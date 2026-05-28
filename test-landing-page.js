#!/usr/bin/env node
// Landing-page integrity check.
//
// Run with: node test-landing-page.js
//
// Verifies that the new "One click to rule them all" + "Every button is a
// variation" landing sections shipped cleanly: frontend/ and root/ stay in
// sync, all image references resolve, HTML tags balance, the new section
// markers exist, the old ones are gone, and every feature color matches the
// Tailwind shade used in the actual Stride UI (stride-vst/app/renderer).
//
// Exit code = number of failed checks (0 = all green).

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const FRONTEND_INDEX = path.join(ROOT, 'frontend', 'index.html');
const ROOT_INDEX = path.join(ROOT, 'index.html');
const FRONTEND_BACKUP = path.join(ROOT, 'frontend', 'index_v1_preLaunchRefresh.html');
const ROOT_BACKUP = path.join(ROOT, 'index_v1_preLaunchRefresh.html');

const BACKUP_EXPECTED_SIZE = 94254; // size of the pre-refresh landing page

let failed = 0;
let passed = 0;

function check(label, ok, detail) {
    if (ok) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n[${title}]`);
}

// ─── 1. File presence + sync ──────────────────────────────────────────────
section('file presence + frontend/root sync');

const frontExists = fs.existsSync(FRONTEND_INDEX);
const rootExists = fs.existsSync(ROOT_INDEX);
check('frontend/index.html exists', frontExists);
check('root index.html exists', rootExists);

let frontHtml = '';
let rootHtml = '';
if (frontExists) frontHtml = fs.readFileSync(FRONTEND_INDEX, 'utf8');
if (rootExists) rootHtml = fs.readFileSync(ROOT_INDEX, 'utf8');

check(
    'frontend/index.html === root index.html (CLAUDE.md sync rule)',
    frontHtml === rootHtml,
    frontHtml.length !== rootHtml.length
        ? `sizes differ: ${frontHtml.length} vs ${rootHtml.length}`
        : 'content differs at same length'
);

// ─── 2. Backup integrity ──────────────────────────────────────────────────
section('backup integrity');

const fBackupExists = fs.existsSync(FRONTEND_BACKUP);
const rBackupExists = fs.existsSync(ROOT_BACKUP);
check('frontend/index_v1_preLaunchRefresh.html exists', fBackupExists);
check('root index_v1_preLaunchRefresh.html exists', rBackupExists);

if (fBackupExists) {
    const sz = fs.statSync(FRONTEND_BACKUP).size;
    check(
        `frontend backup is the original size (${BACKUP_EXPECTED_SIZE} bytes)`,
        sz === BACKUP_EXPECTED_SIZE,
        `got ${sz}`
    );
}
if (rBackupExists) {
    const sz = fs.statSync(ROOT_BACKUP).size;
    check(
        `root backup is the original size (${BACKUP_EXPECTED_SIZE} bytes)`,
        sz === BACKUP_EXPECTED_SIZE,
        `got ${sz}`
    );
}
if (fBackupExists && rBackupExists) {
    const f = fs.readFileSync(FRONTEND_BACKUP, 'utf8');
    const r = fs.readFileSync(ROOT_BACKUP, 'utf8');
    check('both backups are byte-equal', f === r);
}

// ─── 3. New section content present ───────────────────────────────────────
section('new section markers present');

[
    'One click to rule them all',
    'Every button is a',                  // "Every button is a <span>variation</span>"
    'Push your instruments to the edge',  // new Section A subtitle
    'Get multiple variations from the same synth/instrument rack', // Section B sub
].forEach(marker => {
    check(`contains: "${marker}"`, frontHtml.includes(marker));
});

// Feature titles in Section A
['>Chaos<', '>Neuro<', '>Reflector<', '>Sample &amp; Hold<'].forEach(t => {
    check(`Section A title present: ${t}`, frontHtml.includes(t));
});

// ─── 4. Old removed content is gone ───────────────────────────────────────
section('old removed content is absent');

[
    'Not just automation',
    'Inside the Engine',
    '<h2 class="text-4xl md:text-6xl font-black mb-4 tracking-tight text-white">Inside the Engine</h2>',
    'One canvas.<br>Every parameter.<br>',
    'All Lanes, One Click',     // old Power Banner sub-card
    'Mutate & Evolve',          // old Power Banner sub-card
    'Chaos on Demand',          // old Power Banner sub-card
    'Generative Engine</h3>',   // old Inside-the-Engine card title
].forEach(marker => {
    check(`absent: "${marker}"`, !frontHtml.includes(marker));
});

// ─── 5. Image references resolve to real files ────────────────────────────
section('image references resolve to real files');

const imgRe = /<img[^>]+src=["']([^"']+)["']/g;
const imgSrcs = new Set();
let m;
while ((m = imgRe.exec(frontHtml)) !== null) {
    const src = m[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) continue;
    imgSrcs.add(src);
}
imgSrcs.forEach(src => {
    const filePath = path.join(ROOT, src);
    check(`<img src="${src}"> file exists`, fs.existsSync(filePath));
});

// ─── 6. Feature color audit — landing matches in-app ──────────────────────
section('feature title colors match in-app Tailwind shades');

// Single source of truth — mirrors stride-vst/app/renderer/canvas.js + index.html
const APP_COLORS = {
    Chaos: 'cyan-400',
    Neuro: 'fuchsia-400',
    Reflector: 'sky-400',
    'Sample &amp; Hold': 'lime-400',
    Prism: 'violet-400',
    Mutate: 'emerald-400',
};

Object.entries(APP_COLORS).forEach(([feature, shade]) => {
    // We want at least one place where this feature name is rendered in its
    // accent color — either an <h3> title or a <strong> in body copy.
    const escFeature = feature.replace(/&/g, '&').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`text-${shade}[^"]*"[^>]*>(?:<[^>]+>)?${escFeature}(?:<|\\s)`);
    check(
        `${feature.replace('&amp;','&')} rendered in text-${shade} somewhere`,
        pattern.test(frontHtml),
        `expected a node colored text-${shade} containing "${feature}"`
    );
});

// ─── 7. Untouched sections still present ──────────────────────────────────
section('untouched sections still present');

[
    'How It Works',
    'Three steps. Zero friction.',
    'Drop Stride on your track',
    'Shape your sound',
    'Apply to clip',
    'Works with any Ableton instrument rack',
    'Where Stride shines',
].forEach(marker => {
    check(`still contains: "${marker}"`, frontHtml.includes(marker));
});

// ─── 8. HTML tag balance for the major block elements ─────────────────────
section('HTML tag balance');

function tagBalance(html, tag) {
    const open = (html.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || []).length;
    // close = </tag>  (allow optional whitespace before >)
    const close = (html.match(new RegExp(`</${tag}\\s*>`, 'g')) || []).length;
    return { open, close, balanced: open === close };
}

['section', 'h2', 'h3', 'h4', 'p', 'main', 'header', 'footer', 'nav', 'ul', 'li'].forEach(tag => {
    const b = tagBalance(frontHtml, tag);
    check(`<${tag}> balanced (${b.open} open / ${b.close} close)`, b.balanced);
});

// <div> balance is loose — Tailwind utility divs are everywhere. Still worth
// checking for gross imbalance (off by more than ~1 means structural break).
{
    const b = tagBalance(frontHtml, 'div');
    check(
        `<div> balanced (${b.open} open / ${b.close} close)`,
        Math.abs(b.open - b.close) === 0,
        b.balanced ? '' : `off by ${b.open - b.close}`
    );
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────`);
console.log(`  ${passed} passed   ${failed} failed`);
console.log(`────────────────────────────────────────`);

process.exit(failed);
