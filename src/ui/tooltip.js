// ====================== 精美悬浮提示框 ======================
import { el } from './dom.js';

let tipEl = null;
let hideTimer = null;

function ensure() {
  if (!tipEl) {
    tipEl = el('div', { class: 'rich-tip' });
    document.body.appendChild(tipEl);
    document.addEventListener('click', () => hideTip());
    window.addEventListener('scroll', () => hideTip(), true);
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

// 绑定到元素：悬停显示，点击切换（适配触屏）
export function attachTip(node, content) {
  node.addEventListener('mouseenter', () => showTip(node, content));
  node.addEventListener('mouseleave', () => hideTip());
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tipEl && tipEl.classList.contains('show')) hideTip();
    else showTip(node, content);
  });
  return node;
}
