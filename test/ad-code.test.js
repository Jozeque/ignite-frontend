/* The ad discount code, /?code=rekz.
 *
 * An ad lands on the homepage with a code and the visitor must see the discounted price
 * everywhere the page prints one, with the discount already inside the Paddle checkout so
 * there is nothing to type.
 *
 * The behaviour against real Paddle is proven by the Playwright rigs (hero, add-on toggle
 * and the express mount). What can regress SILENTLY is the wiring, so that is what this
 * pins: the reader's rules, and the four places the discount has to reach. The nastiest of
 * them is strideFx: it converts our list anchors (129, 35) into the visitor's currency, so
 * deriving it from the DISCOUNTED preview makes the struck 129 follow the discount down to
 * 103 and the Save seal collapse. It must come from the undiscounted one.
 *
 *   node test/ad-code.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let PASSED = 0, FAILED = 0;

function ok(name, cond, detail) {
  if (cond) { PASSED++; return; }
  FAILED++;
  console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
}

const REKZ = 'dsc_01m2fxadt3hs2myt4k203tpj2t';

for (const file of ['frontend/index.html', 'index.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const where = file + ': ';

  // ── the map and the reader ────────────────────────────────────────────────
  ok(where + 'rekz maps to its Paddle discount',
     new RegExp("STRIDE_CODES\\s*=\\s*\\{\\s*rekz:\\s*'" + REKZ + "'\\s*\\}").test(src));

  const block = src.match(/const STRIDE_CODES = [\s\S]*?\}\)\(\);/);
  ok(where + 'the reader runs as one self-contained block', !!block);

  if (block) {
    const run = (href, stored) => {
      const store = { stride_code: stored || null };
      const ctx = {
        window: {
          location: { href: href },
          sessionStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
          },
        },
        URL: URL,
      };
      ctx.sessionStorage = ctx.window.sessionStorage;
      vm.createContext(ctx);
      // The block declares strideCodeId itself, so it runs as-is.
      vm.runInContext(block[0], ctx);
      const id = vm.runInContext('strideCodeId', ctx);
      return { id: id, stored: store.stride_code };
    };

    const hit = run('https://stridehub.io/?code=rekz&utm_source=ig');
    ok(where + 'a rekz landing resolves to the discount', hit.id === REKZ, String(hit.id));
    ok(where + 'and is remembered for the tab', hit.stored === 'rekz');

    ok(where + 'the code is case and space insensitive',
       run('https://stridehub.io/?code=%20REKZ%20').id === REKZ);

    const miss = run('https://stridehub.io/?code=notarealcode');
    ok(where + 'an unknown code is ignored, never an error', miss.id === null);
    ok(where + 'and is NOT remembered', miss.stored === null);

    ok(where + 'a plain landing discounts nothing',
       run('https://stridehub.io/').id === null);
    ok(where + 'a remembered code survives a page without the param',
       run('https://stridehub.io/how-it-works', 'rekz').id === REKZ);
    ok(where + 'a remembered code that is no longer known is ignored',
       run('https://stridehub.io/', 'retired').id === null);
  }

  // ── the four places it has to reach ───────────────────────────────────────
  ok(where + 'the price preview takes a discount',
     /function stridePricePreview\(discountId\)/.test(src)
     && /if \(discountId\) body\.discountId = discountId;/.test(src));

  ok(where + 'the page previews BOTH the list and the charged price',
     /stridePricePreview\(''\)[\s\S]{0,120}strideCodeId \? stridePricePreview\(strideCodeId\) : null/.test(src));

  // The trap. strideLocal is what the page charges, strideFx is for the anchors.
  ok(where + 'strideFx comes from the UNDISCOUNTED preview, so 129 stays 129',
     /strideFx = \{ rate: list\.stride \/ STRIDE_PRICE, currency: list\.currency \}/.test(src));
  ok(where + 'and strideLocal is what the visitor is actually charged',
     /strideLocal = charged;/.test(src));
  ok(where + 'strideFx is never derived from the charged price',
     !/rate: charged\.stride \/ STRIDE_PRICE/.test(src));

  const opens = src.match(/Paddle\.Checkout\.open\(\{/g) || [];
  ok(where + 'all three checkout paths are still there', opens.length === 3, String(opens.length));

  const carried = (src.match(/discountId: strideCodeId \|\| undefined/g) || []).length;
  ok(where + 'the buy form and the wallet both carry the code', carried === 2, String(carried));

  ok(where + 'a re-priced wallet restates the discount',
     /updateCheckout\(\{ items: strideCheckoutItems\(\),[\s\S]{0,60}discountId: strideCodeId \}\)/.test(src));

  // The gift checkout opens a transaction the backend already built, Stride at this
  // visitor's price with the Collection at 0. A code must never be layered onto it.
  const giftAt = src.indexOf('transactionId: strideGiftTxn');
  ok(where + 'the gift checkout still opens its own transaction', giftAt > 0);
  ok(where + 'and no discount is layered onto the gift',
     giftAt > 0 && !/discountId/.test(src.slice(giftAt, giftAt + 400)));

  // The seal says Save, never a percentage: 20% off the 99 street price is NOT 20% off
  // the 129 anchor, and printing both together makes the page contradict itself.
  ok(where + 'the saving is still printed as Save, not a percentage',
     /'Save ' \+ strideMoneyExact/.test(src) && !/20% OFF/.test(src));

  // ── the badge that names the code ────────────────────────────────────────
  // Without it the discount is applied in silence and nothing tells the visitor the ad
  // earned them anything.
  ok(where + 'the badge is rendered for every price box',
     /strideCodeBadge\(box\);/.test(src) && /function strideCodeBadge\(box\)/.test(src));
  // − in the regex matches the literal minus sign the source carries.
  ok(where + 'it names the code and what it was worth',
     /strideCodeName\.toUpperCase\(\) \+ ' −' \+ strideCodePct \+ '% APPLIED'/.test(src));
  ok(where + 'and is removed when no code is active, so the plain page is untouched',
     /if \(!strideCodeName \|\| !strideCodePct\)/.test(src)
     && /removeChild\(el\)/.test(src));
  ok(where + 'it goes first in the box, above the price',
     /box\.insertBefore\(el, box\.firstChild\)/.test(src));
  ok(where + 'the badge has its own row and never reflows the price',
     /\.sd-code-badge\{flex:0 0 100%/.test(src));

  // The percentage is MEASURED, never written down, so it cannot claim a number Paddle
  // is not charging. REKZ is restricted to the Stride price, so this is deliberately the
  // Stride ratio and not the whole cart's.
  ok(where + 'the percentage is measured from the two previews',
     /var cut = list\.stride > 0 \? 1 - \(charged\.stride \/ list\.stride\) : 0;/.test(src)
     && /strideCodePct = cut > 0\.005 \? Math\.round\(cut \* 100\) : 0;/.test(src));
  ok(where + 'a discount Paddle refused prints no badge rather than 0%',
     /cut > 0\.005/.test(src));
  ok(where + 'no percentage is hardcoded anywhere near the badge',
     !/strideCodePct = 20/.test(src));

  // strideCodeName must be declared BEFORE the reader assigns it, or the reader throws
  // on its own temporal dead zone and no code is ever read.
  ok(where + 'strideCodeName is declared before the reader runs',
     src.indexOf('let strideCodeName') < src.indexOf('strideCodeName = name;')
     && src.indexOf('let strideCodeName') < src.indexOf('(function strideReadCode()'));
}

console.log('  ' + PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
