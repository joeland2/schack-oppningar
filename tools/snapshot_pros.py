"""Every known pro's and streamer's profile, read once by the site itself in a headless browser and kept as
data/pros/<account>.json, so a visitor sees their card at once (profile.js run() draws it like a profile
seen before) while the newest games are fetched behind it.

Needs: playwright (pip install playwright && playwright install chromium).
Run from the repo root: python tools/snapshot_pros.py [account …]   (default: every account in the pros function)
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from analyse_pros import accounts

PORT, KEY, WAIT = int(os.environ.get('PORT', 8800)), 'opening-book-v2-profiles', 240_000
file_of = lambda a: a.lower().replace(':', '_')
assert file_of('cc:AnnaCramling') == 'cc_annacramling'


def main():
    os.makedirs('data/pros', exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    failed = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for a in sys.argv[1:] or accounts():
                page = browser.new_page()
                page.on('console', lambda m: m.type in ('error', 'warning') and print(f'  console {m.type}: {m.text[:200]}', flush=True))
                page.on('requestfailed', lambda r: print(f'  request failed: {r.url[:120]} {r.failure}', flush=True))
                try:
                    page.goto(f'http://localhost:{PORT}/profile.html?u={a}')
                    # Done when the profile is saved and no games are still being fetched or read.
                    page.wait_for_function("""([key, me]) => {
                        const c = JSON.parse(localStorage.getItem(key) || '{}')[me], bar = document.querySelector('#pf-load');
                        return c && (!bar || bar.hidden) && !/Fetching|Reading|Looking/.test(document.querySelector('#profile-msg')?.textContent || '');
                    }""", arg=[KEY, a.lower()], timeout=WAIT)
                    entry = page.evaluate('([key, me]) => JSON.parse(localStorage.getItem(key))[me]', [KEY, a.lower()])
                    with open(f'data/pros/{file_of(a)}.json', 'w') as f:
                        json.dump(entry, f, separators=(',', ':'))
                    print(f'{a}: saved', flush=True)
                except Exception as err:
                    failed.append(a)
                    say = page.evaluate("() => (document.querySelector('#pf-load:not([hidden])')?.textContent || '') + ' | ' + (document.querySelector('#profile-msg')?.textContent || '') + ' | ' + (document.querySelector('#profile')?.innerText || '').slice(0, 150)")
                    print(f'{a}: failed ({str(err)[:80]}) page said: {say.strip()[:200]}', flush=True)
                finally:
                    page.close()
            browser.close()
    finally:
        server.terminate()
    if failed:
        print('failed:', ' '.join(failed))


if __name__ == '__main__':
    main()
