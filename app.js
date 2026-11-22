// Leveling order page: add Pokémon to your box, set each species up, send the order to Discord.
// Orders go to the relay (relay/worker.js, a Cloudflare Worker) which holds the Discord webhook - never put the webhook here.
// The page only says WHAT is ordered; the relay checks it and works out the prices itself (prices here are for show).
const ORDER_URL = 'https://pokemmo-orders-relay.cassnadra.workers.dev/';   // the relay (relay/worker.js on Cloudflare)
const TURNSTILE_SITEKEY = '0x4AAAAAAGLeSbSbBjB4e7Eq';                     // Cloudflare's invisible bot check (the relay needs its token)
if (window.top !== window.self) document.documentElement.hidden = true;     // (not inside another site's frame)
const EV_PRICE = 20000;        // ¥ per Pokémon with any EVs (leveling: 0.17 ¥ per exp, in unitPrice)
const BOX = 60;                // a PokeMMO box: up to 60 shown one by one, more collapse into one stack per species
const MAX_SPECIES = 20, MAX_QTY = 60, COOLDOWN_MS = 60000;
const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
const STAT_TAG = ['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'];

const $ = id => document.getElementById(id);
const byId = new Map(SPECIES.map(s => [s.uid, s]));   // (uid: the game's id; forms share their species' number)
const sprite = img => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/${img}.png`;
const yen = n => n.toLocaleString('en-US') + ' ¥';
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let items = [];               // one per species: {id, qty, from, to, evs: [6], moves: [names]}
let sel = 0;                  // the species selected in the box (0 = none)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function cleanDraft(raw) {
  const seen = new Set(), out = [];
  for (const i of Array.isArray(raw) ? raw : []) {
    if (!i || !byId.has(i.id) || seen.has(i.id) || out.length >= MAX_SPECIES) continue;
    const s = byId.get(i.id), names = new Set(s.moves.map(m => m[1]));
    const evs = Array.isArray(i.evs) && i.evs.length === 6 && i.evs.every(v => isInt(v, 0, 252)) && i.evs.reduce((a, b) => a + b, 0) <= 510 ? i.evs : [0, 0, 0, 0, 0, 0];
    seen.add(i.id);
    out.push({ id: i.id, qty: isInt(i.qty, 1, MAX_QTY) ? i.qty : 1, from: isInt(i.from, 1, 100) ? i.from : 1, to: isInt(i.to, 1, 100) ? i.to : 100, evs,
               moves: (Array.isArray(i.moves) ? i.moves : []).filter((m, k, a) => typeof m === 'string' && names.has(m) && a.indexOf(m) === k).slice(0, 4) });
  }
  return out;
}
try { items = cleanDraft(JSON.parse(localStorage.getItem('order') || '[]')); } catch { items = []; }
const saveDraft = () => { try { localStorage.setItem('order', JSON.stringify(items)); } catch {} };
const item = id => items.find(i => i.id === id);

// ---- pricing
const evTotal = evs => evs.reduce((a, b) => a + b, 0);
// what's wrong with a line's levels ('' = fine): the same level twice is an EV-only order, so it needs EVs
function levelError(it) {
  if (it.to < it.from) return 'The target level can\'t be below the starting level.';
  if (it.to === it.from && !evTotal(it.evs)) return 'Same level: EV training only - set some EVs, or raise the target level.';
  return '';
}
function expNeeded(it) { const t = EXP[byId.get(it.id).group]; return Math.max(0, t[it.to] - t[it.from]); }
function unitPrice(it) { return Math.ceil(expNeeded(it) * 17 / 100) + (evTotal(it.evs) > 0 ? EV_PRICE : 0); }   // (in whole numbers: 0.17 as a float rounded 210,800 up to 210,801)
const linePrice = it => unitPrice(it) * it.qty;
const total = () => items.reduce((a, it) => a + linePrice(it), 0);
const count = () => items.reduce((a, it) => a + it.qty, 0);
function evString(evs) { return evs.map((v, i) => v ? STAT_TAG[i] + v : '').filter(Boolean).join('/') || 'none'; }

// ---- adding
function drawResults() {
  const q = $('search').value.trim().toLowerCase().replace(/^#/, ''), res = $('results');
  res.innerHTML = '';
  if (!q) return;
  const list = SPECIES.filter(s => s.name.toLowerCase().includes(q) || String(s.id) === q).slice(0, 40);
  if (!list.length) { res.innerHTML = '<div class="empty">No Pokémon by that name.</div>'; return; }
  list.forEach(s => {
    const d = document.createElement('div'); d.className = 'res'; d.tabIndex = 0;
    const have = item(s.uid);
    d.innerHTML = `<img loading="lazy" alt="" src="${sprite(s.img)}"><span>#${s.id} <b>${s.name}</b></span>` +
                  (have ? `<span class="in">(${have.qty} in your box)</span>` : '') + `<span class="g">${s.group}</span>`;
    d.onclick = () => add(s.uid);
    d.onkeydown = e => { if (e.key === 'Enter') add(s.uid); };
    res.appendChild(d);
  });
}
function add(id) {
  const it = item(id);
  if (it) it.qty = Math.min(MAX_QTY, it.qty + 1);
  else if (items.length >= MAX_SPECIES) { status(`Up to ${MAX_SPECIES} different species per order.`, 'err'); return; }
  else items.push({ id, qty: 1, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: [] });
  sel = id; $('search').value = ''; drawResults(); changed(true);
}
$('search').oninput = drawResults;
$('search').onkeydown = e => { const f = $('results').querySelector('.res'); if (e.key === 'Enter' && f) f.click(); };

// ---- the box
function drawBox() {
  const grid = $('grid'), n = count(), stacked = n > BOX;
  $('boxInfo').textContent = `${n} Pokémon` + (stacked ? ' (stacked by species)' : '');
  grid.innerHTML = '';
  const slots = [];
  items.forEach(it => { if (stacked) slots.push([it, it.qty]); else for (let k = 0; k < it.qty; k++) slots.push([it, 0]); });
  slots.forEach(([it, stack]) => {
    const s = byId.get(it.id), b = document.createElement('button');
    b.className = 'slot' + (it.id === sel ? ' sel' : '');
    b.title = `${s.name} (${s.group})` + (stack ? ` x${stack}` : '');
    b.innerHTML = `<img alt="${s.name}" src="${sprite(s.img)}">` + (stack ? `<span class="badge">x${stack}</span>` : '');
    b.onclick = () => select(it.id);
    grid.appendChild(b);
  });
  for (let k = slots.length; k < BOX; k++) { const d = document.createElement('div'); d.className = 'slot'; grid.appendChild(d); }
  $('boxHint').hidden = !items.length;
}
function select(id) { sel = id; drawEditor(); drawBox(); drawOrder(); }

// ---- the editor (changes the selected species straight away)
function drawEditor() {
  const it = item(sel);
  $('editorEmpty').hidden = !!it; $('editorBody').hidden = !it;
  if (!it) return;
  const s = byId.get(it.id);
  $('edSprite').src = sprite(s.img); $('edSprite').alt = s.name;
  $('edName').textContent = `#${s.id} ${s.name}`;
  $('edGroup').textContent = s.group;
  $('lvFrom').value = it.from; $('lvTo').value = it.to; $('qty').value = it.qty;
  const evs = $('evs'); evs.innerHTML = '';
  STATS.forEach((name, i) => {
    const row = document.createElement('div'); row.className = 'ev';
    row.innerHTML = `<span>${name}</span><input type="range" min="0" max="252" value="${it.evs[i]}"><input type="number" min="0" max="252" value="${it.evs[i]}">`;
    const [range, num] = row.querySelectorAll('input');
    const set = v => {
      v = Math.max(0, Math.min(252, Math.floor(+v || 0)));
      v = Math.min(v, 510 - (evTotal(it.evs) - it.evs[i]));   // 510 in all
      it.evs[i] = v; range.value = v; num.value = v; changed();
    };
    range.oninput = () => set(range.value); num.onchange = () => set(num.value);
    evs.appendChild(row);
  });
  const mv = $('moves'); mv.innerHTML = '';
  if (!s.moves.length) mv.innerHTML = '<p class="empty">No level-up moves.</p>';
  s.moves.forEach(([lvs, name]) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox"><span class="mn">${name}</span><span class="lv">Lv ${lvs.join(', ')}</span>`;
    const box = l.querySelector('input');
    box.checked = it.moves.includes(name);
    box.onchange = () => {
      if (box.checked && !it.moves.includes(name)) it.moves.push(name);
      if (!box.checked) it.moves = it.moves.filter(m => m !== name);
      changed();
    };
    mv.appendChild(l);
  });
  refreshEditor();
}
function refreshEditor() {
  const it = item(sel); if (!it) return;
  $('evTotal').textContent = `(${evTotal(it.evs)} / 510)`;
  $('evStr').textContent = evString(it.evs);
  const full = it.moves.length >= 4;
  document.querySelectorAll('#moves label').forEach(l => {
    const b = l.querySelector('input'), off = full && !b.checked;
    b.disabled = off; l.classList.toggle('off', off);
  });
  $('expLine').textContent = levelError(it) || (it.to === it.from ? 'No leveling: EV training only.' : `${expNeeded(it).toLocaleString('en-US')} exp each`);
  $('unitPrice').textContent = yen(unitPrice(it));
  $('linePrice').textContent = yen(linePrice(it));
  $('qtyMinus').disabled = it.qty <= 1; $('qtyPlus').disabled = it.qty >= MAX_QTY;
}
function setQty(v) { const it = item(sel); if (!it) return; it.qty = Math.max(1, Math.min(MAX_QTY, Math.floor(+v || 1))); changed(); }
$('qty').oninput = () => setQty($('qty').value);
$('qty').onchange = () => { const it = item(sel); if (it) $('qty').value = it.qty; };
$('qtyMinus').onclick = () => { setQty(item(sel).qty - 1); $('qty').value = item(sel).qty; };
$('qtyPlus').onclick = () => { setQty(item(sel).qty + 1); $('qty').value = item(sel).qty; };
function setLevels() {
  const it = item(sel); if (!it) return;
  it.from = Math.max(1, Math.min(100, Math.floor(+$('lvFrom').value || 1)));
  it.to = Math.max(1, Math.min(100, Math.floor(+$('lvTo').value || 100)));
  changed();
}
['lvFrom', 'lvTo'].forEach(k => { $(k).oninput = setLevels; $(k).onchange = () => { const it = item(sel); if (it) { $('lvFrom').value = it.from; $('lvTo').value = it.to; } }; });
function remove(id) {
  items = items.filter(i => i.id !== id);
  if (sel === id) sel = 0;
  drawEditor(); changed(true);
}
$('removeBtn').onclick = () => remove(sel);

// ---- the order
function itemDetail(it) {
  const parts = [it.to === it.from ? `Lv ${it.from} (EVs only)` : `Lv ${it.from} → ${it.to}`, `EVs ${evString(it.evs)}`];
  if (it.moves.length) parts.push('Moves: ' + it.moves.join(', '));
  return parts.join(' · ');
}
function drawOrder() {
  const t = $('items'); t.innerHTML = '';
  items.forEach((it, i) => {
    const s = byId.get(it.id), tr = document.createElement('tr');
    if (it.id === sel) tr.className = 'sel';
    tr.innerHTML = `<td><img alt="" src="${sprite(s.img)}"></td><td><div class="t">Item ${i + 1}: ${yen(linePrice(it))}</div>
      <div>${it.qty} &times; ${s.name} <span class="small">(${yen(unitPrice(it))} each)</span></div>
      <div class="d">${esc(itemDetail(it))}</div></td>
      <td class="acts"><button data-a="e">Edit</button><button data-a="r">Remove</button></td>`;
    tr.querySelector('[data-a=e]').onclick = () => { select(it.id); $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    tr.querySelector('[data-a=r]').onclick = () => remove(it.id);
    t.appendChild(tr);
  });
  $('itemsEmpty').hidden = items.length > 0;
  document.querySelectorAll('.orderTotal').forEach(e => e.textContent = yen(total()));
  checkReady();
}
// something in the order changed: redraw (full: the editor too)
function changed(full) {
  saveDraft();
  if ($('status').classList.contains('ok')) status('');
  if (full) drawEditor(); else refreshEditor();
  drawBox(); drawOrder();
}

// ---- meeting time + names
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
$('tzNote').textContent = `Your time zone: ${tz}`;
const when = () => document.querySelector('input[name=when]:checked').value;
document.querySelectorAll('input[name=when]').forEach(r => r.onchange = () => { $('rangeBox').hidden = when() !== 'range'; checkReady(); });
['tFrom', 'tTo', 'ign', 'discord', 'notes'].forEach(k => $(k).oninput = checkReady);
$('confirm').onchange = checkReady;

function rangeError() {
  if (when() !== 'range') return '';
  const a = new Date($('tFrom').value), b = new Date($('tTo').value);
  if (isNaN(a) || isNaN(b)) return 'Pick both ends of your time range.';
  if (b <= a) return 'The end of your time range must be after its start.';
  if (b <= new Date()) return 'Your time range is in the past.';
  return '';
}
function problem() {
  if (!items.length) return 'Add at least one Pokémon to your order.';
  const bad = items.find(i => levelError(i));
  if (bad) return `${byId.get(bad.id).name}: ${levelError(bad)}`;
  const r = rangeError(); if (r) return r;
  if (!$('ign').value.trim()) return 'Enter your in-game name.';
  if (!$('discord').value.trim()) return 'Enter your Discord username.';
  if (!$('confirm').checked) return 'Tick the box to confirm your order.';
  return '';
}
function status(text, kind) { $('status').textContent = text; $('status').className = 'status' + (kind ? ' ' + kind : ''); }
let sending = false;
function checkReady() {
  const p = problem();
  $('submit').disabled = !!p || sending;
  if (!sending && !$('status').classList.contains('ok') && !$('status').classList.contains('err')) status(items.length ? p : '');
}

// ---- sending
function order() {
  let w = { type: 'soon' };
  if (when() === 'range') w = { type: 'range', start: Math.floor(new Date($('tFrom').value) / 1000), end: Math.floor(new Date($('tTo').value) / 1000), tz };
  return { items: items.map(it => ({ uid: it.id, qty: it.qty, from: it.from, to: it.to, evs: it.evs, moves: it.moves })),
           when: w, ign: $('ign').value.trim(), discord: $('discord').value.trim(), notes: $('notes').value.trim(), shown: total() };
}
// ---- the bot check (Cloudflare Turnstile, invisible): a fresh token for each order
let tsWidget = null, tsWaiting = null;
(function tsInit() {
  if (!TURNSTILE_SITEKEY) return;
  if (!window.turnstile) return void setTimeout(tsInit, 200);
  tsWidget = turnstile.render('#turnstile', { sitekey: TURNSTILE_SITEKEY, execution: 'execute', appearance: 'interaction-only',
    callback: t => { if (tsWaiting) { tsWaiting.ok(t); tsWaiting = null; } },
    'error-callback': () => { if (tsWaiting) { tsWaiting.no(new Error('the bot check failed')); tsWaiting = null; } } });
})();
function botToken() {
  if (!TURNSTILE_SITEKEY) return Promise.resolve('');
  if (tsWidget === null) return Promise.reject(new Error("the bot check didn't load - reload the page"));
  return new Promise((ok, no) => {
    tsWaiting = { ok, no };
    turnstile.reset(tsWidget); turnstile.execute(tsWidget);
    setTimeout(() => { if (tsWaiting) { tsWaiting = null; no(new Error('the bot check timed out')); } }, 30000);
  });
}
$('submit').onclick = async () => {
  if (problem()) return;
  let last = 0; try { last = +localStorage.getItem('lastOrder') || 0; } catch {}
  if (Date.now() - last < COOLDOWN_MS) { status('You just sent an order - wait a minute before sending another.', 'err'); return; }
  sending = true; status('Sending...'); checkReady();
  try {
    if (!ORDER_URL) throw new Error('ordering is not switched on yet');
    const body = { ...order(), turnstile: await botToken() };
    const r = await fetch(ORDER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.text().catch(() => '')).slice(0, 120) || 'HTTP ' + r.status);
    try { localStorage.setItem('lastOrder', String(Date.now())); } catch {}
    items = []; sel = 0; $('confirm').checked = false; $('notes').value = '';
    sending = false; changed(true);
    status('Order sent! I will contact you soon.', 'ok');
  } catch (e) {
    status(`Couldn't send your order (${e.message}). Try again in a moment.`, 'err');
  } finally { sending = false; checkReady(); }
};
// (an error message goes once the form changes)
document.addEventListener('input', () => { if ($('status').classList.contains('err')) { status(''); checkReady(); } });

drawEditor(); drawBox(); drawOrder();
