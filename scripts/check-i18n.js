#!/usr/bin/env node
// Checks the public site's i18n coverage. No dependencies.
//   npm run i18n:check            → report; exits 1 only on real errors
//   npm run i18n:check -- --list  → also list every untranslated key per language
//
// Errors  (exit 1): a key used in the HTML/JS (data-i18n*, I18n.t(...)) that en.json lacks.
// Warnings (exit 0): keys present in en.json but not yet translated in another language
//                    (the site falls back to English for those at runtime).
'use strict';
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const LOCALES = path.join(PUBLIC, 'locales');
const listAll = process.argv.includes('--list');

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const en = new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, 'en.json'), 'utf8'))));

// ─── Keys referenced by the site ────────────────────────────────
const sources = fs.readdirSync(PUBLIC)
  .filter((f) => /\.(html|js)$/.test(f) && f !== 'sw.js')
  .map((f) => [f, fs.readFileSync(path.join(PUBLIC, f), 'utf8')]);
const used = new Map();
const note = (key, file) => { if (!used.has(key)) used.set(key, new Set()); used.get(key).add(file); };
for (const [file, src] of sources) {
  for (const m of src.matchAll(/data-i18n(?:-[a-z]+)?=["']([\w.]+)["']/g)) note(m[1], file);
  for (const m of src.matchAll(/\b(?:t|_t|errorHtml)\(\s*['"`]([\w]+\.[\w.]+)['"`]/g)) note(m[1], file);
}
const undefinedKeys = [...used.keys()].filter((k) => !en.has(k)).sort();

let failed = false;
if (undefinedKeys.length) {
  failed = true;
  console.error(`✗ ${undefinedKeys.length} key(s) used in the site but missing from en.json:`);
  undefinedKeys.forEach((k) => console.error(`    ${k}   (${[...used.get(k)].join(', ')})`));
} else {
  console.log(`✓ all ${used.size} keys referenced by the site exist in en.json`);
}

// ─── Translation coverage ───────────────────────────────────────
for (const file of fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  const have = new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'))));
  const missing = [...en].filter((k) => !have.has(k));
  const extra = [...have].filter((k) => !en.has(k));
  const pct = Math.round(((en.size - missing.length) / en.size) * 100);
  console.log(`${missing.length ? '△' : '✓'} ${file.replace('.json', '')}: ${en.size - missing.length}/${en.size} translated (${pct}%)` +
    (extra.length ? `, ${extra.length} key(s) not in en.json` : ''));
  if (missing.length) {
    const bySection = {};
    missing.forEach((k) => { const s = k.split('.')[0]; bySection[s] = (bySection[s] || 0) + 1; });
    console.log('    missing by section: ' + Object.entries(bySection).map(([s, n]) => `${s} ${n}`).join(', '));
    if (listAll) missing.forEach((k) => console.log(`      ${k}`));
  }
}
process.exit(failed ? 1 : 0);
