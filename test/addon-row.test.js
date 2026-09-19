/* The Experimental Collection row, and the phone tap that could not add it.
 *
 * On a phone, tapping "Add" threw the Hear it panel open over the row. The Collection was
 * being added correctly, but the panel covering it made that impossible to see, so it read
 * as "Add opens the popup instead of adding". The cause was CSS, not the click handler:
 * touch emulates hover on the FIRST tap, and `.addon:hover .addon-tip` was ungated, so the
 * panel opened the instant a thumb landed anywhere on the row, Add included. Present since
 * the panel shipped, not introduced by the ad code.
 *
 * The fix gates hover on a device that really hovers, and gives phones their own preview
 * button beside Add, since the panel no longer opens by itself there.
 *
 *   node test/addon-row.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let PASSED = 0, FAILED = 0;

function ok(name, cond, detail) {
  if (cond) { PASSED++; return; }
  FAILED++;
  console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
}

for (const file of ['frontend/index.html', 'index.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const where = file + ': ';

  // ── the hover gate, which is the whole bug ────────────────────────────────
  ok(where + 'the hover panel is gated on a device that actually hovers',
     /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.addon:hover \.addon-tip\{/.test(src));
  // Remove the gated block, then insist nothing outside it opens the panel on hover.
  // Checked this way because the gated rule is itself a `.addon:hover .addon-tip{` line.
  const outsideGate = src.replace(
    /@media \(hover: hover\) and \(pointer: fine\)\s*\{[\s\S]*?\n\s*\}/, '');
  ok(where + 'no ungated .addon:hover rule opens the panel',
     !/\.addon:hover \.addon-tip/.test(outsideGate),
     (outsideGate.match(/.{0,60}\.addon:hover \.addon-tip.{0,20}/) || [''])[0]);
  ok(where + 'the explicit tap class still opens it, for phones',
     /\.addon\.tip-open \.addon-tip\{opacity:1;visibility:visible;transform:none\}/.test(src));
  ok(where + 'and keyboard focus still opens it',
     /\.addon:has\(:focus-visible\) \.addon-tip\{/.test(src));

  // ── the preview button ────────────────────────────────────────────────────
  ok(where + 'there is a preview button in the row',
     /id="addon-mini-play"[\s\S]{0,200}onclick="strideCollectionAudio\(event\)"/.test(src));
  ok(where + 'it sits immediately before Add',
     src.indexOf('id="addon-mini-play"') > 0
     && src.indexOf('id="addon-mini-play"') < src.indexOf('id="addon-btn"'));
  ok(where + 'it is labelled for screen readers',
     /id="addon-mini-play"[\s\S]{0,160}aria-label="Play a preview/.test(src));
  ok(where + 'it is hidden by default and shown only where hover is absent',
     /\.addon-mini-play\{display:none\}/.test(src)
     && /@media \(hover: none\)\{[\s\S]{0,400}\.addon-mini-play\{display:inline-flex/.test(src));
  ok(where + 'it is big enough for a thumb',
     /\.addon-mini-play\{display:inline-flex;[\s\S]{0,120}width:32px;height:32px/.test(src));

  // ── neither control may be mistaken for the row ───────────────────────────
  ok(where + 'the row tap handler ignores Add and BOTH play controls',
     /if \(ev\.target\.closest\('#addon-btn'\) \|\| ev\.target\.closest\('\.addon-play'\)\s*\|\| ev\.target\.closest\('\.addon-mini-play'\)\) return;/.test(src));
  ok(where + 'the audio handler still stops the event reaching the row',
     /function strideCollectionAudio\(e\) \{\s*if \(e\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}/.test(src));

  // ── one sound, two buttons ────────────────────────────────────────────────
  ok(where + 'both play icons are driven together',
     /var icons = \[document\.getElementById\('addon-play-i'\),\s*document\.getElementById\('addon-mini-play-i'\)\]\.filter\(Boolean\);/.test(src));
  ok(where + 'and both are reset when the teaser ends',
     /a\.onended = function \(\) \{ set\('&#9654;', 'Hear it'\); \};/.test(src));
  ok(where + 'there is still exactly one audio element to drive',
     (src.match(/id="addon-audio"/g) || []).length === 1);

  // Add itself is untouched: it was never the broken part.
  ok(where + 'Add still toggles the order and nothing else',
     /id="addon-btn"[\s\S]{0,120}onclick="strideToggleAddon\(event\)"/.test(src));
}

console.log('  ' + PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
