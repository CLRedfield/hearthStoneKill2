import { el } from './dom.js';
import { snapshotAnchor, countNewCards, cardCounts } from './fx-motion.js';

// Observe only completed top-level table renders; effects never mutate the game.
export class TableMotion {
  constructor(fx, wrap) {
    this.fx = fx; this.wrap = wrap; this.hand = null; this.turn = null;
    this.frame = null; this.disposed = false; this.control = null;
    if (!wrap || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => this.queue());
    this.observer.observe(wrap, { childList: true });
    this.onClick = (event) => {
      const target = event.target?.closest?.('button, .card-face.clickable, .player.selectable');
      if (!target || target.disabled || target.closest('.fx-quality')) return;
      const anchor = snapshotAnchor(target); if (!anchor) return;
      this.fx.ripple(event.detail ? { x: event.clientX, y: event.clientY } : anchor);
    };
    wrap.addEventListener('click', this.onClick, true);
    this.queue();
  }
  queue() {
    if (this.disposed || this.frame != null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.disposed) this.sync(); });
  }
  sync() {
    if (!this.wrap?.isConnected) return;
    const top = this.wrap.querySelector('.tb-left');
    if (top && !top.querySelector('.fx-quality')) {
      // Reuse the same control across full-table replacements, not more listeners.
      if (!this.control) this.control = el('button', { type: 'button', class: 'fx-quality',
        onclick: () => this.fx.cycleQuality() });
      top.appendChild(this.control);
    }
    this.refreshControl();
    const actor = this.wrap.querySelector('.player.is-turn');
    const turn = actor?.dataset.pid || null;
    if (turn && turn !== this.turn) {
      const title = this.wrap.querySelector('.tb-turn')?.textContent || '新的回合';
      this.fx.turnCue(actor, title); this.turn = turn;
    }
    const cards = [...this.wrap.querySelectorAll('.hand-row .card-face')];
    // Only public, already-rendered card faces are inspected. Occurrence counts
    // also handle two visually identical physical cards without replaying on select.
    const keys = cards.map((card) => ['.cf-name', '.cf-rank', '.cf-suit'].map((s) => card.querySelector(s)?.textContent || '').join('|'));
    const additions = countNewCards(this.hand, keys);
    const deck = snapshotAnchor(this.wrap.querySelector('.deck-pile'));
    let index = 0;
    cards.forEach((card, i) => {
      if (additions[i]) this.fx.drawCard(card, deck, index++);
    });
    this.hand = cardCounts(keys);
  }
  refreshControl() {
    if (!this.control) return;
    const label = { full: '精致', lite: '轻量', off: '关闭' }[this.fx.mode];
    this.control.textContent = `✦ ${label}`;
    this.control.title = this.fx.reduced ? '系统已启用减少动态效果；仍保留伤害与判定信息' : '切换特效：精致 / 轻量 / 关闭';
    this.control.setAttribute('aria-label', `特效：${label}。${this.control.title}`);
  }
  destroy() {
    this.disposed = true; this.observer?.disconnect();
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.wrap?.removeEventListener('click', this.onClick, true); this.control?.remove();
  }
}
