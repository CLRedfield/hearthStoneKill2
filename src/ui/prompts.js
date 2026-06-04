// ====================== 弹层 / 提示 ======================
import { el, clear } from './dom.js';
import { SUIT_SYMBOL, FACTION_NAME, FACTION_COLOR } from '../engine/constants.js';
import { rankLabel } from '../engine/constants.js';
import { CARD_DEFS } from '../engine/cards.js';
import { attachTip } from './tooltip.js';

const overlayRoot = () => document.getElementById('overlay-root');
const toastRoot = () => document.getElementById('toast-root');

export function toast(msg, kind = 'info', ms = 1600) {
  const t = el('div', { class: `toast toast-${kind}`, text: msg });
  toastRoot().appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// 通用弹层
export function openOverlay({ title, bodyNode, buttons = [], closable = false, className = '' }) {
  const root = overlayRoot();
  const back = el('div', { class: 'overlay-back' });
  const panel = el('div', { class: `overlay-panel ${className}` });
  if (title) panel.appendChild(el('div', { class: 'overlay-title', text: title }));
  if (bodyNode) panel.appendChild(bodyNode);
  if (buttons.length) {
    const bar = el('div', { class: 'overlay-buttons' });
    buttons.forEach((b) => bar.appendChild(el('button', {
      class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`,
      text: b.label, onclick: () => b.onClick?.(),
    })));
    panel.appendChild(bar);
  }
  back.appendChild(panel);
  root.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 200); };
  if (closable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  return { close, panel };
}

// 文字选项弹层 → Promise<value>
export function chooseDialog(title, options, { closable = false } = {}) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'choose-grid' });
    let ov;
    options.forEach((o) => {
      body.appendChild(el('button', {
        class: 'choose-item btn', html: o.html || undefined, text: o.html ? undefined : o.label,
        onclick: () => { ov.close(); resolve(o.value); },
      }));
    });
    const buttons = closable ? [{ label: '取消', onClick: () => { ov.close(); resolve(null); } }] : [];
    ov = openOverlay({ title, bodyNode: body, buttons });
  });
}

// 武将选择弹层
export function chooseGeneralDialog(generals) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'general-choose' });
    let ov;
    generals.forEach((g) => {
      const card = el('div', {
        class: 'general-pick', style: { '--fac': FACTION_COLOR[g.faction] },
        onclick: () => { ov.close(); resolve(g.id); },
      }, [
        el('div', { class: 'gp-portrait', text: g.name[0] }),
        el('div', { class: 'gp-name', text: g.name }),
        el('div', { class: 'gp-title', text: g.title }),
        el('div', { class: 'gp-faction', text: FACTION_NAME[g.faction] }),
        el('div', { class: 'gp-hp', text: '♥'.repeat(g.hp) }),
        el('div', { class: 'gp-bio', text: g.bio }),
      ]);
      body.appendChild(card);
    });
    ov = openOverlay({ title: '选择你的武将', bodyNode: body, className: 'wide' });
  });
}

// 一张小卡片的 DOM（用于弹层展示）
export function miniCardNode(card, onClick) {
  const red = card.red;
  const def = CARD_DEFS[card.kind] || {};
  const node = el('div', {
    class: `mini-card ${red ? 'red' : 'black'}`,
  }, [
    el('div', { class: 'mc-corner', text: `${rankLabel(card.number)}${SUIT_SYMBOL[card.suit] || ''}` }),
    el('div', { class: 'mc-name', text: card.name }),
  ]);
  // 单击/悬停显示精美介绍（移动端无需长按）
  const typeLabel = { equip: '装备', trick: '锦囊', delayed: '延时', basic: '基本', secret: '奥秘' }[def.type] || '';
  const accent = { equip: '#2e8b57', trick: '#8a5bba', delayed: '#d08a3a', secret: '#b186ff' }[def.type] || 'var(--gold)';
  if (def.name) attachTip(node, { title: card.name, sub: [typeLabel, `${rankLabel(card.number)}${SUIT_SYMBOL[card.suit] || ''}`].filter(Boolean).join(' · '), desc: def.desc || '', accent });
  if (onClick) node.addEventListener('click', () => onClick(card));
  return node;
}

export { rankLabel };
