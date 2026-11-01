"""Every known pro's and VIP's profile, read by the site itself in a headless browser from the games kept on
our server, and written with those games to out/<account>.json, plus out/index.json (when each account last
played). The workflow pushes out/ to the branch pros-data, where profile.js reads it: their page then draws at
once and fetches nothing from Lichess or Chess.com.

Needs: playwright (pip install playwright && playwright install chromium).
Run from the repo root: python tools/snapshot_pros.py [account …]   (default: every account in pros.js)
"""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
from analyse_pros import accounts

PORT, WAIT, OUT = int(os.environ.get('PORT', 8800)), 240_000, 'out'
file_of = lambda a: a.lower().replace(':', '_')
assert file_of('cc:AnnaCramling') == 'cc_annacramling'


def main():
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    failed = []
    try:  # the last run's, from the branch (the workflow puts it in out/): an account that fails now keeps its old one
        last = json.load(open(f'{OUT}/index.json'))
    except (OSError, ValueError):
        last = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for a in sys.argv[1:] or accounts():
                ctx = browser.new_context()  # a fresh browser each time: nothing kept from the one before
                page = ctx.new_page()
                page.on('console', lambda m: m.type in ('error', 'warning') and print(f'  console {m.type}: {m.text[:200]}', flush=True))
                page.on('requestfailed', lambda r: print(f'  request failed: {r.url[:120]} {r.failure}', flush=True))
                try:
                    page.goto(f'http://localhost:{PORT}/profile.html?u={a}&snapshot=1')
                    page.wait_for_function('() => window.snapOut && window.snapOut.games', timeout=WAIT)
                    entry = page.evaluate('() => window.snapOut')
                    with open(f'{OUT}/{file_of(a)}.json', 'w') as f:
                        json.dump(entry, f, separators=(',', ':'))
                    last[a.lower()] = entry['games'][0]['createdAt'] if entry['games'] else 0
                    print(f'{a}: saved, {len(entry["games"])} games', flush=True)
                except Exception as err:
                    failed.append(a)
                    say = page.evaluate("() => (document.querySelector('#profile-msg')?.textContent || '') + ' | ' + (document.querySelector('#profile')?.innerText || '').slice(0, 150)")
                    print(f'{a}: failed ({str(err)[:80]}) page said: {say.strip()[:200]}', flush=True)
                finally:
                    ctx.close()
            browser.close()
    finally:
        server.terminate()
    with open(f'{OUT}/index.json', 'w') as f:
        json.dump(last, f, separators=(',', ':'))
    if failed:
        print('failed:', ' '.join(failed))


if __name__ == '__main__':
    main()
