'use strict';
/*
 * Adapter tests with in-memory GAS mocks. Not a substitute for GAS execution, but it reproduces:
 *  - Sheets API grid limits (updateCells past maxRows fails the whole batch; appendCells grows the grid)
 *  - one shared ScriptLock, with call counting
 *  - admin GAS -> UrlFetchApp -> public doPost HMAC RPC, end to end
 * Usage: node adapter.test.cjs [path-to-02_gas]   (default: ../02_gas)
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '02_gas'));

// ---------- in-memory spreadsheet ----------
class Sheet {
  constructor(name, id) { this.name = name; this.id = id; this.rows = []; this.maxRows = 1000; }
  getSheetId() { return this.id; } getName() { return this.name; }
  getLastRow() { let n = this.rows.length; while (n && this.rows[n - 1].every(v => v === '' || v == null)) n--; return n; }
  getMaxRows() { return this.maxRows; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  setCell(r, c, v) { if (r > this.maxRows) throw new Error(`Range exceeds grid limits (row ${r} > ${this.maxRows}) on ${this.name}`); while (this.rows.length < r) this.rows.push([]); this.rows[r - 1][c - 1] = v; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = sh.cell(r + i, c + j); return v === undefined ? '' : v; })),
      getDisplayValues() { return this.getValues().map(row => row.map(v => v instanceof Date ? v.toISOString() : String(v))); },
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => sh.setCell(r + i, c + j, v))),
      setValue: (v) => sh.setCell(r, c, v),
    };
  }
  appendRow(vals) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; vals.forEach((v, j) => this.setCell(r, j + 1, v)); }
  insertRowsAfterLast(n) { this.maxRows += n; }
}
class Book {
  constructor(id) { this.id = id; this.sheets = []; this.nextId = 100; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, this.nextId++); this.sheets.push(s); return s; }
  setSpreadsheetTimeZone() {}
  sheetById(id) { return this.sheets.find(s => s.id === id); }
}
const books = {};
const apiValue = (cell) => { const u = cell.userEnteredValue || {}; return 'numberValue' in u ? u.numberValue : 'boolValue' in u ? u.boolValue : 'stringValue' in u ? u.stringValue : ''; };

function makeEnv(props, user) {
  const counters = { lockAttempts: 0, flush: 0 }, cache = new Map();
  let lockFree = true;
  const signed = (buf) => [...buf].map(b => (b > 127 ? b - 256 : b));
  const env = {
    console: { log() {}, warn() {}, error() {} }, JSON, Math, Date, Object, Array, String, Number, Set, Map, Error, RegExp, Promise,
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz) => { const o = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value])); return `${o.year}-${o.month}-${o.day}`; },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => signed(crypto.createHash('sha256').update(String(text), 'utf8').digest()),
      computeHmacSha256Signature: (text, key) => signed(crypto.createHmac('sha256', key).update(String(text), 'utf8').digest()),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { counters.lockAttempts++; if (env.__forceBusy || !lockFree) return false; lockFree = false; return true; }, releaseLock: () => { lockFree = true; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
    SpreadsheetApp: { openById: id => { if (!books[id]) throw new Error('no book ' + id); return books[id]; }, flush: () => { counters.flush++; } },
    Sheets: { Spreadsheets: { batchUpdate: ({ requests }, id) => {
      // All-or-nothing, like the real API: validate everything against a scratch copy first.
      const book = books[id], snapshot = book.sheets.map(s => ({ s, rows: JSON.stringify(s.rows), max: s.maxRows }));
      try {
        for (const rq of requests) {
          if (rq.appendCells) { const sh = book.sheetById(rq.appendCells.sheetId); for (const row of rq.appendCells.rows) { const r = sh.getLastRow() + 1; if (r > sh.maxRows) sh.maxRows = r; row.values.forEach((c, j) => sh.setCell(r, j + 1, apiValue(c))); } }
          else if (rq.appendDimension) { book.sheetById(rq.appendDimension.sheetId).insertRowsAfterLast(rq.appendDimension.length); }
          else if (rq.updateCells) {
            const u = rq.updateCells, sh = book.sheetById(u.range.sheetId);
            if (!u.rows) { for (let r = u.range.startRowIndex + 1; r <= Math.min(u.range.endRowIndex, sh.rows.length); r++) for (let c = u.range.startColumnIndex + 1; c <= u.range.endColumnIndex; c++) if (sh.rows[r - 1]) sh.rows[r - 1][c - 1] = ''; }
            else u.rows.forEach((row, i) => row.values.forEach((c, j) => sh.setCell(u.range.startRowIndex + 1 + i, u.range.startColumnIndex + 1 + j, apiValue(c))));
          } else throw new Error('unsupported request ' + Object.keys(rq)[0]);
        }
      } catch (e) { snapshot.forEach(x => { x.s.rows = JSON.parse(x.rows, (k, v) => v); x.s.maxRows = x.max; }); throw e; }
    } } },
    Session: { getActiveUser: () => ({ getEmail: () => user || '' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    HtmlService: {},
    UrlFetchApp: { fetch: () => { throw new Error('UrlFetchApp not wired'); } },
  };
  env.__counters = counters;
  return vm.createContext(env);
}
function load(ctx, dir, names) {
  const src = names.map(n => fs.readFileSync(path.join(root, dir, n), 'utf8')).join('\n;\n');
  vm.runInContext(src + '\n;globalThis.__V2_SHEETS=typeof V2_SHEETS!=="undefined"?V2_SHEETS:null;', ctx, { filename: dir });
}
const gasFiles = dir => fs.readdirSync(path.join(root, dir)).filter(f => /\.(gs|js)$/.test(f)).sort((a, b) => (a === 'Domain.js' ? -1 : b === 'Domain.js' ? 1 : a.localeCompare(b)));

// ---------- fixture ----------
const SECRET = 'k'.repeat(64), DB = 'DB-V2';
function setup() {
  for (const k of Object.keys(books)) delete books[k];
  books[DB] = new Book(DB);
  const pub = makeEnv({ DB_ID: DB, ADMIN_RPC_SECRET: SECRET });
  load(pub, 'public', gasFiles('public'));
  const adm = makeEnv({ DB_ID: DB, ADMIN_RPC_SECRET: SECRET, ADMIN_EMAILS: 'boss@example.com', PUBLIC_EXEC_URL: 'https://script.google.com/macros/s/X/exec', TEST_DB_ID: 'DB-TEST' }, 'boss@example.com');
  load(adm, 'admin', gasFiles('admin'));
  adm.UrlFetchApp.fetch = (url, opt) => { const out = pub.doPost({ postData: { contents: opt.payload } }); return { getResponseCode: () => 200, getContentText: () => out.text }; };
  vm.runInContext('v2EnsureSheets_()', pub);
  return { pub, adm };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00+09:00') + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
function campaign(adm, extra = {}) {
  const t = today();
  return adm.adminSaveCampaign({ id: null, version: 0, name: '検証開催', startDate: shift(t, -1), endDate: shift(t, 5), receptionEndDate: shift(t, 7), target: 3, points: [3, 3, 3, 3, 3, 3], confirmationEnabled: true, operationId: crypto.randomUUID(), ...extra }).campaign;
}
function participant(pub) {
  const key = crypto.randomBytes(32).toString('hex'), r = pub.v2Public_({ action: 'register', registrationKey: key, source: 'line' });
  assert.ok(r.ok, JSON.stringify(r)); return r.identity;
}

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n')[0]); } }

test('Bridge entry: client-callable public function exists and is not private', () => {
  const { pub } = setup();
  const html = fs.readFileSync(path.join(root, 'public', 'Bridge.html'), 'utf8'), m = /google\.script\.run[\s\S]*?\.([A-Za-z_$][\w$]*)\(m\.request\)/.exec(html);
  assert.ok(m, 'bridge call not found'); assert.ok(!m[1].endsWith('_'), `Bridge calls private ${m[1]}`); assert.equal(typeof pub[m[1]], 'function');
});

test('admin save via signed RPC, then register -> status -> roll -> achieved code', () => {
  const { pub, adm } = setup(); const c = campaign(adm), id = participant(pub);
  const s = pub.v2Public_({ action: 'status', ...id }); assert.ok(s.ok && s.card.canRoll, JSON.stringify(s));
  const r = pub.v2Public_({ action: 'roll', ...id, campaignId: c.id, requestId: 'req-1' });
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.card.state, 'ACHIEVED'); assert.match(r.card.confirmationCode, /^\d{6}$/);
  const again = pub.v2Public_({ action: 'roll', ...id, campaignId: c.id, requestId: 'req-1' }); assert.ok(again.ok, 'replay of same requestId must resolve');
  assert.equal(books[DB].getSheetByName('DailyHistory').getLastRow(), 2, 'replay must not add a second draw');
});

test('rolls keep working after the 1000-row grid is full (ProcessLog / DailyHistory)', () => {
  const { pub, adm } = setup(); const c = campaign(adm, { target: 30, points: [1, 1, 1, 1, 1, 1] });
  for (const n of ['ProcessLog', 'DailyHistory']) { const sh = books[DB].getSheetByName(n); while (sh.getLastRow() < 1000) sh.rows.push(sh.rows[0].map(() => 'filler')); sh.maxRows = 1000; }
  const id = participant(pub), r = pub.v2Public_({ action: 'roll', ...id, campaignId: c.id, requestId: 'grid-1' });
  assert.ok(r.ok, 'roll failed at grid limit: ' + JSON.stringify(r));
  assert.equal(books[DB].getSheetByName('DailyHistory').getLastRow(), 1001);
});

test('read-only status does not take the lock', () => {
  const { pub, adm } = setup(); campaign(adm); const id = participant(pub);
  pub.v2Public_({ action: 'status', ...id }); const before = pub.__counters.lockAttempts;
  const s = pub.v2Public_({ action: 'status', ...id }); assert.ok(s.ok);
  assert.equal(pub.__counters.lockAttempts - before, 0, 'status should be lock-free when nothing is written');
});

test('BUSY_RETRY: one lock attempt only, no second wait on the error path', () => {
  const { pub, adm } = setup(); const c = campaign(adm), id = participant(pub);
  pub.__forceBusy = true; const before = pub.__counters.lockAttempts;
  const r = pub.v2Public_({ action: 'roll', ...id, campaignId: c.id, requestId: 'busy-1' });
  pub.__forceBusy = false;
  assert.equal(r.error, 'BUSY_RETRY'); assert.equal(pub.__counters.lockAttempts - before, 1, 'error path re-waited for the lock');
});

test('lock release flushes SpreadsheetApp', () => {
  const { pub, adm } = setup(); campaign(adm); const before = pub.__counters.flush; participant(pub);
  assert.ok(pub.__counters.flush > before, 'SpreadsheetApp.flush() not called before releasing the lock');
});

test('staff: hyphenated code accepted; second completion says ALREADY_COMPLETED', () => {
  const { pub, adm } = setup(); const c = campaign(adm), id = participant(pub);
  const code = pub.v2Public_({ action: 'roll', ...id, campaignId: c.id, requestId: 'st-1' }).card.confirmationCode, shown = code.slice(0, 3) + '-' + code.slice(3);
  const look = adm.staffLookup(shown); assert.ok(look.ok && !look.completed, JSON.stringify(look));
  assert.ok(adm.staffComplete(look.operationId, look.campaignId, look.participantId, shown, '加藤').ok);
  assert.ok(adm.staffComplete(look.operationId, look.campaignId, look.participantId, shown, '加藤').replayed, 'same operation must replay');
  assert.throws(() => adm.staffComplete(crypto.randomUUID(), look.campaignId, look.participantId, shown, '加藤'), /ALREADY_COMPLETED/);
});

test('tampered admin RPC is rejected', () => {
  const { pub } = setup();
  const req = { action: 'saveCampaign', actor: 'x@example.com', operationId: crypto.randomUUID(), issuedAt: String(Date.now()), nonce: crypto.randomUUID(), payload: { name: 'x' } };
  const sig = crypto.createHmac('sha256', SECRET).update(JSON.stringify(req)).digest('hex');
  const out = JSON.parse(pub.doPost({ postData: { contents: JSON.stringify({ ...req, actor: 'evil@example.com', signature: sig }) } }).text);
  assert.equal(out.error, 'RPC_AUTH');
});

test('dashboard refresh past the grid limit', () => {
  const { pub, adm } = setup(); const c = campaign(adm, { target: 30, points: [1, 1, 1, 1, 1, 1] });
  participant(pub); books[DB].getSheetByName('Dashboard').maxRows = 5; const audit = books[DB].getSheetByName('AuditLog'); audit.maxRows = audit.getLastRow();
  const r = adm.refreshDashboard(); assert.ok(r.ok && r.rows > 5, JSON.stringify(r));
});

console.log(`\n${passed} adapter tests passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
