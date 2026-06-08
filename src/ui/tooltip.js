// ====================== 精美悬浮提示框 ======================
import { el } from './dom.js';

let tipEl = null;
let hideTimer = null;

function ensure() {
  if (!tipEl) {
    tipEl = el('div', { class: 'rich-tip' });
    document.body.appendChild(tipEl);
    document.addEventListener('click', () => hideTip());
    // 仅在“真正的窗口滚动”时收起；不要用 capture，否则每次重渲染里日志/手牌的程序化内部滚动都会误触发收起
    window.addEventListener('scroll', () => hideTip());
  }
  return tipEl;
}

export function showTip(anchor, { title, desc, sub, accent }) {
  clearTimeout(hideTimer);
  const tip = ensure();
  tip.innerHTML = '';
  tip.style.setProperty('--accent', accent || 'var(--gold)');
  tip.appendChild(el('div', { class: 'rt-title', text: title }));
  if (sub) tip.appendChild(el('div', { class: 'rt-sub', text: sub }));
  if (desc) tip.appendChild(el('div', { class: 'rt-desc', text: desc }));
  tip.classList.add('show');
  // 定位（默认在元素上方居中，越界则自动调整）
  const r = anchor.getBoundingClientRect();
  tip.style.left = '0px'; tip.style.top = '0px';
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  let top = r.top - tr.height - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  if (top < 8) top = r.bottom + 10; // 上方放不下则放下方
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

export function hideTip() {
  if (!tipEl) return;
  hideTimer = setTimeout(() => tipEl && tipEl.classList.remove('show'), 60);
}

// 绑定到元素：桌面端悬停显示；移动端单击即显示（不再需要长按）
// 关键：触屏点击会先后触发合成的 mouseenter 与 click，若 click 用“切换”会立刻把刚显示的提示关掉，
// 故 click 一律「显示」，由点击其它位置（document click）来关闭。
export function attachTip(node, content) {
  node.addEventListener('mouseenter', () => showTip(node, content));
  node.addEventListener('mouseleave', () => hideTip());
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    showTip(node, content);
  });
  return node;
}
