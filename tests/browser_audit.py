"""Synthetic UI audit in an isolated Brave context; API/auth are mocked.

Requires Python Playwright and installed Brave. Run npm run build first.
Never opens the user's profile, calls paid AI, or writes to production.
"""

import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
KEY = 'budget-next-draft-v1:owner:anonymous'
AUTH = """
const initialOwner = sessionStorage.getItem('audit-owner');
let user = initialOwner ? {uid:initialOwner} : null;
window.budgetAuth = {ready: Promise.resolve(), getUser: () => user,
  getToken: async () => 'synthetic-test-token'};
window.auditSetUser = uid => {user = uid ? {uid} : null;
  if(uid) sessionStorage.setItem('audit-owner', uid); else sessionStorage.removeItem('audit-owner');
  window.dispatchEvent(new CustomEvent('budget-auth-changed'));};
"""
FIREBASE_AUTH = """
const auth = {currentUser: null}, listeners = new Set();
function setUser(uid) {
  auth.currentUser = uid ? {uid, email:'synthetic@example.invalid', displayName:'Synthetic',
    photoURL:null, getIdToken:async () => 'synthetic-test-token'} : null;
  for (const listener of listeners) listener(auth.currentUser);
}
window.auditFirebaseUser = setUser;
export function getAuth() {return auth;}
export function onAuthStateChanged(_, callback) {
  listeners.add(callback); queueMicrotask(() => {if(listeners.has(callback)) callback(auth.currentUser);});
  return () => listeners.delete(callback);
}
export class GoogleAuthProvider {}
export async function signInWithPopup() {setUser('synthetic-google-owner'); return {user:auth.currentUser};}
export async function signOut() {setUser(null);}
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Checks(list):
    def append(self, label):
        super().append(label)
        print('PASS:', label, flush=True)


class AuditServer(ThreadingHTTPServer):
    def __exit__(self, *args):
        self.shutdown()
        return super().__exit__(*args)


def empty():
    return dict(version=2, openingCents=0, demo=False, entries=[], trips=[])


def entry(identifier, date, cents=1000, **fields):
    return dict(id=identifier, date=date, amountCents=cents, type='expense',
                description='Synthetic item', category='Food', tripId='', **fields)


with AuditServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'dist'))) as server:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as playwright:
        executable = next((path for path in [
            Path(r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'),
            Path(r'C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe'),
            Path.home() / 'AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe',
        ] if path.exists()), None)
        if executable is None:
            raise RuntimeError('Brave executable not found')
        browser = playwright.chromium.launch(executable_path=str(executable), headless=True)
        checks = Checks()
        errors = []
        contexts = []

        def setup(initial=None, auth_mode='stub'):
            context = browser.new_context(viewport=dict(width=393, height=852), service_workers='block')
            contexts.append(context)
            remote = {'state': None, 'revision': 0, '_putCount':0}
            ai_requests = []
            def route(request):
                url = request.request.url
                if url.endswith('/firebase-app.js'):
                    request.fulfill(content_type='text/javascript', headers={'Access-Control-Allow-Origin':'*'}, body='export const initializeApp = config => config;')
                elif url.endswith('/firebase-auth.js'):
                    request.fulfill(content_type='text/javascript', headers={'Access-Control-Allow-Origin':'*'}, body=FIREBASE_AUTH)
                elif not url.startswith(base + '/'):
                    request.abort()
                elif url.endswith('/auth.js') and auth_mode == 'stub':
                    request.fulfill(content_type='text/javascript', body=AUTH)
                elif url.endswith('/api/config'):
                    request.fulfill(json={'firebase':{'apiKey':'synthetic', 'projectId':'synthetic', 'authDomain':'synthetic.invalid'}})
                elif url.endswith('/api/ledger'):
                    if request.request.method == 'PUT':
                        value = request.request.post_data_json
                        assert value['revision'] == remote['revision']
                        remote['state'] = value['state']
                        remote['revision'] += 1
                        remote['_putCount'] += 1
                    request.fulfill(json=remote)
                elif url.endswith('/api/ai'):
                    value = request.request.post_data_json
                    ai_requests.append(value)
                    if value['action'] == 'ask':
                        request.fulfill(json={'answer': 'Synthetic monthly explanation'})
                    else:
                        date = value['date']
                        request.fulfill(json={'entries': [
                            dict(type='expense', amount='10.00', date=date, description='AI food', category='Food'),
                            dict(type='expense', amount='10.00', date=date, description='AI food', category='Food'),
                            dict(type='income', amount='20.00', date=date, description='AI income', category='Work'),
                        ], 'warnings': ['Synthetic review warning']})
                else:
                    request.continue_()
            context.route('**/*', route)
            seed_key = KEY
            if auth_mode == 'offline':
                seed_key = 'budget-next-draft-v1:owner:synthetic-offline-owner'
                context.add_init_script("Object.defineProperty(navigator, 'onLine', {get: () => false}); localStorage.setItem('budget-last-owner-v1', 'synthetic-offline-owner');")
            if initial is not None:
                context.add_init_script('if (!sessionStorage.auditSeeded) {localStorage.setItem(' +
                                        json.dumps(seed_key) + ', ' + json.dumps(json.dumps(initial)) +
                                        '); sessionStorage.auditSeeded="1";}')
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(base)
            expect(page.locator('#entry-fields')).to_be_enabled()
            return page, context, remote, ai_requests

        def ledger(page, key=KEY):
            return page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)

        def nav(page, name):
            page.locator(f'.sidebar nav a[href="#{name}"]').click()
            expect(page.locator('#' + name)).to_be_visible()

        def add(page, amount, description='', income=False, date=None):
            nav(page, 'entry-panel')
            page.locator('#type-income' if income else '#type-expense').click()
            page.locator('#amount').fill(amount)
            page.locator('#description').fill(description)
            if date:
                page.locator('#date').fill(date)
            page.locator('#submit-entry').click()
            expect(page.locator('#form-error')).to_have_text('')

        page, context, remote, requests = setup()
        today = page.locator('#date').input_value()
        month = today[:7]
        add(page, '10.01')
        assert ledger(page)['entries'][0]['amountCents'] == 1001
        add(page, '100', 'Synthetic income', income=True)
        nav(page, 'overview')
        expect(page.locator('#balance')).to_contain_text('89.99')
        page.locator('#summary-nav').click()
        expect(page.locator('#summary-content')).to_contain_text('89.99')
        page.locator('#close-summary').click()
        nav(page, 'transactions')
        page.locator('[data-action="edit"]').first.click()
        page.locator('#amount').fill('120')
        page.locator('#submit-entry').click()
        assert ledger(page)['entries'][1]['amountCents'] == 12000
        page.locator('#last-saved-undo').click()
        assert ledger(page)['entries'][1]['amountCents'] == 10000
        nav(page, 'transactions')
        page.locator('[data-action="delete"]').first.click()
        assert len(ledger(page)['entries']) == 1
        page.locator('#undo').click()
        assert len(ledger(page)['entries']) == 2
        page.reload()
        expect(page.locator('#entry-fields')).to_be_enabled()
        assert len(ledger(page)['entries']) == 2
        checks.append('manual CRUD, exact cents, summary, save undo, delete undo, refresh')

        initial = empty()
        initial['entries'] = [entry(str(i), today, i + 1) for i in range(12)]
        page, _, _, _ = setup(initial)
        nav(page, 'transactions')
        expect(page.locator('.entry-row')).to_have_count(10)
        page.locator('#page-next').click()
        expect(page.locator('.entry-row')).to_have_count(2)
        page.locator('#search').fill('no-match')
        expect(page.locator('.entry-row')).to_have_count(0)
        page.locator('#clear-filter').click()
        expect(page.locator('.entry-row')).to_have_count(10)
        page.locator('#filter-type').select_option('income')
        expect(page.locator('.entry-row')).to_have_count(0)
        page.locator('#clear-filter').click()
        page.locator('#prev-month').click()
        expect(page.locator('.entry-row')).to_have_count(0)
        page.locator('#next-month').click()
        expect(page.locator('.entry-row')).to_have_count(10)
        nav(page, 'entry-panel')
        page.locator('#amount').fill('-1')
        page.locator('#submit-entry').click()
        expect(page.locator('#form-error')).not_to_have_text('')
        assert len(ledger(page)['entries']) == 12
        checks.append('paging, search, type filters, month navigation, invalid amount blocked')

        page, _, _, _ = setup()
        nav(page, 'trips')
        page.locator('#trips-new').click()
        page.locator('#trip-name').fill('Synthetic travel')
        page.locator('#trip-budget').fill('50')
        page.locator('#trip-submit').click()
        trip_id = ledger(page)['trips'][0]['id']
        page.locator('#trip-add-expense').click()
        expect(page.locator('#entry-trip')).to_have_value(trip_id)
        add(page, '60', 'Advance ticket', date=month + '-01')
        nav(page, 'trips')
        expect(page.locator('#trip-detail-spent')).to_have_text('฿60')
        expect(page.locator('#trip-detail-remaining')).to_have_text('เกิน ฿10')
        nav(page, 'entry-panel')
        add(page, '20', 'Trip income', income=True)
        nav(page, 'trips')
        expect(page.locator('#trip-detail-spent')).to_have_text('฿60')
        page.locator('#trip-edit').click()
        page.locator('#trip-budget').fill('100')
        page.locator('#trip-submit').click()
        expect(page.locator('#trip-detail-remaining')).to_have_text('฿40')
        page.locator('#trip-archive').click()
        expect(page.locator('#trip-add-expense')).to_be_hidden()
        nav(page, 'entry-panel')
        expect(page.locator('#entry-trip')).to_have_value('')
        nav(page, 'trips')
        page.locator('#trip-archive').click()
        expect(page.locator('#trip-add-expense')).to_be_visible()
        checks.append('trip create/edit, budget overrun, income semantics, archive/reopen, default trip')

        page, _, _, _ = setup()
        imported = empty()
        imported['entries'] = [entry('csv', today)]
        imported['entries'][0]['description'] = '=1+1'
        nav(page, 'data-tools')
        page.locator('#restore-file').set_input_files(dict(name='synthetic.json', mimeType='application/json', buffer=json.dumps(imported).encode()))
        expect(page.locator('#toast-text')).to_have_text('กู้คืนข้อมูลและบันทึกแล้ว')
        assert ledger(page) == imported
        with page.expect_download() as download:
            page.locator('#backup').click()
        assert json.loads(Path(download.value.path()).read_text(encoding='utf-8')) == imported
        with page.expect_download() as download:
            page.locator('#export-csv').click()
        csv = Path(download.value.path()).read_text(encoding='utf-8-sig')
        assert "'=1+1" in csv
        page.locator('#restore-file').set_input_files(dict(name='bad.json', mimeType='application/json', buffer=b'{bad'))
        expect(page.locator('#toast-text')).to_have_text('ไฟล์ JSON อ่านไม่ได้')
        assert ledger(page) == imported
        checks.append('JSON restore/backup, invalid import preserves state, CSV formula escaping')

        page, _, _, requests = setup()
        nav(page, 'entry-panel')
        page.locator('#ai-extract-open').click()
        page.locator('#ai-text').fill('Synthetic three entries')
        page.locator('#ai-submit').click()
        expect(page.locator('.ai-candidate')).to_have_count(3)
        assert not page.locator('.ai-candidate').nth(1).locator('[data-field="include"]').is_checked()
        assert ledger(page) is None
        page.locator('.ai-candidate').first.locator('[data-field="amount"]').fill('12.34')
        page.locator('#ai-save-reviewed').click()
        assert len(ledger(page)['entries']) == 2
        assert ledger(page)['entries'][0]['amountCents'] == 1234
        page.locator('#last-saved-undo').click()
        assert ledger(page)['entries'] == []
        nav(page, 'overview')
        page.locator('#ai-ask-open').click()
        page.locator('#ai-submit').click()
        expect(page.locator('#ai-answer')).to_have_text('Synthetic monthly explanation')
        assert requests[-1]['context']['totals']['expense'] == 0
        page.locator('#ai-close').click()
        checks.append('AI mocked extraction, duplicate unchecked, edit/review/save, batch undo, ask context')

        page, context, _, _ = setup(imported)
        nav(page, 'overview')
        page.locator('#summary-nav').click()
        page.evaluate("window.auditSetUser('synthetic-owner-b')")
        expect(page.locator('#summary-dialog')).not_to_be_visible()
        expect(page.locator('#summary-content')).to_have_text('')
        assert ledger(page, KEY)['entries'][0]['description'] == '=1+1'
        assert ledger(page, 'budget-next-draft-v1:owner:synthetic-owner-b') is None
        page.evaluate('window.auditSetUser(null)')
        other = context.new_page()
        other.goto(base)
        expect(other.locator('#entry-fields')).to_be_enabled()
        other.evaluate('(key) => localStorage.removeItem(key)', KEY)
        expect(page.locator('#balance')).to_have_text('—')
        nav(page, 'entry-panel')
        page.locator('#amount').fill('1')
        page.locator('#submit-entry').click()
        expect(page.locator('#form-error')).not_to_have_text('')
        assert ledger(page) is None
        checks.append('owner isolation, old summary cleared, cross-tab storage removal blocks stale writes')

        page, _, remote, _ = setup()
        remote['state'] = imported
        remote['revision'] = 1
        page.evaluate("window.auditSetUser('synthetic-cloud-owner')")
        nav(page, 'data-tools')
        expect(page.locator('#sync-status')).to_have_text('ซิงค์แล้ว')
        owner_key = 'budget-next-draft-v1:owner:synthetic-cloud-owner'
        assert ledger(page, owner_key) == imported
        page.evaluate('(key) => {localStorage.removeItem(key); window.dispatchEvent(new StorageEvent("storage", {key, newValue:null}));}', owner_key)
        expect(page.locator('#sync-conflict')).to_be_visible()
        page.locator('#sync-use-cloud').click()
        expect(page.locator('#sync-status')).to_have_text('ซิงค์แล้ว')
        assert ledger(page, owner_key) == imported
        checks.append('mock cloud first download, deletion pause and explicit cloud recovery')
        puts_before = remote['_putCount']
        page.evaluate('(key)=>localStorage.removeItem(key)', owner_key)
        page.reload()
        expect(page.locator('#entry-fields')).to_be_enabled()
        nav(page, 'data-tools')
        expect(page.locator('#sync-conflict')).to_be_visible()
        assert remote['_putCount'] == puts_before
        assert remote['state'] == imported
        page.locator('#sync-use-cloud').click()
        expect(page.locator('#sync-status')).to_have_text('ซิงค์แล้ว')
        assert ledger(page, owner_key) == imported
        checks.append('reload with erased ledger and retained sync metadata never uploads an empty replacement')

        page, _, _, requests = setup()
        nav(page, 'entry-panel')
        page.locator('#ai-extract-open').click()
        page.locator('#ai-image').set_input_files(dict(name='not-image.png', mimeType='image/png', buffer=b'not an image'))
        expect(page.locator('#ai-error')).to_have_text('ไฟล์นี้ไม่ใช่ภาพที่รองรับ')
        png = (ROOT / 'icon-192.png').read_bytes()
        page.locator('#ai-image').set_input_files(dict(name='synthetic.png', mimeType='image/png', buffer=png))
        expect(page.locator('#ai-image-preview')).to_be_visible()
        page.locator('#ai-submit').click()
        expect(page.locator('.ai-candidate')).to_have_count(3)
        assert requests[-1]['image']['mimeType'] == 'image/jpeg'
        assert requests[-1]['image']['data']
        assert ledger(page) is None
        page.locator('#ai-image-remove').click()
        expect(page.locator('#ai-image-preview')).to_be_hidden()
        expect(page.locator('#ai-review')).to_be_hidden()
        page.locator('#ai-close').click()
        checks.append('receipt image validation, decode/reencode, mocked request, remove clears review')

        page, _, remote, _ = setup(imported, auth_mode='firebase')
        expect(page.locator('#ai-login')).to_be_enabled()
        remote['state'] = imported
        remote['revision'] = 1
        page.locator('#ai-login').click()
        expect(page.locator('#ai-login')).to_have_class('signed-in')
        nav(page, 'data-tools')
        expect(page.locator('#sync-status')).to_have_text('ซิงค์แล้ว')
        page.locator('#ai-login').click()
        expect(page.locator('#account-dialog')).to_be_visible()
        expect(page.locator('#account-identity')).to_have_text('synthetic@example.invalid')
        page.locator('#account-logout').click()
        expect(page.locator('#account-dialog')).not_to_be_visible()
        expect(page.locator('#ai-login')).not_to_have_class('signed-in')
        assert page.evaluate("localStorage.getItem('budget-last-owner-v1')") is None
        page.locator('#install-app').click()
        expect(page.locator('#install-dialog')).to_be_visible()
        page.locator('#install-close').click()
        nav(page, 'entry-panel')
        nav(page, 'trips')
        page.go_back()
        expect(page.locator('#entry-panel')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        for link in page.locator('.sidebar nav a').all():
            assert link.bounding_box()['height'] >= 44
        checks.append('actual auth UI with mocked SDK: login/account/logout, install help, history, mobile fit')

        page, _, _, _ = setup(imported, auth_mode='offline')
        expect(page.locator('#ai-account-status')).to_contain_text('ออฟไลน์')
        add(page, '2', 'Synthetic offline entry')
        offline_key = 'budget-next-draft-v1:owner:synthetic-offline-owner'
        assert len(ledger(page, offline_key)['entries']) == 2
        nav(page, 'data-tools')
        expect(page.locator('#sync-conflict')).to_be_hidden()
        checks.append('offline auth fallback uses last owner and manual writes remain owner-scoped')

        assert errors == [], 'Browser script errors: ' + repr(errors)
        print(f'{len(checks)} browser scenario groups passed; mocked auth/API, isolated Brave, no production writes.')
        for context in contexts:
            context.close()
        browser.close()
