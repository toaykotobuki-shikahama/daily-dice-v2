'use strict';
/*
 * GAS static checks (no dependencies). Catches failures that only surface at runtime in Apps Script:
 *  1. google.script.run targets must exist in the same project and must not be private (trailing "_").
 *  2. Every called helper ending in "_" must be defined in the same project.
 *  3. A function name must not be defined twice in one project (GAS silently keeps one).
 *  4. If appsscript.json declares oauthScopes, the services used must be covered.
 *  5. Shared files (Domain.js, Repository.gs) must be identical in both projects.
 *  6. All .gs/.js and inline <script> blocks must compile.
 * Usage: node static_check.cjs [path-to-02_gas]   (default: ../02_gas)
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '02_gas'));
const projects = ['public', 'admin'];
const errors = [], notes = [];
const err = (m) => { if (!errors.includes(m)) errors.push(m); };

function files(dir) { return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1'); }
function scriptBlocks(html) { return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].replace(/<\?!?=?[\s\S]*?\?>/g, 'null')); }

// Find the server function called by each google.script.run chain, skipping handler/user-object calls.
function runTargets(js) {
  const out = []; let at = 0;
  while ((at = js.indexOf('google.script.run', at)) >= 0) {
    let i = at + 'google.script.run'.length;
    for (;;) {
      const m = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(js.slice(i));
      if (!m) break;
      const name = m[1]; i += m[0].length;
      let depth = 1, q = null;
      for (; i < js.length && depth; i++) {
        const ch = js[i];
        if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'" || ch === '`') q = ch; else if (ch === '(') depth++; else if (ch === ')') depth--;
      }
      if (!['withSuccessHandler', 'withFailureHandler', 'withUserObject'].includes(name)) { out.push(name); break; }
    }
    at = i;
  }
  return out;
}

const SCOPE_RULES = [
  [/\bSpreadsheetApp\.getUi\b|\.showModalDialog\b|\.showSidebar\b/, ['https://www.googleapis.com/auth/script.container.ui']],
  [/\bSession\.getActiveUser\b/, ['https://www.googleapis.com/auth/userinfo.email']],
  [/\bUrlFetchApp\./, ['https://www.googleapis.com/auth/script.external_request']],
  [/\bSpreadsheetApp\.(openById|openByUrl|create)\b|\bSheets\.Spreadsheets\b/, ['https://www.googleapis.com/auth/spreadsheets']],
  [/\bDriveApp\./, ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']],
  [/\bMailApp\.|GmailApp\./, ['https://www.googleapis.com/auth/script.send_mail', 'https://mail.google.com/']],
];

for (const proj of projects) {
  const dir = path.join(root, proj);
  if (!fs.existsSync(dir)) { err(`[${proj}] directory missing: ${dir}`); continue; }
  const list = files(dir);
  const code = {}, html = {};
  for (const f of list) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\.(gs|js)$/.test(f)) code[f] = src; else if (/\.html$/.test(f)) html[f] = src;
  }
  // 6. compile
  for (const [f, src] of Object.entries(code)) { try { new vm.Script(src, { filename: f }); } catch (e) { err(`[${proj}] ${f}: syntax error: ${e.message}`); } }
  for (const [f, src] of Object.entries(html)) scriptBlocks(src).forEach((s, k) => { try { new vm.Script(s, { filename: `${f}#script${k}` }); } catch (e) { err(`[${proj}] ${f} <script> #${k}: syntax error: ${e.message}`); } });
  try { new vm.Script(Object.values(code).join('\n;\n'), { filename: `${proj}(all files)` }); } catch (e) { err(`[${proj}] files do not load together (duplicate const/let?): ${e.message}`); }

  // definitions
  const defs = new Set(), fnDecl = new Map();
  for (const [f, src] of Object.entries(code)) {
    const s = stripComments(src);
    for (const m of s.matchAll(/(?:^|[;\s}])function\s+([A-Za-z_$][\w$]*)\s*\(/g)) { defs.add(m[1]); if (!fnDecl.has(m[1])) fnDecl.set(m[1], []); fnDecl.get(m[1]).push(f); }
    for (const m of s.matchAll(/(?:^|[;\s}(,])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defs.add(m[1]);
  }
  // 3. GAS shares one global scope across files; a second declaration silently wins.
  for (const [n, where] of fnDecl) if (where.length > 1) err(`[${proj}] function ${n}() declared ${where.length} times: ${where.join(', ')}`);

  // 1. google.script.run targets
  for (const [f, src] of Object.entries(html)) for (const s of scriptBlocks(src)) for (const t of runTargets(stripComments(s))) {
    if (t.endsWith('_')) err(`[${proj}] ${f}: google.script.run.${t}() calls a PRIVATE function (trailing "_" is not callable from the client)`);
    else if (!defs.has(t)) err(`[${proj}] ${f}: google.script.run.${t}() has no server function in this project`);
  }
  // 2. undefined private helpers
  for (const [f, src] of Object.entries(code)) {
    const s = stripComments(src).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
    for (const m of s.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*_)\s*\(/g)) if (!defs.has(m[1])) err(`[${proj}] ${f}: calls undefined function ${m[1]}()`);
  }
  // 4. manifest scopes
  const manifestPath = path.join(dir, 'appsscript.json');
  if (fs.existsSync(manifestPath)) {
    const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(mf.oauthScopes)) {
      const all = Object.values(code).join('\n') + Object.values(html).join('\n');
      for (const [re, scopes] of SCOPE_RULES) if (re.test(all) && !scopes.some(s => mf.oauthScopes.includes(s))) err(`[${proj}] appsscript.json oauthScopes is explicit but lacks ${scopes[0]} (used: ${re})`);
    } else notes.push(`[${proj}] oauthScopes not declared: Apps Script auto-detects scopes`);
    const adv = (mf.dependencies && mf.dependencies.enabledAdvancedServices || []).map(x => x.userSymbol);
    if (/\bSheets\.Spreadsheets\b/.test(Object.values(code).join('\n')) && !adv.includes('Sheets')) err(`[${proj}] uses Sheets advanced service but it is not enabled in appsscript.json`);
  }
}
// 5. shared files
for (const f of ['Domain.js', 'Repository.gs']) {
  const a = path.join(root, 'public', f), b = path.join(root, 'admin', f);
  if (fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) err(`shared file ${f} differs between public and admin`);
}

// 7. Pages storage key: Pages shares the github.io origin with the live v1 site, so the
//    verification build must not use the v1 key (it would overwrite real participants' records
//    on the same device). Switching back to v1 is a production cut-over decision, not a test edit.
{
  const cfgPath = path.join(root, '..', '03_pages', 'config.js');
  if (fs.existsSync(cfgPath)) {
    const m = /storageKey\s*:\s*['"]([^'"]+)['"]/.exec(fs.readFileSync(cfgPath, 'utf8'));
    if (!m) err('03_pages/config.js: storageKey not found');
    else if (m[1] === 'daily-dice.identity.v1' && process.env.ALLOW_V1_STORAGE_KEY !== '1') err('03_pages/config.js: storageKey is the live v1 key; use daily-dice.identity.v2-verify while verifying');
  }
}

notes.forEach(n => console.log('NOTE ' + n));
if (errors.length) { errors.forEach(e => console.log('FAIL ' + e)); console.log(`\n${errors.length} static check failure(s)`); process.exit(1); }
console.log('static checks passed');
