import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionScope, snapshotAnchor, resolveAnchor, readMode, effectiveMode, curvePoint, countNewCards, cardCounts } from '../src/ui/fx-motion.js';
import { FxParticles } from '../src/ui/fx-particles.js';
import { el } from '../src/ui/dom.js';

function clock() {
  let id = 0; const tasks = new Map();
  return { tasks, setTimeout: (fn) => { tasks.set(++id, fn); return id; }, clearTimeout: (i) => tasks.delete(i),
    flush() { for (const [i, fn] of [...tasks]) { tasks.delete(i); fn(); } } };
}
function node() {
  return { style: {}, removed: false, remove() { this.removed = true; },
    animate() { this.animation = { cancel() { this.oncancel?.(); } }; return this.animation; } };
}
const frames = [{ transform: 'translateX(0)', opacity: 0 }, { transform: 'translateX(10px)', opacity: 1 }];

test('FX: completion callback fires exactly once and clears the fallback timer', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), n = node(); let count = 0;
  scope.play(n, frames, { duration: 100 }, () => count++);
  n.animation.onfinish(); c.flush();
  assert.equal(count, 1); assert.equal(scope.tasks.size, 0); assert.equal(c.tasks.size, 0); assert.ok(n.removed);
});
test('FX: animation cancellation never triggers a later hit effect', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), n = node(); let hit = 0;
  scope.play(n, frames, {}, () => hit++); n.animation.cancel(); c.flush();
  assert.equal(hit, 0); assert.equal(scope.tasks.size, 0); assert.equal(scope.timers.size, 0);
});
test('FX: destroy clears all timers/animations, including scheduled bursts', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), n = node(); let hits = 0;
  scope.play(n, frames, {}, () => hits++); scope.schedule(() => hits++, 100); scope.dispose(); c.flush();
  assert.equal(hits, 0); assert.equal(c.tasks.size, 0); assert.equal(scope.tasks.size, 0);
  scope.schedule(() => hits++); assert.equal(c.tasks.size, 0);
});
test('FX: in-place animation cleanup never removes a real hand card', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), card = node();
  scope.play(card, frames, {}, null, { remove: false }); scope.clear(); assert.equal(card.removed, false);
});
test('FX: mode off keeps information still without invoking WAAPI', () => {
  const c = clock(), scope = new MotionScope({ clock: c, mode: 'off' }), n = node();
  scope.play(n, frames, { duration: 900 });
  assert.equal(n.animation, undefined); assert.equal(n.style.opacity, 1); assert.equal(n.removed, false);
  c.flush(); assert.ok(n.removed);
});
test('FX: mode off discards decoration without scheduling anything', () => {
  const scope = new MotionScope({ clock: clock(), mode: 'off' }), n = node();
  scope.play(n, frames, {}, null, { essential: false }); assert.ok(n.removed); assert.equal(scope.tasks.size, 0);
});
test('FX: missing WAAPI falls back to a readable frame and cleans up', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), n = node(); delete n.animate;
  scope.play(n, frames, {}); assert.equal(n.style.opacity, 1); c.flush(); assert.ok(n.removed);
});
test('FX: task budget remains bounded under a burst of 200 effects', () => {
  const c = clock(), scope = new MotionScope({ clock: c, maxTasks: 12 });
  for (let i = 0; i < 200; i++) scope.play(node(), frames, {});
  assert.equal(scope.tasks.size, 12); assert.equal(c.tasks.size, 12); scope.clear(); assert.equal(c.tasks.size, 0);
});
test('FX: detached, hidden and malformed anchors are rejected', () => {
  assert.equal(snapshotAnchor(null), null);
  assert.equal(snapshotAnchor({ isConnected: false, getBoundingClientRect() { throw Error('must not read'); } }), null);
  assert.equal(snapshotAnchor({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 10 }) }), null);
  assert.equal(snapshotAnchor({ getBoundingClientRect: () => ({ left: NaN, top: 0, width: 10, height: 10 }) }), null);
});
test('FX: hit resolves the replacement player node, not the detached old DOM', () => {
  const old = { dataset: { pid: 'p[1]' }, getBoundingClientRect: () => ({ left: 10, top: 20, width: 80, height: 90 }) };
  const anchor = snapshotAnchor(old); old.isConnected = false;
  const live = { dataset: { pid: 'p[1]' }, getBoundingClientRect: () => ({ left: 200, top: 50, width: 80, height: 90 }) };
  assert.equal(resolveAnchor(anchor, { querySelectorAll: () => [live] }).x, 240);
  assert.equal(resolveAnchor(anchor, { querySelectorAll: () => [] }).x, 50);
  assert.ok(Object.isFrozen(anchor));
});
test('FX: visual curve has exact endpoints and finite intermediate points', () => {
  const a = { x: 20, y: 30 }, b = { x: 80, y: 90 };
  assert.deepEqual(curvePoint(a, b, 0), a); assert.deepEqual(curvePoint(a, b, 1), b);
  assert.deepEqual(curvePoint(a, b, .5, 10), { x: 50, y: 50 });
});
test('FX: selecting/reordering cards does not repeat the draw animation', () => {
  const previous = cardCounts(['sha', 'tao', 'sha']);
  assert.deepEqual(countNewCards(previous, ['tao', 'sha', 'sha']), [false, false, false]);
  assert.deepEqual(countNewCards(previous, ['sha', 'sha', 'sha']), [false, false, true]);
  assert.deepEqual(countNewCards(null, ['sha']), [false]);
});
test('FX: settings tolerate invalid/blocked storage and honor reduced motion', () => {
  assert.equal(readMode({ getItem: () => 'lite' }), 'lite');
  assert.equal(readMode({ getItem() { throw Error('denied'); } }, true), 'lite');
  assert.equal(readMode({ getItem: () => 'invalid' }), 'full');
  assert.equal(effectiveMode('full', true), 'off');
});
test('FX: visual randomness does not consume the game Math.random stream', () => {
  const old = Math.random;
  try { Math.random = () => { throw Error('game RNG consumed'); }; const p = new FxParticles(null); assert.ok(p.random() >= 0); assert.ok(p.random() < 1); }
  finally { Math.random = old; }
});
test('DOM: custom CSS properties use setProperty, camelCase styles stay supported', () => {
  const old = globalThis.document, properties = new Map();
  globalThis.document = { createElement: () => ({ style: { setProperty: (k, v) => properties.set(k, v) } }) };
  try {
    const n = el('div', { style: { '--accent': '#123456', 'background-color': 'red', borderRadius: '4px' } });
    assert.equal(properties.get('--accent'), '#123456'); assert.equal(properties.get('background-color'), 'red'); assert.equal(n.style.borderRadius, '4px');
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; }
});


test('FX: fallback restores inline styles on a real card after cleanup', () => {
  const c = clock(), scope = new MotionScope({ clock: c }), n = node(); delete n.animate;
  n.style.opacity = '.8'; n.style.transform = 'rotate(2deg)';
  scope.play(n, frames, {}, null, { remove: false }); c.flush();
  assert.equal(n.style.opacity, '.8'); assert.equal(n.style.transform, 'rotate(2deg)'); assert.equal(n.removed, false);
});
test('FX: malformed task budgets cannot hang animation scheduling', () => {
  for (const maxTasks of [-1, 0, NaN, Infinity]) {
    const scope = new MotionScope({ clock: clock(), maxTasks });
    scope.play(node(), frames); assert.ok(scope.tasks.size <= 128); scope.dispose();
  }
});
