/**
 * Smoke tests for pattern-library.js (the UI module).
 *
 * Pattern-library.js touches DOM globals, so we stub them just enough to
 * load the module cleanly and assert the public API surface. Visual /
 * interaction tests live in the Electron app — this only catches gross
 * regressions like a missing export or a throw on init.
 *
 * Run: node test/test-pattern-library-ui.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─── Minimal DOM stub ────────────────────────────────────────────
// Just enough that pattern-library.js loads without throwing. We don't
// test actual show/hide behavior here — that needs jsdom or real
// Electron, neither of which is wired into the test runner.

const elements = {};
function makeEl(id) {
    const classList = new Set();
    const attrs = {};
    const listeners = {};
    return {
        id,
        classList: {
            add: (c) => classList.add(c),
            remove: (c) => classList.delete(c),
            contains: (c) => classList.has(c),
            toggle: (c) => classList.has(c) ? classList.delete(c) : classList.add(c),
            _set: classList,
        },
        setAttribute: (k, v) => { attrs[k] = v; },
        removeAttribute: (k) => { delete attrs[k]; },
        getAttribute: (k) => attrs[k] || null,
        addEventListener: (ev, fn) => {
            (listeners[ev] = listeners[ev] || []).push(fn);
        },
        _fire: (ev, data) => (listeners[ev] || []).forEach(fn => fn(data)),
        _attrs: attrs,
    };
}

global.document = {
    getElementById: (id) => {
        if (!elements[id]) elements[id] = makeEl(id);
        return elements[id];
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete',
    activeElement: null,
};
global.window = {};
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.fetch = () => Promise.reject(new Error('fetch not stubbed'));

console.log('\n── Pattern library UI smoke ──────────────────\n');

test('pattern-library.js loads without throwing', () => {
    require('../app/renderer/pattern-library.js');
});

test('strideLibraryUI is attached to window', () => {
    assert(window.strideLibraryUI, 'window.strideLibraryUI missing');
});

test('API surface exposes expected functions', () => {
    const ui = window.strideLibraryUI;
    for (const fn of ['open', 'close', 'toggle', 'isOpen', 'on', 'off', 'init']) {
        assert(typeof ui[fn] === 'function', `missing ${fn}`);
    }
});

test('isOpen() initial state is false', () => {
    assert(window.strideLibraryUI.isOpen() === false);
});

test('open() flips state to true', (done) => {
    window.strideLibraryUI.open();
    assert(window.strideLibraryUI.isOpen() === true, 'isOpen still false after open()');
});

test('toggle() inverts state', () => {
    const before = window.strideLibraryUI.isOpen();
    window.strideLibraryUI.toggle();
    assert(window.strideLibraryUI.isOpen() !== before, 'toggle did nothing');
});

test('event bus emits open and close', () => {
    let openFired = 0;
    let closeFired = 0;
    window.strideLibraryUI.on('open', () => openFired++);
    window.strideLibraryUI.on('close', () => closeFired++);
    // Ensure starting from a known state
    if (window.strideLibraryUI.isOpen()) window.strideLibraryUI.close();
    window.strideLibraryUI.open();
    window.strideLibraryUI.close();
    assert(openFired >= 1, 'open event not fired');
    assert(closeFired >= 1, 'close event not fired');
});

test('off() removes listener', () => {
    let fired = 0;
    const handler = () => fired++;
    window.strideLibraryUI.on('open', handler);
    window.strideLibraryUI.off('open', handler);
    if (window.strideLibraryUI.isOpen()) window.strideLibraryUI.close();
    window.strideLibraryUI.open();
    assert(fired === 0, 'handler still fired after off()');
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
