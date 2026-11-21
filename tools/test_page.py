# Drives the order page in headless Edge; orders go to a stand-in relay address that is intercepted (nothing is sent).
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
    pg.route('https://relay.test/**', hook)
    app = pathlib.Path(__file__).resolve().parent.parent.joinpath('app.js').read_text(encoding='utf-8')
    assert "const ORDER_URL = '';" in app or 'const ORDER_URL =' in app
    import re as _re
    pg.route('**/app.js', lambda r: r.fulfill(content_type='application/javascript', body=_re.sub(r"const ORDER_URL = '[^']*';", "const ORDER_URL = 'https://relay.test/';", app)))
    pg.goto(url); pg.wait_for_load_state('networkidle')

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
    pg.check('input[name=contact][value="In-game mail"]')
    ok(pg.get_attribute('#who', 'placeholder') == 'Your in-game name', 'contact switch')
    pg.fill('#who', 'TestTrainer'); pg.fill('#notes', 'test @everyone')
    pg.check('#confirm')
    ok(not pg.is_disabled('#submit'), 'ready to send')
    pg.screenshot(path=os.path.join(out, 'ready.png'), full_page=True)
    pg.click('#submit'); pg.wait_for_selector('.status.ok')
    ok(len(sent) == 1, 'one webhook post')
    if sent:
        e = sent[0]['embeds'][0]
        print(json.dumps(sent[0], indent=1, ensure_ascii=False))
        ok(sent[0]['allowed_mentions'] == {'parse': []}, 'no pings')
        ok('<t:%d:F>' % int(start.replace(second=0, microsecond=0).timestamp()) in json.dumps(e), 'Discord timestamp for the start')
        ok(len(json.dumps(e)) < 6000, 'embed within Discord limits')
    ok(pg.locator('#items tr').count() == 0 and pg.locator('#grid button.slot').count() == 0, 'order cleared after sending')
    ok(pg.inner_text('#status') == 'Order sent! I will contact you soon.', 'sent message')

    ph = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ph.goto(url); ph.wait_for_load_state('networkidle')
    add(ph, 'eevee'); ph.click('#qtyPlus')
    ok(ph.evaluate('document.documentElement.scrollWidth') <= 390, 'no sideways scroll on a phone')
    ph.screenshot(path=os.path.join(out, 'phone.png'), full_page=True)
    b.close()

print('ERRORS:', errors if errors else 'none')
