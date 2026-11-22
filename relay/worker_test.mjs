// Tests relay/worker.js with Discord and Turnstile stubbed out (nothing is sent). Run: node relay/worker_test.mjs
import worker from './worker.js';

const posted = [], verified = [];
let turnstilePass = true;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('siteverify')) {
    verified.push(init.body.get('response'));
    return new Response(JSON.stringify({ success: turnstilePass, hostname: 'cassnadra.github.io' }));
  }
  posted.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 204 });
};
const env = { WEBHOOK_URL: 'https://discord.example/hook', ALLOWED_ORIGIN: 'https://cassnadra.github.io', TURNSTILE_SECRET: 'x' };
let fails = 0, ipn = 0;
const ok = (c, what) => { console.log((c ? 'PASS ' : 'FAIL ') + what); if (!c) fails++; };
const req = (body, { origin = env.ALLOWED_ORIGIN, ip = 'ip' + ++ipn, method = 'POST' } = {}) =>
  new Request('https://relay.example/', { method, headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
                                           body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
const order = (extra = {}) => ({
  items: [{ uid: 25, qty: 2, from: 1, to: 100, evs: [4, 0, 0, 252, 0, 252], moves: ['Thunderbolt', 'Nasty Plot'] },
          { uid: 129, qty: 1, from: 20, to: 20, evs: [0, 0, 0, 0, 0, 252], moves: [] }],
  when: { type: 'range', start: Math.floor(Date.now() / 1000) + 3600, end: Math.floor(Date.now() / 1000) + 7200, tz: 'Europe/Berlin' },
  ign: 'Trainer', discord: 'trainer_dc', notes: 'hi', shown: 400000, turnstile: 'tok', ...extra,
});
const send = async (o, opts) => { const n = posted.length; const r = await worker.fetch(req(o, opts), env); return { r, p: posted.length > n ? posted[posted.length - 1].body : null }; };

let r = await worker.fetch(req(null, { method: 'OPTIONS' }), env);
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === env.ALLOWED_ORIGIN, 'CORS preflight');
ok((await send(order(), { origin: 'https://evil.example' })).r.status === 403, 'other sites refused');

// a good order: priced by the relay, not the page
let { r: r1, p } = await send(order());
ok(r1.status === 204 && p, 'a good order goes through');
const e = p && p.embeds[0];
ok(e.fields[0].value === '400,000 ¥', 'total priced by the relay: 2 x 190,000 + 20,000 = ' + (e && e.fields[0].value));
ok(e.description.includes('Pikachu** ×2') && e.description.includes('*Medium Fast*') && e.description.includes('Magikarp') && e.description.includes('Lv 20 (EVs only)'), 'lines written by the relay');
ok(!e.fields.some(f => f.name.includes('mismatch')), 'no mismatch warning when the page showed the right total');
ok(e.fields[1].value === 'Trainer' && e.fields[2].value === 'trainer\\_dc', 'both names: ' + (e && e.fields[1].value + ' / ' + e.fields[2].value));
ok(/<t:\d+:F> → <t:\d+:F>/.test(e.fields[3].value) && e.fields[3].value.includes('Europe/Berlin'), 'meeting time: Discord timestamps + their time');
ok(!('content' in p) && p.allowed_mentions.parse.length === 0 && p.username === 'Leveling Orders', 'no content, no pings, fixed name');
ok(verified.includes('tok'), 'the bot check was asked');

// tampering
({ p } = await send(order({ shown: 1 })));
ok(p && p.embeds[0].fields[0].value === '400,000 ¥' && p.embeds[0].fields.some(f => f.name.includes('mismatch') && f.value.includes('1 ¥')), 'a faked price: real total + a warning');
({ p } = await send(order({ items: [{ uid: 25, qty: 1, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: [], price: 1, group: 'Fast' }] })));
ok(p && p.embeds[0].fields[0].value === '170,000 ¥' && !p.embeds[0].description.includes('*Fast*'), 'extra price / group fields ignored');
const bad = async (items, what) => ok((await send(order({ items }))).r.status === 400, what);
await bad([{ uid: 9999, qty: 1, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: [] }], 'made-up Pokemon refused');
await bad([{ uid: 25, qty: 1, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: ['Spore'] }], "a move it doesn't learn refused");
await bad([{ uid: 25, qty: 1, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: ['Growl', 'Growl'] }], 'a move twice refused');
await bad([{ uid: 25, qty: 1, from: 1, to: 100, evs: [252, 252, 252, 0, 0, 0], moves: [] }], 'over 510 EVs refused');
await bad([{ uid: 25, qty: 1, from: 1, to: 100, evs: [300, 0, 0, 0, 0, 0], moves: [] }], 'over 252 in a stat refused');
await bad([{ uid: 25, qty: 0, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: [] }], 'quantity 0 refused');
await bad([{ uid: 25, qty: 1.5, from: 1, to: 100, evs: [0, 0, 0, 0, 0, 0], moves: [] }], 'a fractional quantity refused');
await bad([{ uid: 25, qty: 1, from: 50, to: 10, evs: [0, 0, 0, 0, 0, 0], moves: [] }], 'target below start refused');
await bad([{ uid: 25, qty: 1, from: 5, to: 5, evs: [0, 0, 0, 0, 0, 0], moves: [] }], 'same level without EVs refused');
await bad(Array.from({ length: 21 }, (_, i) => ({ uid: i + 1, qty: 1, from: 1, to: 2, evs: [0, 0, 0, 0, 0, 0], moves: [] })), 'over 20 species refused');
ok((await send(order({ when: { type: 'range', start: 100, end: 200 } }))).r.status === 400, 'a time range in the past refused');
({ p } = await send(order({ ign: '  ', discord: undefined })));
ok(p && p.embeds[0].fields[1].value === '(not given)' && p.embeds[0].fields[2].value === '(not given)', 'missing names: still sent, marked (not given)');
({ p } = await send(order({ ign: undefined, discord: undefined, contact: 'In-game mail', who: 'OldPage' })));
ok(p && p.embeds[0].fields[1].value === 'OldPage' && p.embeds[0].fields[2].value === '(not given)', 'an old cached page (contact + who): still sent');
({ p } = await send(order({ ign: 42, discord: 'x'.repeat(5000) })));
ok(p && p.embeds[0].fields[1].value === '(not given)' && p.embeds[0].fields[2].value.length === 40, 'odd names: never refused');

// injection through what a customer types
({ p } = await send(order({ discord: '@everyone <@&123> [click](https://evil.example)', notes: '**PAID IN FULL** <t:0:F> https://evil.example\n\n\n\n#hdr' })));
const contact = p.embeds[0].fields[2].value, notes = p.embeds[0].fields.find(f => f.name === 'Notes').value;
ok(!/(^|[^\\])[@<\[*]/.test(contact) && !/(^|[^\\])(\*\*|<t:|https:\/\/)/.test(notes), 'markdown, mentions, links and timestamps made plain: ' + contact + ' | ' + notes.replace(/\n/g, '\\n'));
ok(p.allowed_mentions.parse.length === 0, 'and pings off anyway');

// the bot check and the limits
turnstilePass = false;
ok((await send(order())).r.status === 403, 'a failed bot check refused');
turnstilePass = true;
ok((await send(order({ turnstile: undefined }))).r.status === 403, 'no bot check token refused');
ok((await worker.fetch(req('x'.repeat(9000)), env)).status === 413, 'oversized refused');
const ip = 'same-ip';
ok((await send(order(), { ip })).r.status === 204 && (await send(order(), { ip })).r.status === 429, 'one order a minute per address');
let busy = 0;
for (let i = 0; i < 12; i++) if ((await send(order())).r.status === 429) busy++;
ok(busy > 0, `at most ${10} orders a minute per relay instance (${busy} of 12 refused)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
