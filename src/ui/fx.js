// ====================== 动画特效层 ======================
import { el } from './dom.js';
import { SUIT_SYMBOL, rankLabel } from '../engine/constants.js';

const TOKEN_W = 54, TOKEN_H = 76;

function center(node) { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
const kindAccent = (type) => ({ trick: '#8a5bba', delayed: '#d08a3a', equip: '#2e8b57', basic: '#c9a227' }[type] || '#c9a227');

export class FxLayer {
  constructor() {
    this.root = el('div', { class: 'fx-root' });
    document.body.appendChild(this.root);
  }
  destroy() { this.root.remove(); }

  // 播放动画并在结束后必定移除节点（onfinish 与超时双保险）
  _play(node, frames, opts, onEnd) {
    const total = (opts.duration || 500) + (opts.delay || 0) + 140;
    const done = () => { if (node._fxDone) return; node._fxDone = true; node.remove(); if (onEnd) onEnd(); };
    try { node.animate(frames, opts).onfinish = done; } catch (e) { /* 不支持 WAAPI */ }
    setTimeout(done, total);
  }

  _token(info) {
    return el('div', { class: `fx-card ${info.red ? 'red' : 'black'}`, style: { '--accent': kindAccent(info.type) } }, [
      el('div', { class: 'fxc-name', text: info.name }),
      info.suit ? el('div', { class: 'fxc-suit', text: SUIT_SYMBOL[info.suit] || '' }) : null,
    ]);
  }

  // 使用牌：从来源飞向每个目标，落点处迸发
  flyUse(fromEl, toEls, info) {
    if (!fromEl) return;
    const from = center(fromEl);
    const targets = toEls.length ? toEls : [fromEl];
    targets.forEach((toEl) => {
      if (!toEl) return;
      const to = center(toEl);
      const token = this._token(info);
      this.root.appendChild(token);
      const tx = (p) => `translate(${p.x - TOKEN_W / 2}px, ${p.y - TOKEN_H / 2}px)`;
      this._play(token, [
        { transform: `${tx(from)} scale(.5) rotate(-8deg)`, opacity: 0 },
        { transform: `${tx(from)} scale(1) rotate(0deg)`, opacity: 1, offset: .18 },
        { transform: `${tx(to)} scale(.9) rotate(4deg)`, opacity: 1, offset: .82 },
        { transform: `${tx(to)} scale(.55)`, opacity: 0 },
      ], { duration: 540, easing: 'cubic-bezier(.45,.05,.3,1)' }, () => { if (toEl !== fromEl) this.impact(toEl, info); });
    });
  }

  // 命中迸发
  impact(node, info) {
    const c = center(node);
    const ring = el('div', { class: 'fx-impact', style: { left: c.x + 'px', top: c.y + 'px', '--accent': kindAccent(info?.type) } });
    this.root.appendChild(ring);
    this._play(ring, [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: .9 },
      { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 },
    ], { duration: 420, easing: 'ease-out' });
  }

  // 伤害：飘字 + 抖动
  damage(node, amount, nature) {
    if (!node) return;
    const c = center(node);
    const num = el('div', { class: `fx-dmg ${nature || ''}`, text: '-' + amount, style: { left: c.x + 'px', top: c.y + 'px' } });
    this.root.appendChild(num);
    this._play(num, [
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-130%) scale(1.3)', opacity: 1, offset: .3 },
      { transform: 'translate(-50%,-220%) scale(1)', opacity: 0 },
    ], { duration: 900, easing: 'ease-out' });
    node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake');
    setTimeout(() => node.classList.remove('shake'), 500);
  }

  // 回血飘字
  heal(node, amount) {
    if (!node || !amount) return;
    const c = center(node);
    const num = el('div', { class: 'fx-heal', text: '+' + amount, style: { left: c.x + 'px', top: c.y + 'px' } });
    this.root.appendChild(num);
    this._play(num, [
      { transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%,-150%) scale(1.2)', opacity: 1, offset: .3 },
      { transform: 'translate(-50%,-230%)', opacity: 0 },
    ], { duration: 1000, easing: 'ease-out' });
  }

  // 判定：屏幕中央翻出判定牌
  judge(info, playerName) {
    const token = el('div', { class: `fx-judge ${info.red ? 'red' : 'black'}` }, [
      el('div', { class: 'fxj-label', text: `${playerName || ''} · 判定` }),
      el('div', { class: 'fxj-card' }, [
        el('div', { class: 'fxj-corner', text: `${rankLabel(info.number)}${SUIT_SYMBOL[info.suit] || ''}` }),
        el('div', { class: 'fxj-name', text: info.name }),
        el('div', { class: 'fxj-suit', text: SUIT_SYMBOL[info.suit] || '' }),
      ]),
    ]);
    this.root.appendChild(token);
    this._play(token, [
      { transform: 'translate(-50%,-50%) scale(.45) rotateY(90deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.12) rotateY(0deg)', opacity: 1, offset: .28 },
      { transform: 'translate(-50%,-50%) scale(1) rotateY(0deg)', opacity: 1, offset: .72 },
      { transform: 'translate(-50%,-50%) scale(.9) rotateY(0deg)', opacity: 0 },
    ], { duration: 1150, easing: 'cubic-bezier(.3,.7,.3,1)' });
  }

  // 奥秘触发
  secret(node, label) {
    if (!node) return;
    const c = center(node);
    const burst = el('div', { class: 'fx-secret', style: { left: c.x + 'px', top: c.y + 'px' }, text: `🔒 ${label || '奥秘'}` });
    this.root.appendChild(burst);
    this._play(burst, [
      { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 },
      { transform: 'translate(-50%,-150%) scale(1.15)', opacity: 1, offset: .3 },
      { transform: 'translate(-50%,-230%) scale(1)', opacity: 0 },
    ], { duration: 1200, easing: 'ease-out' });
  }

  // 弃牌：在弃牌堆位置渐隐
  discardFade(discardEl, cards) {
    if (!discardEl) return;
    const base = center(discardEl);
    cards.slice(0, 4).forEach((info, i) => {
      const token = this._token(info);
      token.classList.add('fx-discarding');
      this.root.appendChild(token);
      const ox = base.x - TOKEN_W / 2 + (i - 1.5) * 6;
      const oy = base.y - TOKEN_H / 2;
      this._play(token, [
        { transform: `translate(${ox}px, ${oy - 30}px) scale(1)`, opacity: 1 },
        { transform: `translate(${ox}px, ${oy}px) scale(.9)`, opacity: .85, offset: .35 },
        { transform: `translate(${ox}px, ${oy + 26}px) scale(.7) rotate(${(i - 1.5) * 8}deg)`, opacity: 0 },
      ], { duration: 720, easing: 'ease-in', delay: i * 40 });
    });
  }
}
