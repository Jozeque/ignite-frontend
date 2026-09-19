/* The ad discount code, /?code=rekz.
 *
 * An ad lands on the homepage with a code and the visitor sees the discounted price
 * everywhere the page prints one, with the discount already inside the Paddle checkout so
 * there is nothing to type. ORGANIC traffic must see none of it.
 *
 * Two rules this pins, both learned the hard way on 2026-09-19:
 *
 *   1. The code comes from the URL and NOWHERE else. It was briefly remembered in
 *      sessionStorage so it survived navigation; that leaked the ad price to anyone who
 *      had clicked an ad once in that tab, including on a bare stridehub.io.
 *   2. Nothing about the code may move the page. A badge announcing it was added above the
 *      price and pushed the Collection's Add button down 19 to 28px at 390, 768 and 1280,
 *      so clicking where Add used to be hit "Hear it" instead. The badge is gone. Any
 *      future one must not occupy layout.
 *
 * And the oldest trap: strideFx converts our list anchors (129, 35) into the visitor's
 * currency, so it MUST come from the UNDISCOUNTED preview. From the discounted one it
 * reads 0.8 for a US visitor, redrawing the struck 129 as 103 and collapsing the seal.
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
    // The stub records every storage call, so a reader that reaches for one fails here.
    const run = (href, stored) => {
      const touched = [];
      const store = { stride_code: stored || null };
      const shim = (kind) => ({
        getItem: (k) => { touched.push(kind + '.getItem:' + k); return (k in store ? store[k] : null); },
        setItem: (k, v) => { touched.push(kind + '.setItem:' + k); store[k] = String(v); },
        removeItem: (k) => { touched.push(kind + '.removeItem:' + k); delete store[k]; },
      });
      const ctx = { window: { location: { href: href } }, URL: URL, document: { cookie: '' } };
      ctx.window.sessionStorage = shim('session');
      ctx.window.localStorage = shim('local');
      ctx.sessionStorage = ctx.window.sessionStorage;
      ctx.localStorage = ctx.window.localStorage;
      vm.createContext(ctx);
      vm.runInContext(block[0], ctx);
      return { id: vm.runInContext('strideCodeId', ctx), touched: touched, stored: store.stride_code };
    };

    const hit = run('https://stridehub.io/?code=rekz&utm_source=ig&ad_id=120254172571240440');
    ok(where + 'a rekz landing resolves to the discount', hit.id === REKZ, String(hit.id));
    ok(where + 'the code is case and space insensitive',
       run('https://stridehub.io/?code=%20REKZ%20').id === REKZ);
    ok(where + 'an unknown code is ignored, never an error',
       run('https://stridehub.io/?code=notarealcode').id === null);
    ok(where + 'a bare stridehub.io discounts nothing',
       run('https://stridehub.io/').id === null);
    ok(where + 'nor any other page without the param',
       run('https://stridehub.io/how-it-works').id === null);

    // RULE 1. Organic traffic must never inherit an earlier ad click.
    ok(where + 'the reader touches NO browser storage at all',
       hit.touched.length === 0, hit.touched.join(', '));
    ok(where + 'a code stored from an earlier visit does NOT discount a bare landing',
       run('https://stridehub.io/', 'rekz').id === null,
       'organic traffic would be getting the ad price');
    ok(where + 'and the reader writes nothing for a later visit to find',
       run('https://stridehub.io/?code=rekz').stored === null);
    ok(where + 'no storage key is even defined for it',
       !/STRIDE_CODE_KEY/.test(src) && !/stride_code'/.test(src));
  }

  // ── the four places it has to reach ───────────────────────────────────────
  ok(where + 'the price preview takes a discount',
     /function stridePricePreview\(discountId\)/.test(src)
     && /if \(discountId\) body\.discountId = discountId;/.test(src));

  ok(where + 'the page previews BOTH the list and the charged price',
     /stridePricePreview\(''\)[\s\S]{0,120}strideCodeId \? stridePricePreview\(strideCodeId\) : null/.test(src));

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

  const giftAt = src.indexOf('transactionId: strideGiftTxn');
  ok(where + 'the gift checkout still opens its own transaction', giftAt > 0);
  ok(where + 'and no discount is layered onto the gift',
     giftAt > 0 && !/discountId/.test(src.slice(giftAt, giftAt + 400)));

  // ── RULE 2. the code may not move the page ────────────────────────────────
  // The badge that did is gone. These keep it gone rather than trusting memory.
  ok(where + 'no badge element is created in the price box',
     !/sd-code-badge/.test(src) && !/strideCodeBadge/.test(src));
  ok(where + 'nothing is inserted at the front of a price box',
     !/box\.insertBefore/.test(src));
  ok(where + 'the price box loop only rewrites the two numbers already there',
     /const struck = box\.querySelector\('\[style\*="line-through"\]'\);[\s\S]{0,400}?\}\);/.test(src)
     && !/createElement/.test((src.match(/document\.querySelectorAll\('\.sd-price-box'\)[\s\S]{0,400}?\}\);/) || [''])[0]));
  ok(where + 'the code contributes no CSS of its own',
     !/\.sd-code-badge\{/.test(src));
  ok(where + 'the saving is still printed as Save, not a percentage',
     /'Save ' \+ strideMoneyExact/.test(src) && !/20% OFF/.test(src));
  ok(where + 'no percentage is computed for display anywhere',
     !/strideCodePct/.test(src));
}

console.log('  ' + PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
