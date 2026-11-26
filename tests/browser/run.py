"""Browser checks for Heybe (Playwright for Python, no npm packages).

    npm run test:browser            layout and page checks; requests to other sites are blocked, so it is quick and steady
    npm run test:browser -- --live  also real searches (Ryanair, Travelpayouts, FlixBus, Transitous): slower, needs internet

Needs once:  pip install playwright  and  python -m playwright install chromium
Starts its own server (server.js) on a free port and stops it at the end. Exit code 1 when a check fails.
"""
import json, os, socket, subprocess, sys, time, urllib.request
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit('Playwright for Python is missing: pip install playwright && python -m playwright install chromium')

ROOT = Path(__file__).resolve().parents[2]
LIVE = '--live' in sys.argv
WIDTHS = {'desktop': 1280, 'tablet': 820, 'phone': 390}
TABS = ['rt', 'ow', 'mc', 'via', 'open', 'meet', 'legs']
PAGES = ['index.html', 'bus.html', 'train.html', 'hotels.html', 'things.html', 'help.html']
results = []


def check(name, ok, info=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  ({info})' if info and not ok else ''))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_server():
    port = free_port()
    env = {**os.environ, 'PORT': str(port), 'NO_OPEN': '1'}
    proc = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}'
    for _ in range(50):
        try:
            urllib.request.urlopen(base + '/tp/health', timeout=1)
            return proc, base
        except Exception:
            time.sleep(0.2)
    proc.kill()
    sys.exit('server.js did not start')


def new_page(browser, base, width, storage=None, height=900):
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    if not LIVE:   # only this site: no live prices, weather or maps, so the checks do not depend on the network
        ctx.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
    if storage:
        ctx.add_init_script('(' + json.dumps(storage) + ').forEach(([k,v])=>localStorage.setItem(k,JSON.stringify(v)))')
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    return ctx, page


# the search form: no field over another, nothing sideways, Search at the right end of its row
LAYOUT = r"""() => {
  const f = document.querySelector('#f'), vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetWidth > 0; };
  const items = [...f.querySelectorAll('.frow > *, :scope > .legs-only')].filter(vis), bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
      bad.push((items[i].innerText || items[i].className).split('\n')[0] + ' / ' + (items[j].innerText || items[j].className).split('\n')[0]); }
  const btn = f.querySelector('button[type=submit]').getBoundingClientRect(), row = btn && f.getBoundingClientRect();
  const tabs = [...document.querySelectorAll('#tripType button')], h = tabs.map(b => b.offsetHeight);
  return { overlaps: bad, sideways: document.documentElement.scrollWidth > innerWidth + 1,
           searchRight: Math.abs(btn.right - row.right) < 3, tabsSame: Math.max(...h) - Math.min(...h) < 4 }; }"""


def flights_form(browser, base):
    for wn, w in WIDTHS.items():
        ctx, page = new_page(browser, base, w)
        for t in TABS:
            page.goto(f'{base}/index.html?trip={t}')
            page.wait_for_selector('#f button[type=submit]')
            m = page.evaluate(LAYOUT)
            name = f'flights form {t} @ {wn}'
            check(name + ': no field over another', not m['overlaps'], m['overlaps'])
            check(name + ': no sideways scroll', not m['sideways'])
            check(name + ': Search at the right end', m['searchRight'])
            if wn == 'tablet':
                check(name + ': trip tabs keep whole words (same height)', m['tabsSame'])
            check(name + ': no script errors', not page.errors, page.errors[:2])
            page.errors.clear()
        ctx.close()


def pages_load(browser, base):
    for wn in ('desktop', 'phone'):
        ctx, page = new_page(browser, base, WIDTHS[wn])
        for p in PAGES:
            page.goto(f'{base}/{p}')
            page.wait_for_load_state('load')
            page.wait_for_timeout(300)
            sideways = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            check(f'{p} @ {wn}: loads without script errors', not page.errors, page.errors[:2])
            check(f'{p} @ {wn}: no sideways scroll', not sideways)
            page.errors.clear()
        ctx.close()


def search_button_end(browser, base):
    """Buses and Trains: Search sits at the right end, one way and round trip."""
    for p in ('bus.html', 'train.html'):
        ctx, page = new_page(browser, base, WIDTHS['desktop'])
        page.goto(f'{base}/{p}')
        for trip in ('One way', 'Round trip'):
            page.get_by_role('button', name=trip, exact=True).click()
            page.wait_for_timeout(200)
            ok = page.evaluate("""() => { const f = document.querySelector('#f'), b = f.querySelector('button[type=submit]');
              return Math.abs(b.getBoundingClientRect().right - f.getBoundingClientRect().right) < 3; }""")
            check(f'{p} {trip}: Search at the right end', ok)
        ctx.close()


def trip_cost(browser, base):
    costs = [{'id': 'a', 'kind': 'bus', 'title': 'Berlin → Munich', 'sub': 'FlixBus', 'price': 80, 'cur': 'EUR', 'pp': False},
             {'id': 'b', 'kind': 'train', 'title': 'München Hbf → Augsburg Hbf', 'sub': 'FlixTrain', 'price': 10, 'cur': 'EUR', 'pp': True},
             {'id': 'c', 'kind': 'other', 'title': 'Taxi', 'sub': '', 'price': 30, 'cur': 'GBP', 'pp': False}]
    trip = {'adults': 2, 'children': 0, 'currency': 'EUR'}
    # no stay plan: a Trip cost card with the costs alone (80 + 2 × 10; the GBP taxi stays out)
    ctx, page = new_page(browser, base, WIDTHS['desktop'], [['heybe.tripCosts', costs], ['heybe.trip', trip]])
    page.goto(f'{base}/hotels.html')
    box = page.locator('#stayWizard')
    box.wait_for(state='visible')
    check('trip cost card: shown without a stay plan', 'Trip cost' in box.inner_text())
    check('trip cost card: total counts per-person prices for everyone', 'EUR 100' in box.locator('.grand').inner_text(), box.locator('.grand').inner_text())
    check('trip cost card: other currency is marked, not added', 'other currency' in box.inner_text())
    box.locator('#costAdd input[name=title]').fill('Airport transfer')
    box.locator('#costAdd input[name=price]').fill('25,50')
    box.locator('#costAdd button').click()
    check('trip cost card: a cost added by hand is in the total', 'EUR 126' in box.locator('.grand').inner_text(), box.locator('.grand').inner_text())
    box.locator('[data-cost-del="a"]').click()
    check('trip cost card: ✕ removes a cost', 'Berlin → Munich' not in box.inner_text() and 'EUR 46' in box.locator('.grand').inner_text())
    check('trip cost card: no script errors', not page.errors, page.errors[:2])
    ctx.close()
    # with a stay plan: stays + buses/trains + flights in one total
    plan = {'cities': [{'city': 'Munich', 'cc': 'DE', 'code': 'MUC', 'ci': '2027-03-01', 'co': '2027-03-04', 'nights': 3}],
            'flightPP': 100, 'cur': 'EUR', 'label': 'Munich', 'flights': [], 'booked': {}, 'adults': 2, 'children': 0,
            'picks': [{'name': 'Hotel X', 'total': 300}], 'step': 1, 'kind': 'both'}
    ctx, page = new_page(browser, base, WIDTHS['desktop'], [['heybe.tripCosts', costs[:2]], ['heybe.trip', trip], ['heybe.stayPlan', plan]])
    page.goto(f'{base}/hotels.html')
    box = page.locator('#stayWizard')
    box.wait_for(state='visible')
    t = box.locator('.st-total').inner_text()
    # 300 stays + 100 buses/trains + 200 flights
    check('stay planner total: stays + buses & trains + flights', 'Buses, trains' in t and 'EUR 600' in t and 'EUR 300 per person' in t, t.replace('\n', ' '))
    check('stay planner total: no script errors', not page.errors, page.errors[:2])
    ctx.close()


# small and short screens: the smallest Android phone (320 wide) and a phone turned sideways (844 x 390)
def small_screens(browser, base):
    for pg in PAGES:
        ctx, page = new_page(browser, base, 320, height=640)
        page.goto(f'{base}/{pg}')
        cut = page.evaluate("(() => { const u = document.querySelector('.nav ul'); return u.scrollWidth - u.clientWidth; })()")
        check(f'{pg} @ 320: every menu item and the theme button fit', cut <= 1, f'{cut}px cut off')
        ctx.close()
    ctx, page = new_page(browser, base, 320, height=640)
    page.goto(f'{base}/index.html')
    fit = page.evaluate("(() => { const i = document.querySelector('#f input[name=from]') || document.querySelector('.w-from input'); return i.scrollWidth - i.clientWidth; })()")
    check('index.html @ 320: "NUE — Nuremberg, Germany" fits its field', fit <= 1, f'{fit}px cut off')
    ctx.close()
    ctx, page = new_page(browser, base, 844, height=390)
    for pg in ['index.html', 'bus.html', 'train.html', 'hotels.html']:
        page.goto(f'{base}/{pg}')
        top = page.evaluate("document.querySelector('main .card, .lift .card, .card').getBoundingClientRect().top")
        check(f'{pg} @ phone sideways: the first card starts on the first screen', top < 390 - 60, f'card top {round(top)}')
    page.goto(f'{base}/index.html')
    room = page.evaluate("""(() => { const s = document.querySelector('select[name=cabin]'); s.value = 'premium_economy';
        const c = document.createElement('canvas').getContext('2d'), st = getComputedStyle(s); c.font = st.font;
        return s.clientWidth - c.measureText(s.options[s.selectedIndex].text).width - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) - 20; })()""")
    check('index.html @ phone sideways: Cabin shows "Premium eco." in full', room >= 0, f'{round(room)}px short')
    ctx.close()


def live_searches(browser, base):
    ctx, page = new_page(browser, base, WIDTHS['desktop'])
    page.goto(f'{base}/index.html?trip=mc')
    page.click('#f button[type=submit]')
    page.wait_for_selector('#mcPicks .pick, #multiMode .empty', timeout=60000)
    txt = page.inner_text('#multiMode')
    check('live multi-city: routes, no "Could not load flights"', 'Could not load flights' not in txt and page.locator('#mcPicks .pick').count() > 0)
    page.goto(f'{base}/index.html?trip=meet')
    page.fill('#meetFrom', 'Berlin'); page.wait_for_timeout(700); page.keyboard.press('Enter')
    page.click('#f button[type=submit]')
    page.wait_for_selector('#meetPicks .pick, #meetMode .empty', timeout=90000)
    check('live meet up: places to meet', 'Could not load flights' not in page.inner_text('#meetMode') and page.locator('#meetPicks .pick').count() > 0)
    ctx.close()

    ctx, page = new_page(browser, base, WIDTHS['desktop'])
    page.goto(f'{base}/bus.html')
    ins = page.locator('#f input:not([type=date]):not([type=number])')
    ins.nth(0).fill('Berlin'); page.wait_for_timeout(1500); page.keyboard.press('Enter')
    ins.nth(1).fill('Munich'); page.wait_for_timeout(1500); page.keyboard.press('Enter')
    page.click('#f button[type=submit]')
    page.wait_for_selector('#rides .cost-add', timeout=30000)
    page.locator('#rides .cost-add').first.click()
    saved = page.evaluate("JSON.parse(localStorage.getItem('heybe.tripCosts')||'[]').length")
    check('live buses: rides shown, ➕ Trip cost saves one', saved == 1)
    ctx.close()

    ctx, page = new_page(browser, base, WIDTHS['desktop'])
    page.goto(f'{base}/train.html')
    ins = page.locator('#f input:not([type=date]):not([type=time])')
    ins.nth(0).fill('Munich'); page.wait_for_timeout(1500); page.keyboard.press('Enter')
    ins.nth(1).fill('Berlin'); page.wait_for_timeout(1500); page.keyboard.press('Enter')
    page.click('#f button[type=submit]')
    page.wait_for_selector('#trips .deal', timeout=60000)
    head = page.locator('#trips .hint').first.inner_text()
    check('live trains: a town leaves from its main station', 'München Hbf' in head or 'Hbf' in head, head)
    ctx.close()


def main():
    proc, base = start_server()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            pages_load(browser, base)
            flights_form(browser, base)
            search_button_end(browser, base)
            trip_cost(browser, base)
            small_screens(browser, base)
            if LIVE:
                live_searches(browser, base)
            browser.close()
    finally:
        proc.kill()
    failed = results.count(False)
    print(f'\n{len(results) - failed} passed, {failed} failed' + ('' if LIVE else '  (add --live for real searches)'))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
