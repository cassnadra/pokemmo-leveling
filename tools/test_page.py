# Drives the order page in headless Edge. The relay's address and Cloudflare's bot check are intercepted (nothing is sent).
# Run: python tools/test_page.py OUTDIR
import json, sys, os, pathlib
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
url = pathlib.Path(__file__).resolve().parent.parent.joinpath('index.html').as_uri()
sent, errors = [], []

def ok(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond: errors.append(what)

def add(pg, q):
    pg.fill('#search', q); pg.locator('#results .res').first.click()

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=True)
    pg = b.new_page(viewport={'width': 1100, 'height': 900})
    pg.on('pageerror', lambda e: errors.append('page error: %s' % e))
    def hook(route):
        sent.append(json.loads(route.request.post_data)); route.fulfill(status=204, body='')
    pg.route('https://pokemmo-orders-relay.cassnadra.workers.dev/**', hook)   # (the real relay's address, answered here)
    # a stand-in for Cloudflare's Turnstile script: execute() hands back a token
    TS = ("window.turnstile = { _cb: null, render(el, o) { this._cb = o.callback; return 'w1'; }, reset() {},"
          " execute() { setTimeout(() => this._cb('stub-token'), 20); } };")
    pg.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(content_type='application/javascript', body=TS))
    pg.on('console', lambda m: errors.append('console: ' + m.text) if 'Content Security Policy' in m.text else None)
    # a tampered saved draft (as another page on cassnadra.github.io could leave): cleaned before use
    pg.add_init_script('''if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
      localStorage.setItem('order', JSON.stringify([{ id: 25, qty: 'x', from: 1, to: 100,
        evs: ['"><img src=x onerror=window.pwned=1>', 0, 0, 0, 0, 0], moves: ['Spore', '<b>x</b>'] }, { id: 99999 }])); }''')
    pg.goto(url); pg.wait_for_load_state('networkidle')

    ok(pg.locator('#items tr').count() == 1 and not pg.evaluate('window.pwned'), 'a tampered draft: cleaned (1 Pikachu, no injected code)')
    pg.locator('#items tr').first.locator('button', has_text='Edit').click()
    ok(pg.input_value('#qty') == '1' and pg.inner_text('#evStr') == 'none' and not pg.locator('#moves input:checked').count(), 'its bad quantity / EVs / moves reset')
    pg.click('#removeBtn')
    ok(pg.locator('#grid .slot').count() == 60, 'an empty 60-slot box')
    add(pg, 'pikachu')
    ok(pg.inner_text('#edName') == '#25 Pikachu', 'search + add Pikachu')
    ok(pg.inner_text('#edGroup') == 'Medium Fast', 'Pikachu is Medium Fast')
    ok(pg.inner_text('#unitPrice') == '170,000 ¥', 'Lv 1-100 price 170,000')
    nums = pg.locator('#evs input[type=number]')
    for i, v in [(0, '4'), (3, '252'), (5, '252'), (1, '252')]:
        nums.nth(i).fill(v); nums.nth(i).dispatch_event('change')
    ok(pg.inner_text('#evStr') == 'HP4/ATK2/SPA252/SPE252', 'EVs capped at 510 (Atk got 2)')
    nums.nth(1).fill('0'); nums.nth(1).dispatch_event('change')
    ok(pg.inner_text('#evStr') == 'HP4/SPA252/SPE252', 'EV string')
    ok(pg.inner_text('#unitPrice') == '190,000 ¥', 'EVs add 20,000')
    maxes = pg.locator('#evs button.max')
    maxes.nth(2).click()
    ok(pg.inner_text('#evStr') == 'HP4/DEF2/SPA252/SPE252' and nums.nth(2).input_value() == '2', 'the 252 button: what is left of 510 (Def got 2)')
    nums.nth(2).fill('0'); nums.nth(2).dispatch_event('change'); nums.nth(0).fill('0'); nums.nth(0).dispatch_event('change')
    nums.nth(5).fill('0'); nums.nth(5).dispatch_event('change'); maxes.nth(0).click()
    ok(pg.inner_text('#evStr') == 'HP252/SPA252', 'the 252 button: 252')
    maxes.nth(0).click(); nums.nth(0).fill('4'); nums.nth(0).dispatch_event('change'); maxes.nth(5).click()
    ok(pg.inner_text('#evStr') == 'HP4/SPA252/SPE252', '(back to the earlier EVs)')
    boxes = pg.locator('#moves input')
    for i in range(4): boxes.nth(i).check()
    ok(boxes.nth(4).is_disabled(), 'a 5th move is blocked')
    pg.click('#qtyPlus'); pg.click('#qtyPlus')
    ok(pg.input_value('#qty') == '3' and pg.inner_text('#linePrice') == '570,000 ¥', 'quantity + : 3 x 190,000')
    ok(pg.locator('#grid button.slot').count() == 3, 'the box shows 3 Pikachu one by one')
    add(pg, 'pikachu')
    ok(pg.input_value('#qty') == '4' and pg.locator('#items tr').count() == 1, 'adding Pikachu again adds to its line')
    pg.click('#qtyMinus')

    ok('Lv 1, 5' in pg.inner_text('#moves') and 'Nasty Plot' in pg.inner_text('#moves'), "PokeMMO's moves (Pikachu: Nasty Plot, Growl at 1 and 5)")
    pg.fill('#search', 'rotom')
    ok(pg.locator('#results .res').count() == 6, 'Rotom and its 5 forms: ' + str(pg.locator('#results .res').count()))
    pg.fill('#search', '')
    add(pg, '129')
    ok(pg.inner_text('#edGroup') == 'Slow', 'Magikarp is Slow')
    pg.fill('#lvFrom', '20'); pg.dispatch_event('#lvFrom', 'input')
    want = 570000 + (1250000 - 10000) * 17 // 100   # Slow: Lv 20 = 10,000 exp
    ok(pg.locator('.orderTotal').first.inner_text() == f'{want:,} ¥', 'order total ' + pg.locator('.orderTotal').first.inner_text())
    ok(pg.locator('.orderTotal').count() == 2, 'total shown twice')
    # Lv 20 -> 20: EV-only - needs EVs, then costs just the EV fee
    pg.fill('#lvTo', '20'); pg.dispatch_event('#lvTo', 'input')
    ok('EV training only' in pg.inner_text('#expLine') and 'Magikarp' in pg.inner_text('#status'), 'same level, no EVs: blocked')
    n = pg.locator('#evs input[type=number]').nth(5); n.fill('252'); n.dispatch_event('change')
    ok(pg.inner_text('#unitPrice') == '20,000 ¥' and 'EVs only' in pg.inner_text('#items'), 'same level + EVs: an EV-only order, 20,000')
    pg.fill('#lvTo', '10'); pg.dispatch_event('#lvTo', 'input')
    ok('below' in pg.inner_text('#expLine'), 'target below start: blocked')
    n.fill('0'); n.dispatch_event('change')
    pg.fill('#lvTo', '100'); pg.dispatch_event('#lvTo', 'input')
    pg.screenshot(path=os.path.join(out, 'editor.png'), full_page=True)

    # back to Pikachu from the box: the editor shows its setup
    pg.locator('#grid button.slot').first.click()
    ok(pg.inner_text('#edName') == '#25 Pikachu' and pg.inner_text('#evStr') == 'HP4/SPA252/SPE252', 'box click selects Pikachu with its setup')
    pg.fill('#qty', '58'); pg.dispatch_event('#qty', 'input')
    ok(pg.locator('#grid button.slot').count() == 59, '59 Pokémon shown one by one')
    pg.click('#qtyPlus'); pg.click('#qtyPlus')
    ok(pg.locator('#grid button.slot').count() == 2 and 'x60' in pg.inner_text('#grid'), 'over 60: stacks (Pikachu x60, Magikarp)')
    pg.screenshot(path=os.path.join(out, 'stacked.png'), full_page=True)
    pg.fill('#qty', '2'); pg.dispatch_event('#qty', 'input')

    ok(pg.is_disabled('#submit'), 'cannot send before name / confirm')
    pg.check('input[name=when][value=range]')
    start = datetime.now() + timedelta(hours=2); end = start + timedelta(hours=3)
    pg.fill('#tFrom', start.strftime('%Y-%m-%dT%H:%M')); pg.fill('#tTo', end.strftime('%Y-%m-%dT%H:%M'))
    pg.fill('#ign', 'TestTrainer'); pg.fill('#notes', 'test @everyone')
    pg.check('#confirm')
    ok(pg.is_disabled('#submit') and 'Discord' in pg.inner_text('#status'), 'in-game name alone is not enough')
    pg.fill('#discord', 'test_dc')
    pg.check('#confirm')
    ok(not pg.is_disabled('#submit'), 'ready to send')
    pg.screenshot(path=os.path.join(out, 'ready.png'), full_page=True)
    pg.click('#submit'); pg.wait_for_selector('.status.ok')
    ok(len(sent) == 1, 'one order sent to the relay')
    if sent:
        o = sent[0]
        print(json.dumps(o, indent=1, ensure_ascii=False))
        ok(set(o) == {'items', 'when', 'ign', 'discord', 'notes', 'shown', 'turnstile'} and 'embeds' not in o, 'only the order itself, no message text')
        ok(all(set(i) == {'uid', 'qty', 'from', 'to', 'evs', 'moves'} for i in o['items']), 'no prices or groups in the items')
        ok(o['turnstile'] == 'stub-token', 'with a bot check token')
        ok(o['ign'] == 'TestTrainer' and o['discord'] == 'test_dc', 'both names sent')
        ok(o['when']['type'] == 'range' and o['when']['start'] == int(start.replace(second=0, microsecond=0).timestamp()), 'the time range as Unix time')
    ok(pg.locator('#items tr').count() == 0 and pg.locator('#grid button.slot').count() == 0, 'order cleared after sending')
    ok(pg.inner_text('#status') == 'Order sent! I will contact you soon.', 'sent message')

    ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ph.goto(url); ph.wait_for_load_state('networkidle')
    add(ph, 'eevee'); ph.click('#qtyPlus')
    ok(ph.evaluate('document.documentElement.scrollWidth') <= 390, 'no sideways scroll on a phone')
    ph.screenshot(path=os.path.join(out, 'phone.png'), full_page=True)
    b.close()

print('ERRORS:', errors if errors else 'none')
