// Tests relay/worker.js with Discord stubbed out (nothing is sent). Run: node relay/worker_test.mjs
import worker from './worker.js';

const posted = [];
globalThis.fetch = async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); };
const env = { WEBHOOK_URL: 'https://discord.example/hook', ALLOWED_ORIGIN: 'https://cassnadra.github.io' };
let fails = 0;
const ok = (c, what) => { console.log((c ? 'PASS ' : 'FAIL ') + what); if (!c) fails++; };
const req = (body, { origin = env.ALLOWED_ORIGIN, ip = '1.1.1.1', method = 'POST' } = {}) =>
  new Request('https://relay.example/', { method, headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' }, body: method === 'POST' ? body : undefined });
const order = (extra = {}) => JSON.stringify({
  username: 'x', content: '@everyone hi', allowed_mentions: { parse: ['everyone'] },
  embeds: [{ title: 'New order: 2 Pokémon, 380,000 ¥', description: '**1. Pikachu** x2', fields: [{ name: 'Total', value: '380,000 ¥', inline: true }, { name: 'Notes', value: '@everyone' }], ...extra }],
});

let r = await worker.fetch(req(null, { method: 'OPTIONS' }), env);
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === env.ALLOWED_ORIGIN, 'CORS preflight');
r = await worker.fetch(req(order(), { origin: 'https://evil.example' }), env);
ok(r.status === 403 && posted.length === 0, 'other sites refused');
r = await worker.fetch(req('{"content":"spam"}', { ip: '2.2.2.2' }), env);
ok(r.status === 400 && posted.length === 0, 'non-orders refused');
r = await worker.fetch(req(order(), { ip: '3.3.3.3' }), env);
ok(r.status === 204 && posted.length === 1, 'an order goes through');
const p = posted[0].body;
ok(posted[0].url === env.WEBHOOK_URL, 'to the secret webhook');
ok(!('content' in p) && p.allowed_mentions.parse.length === 0 && p.username === 'Leveling Orders', 'no content, no pings, fixed name');
ok(p.embeds[0].fields[1].value === '@everyone' && p.embeds[0].description.includes('Pikachu'), 'the order itself kept');
r = await worker.fetch(req(order(), { ip: '3.3.3.3' }), env);
ok(r.status === 429 && posted.length === 1, 'a second order within a minute refused');
r = await worker.fetch(req(order({ description: 'x'.repeat(20000) }), { ip: '4.4.4.4' }), env);
ok(r.status === 413, 'oversized refused');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
