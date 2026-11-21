// Order relay (Cloudflare Worker): the order page posts here, this posts to Discord. The webhook URL stays a secret
// (WEBHOOK_URL, set with `wrangler secret put WEBHOOK_URL`), so nobody can read it from the page, delete the webhook
// or post anything else through it. Only an order-shaped embed gets through, it can't ping, and one order a minute
// per address (best effort: per Worker instance).
const MINUTE = 60000;
const recent = new Map();   // address -> last order time

const clip = (s, n) => (typeof s === 'string' ? s : '').slice(0, n);

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://cassnadra.github.io';
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    const reply = (status, text) => new Response(text, { status, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, 'POST only');
    if (req.headers.get('Origin') !== allowed) return reply(403, 'not from the order page');

    const ip = req.headers.get('CF-Connecting-IP') || '?', now = Date.now();
    if (now - (recent.get(ip) || 0) < MINUTE) return reply(429, 'one order a minute');

    const text = await req.text();
    if (text.length > 12000) return reply(413, 'too big');
    let body;
    try { body = JSON.parse(text); } catch { return reply(400, 'not JSON'); }
    const e = body && Array.isArray(body.embeds) && body.embeds.length === 1 && body.embeds[0];
    if (!e || typeof e.title !== 'string' || !e.title.startsWith('New order:') || !Array.isArray(e.fields)) return reply(400, 'not an order');

    // rebuilt field by field: only what an order has, within Discord's limits
    const embed = {
      title: clip(e.title, 256), description: clip(e.description, 4000), color: 0xf0c020, timestamp: new Date().toISOString(),
      fields: e.fields.slice(0, 6).map(f => ({ name: clip(f && f.name, 64) || '-', value: clip(f && f.value, 1024) || '-', inline: !!(f && f.inline) })),
    };
    const r = await fetch(env.WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Leveling Orders', allowed_mentions: { parse: [] }, embeds: [embed] }),
    });
    if (!r.ok) return reply(502, 'Discord said ' + r.status);
    recent.set(ip, now);
    if (recent.size > 5000) recent.clear();
    return reply(204, null);
  },
};
