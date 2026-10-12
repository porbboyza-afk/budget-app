"""Exercise the real built service worker offline/update flows on loopback only.

Requires Python Playwright and installed Brave. API responses are synthetic;
uses a fresh context, never the user's browser profile or production data.
"""
import json
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
release = {'version': 1}
worker = (ROOT / 'dist/sw.js').read_text(encoding='utf-8')


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == '/sw.js':
            text = re.sub(r"const CACHE = '[^']+';", f"const CACHE = 'budget-shell-audit-{release['version']}';", worker)
            data = text.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


class Server(ThreadingHTTPServer):
    def __exit__(self, *args):
        self.shutdown()
        return super().__exit__(*args)


with Server(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'dist'))) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as playwright:
        executable = next(path for path in [
            Path(r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'),
            Path(r'C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe'),
            Path.home() / 'AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe',
        ] if path.exists())
        browser = playwright.chromium.launch(executable_path=str(executable), headless=True)
        context = browser.new_context(viewport={'width':393, 'height':852})
        remote = {'state': None, 'revision': 0}
        errors = []

        def route(request):
            url = request.request.url
            if not url.startswith(base + '/'):
                request.abort()
            elif url.endswith('/api/config'):
                request.fulfill(json={'localPreview': True})
            elif url.endswith('/api/ledger'):
                if request.request.method == 'PUT':
                    payload = request.request.post_data_json
                    assert payload['revision'] == remote['revision']
                    remote['state'] = payload['state']
                    remote['revision'] += 1
                request.fulfill(json=remote)
            elif '/api/' in url:
                request.abort()
            else:
                request.continue_()

        context.route('**/*', route)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(base)
        expect(page.locator('#entry-fields')).to_be_enabled()
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        page.locator('.sidebar nav a[href="#data-tools"]').click()
        expect(page.locator('#connection-status')).to_contain_text('พร้อมใช้แบบออฟไลน์')
        urls = page.evaluate('async () => {const cache=await caches.open("budget-shell-audit-1"); return (await cache.keys()).map(r=>new URL(r.url).pathname);}')
        assert '/app.js' in urls and '/ai-ui.js' in urls
        assert not any('/api/' in path or '.env' in path for path in urls)
        print('PASS: actual service worker installation and public-only offline shell', flush=True)

        page.evaluate("localStorage.setItem('budget-last-owner-v1', 'local-owner')")
        page.locator('.sidebar nav a[href="#entry-panel"]').click()
        page.locator('#amount').fill('12.34')
        page.locator('#description').fill('Synthetic offline fixture')
        page.locator('#submit-entry').click()
        expect(page.locator('#form-error')).to_have_text('')
        context.set_offline(True)
        page.reload()
        expect(page.locator('#entry-fields')).to_be_enabled()
        page.locator('.sidebar nav a[href="#overview"]').click()
        expect(page.locator('#expense')).to_contain_text('12.34')
        page.locator('.sidebar nav a[href="#entry-panel"]').click()
        page.locator('#amount').fill('1')
        page.locator('#submit-entry').click()
        expect(page.locator('#form-error')).to_have_text('')
        key = 'budget-next-draft-v1:owner:local-owner'
        assert len(page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).entries', key)) == 2
        print('PASS: actual offline reload and owner-scoped manual save from cached modules', flush=True)

        context.set_offline(False)
        page.reload()
        expect(page.locator('#entry-fields')).to_be_enabled()
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        release['version'] = 2
        page.evaluate('async () => (await navigator.serviceWorker.getRegistration()).update()')
        page.locator('.sidebar nav a[href="#data-tools"]').click()
        expect(page.locator('#update-app')).to_be_visible(timeout=15000)
        page.locator('#update-app').click()
        expect(page.locator('#entry-fields')).to_be_enabled()
        page.wait_for_function('async () => (await caches.keys()).includes("budget-shell-audit-2") && !(await caches.keys()).includes("budget-shell-audit-1")')
        assert len(page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).entries', key)) == 2
        print('PASS: pending update, explicit activation/reload and ledger preservation', flush=True)
        assert errors == [], repr(errors)
        context.close()
        browser.close()
        print('3 PWA browser scenario groups passed; loopback, mocked API, no production writes.')
