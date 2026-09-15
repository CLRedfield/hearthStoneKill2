import { FxLayer as CardFxLayer } from './fx-core.js';
import { el } from './dom.js';
import { CARD_DEFS } from '../engine/cards.js';
import { FX_MODES, FX_STORAGE_KEY, readMode, effectiveMode, snapshotAnchor, resolveAnchor, curvePoint, MotionScope } from './fx-motion.js';
import { FxParticles } from './fx-particles.js';
import { TableMotion } from './fx-table.js';

const COLORS = { basic: '#e9bc57', trick: '#bd91f5', delayed: '#efb167', equip: '#70d7ae', secret: '#c0a0ff', fire: '#ff994d', thunder: '#8fcaff', heal: '#7de3b0' };
// Card artwork colors do not alter or relabel the engine's damage nature.
const CARD_COLORS = { huoqiu: COLORS.fire, linghunzhihuo: '#abdf6a', shandianjian: COLORS.thunder, hanbingjian: '#96e4f2', hanbinghuti: '#96e4f2', zhiliao: COLORS.heal, lianjie: COLORS.heal, tao: COLORS.heal };
const accent = (info = {}) => COLORS[info.nature] || CARD_COLORS[info.kind] || COLORS[info.type || CARD_DEFS[info.kind]?.type] || COLORS.basic;
const media = (query) => typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
function savedMode() {
  let storage;
  try { storage = window.localStorage; } catch { /* Storage may be unavailable. */ }
  return readMode(storage, media('(pointer: coarse)')?.matches);
}
export function initFxPreferences() {
  document.documentElement.dataset.fx = effectiveMode(savedMode(), media('(prefers-reduced-motion: reduce)')?.matches);
}

// Public API stays compatible with GameUI and the network FX messages.
// Card faces / judgment copy live in fx-core; this layer owns motion and cleanup.
export class FxLayer extends CardFxLayer {
  constructor() {
    super();
    this.root.setAttribute('aria-hidden', 'true');
    this.preference = savedMode();
    this.media = media('(prefers-reduced-motion: reduce)');
    this.reduced = !!this.media?.matches;
    this.mode = effectiveMode(this.preference, this.reduced);
    this.motion = new MotionScope({ mode: this.mode });
    this.particles = new FxParticles(this.root);
    this.scope = document.querySelector('#table-wrap');
    this.tableMotion = new TableMotion(this, this.scope);
    this.applyQuality();
    this.onMedia = () => { this.reduced = !!this.media?.matches; this.applyQuality(); };
    this.onVisibility = () => { if (document.hidden) this.clear(); };
    this.onResize = () => this.clear();
    this.media?.addEventListener?.('change', this.onMedia);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('resize', this.onResize, { passive: true });
  }
  applyQuality() {
    this.clear(); this.mode = effectiveMode(this.preference, this.reduced);
    this.motion.mode = this.mode;
    document.documentElement.dataset.fx = this.mode;
    this.tableMotion?.refreshControl();
  }
  cycleQuality() {
    this.preference = FX_MODES[(FX_MODES.indexOf(this.preference) + 1) % FX_MODES.length];
    try { window.localStorage.setItem(FX_STORAGE_KEY, this.preference); } catch { /* Session-only preference. */ }
    this.applyQuality();
  }
  clear() {
    this.motion?.clear(); this.particles?.clear(); this._judgeVisual = null;
  }
  destroy() {
    this.tableMotion?.destroy();
    this.media?.removeEventListener?.('change', this.onMedia);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('resize', this.onResize);
    this.motion?.dispose(); this.particles?.destroy();
    this._judgeVisual = null; super.destroy();
  }
  _ready() { return !this.motion.disposed && !document.hidden; }
  _play(node, frames, opts, onEnd) {
    if (document.hidden) { node.remove(); return; }
    this.motion.play(node, frames, opts, onEnd);
  }
  _decor(node, frames, opts) {
    this.root.appendChild(node);
    this.motion.play(node, frames, opts, null, { essential: false });
    return node;
  }
  _burst(point, color, count = 16, shape = 'spark') {
    if (this.mode !== 'off' && this._ready()) this.particles.burst(point, color, this.mode === 'lite' ? Math.min(count, 5) : count, shape);
  }
  _ring(point, color, size = 80, delay = 0) {
    if (!point || this.mode === 'off' || !this._ready()) return;
    return this._decor(el('div', { class: 'fx-halo', style: {
      left: `${point.x}px`, top: `${point.y}px`, width: `${size}px`, height: `${size}px`, '--fx-color': color,
    } }), [
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(.8)', opacity: .85, offset: .2 },
      { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 0 },
    ], { duration: 520, delay, easing: 'ease-out' });
  }
  _trail(from, to, color, delay = 0) {
    if (this.mode !== 'full' || !this._ready()) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'fx-trajectory');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 60} ${to.x} ${to.y}`);
    path.setAttribute('pathLength', '1'); path.setAttribute('stroke', color);
    path.style.strokeDasharray = '1'; path.style.strokeDashoffset = '1';
    svg.appendChild(path); this.root.appendChild(svg);
    this.motion.play(path, [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: 330, delay, easing: 'ease-out' }, null, { remove: false, essential: false });
    this.motion.play(svg, [{ opacity: 0 }, { opacity: .65, offset: .24 }, { opacity: 0 }], { duration: 520, delay }, null, { essential: false });
  }
  flyUse(fromEl, toEls = [], info = {}, context = {}) {
    if (!this._ready()) return;
    const from = snapshotAnchor(fromEl); if (!from) return;
    // Capture positions before GameUI replaces the table's DOM. Resolve by pid
    // at arrival to follow the new frame, with a safe original-position fallback.
    const targets = [...new Set(toEls.filter(Boolean))].filter((node) => node !== fromEl).map(snapshotAnchor).filter(Boolean);
    const stage = { x: window.innerWidth / 2, y: Math.max(125, window.innerHeight * .42) };
    const dx = stage.x - from.x, dy = stage.y - from.y, length = Math.max(1, Math.hypot(dx, dy));
    const reveal = { x: from.x + dx / length * 82, y: from.y + dy / length * 82 };
    const destination = targets.length === 1 ? targets[0] : stage;
    const color = accent(info);
    this._ring(from, color, Math.min(140, Math.max(80, from.width * .65)));
    this._burst(from, color, 9);
    const token = this._token(info, context); token.style.setProperty('--accent', color); this.root.appendChild(token);
    const box = token.getBoundingClientRect();
    const tx = (p) => `translate(${Math.max(8, Math.min(window.innerWidth - box.width - 8, p.x - box.width / 2))}px, ${Math.max(55, Math.min(window.innerHeight - box.height - 8, p.y - box.height / 2))}px)`;
    const frames = this.mode === 'off' ? [
      { transform: `${tx(reveal)}`, opacity: 1 },
    ] : [
      { transform: `${tx(from)} scale(.45) rotate(-7deg)`, opacity: 0 },
      { transform: `${tx(reveal)} scale(1.06) rotate(0deg)`, opacity: 1, offset: .2 },
      { transform: `${tx(reveal)} scale(1)`, opacity: 1, offset: .57 },
      { transform: `${tx(curvePoint(reveal, destination, .5))} scale(.97)`, opacity: 1, offset: .75 },
      { transform: `${tx(destination)} scale(.84) rotate(3deg)`, opacity: 1, offset: .91 },
      { transform: `${tx(destination)} scale(.65) rotate(5deg)`, opacity: 0 },
    ];
    this._trail(reveal, destination, color, 570);
    if (targets.length > 1) targets.forEach((target, i) => this._trail(stage, target, color, 730 + i * 20));
    this._play(token, frames, { duration: 1080, easing: 'cubic-bezier(.2,.72,.25,1)' }, () => {
      targets.forEach((target) => this.impact(resolveAnchor(target, this.scope), info));
    });
  }
  impact(nodeOrPoint, info = {}) {
    if (!this._ready()) return;
    const point = nodeOrPoint?.getBoundingClientRect ? snapshotAnchor(nodeOrPoint) : nodeOrPoint;
    if (!point) return;
    const color = accent(info); this._ring(point, color, 76); this._burst(point, color, 9);
  }
  _number(point, text, className, label = '') {
    const node = el('div', { class: className, style: { left: `${point.x}px`, top: `${point.y}px` }, text });
    if (label) node.appendChild(el('span', { class: 'fx-hit-label', text: label }));
    this.root.appendChild(node);
    this._play(node, [
      { transform: 'translate(-50%,-40%) scale(.65)', opacity: 0 },
      { transform: 'translate(-50%,-100%) scale(1.18)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-140%) scale(1)', opacity: 1, offset: .65 },
      { transform: 'translate(-50%,-190%) scale(.96)', opacity: 0 },
    ], { duration: 930, easing: 'ease-out' });
  }
  damage(node, amount, nature) {
    const point = snapshotAnchor(node);
    if (!this._ready() || !point || !Number.isFinite(amount) || amount <= 0) return;
    const type = nature === 'fire' || nature === 'thunder' ? nature : 'basic';
    const color = COLORS[type], heavy = amount >= 2;
    this._number(point, `−${amount}`, `fx-dmg ${type} ${heavy ? 'heavy' : ''}`, type === 'fire' ? '火焰' : type === 'thunder' ? '雷电' : heavy ? '重击' : '');
    if (this.mode === 'off') return;
    this._ring(point, color, heavy ? 130 : 90);
    this._burst(point, color, heavy ? 26 : 17);
    if (type === 'thunder') this._lightning(point);
    else if (type === 'fire') {
      this._decor(el('div', { class: 'fx-fire-bloom', style: { left: `${point.x}px`, top: `${point.y}px` } }), [
        { transform: 'translate(-50%,-50%) scale(.35)', opacity: 0 },
        { transform: 'translate(-50%,-60%) scale(1)', opacity: .75, offset: .2 },
        { transform: 'translate(-50%,-90%) scale(1.3)', opacity: 0 },
      ], { duration: 560, easing: 'ease-out' });
    } else {
      const slash = el('div', { class: 'fx-slash', style: { left: `${point.x}px`, top: `${point.y}px` } });
      this._decor(slash, [
        { transform: 'translate(-50%,-50%) rotate(-32deg) scaleX(.1)', opacity: 0 },
        { transform: 'translate(-50%,-50%) rotate(-32deg) scaleX(1)', opacity: .95, offset: .25 },
        { transform: 'translate(-35%,-60%) rotate(-32deg) scaleX(1.2)', opacity: 0 },
      ], { duration: 370, easing: 'ease-out' });
    }
  }
  _lightning(point) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'fx-lightning'); svg.setAttribute('viewBox', '0 0 160 180');
    svg.style.left = `${point.x}px`; svg.style.top = `${point.y}px`;
    for (const d of ['M 94 5 L 62 49 L 96 58 L 55 103 L 86 109 L 66 167', 'M 92 58 L 130 94 L 119 130', 'M 57 101 L 26 129']) {
      const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); svg.appendChild(path);
    }
    this._decor(svg, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: .8, offset: .48 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
  }
  heal(node, amount) {
    const point = snapshotAnchor(node);
    if (!this._ready() || !point || !Number.isFinite(amount) || amount <= 0) return;
    this._number(point, `+${amount}`, 'fx-heal', '恢复');
    this._ring(point, COLORS.heal, 100); this._burst(point, COLORS.heal, 20, 'heal');
  }
  secret(node, label) {
    const point = snapshotAnchor(node); if (!this._ready() || !point) return;
    this._ring(point, COLORS.secret, 115); this._burst(point, COLORS.secret, 24);
    if (this.mode !== 'off') this._decor(el('div', { class: 'fx-rune', style: { left: `${point.x}px`, top: `${point.y}px` }, text: '◇' }), [
      { transform: 'translate(-50%,-50%) rotate(-45deg) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: .8, offset: .25 },
      { transform: 'translate(-50%,-50%) rotate(20deg) scale(1.4)', opacity: 0 },
    ], { duration: 820, easing: 'ease-out' });
    this._number(point, label || '奥秘触发', 'fx-secret', '奥秘触发');
  }
  _clearJudgeVisual() {
    if (this._judgeVisual) { this.motion.cancel(this._judgeVisual); this._judgeVisual.remove(); }
    this._judgeVisual = null;
  }
  _pulseJudgeTarget(node) { this._ring(snapshotAnchor(node), COLORS.delayed, 120); }
  judge(info, playerName, context = {}) {
    if (!this._ready()) return;
    super.judge(info, playerName, context);
    if (this.mode === 'off') {
      const flipper = this._judgeVisual?.querySelector('.fxj-flipper');
      for (const animation of flipper?.getAnimations?.() || []) animation.cancel();
      if (flipper) flipper.style.transform = 'rotateY(0deg)';
    }
  }
  discardFade(node, cards) {
    if (this._ready() && this.mode !== 'off' && snapshotAnchor(node)) super.discardFade(node, cards);
  }
  turnCue(node, title) {
    if (!this._ready() || this.mode === 'off') return;
    this._ring(snapshotAnchor(node), COLORS.basic, 110);
    const banner = el('div', { class: 'fx-turn-banner' }, [el('span', { class: 'fx-turn-gem', text: '◆' }), el('span', { text: title })]);
    this._decor(banner, [
      { transform: 'translate(-50%,-8px)', opacity: 0 },
      { transform: 'translate(-50%,0)', opacity: 1, offset: .2 },
      { transform: 'translate(-50%,0)', opacity: 1, offset: .7 },
      { transform: 'translate(-50%,6px)', opacity: 0 },
    ], { duration: 1150, easing: 'ease-out' });
  }
  drawCard(card, deck, index = 0) {
    const point = snapshotAnchor(card); if (!this._ready() || this.mode === 'off' || !point) return;
    // Animate the visible card without permanently changing hover/selection styles.
    this.motion.play(card, [{ opacity: .25, translate: '0 13px' }, { opacity: 1, translate: '0 0' }],
      { duration: 320, delay: Math.min(index, 5) * 45, easing: 'ease-out' }, null, { remove: false, essential: false });
    if (!deck || this.mode !== 'full' || index > 3) return;
    const back = el('div', { class: 'fx-draw-back', text: '杀' });
    this._decor(back, [
      { transform: `translate(${deck.x - 20}px,${deck.y - 28}px) scale(.65) rotate(-12deg)`, opacity: 0 },
      { transform: `translate(${deck.x - 20}px,${deck.y - 42}px) scale(.8)`, opacity: .85, offset: .15 },
      { transform: `translate(${point.x - 20}px,${point.y - 28}px) scale(.85) rotate(4deg)`, opacity: 0 },
    ], { duration: 470, delay: index * 45, easing: 'cubic-bezier(.3,.6,.3,1)' });
  }
  ripple(point) { this._ring(point, COLORS.basic, 38); }
}
