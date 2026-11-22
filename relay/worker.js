// Order relay (Cloudflare Worker): the order page posts the order here, this checks it, prices it and posts it to
// Discord. The page sends only WHAT was ordered (Pokemon, levels, EVs, moves, time, names, notes) - never prices or
// message text - so a tampered page or a hand-made request can't change a price, an exp group or what you read.
//   WEBHOOK_URL        secret: the Discord webhook (nobody can read it from the page, delete it or post through it)
//   TURNSTILE_SECRET   secret: Cloudflare Turnstile (when set, every order needs a passed bot check)
//   ALLOWED_ORIGIN     the order page's origin
import { EXP, SPECIES } from './data.js';

const EV_PRICE = 20000;                      // per Pokemon with any EVs; leveling 0.17 per exp (unitPrice)
const MAX_SPECIES = 20, MAX_QTY = 60, MAX_NOTES = 800, MAX_WHO = 40;
const PER_IP_MS = 60000, PER_INSTANCE_PER_MIN = 10;
const STAT_TAG = ['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'];
const BY_UID = new Map(SPECIES.map(s => [s.uid, s]));
const MOVES = new Map(SPECIES.map(s => [s.uid, new Set(s.moves.map(m => m[1]))]));

const recent = new Map();                    // address -> last order (pruned, never wiped: wiping resets everyone)
let windowStart = 0, windowCount = 0;        // this instance's orders in the current minute

const yen = n => n.toLocaleString('en-US') + ' ¥';
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const evTotal = evs => evs.reduce((a, b) => a + b, 0);
const evString = evs => evs.map((v, i) => v ? STAT_TAG[i] + v : '').filter(Boolean).join('/') || 'none';
function expNeeded(it) { const t = EXP[BY_UID.get(it.uid).group]; return t[it.to] - t[it.from]; }
function unitPrice(it) { return Math.ceil(expNeeded(it) * 17 / 100) + (evTotal(it.evs) > 0 ? EV_PRICE : 0); }
// what a customer types: one line or a few, with Discord's markdown, links, mentions and timestamps made plain text
function plain(s, max, lines) {
  s = String(s).normalize('NFKC').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁠-⁯﻿]/g, '');
  s = lines ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  s = s.trim().slice(0, max);
  return s.replace(/[\\`*_~|>#\-[\]()<@:/]/g, c => '\\' + c);
}

// the order as the page sent it -> {items, when, ign, discord, notes, shown} or an error string
function check(o, now) {
  if (!o || typeof o !== 'object') return 'not an order';
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > MAX_SPECIES) return 'bad items';
  const seen = new Set(), items = [];
  for (const x of o.items) {
    if (!x || !BY_UID.has(x.uid) || seen.has(x.uid)) return 'bad Pokemon';
    seen.add(x.uid);
    if (!isInt(x.qty, 1, MAX_QTY) || !isInt(x.from, 1, 100) || !isInt(x.to, 1, 100) || x.to < x.from) return 'bad quantity or levels';
    if (!Array.isArray(x.evs) || x.evs.length !== 6 || !x.evs.every(v => isInt(v, 0, 252)) || evTotal(x.evs) > 510) return 'bad EVs';
    if (x.to === x.from && !evTotal(x.evs)) return 'nothing to do';
    if (!Array.isArray(x.moves) || x.moves.length > 4 || new Set(x.moves).size !== x.moves.length ||
        !x.moves.every(m => typeof m === 'string' && MOVES.get(x.uid).has(m))) return 'bad moves';
    items.push({ uid: x.uid, qty: x.qty, from: x.from, to: x.to, evs: x.evs.slice(), moves: x.moves.slice() });
  }
  let when;
  if (o.when && o.when.type === 'soon') when = { type: 'soon' };
  else if (o.when && o.when.type === 'range' && isInt(o.when.start, 0, 2 ** 40) && isInt(o.when.end, 0, 2 ** 40)) {
    const { start, end } = o.when, nowS = now / 1000;
    if (end <= start || end <= nowS || start > nowS + 60 * 86400 || end - start > 14 * 86400) return 'bad time range';
    let tz = typeof o.when.tz === 'string' ? o.when.tz.slice(0, 64) : '';
    try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); } catch { tz = ''; }
    when = { type: 'range', start, end, tz };
  } else return 'bad time';
  // names never refuse an order (an old cached page sends {contact, who} instead): shown as given, or '(not given)'
  const str = v => typeof v === 'string' ? v.slice(0, 400) : '';
  let ign = str(o.ign), discord = str(o.discord);
  if (!ign.trim() && !discord.trim() && str(o.who).trim()) (o.contact === 'In-game mail' ? (ign = str(o.who)) : (discord = str(o.who)));
  const named = v => plain(v, MAX_WHO) || '(not given)';
  if (o.notes != null && (typeof o.notes !== 'string' || o.notes.length > 4000)) return 'bad notes';
  return { items, when, ign: named(ign), discord: named(discord), notes: plain(o.notes || '', MAX_NOTES, true),
           shown: Number.isSafeInteger(o.shown) ? o.shown : null };
}

function embedFor(o) {
  const total = o.items.reduce((a, it) => a + unitPrice(it) * it.qty, 0), count = o.items.reduce((a, it) => a + it.qty, 0);
  const lines = o.items.map((it, i) => {
    const s = BY_UID.get(it.uid);
    const parts = [it.to === it.from ? `Lv ${it.from} (EVs only)` : `Lv ${it.from} → ${it.to}`, `EVs ${evString(it.evs)}`];
    if (it.moves.length) parts.push('Moves: ' + it.moves.join(', '));
    return `**${i + 1}. ${s.name}** ×${it.qty} — *${s.group}* — ${yen(unitPrice(it))} each = **${yen(unitPrice(it) * it.qty)}**\n　${parts.join(' · ')}`;
  });
  let meet = 'Within a few hours';
  if (o.when.type === 'range') {
    const { start, end, tz } = o.when;
    meet = `<t:${start}:F> → <t:${end}:F> (starts <t:${start}:R>)`;   // (Discord shows these in your own time)
    if (tz) {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
      meet += `\nTheir time: ${f.format(start * 1000)} – ${f.format(end * 1000)} (${tz})`;
    }
  }
  const fields = [
    { name: 'Total', value: yen(total), inline: true },
    { name: 'In-game name', value: o.ign, inline: true },
    { name: 'Discord', value: o.discord, inline: true },
    { name: 'Meet', value: meet },
  ];
  if (o.notes) fields.push({ name: 'Notes', value: o.notes.slice(0, 1024) });
  if (o.shown !== null && o.shown !== total) fields.push({ name: '⚠ Price mismatch', value: `Their page showed ${yen(Math.max(0, o.shown))} - the total above is the real one.` });
  return { title: `New order: ${count} Pokémon, ${yen(total)}`, description: lines.join('\n').slice(0, 4000), color: 0xf0c020,
           fields, timestamp: new Date().toISOString() };
}

async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET); form.append('response', token); form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const v = await r.json().catch(() => ({}));
  const host = new URL(env.ALLOWED_ORIGIN || 'https://cassnadra.github.io').hostname;
  return v.success === true && v.hostname === host;
}

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://cassnadra.github.io';
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
                   'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const reply = (status, text) => new Response(text, { status, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, 'POST only');
    if (req.headers.get('Origin') !== allowed) return reply(403, 'not from the order page');

    const ip = req.headers.get('CF-Connecting-IP') || '?', now = Date.now();
    if (now - (recent.get(ip) || 0) < PER_IP_MS) return reply(429, 'one order a minute');
    if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
    if (windowCount >= PER_INSTANCE_PER_MIN) return reply(429, 'busy - try again in a minute');

    const text = await req.text();
    if (text.length > 8000) return reply(413, 'too big');
    let body;
    try { body = JSON.parse(text); } catch { return reply(400, 'not JSON'); }
    const o = check(body, now);
    if (typeof o === 'string') return reply(400, o);
    if (!(await turnstileOk(env, body.turnstile, ip))) return reply(403, 'bot check failed - reload the page and try again');

    windowCount++;
    recent.set(ip, now);
    for (const [k, t] of recent) if (now - t >= PER_IP_MS) recent.delete(k);   // (only the expired ones)
    const r = await fetch(env.WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Leveling Orders', allowed_mentions: { parse: [] }, embeds: [embedFor(o)] }),
    });
    if (!r.ok) { recent.delete(ip); return reply(502, 'Discord said ' + r.status); }
    return reply(204, null);
  },
};
