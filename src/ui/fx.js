// ====================== 动画特效层 ======================
import { el } from './dom.js';
import { SUIT_SYMBOL, rankLabel } from '../engine/constants.js';

const TOKEN_W = 54, TOKEN_H = 76;
const USE_W = 78, USE_H = 108;

function center(node) { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
const kindAccent = (type) => ({ trick: '#9a6dce', delayed: '#dc9742', equip: '#43a86c', secret: '#a98be8', basic: '#ddb84d' }[type] || '#ddb84d');

export class FxLayer {
  constructor() {
    this.root = el('div', { class: 'fx-root' });
    this._judgeVisual = null;
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

  _token(info, context = null) {
    const corner = [info.number ? rankLabel(info.number) : '', info.suit ? SUIT_SYMBOL[info.suit] || '' : ''].join('');
    return el('div', { class: `fx-card ${context ? 'fx-use-card' : ''} ${info.red ? 'red' : 'black'}`, style: { '--accent': kindAccent(info.type) } }, [
      context ? el('div', { class: 'fxc-actor', text: `${context.actorName || '玩家'} · ${context.verb || '使用'}` }) : null,
      corner ? el('div', { class: 'fxc-corner', text: corner }) : null,
      el('div', { class: 'fxc-name', text: info.name }),
      info.suit ? el('div', { class: 'fxc-suit', text: SUIT_SYMBOL[info.suit] || '' }) : null,
      context?.targetLabel ? el('div', { class: 'fxc-targets', text: `→ ${context.targetLabel}` }) : null,
    ]);
  }

  // 使用牌：先在出牌者身边清晰亮相，再飞向目标；多目标牌在桌面中央展开。
  flyUse(fromEl, toEls, info, context = {}) {
    if (!fromEl) return;
    const from = center(fromEl);
    const targets = toEls.filter(Boolean);
    const stage = { x: window.innerWidth / 2, y: Math.max(150, window.innerHeight * .43) };
    const dx = stage.x - from.x, dy = stage.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const revealDistance = Math.min(88, Math.max(54, distance * .24));
    const reveal = { x: from.x + dx / distance * revealDistance, y: from.y + dy / distance * revealDistance };
    const singleTarget = targets.length === 1 && targets[0] !== fromEl;
    const destination = singleTarget ? center(targets[0]) : stage;

    const sourceRect = fromEl.getBoundingClientRect();
    const sourceRing = el('div', {
      class: 'fx-source-ring',
      style: {
        left: sourceRect.left + 'px', top: sourceRect.top + 'px',
        width: sourceRect.width + 'px', height: sourceRect.height + 'px',
        '--accent': kindAccent(info.type),
      },
    });
    this.root.appendChild(sourceRing);
    this._play(sourceRing, [
      { transform: 'scale(.96)', opacity: 0 },
      { transform: 'scale(1.035)', opacity: 1, offset: .25 },
      { transform: 'scale(1.055)', opacity: .82, offset: .66 },
      { transform: 'scale(1.08)', opacity: 0 },
    ], { duration: 900, easing: 'ease-out' });

    const token = this._token(info, context);
    this.root.appendChild(token);
    const tx = (point) => `translate(${point.x - USE_W / 2}px, ${point.y - USE_H / 2}px)`;
    this._play(token, [
      { transform: `${tx(from)} scale(.32) rotate(-9deg)`, opacity: 0, filter: 'brightness(1.7)' },
      { transform: `${tx(reveal)} scale(1.12) rotate(0deg)`, opacity: 1, filter: 'brightness(1.14)', offset: .2 },
      { transform: `${tx(reveal)} scale(1.04) rotate(0deg)`, opacity: 1, filter: 'brightness(1)', offset: .58 },
      { transform: `${tx(destination)} scale(.92) rotate(3deg)`, opacity: 1, filter: 'brightness(1.08)', offset: .88 },
      { transform: `${tx(destination)} scale(.62) rotate(5deg)`, opacity: 0, filter: 'brightness(1.3)' },
    ], { duration: 1180, easing: 'cubic-bezier(.2,.72,.25,1)' }, () => {
      targets.filter((target) => target !== fromEl).forEach((target) => this.impact(target, info));
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

  _clearJudgeVisual() {
    if (this._judgeVisual?.isConnected) this._judgeVisual.remove();
    this._judgeVisual = null;
  }

  _pulseJudgeTarget(node) {
    if (!node) return;
    node.classList.remove('judge-pulse');
    void node.offsetWidth;
    node.classList.add('judge-pulse');
    setTimeout(() => node.classList.remove('judge-pulse'), 1150);
  }

  // 延时锦囊即将判定：先点亮目标与反制窗口，判定牌仍保持未知。
  judgePending(node, info, playerName, counterName, responseAllowed = true) {
    this._clearJudgeVisual();
    this._pulseJudgeTarget(node);
    const token = el('div', { class: 'fx-judge-pending' }, [
      el('div', { class: 'fxjp-eyebrow', text: '延时锦囊 · 即将判定' }),
      el('div', { class: 'fxjp-main' }, [
        el('span', { class: 'fxjp-card', text: `【${info.name || '延时锦囊'}】` }),
        el('span', { class: 'fxjp-arrow', text: '→' }),
        el('strong', { class: 'fxjp-player', text: playerName || '目标角色' }),
      ]),
      el('div', {
        class: `fxjp-counter ${responseAllowed ? '' : 'locked'}`,
        text: responseAllowed ? `反制窗口 · ${counterName}` : '此牌无法被响应',
      }),
    ]);
    this._judgeVisual = token;
    this.root.appendChild(token);
    this._play(token, [
      { transform: 'translate(-50%,-50%) scale(.86)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.03)', opacity: 1, offset: .26 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .78 },
      { transform: 'translate(-50%,-54%) scale(.98)', opacity: 0 },
    ], { duration: 1100, easing: 'cubic-bezier(.2,.75,.25,1)' }, () => {
      if (this._judgeVisual === token) this._judgeVisual = null;
    });
  }

  // 判定：牌背落场后翻开牌面；改判会替换现有判定视觉。
  judge(info, playerName, context = {}) {
    this._clearJudgeVisual();
    const sourceName = context.sourceCard?.name || context.reason?.replace(/判定$/, '') || '判定';
    const flipper = el('div', { class: 'fxj-flipper' }, [
      el('div', { class: 'fxj-card fxj-front' }, [
        el('div', { class: 'fxj-corner', text: `${rankLabel(info.number)}${SUIT_SYMBOL[info.suit] || ''}` }),
        el('div', { class: 'fxj-name', text: info.name }),
        el('div', { class: 'fxj-suit', text: SUIT_SYMBOL[info.suit] || '' }),
      ]),
      el('div', { class: 'fxj-card fxj-back' }, [
        el('div', { class: 'fxj-back-mark', text: '判' }),
      ]),
    ]);
    const token = el('div', { class: `fx-judge ${info.red ? 'red' : 'black'} ${context.rewritten ? 'rewritten' : ''}` }, [
      el('div', { class: 'fxj-kicker', text: `【${sourceName}】` }),
      el('div', { class: 'fxj-stage' }, [flipper]),
      el('div', { class: 'fxj-label', text: `${playerName || '目标角色'} · ${context.rewritten ? '判定被改写' : '翻开判定牌'}` }),
    ]);
    this._judgeVisual = token;
    this.root.appendChild(token);
    try {
      flipper.animate([
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(180deg)', offset: .12 },
        { transform: 'rotateY(0deg)', offset: .42 },
        { transform: 'rotateY(0deg)' },
      ], { duration: 1040, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'both' });
    } catch (e) { /* 不支持 WAAPI */ }
    this._play(token, [
      { transform: 'translate(-50%,-50%) scale(.78)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .2 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .84 },
      { transform: 'translate(-50%,-54%) scale(.96)', opacity: 0 },
    ], { duration: 1220, easing: 'ease-out' }, () => {
      if (this._judgeVisual === token) this._judgeVisual = null;
    });
  }

  // 延时锦囊的最终判定结果：把花色条件直接翻译成可读结论。
  judgeResult(info, playerName, delayedInfo, result = {}) {
    this._clearJudgeVisual();
    const tone = ['good', 'bad', 'neutral'].includes(result.tone) ? result.tone : 'neutral';
    const token = el('div', { class: `fx-judge-result ${tone} ${info.red ? 'red' : 'black'}` }, [
      el('div', { class: 'fxjr-card' }, [
        el('span', { class: 'fxjr-rank', text: `${rankLabel(info.number)}${SUIT_SYMBOL[info.suit] || ''}` }),
        el('strong', { class: 'fxjr-card-name', text: info.name }),
      ]),
      el('div', { class: 'fxjr-copy' }, [
        el('div', { class: 'fxjr-source', text: `${playerName || '目标角色'} · 【${delayedInfo?.name || '延时锦囊'}】` }),
        el('div', { class: 'fxjr-title', text: result.title || '判定完成' }),
        el('div', { class: 'fxjr-detail', text: result.detail || '' }),
      ]),
      el('div', { class: 'fxjr-seal', text: tone === 'bad' ? '危' : (tone === 'good' ? '安' : '转') }),
    ]);
    this._judgeVisual = token;
    this.root.appendChild(token);
    this._play(token, [
      { transform: 'translate(-50%,-50%) scale(.84)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.04)', opacity: 1, offset: .24 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .78 },
      { transform: 'translate(-50%,-54%) scale(.97)', opacity: 0 },
    ], { duration: 1250, easing: 'cubic-bezier(.2,.75,.25,1)' }, () => {
      if (this._judgeVisual === token) this._judgeVisual = null;
    });
  }

  judgeCancelled(node, info, playerName, counterName) {
    this._clearJudgeVisual();
    this._pulseJudgeTarget(node);
    const token = el('div', { class: 'fx-judge-cancelled' }, [
      el('div', { class: 'fxjc-mark', text: '×' }),
      el('div', { class: 'fxjc-copy' }, [
        el('strong', { text: '判定取消' }),
        el('span', { text: `${playerName || '目标角色'} 的【${info.name || '延时锦囊'}】被【${counterName}】抵消` }),
      ]),
    ]);
    this._judgeVisual = token;
    this.root.appendChild(token);
    this._play(token, [
      { transform: 'translate(-50%,-50%) scale(.8)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.05)', opacity: 1, offset: .24 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .74 },
      { transform: 'translate(-50%,-54%) scale(.96)', opacity: 0 },
    ], { duration: 1150, easing: 'ease-out' }, () => {
      if (this._judgeVisual === token) this._judgeVisual = null;
    });
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
