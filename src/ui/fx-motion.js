// Presentation-only helpers. No engine state, gameplay delays or game RNG are used.
export const FX_MODES = ['full', 'lite', 'off'];
export const FX_STORAGE_KEY = 'sgs_fx_quality';
export const normalizeMode = (value) => FX_MODES.includes(value) ? value : 'full';
export const effectiveMode = (mode, reduced) => reduced ? 'off' : normalizeMode(mode);
export function readMode(storage, coarse = false) {
  try {
    const saved = storage?.getItem(FX_STORAGE_KEY);
    if (FX_MODES.includes(saved)) return saved;
  } catch { /* Private browsing may deny storage. */ }
  return coarse ? 'lite' : 'full';
}
export function snapshotAnchor(node) {
  if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== 'function') return null;
  const r = node.getBoundingClientRect();
  if (![r.left, r.top, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
  return Object.freeze({ left: r.left, top: r.top, width: r.width, height: r.height,
    x: r.left + r.width / 2, y: r.top + r.height / 2, pid: node.dataset?.pid ?? null });
}
export function resolveAnchor(anchor, scope) {
  if (!anchor) return null;
  if (anchor.pid != null && scope?.querySelectorAll) {
    const live = [...scope.querySelectorAll('[data-pid]')].find((node) => node.dataset.pid === anchor.pid);
    return snapshotAnchor(live) || anchor;
  }
  return anchor;
}
export function curvePoint(from, to, t, lift = 30) {
  const p = Math.max(0, Math.min(1, t));
  return { x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p - 4 * lift * p * (1 - p) };
}
export function countNewCards(previous, keys) {
  const counts = new Map();
  return keys.map((key) => {
    const occurrence = (counts.get(key) || 0) + 1;
    counts.set(key, occurrence);
    return previous != null && occurrence > (previous.get(key) || 0);
  });
}
export function cardCounts(keys) {
  const counts = new Map();
  keys.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
  return counts;
}

// Own every animation and timeout; cancellation never invokes a completion effect.
export class MotionScope {
  constructor({ mode = 'full', maxTasks = 64, clock = globalThis } = {}) {
    this.mode = normalizeMode(mode); this.maxTasks = Math.max(1, Math.min(128, Math.floor(Number(maxTasks) || 64))); this.clock = clock;
    this.tasks = new Map(); this.timers = new Set(); this.disposed = false;
  }
  schedule(fn, delay = 0) {
    if (this.disposed) return null;
    const id = this.clock.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, Math.max(0, delay));
    this.timers.add(id);
    return id;
  }
  unschedule(id) { this.clock.clearTimeout(id); this.timers.delete(id); }
  play(node, frames, options = {}, onEnd, { remove = true, essential = true } = {}) {
    if (!node) return;
    if (this.disposed || (!essential && this.mode === 'off')) { if (remove) node.remove(); return; }
    this.cancel(node);
    while (this.tasks.size >= this.maxTasks) this.cancel(this.tasks.keys().next().value);
    let finished = false, animation, timer;
    const restoredStyles = new Map();
    const finish = (cancelled = false) => {
      if (finished) return;
      finished = true;
      this.unschedule(timer); this.tasks.delete(node);
      if (animation) {
        animation.onfinish = null; animation.oncancel = null;
        try { animation.cancel(); } catch { /* Already detached. */ }
      }
      // Judgment cards have a nested flip animation owned by their parent token.
      if (remove) {
        for (const childAnimation of node.getAnimations?.({ subtree: true }) || []) {
          try { childAnimation.cancel(); } catch { /* Detached animation. */ }
        }
        node.remove();
      }
      if (!remove) for (const [key, value] of restoredStyles) node.style[key] = value;
      if (!cancelled && !this.disposed && onEnd) onEnd();
    };
    this.tasks.set(node, () => finish(true));
    const duration = Math.max(0, Number(options.duration ?? 500) || 0);
    const delay = Math.max(0, Number(options.delay ?? 0) || 0);
    const hold = [...frames].reverse().find((frame) => frame.opacity === 1) || frames[0] || {};
    const applyStill = () => {
      for (const [key, value] of Object.entries(hold)) {
        if (!['offset', 'easing', 'composite'].includes(key)) {
          if (!remove) restoredStyles.set(key, node.style[key] ?? '');
          node.style[key] = value;
        }
      }
    };
    if (this.mode === 'off') {
      applyStill();
      // Keep readable information, not travel/flash animations, in reduced motion.
      timer = this.schedule(() => finish(), Math.max(650, Math.min(duration, 1200)));
    } else {
      timer = this.schedule(() => finish(), duration + delay + 100);
      try {
        animation = node.animate(frames, { ...options, duration, delay, fill: 'both' });
        animation.onfinish = () => finish();
        animation.oncancel = () => finish(true);
      } catch { applyStill(); }
    }
  }
  cancel(node) { this.tasks.get(node)?.(); }
  clear() {
    [...this.tasks.values()].forEach((cancel) => cancel());
    [...this.timers].forEach((id) => this.unschedule(id));
  }
  dispose() { this.disposed = true; this.clear(); }
}
