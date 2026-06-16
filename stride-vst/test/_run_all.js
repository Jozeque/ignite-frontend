/**
 * Run every test file in stride-vst/test/ in sequence. Reports pass/fail
 * counts and exits non-zero if anything failed.
 *
 * Doesn't run files with underscore prefix (those are utilities, not tests).
 *
 * Usage: node test/_run_all.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_DIR = __dirname;
const files = fs.readdirSync(TEST_DIR)
    .filter(f => f.startsWith('test-') && f.endsWith('.js'))
    .sort();

let totalPassed = 0;
let totalFailed = 0;
let filesFailed = 0;

console.log(`\nRunning ${files.length} test files…\n`);
for (const f of files) {
    const full = path.join(TEST_DIR, f);
    const res = spawnSync(process.execPath, [full], { encoding: 'utf8' });
    const out = (res.stdout || '') + (res.stderr || '');
    const m = out.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
    if (m) {
        const p = +m[1], fl = +m[2];
        totalPassed += p; totalFailed += fl;
        if (fl > 0) filesFailed++;
        const status = fl === 0 ? '✓' : '✗';
        console.log(`  ${status} ${f.padEnd(38)} ${p} passed, ${fl} failed`);
    } else {
        // No results line means crash or unusual output
        filesFailed++;
        totalFailed++;
        console.log(`  ✗ ${f.padEnd(38)} CRASHED (exit ${res.status})`);
        if (process.env.STRIDE_TEST_VERBOSE) {
            console.log('     stdout:', (res.stdout || '').slice(0, 500));
            console.log('     stderr:', (res.stderr || '').slice(0, 500));
        }
    }
}

console.log(`\n──────────────────────────────────────────────`);
console.log(`Suite total: ${totalPassed} passed, ${totalFailed} failed across ${files.length} files`);
console.log(`──────────────────────────────────────────────\n`);

if (totalFailed > 0 || filesFailed > 0) process.exit(1);
