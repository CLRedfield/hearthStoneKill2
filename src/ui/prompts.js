// ====================== 弹层 / 提示 ======================
import { el, clear } from './dom.js';
import { SUIT_SYMBOL, FACTION_NAME, FACTION_COLOR, EQUIP_SLOT } from '../engine/constants.js';
import { rankLabel } from '../engine/constants.js';
import { CARD_DEFS } from '../engine/cards.js';
import { attachTip, showTip, hideTip } from './tooltip.js';

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
      const onclick = () => { ov.close(); resolve(o.value); };
      if (o.player) {
        // 选人：显示 昵称 + 武将 + 体力（势力色描边）
        const pi = o.player;
        const fac = FACTION_COLOR[pi.faction] || 'var(--gold)';
        body.appendChild(el('button', { class: 'choose-item btn choose-player', style: { '--fac': fac }, onclick }, [
          el('span', { class: 'cp-name', text: o.label || pi.name }),
          el('span', { class: 'cp-info' }, [
            el('span', { class: 'cp-general', text: pi.general || '未知' }),
            el('span', { class: 'cp-hp', text: `♥${pi.hp}/${pi.maxHp}` }),
            pi.team ? el('span', { class: `cp-team team-${pi.team}`, text: `${pi.team}队` }) : null,
          ]),
        ]));
        return;
      }
      if (o.card) {
        // 选牌：显示 花色点数 + 牌名（红/黑）；字母点数附带数字（如 Q(12)，便于比点/凑数）
        const c = o.card;
        const rl = String(rankLabel(c.number));
        const corner = `${SUIT_SYMBOL[c.suit] || ''}${rl}${/^[AJQK]$/.test(rl) && c.number != null ? `(${c.number})` : ''}`;
        body.appendChild(el('button', { class: `choose-item btn choose-cardopt ${c.red ? 'red' : 'black'}`, onclick }, [
          el('span', { class: 'cc-corner', text: corner }),
          el('span', { class: 'cc-name', text: c.name }),
        ]));
        return;
      }
      body.appendChild(el('button', {
        class: 'choose-item btn', html: o.html || undefined, text: o.html ? undefined : o.label,
        onclick,
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

// 上古号角等“从展示武将中获得技能”的选择弹层。
// 点击仅选中，完整描述常驻在下方；确认按钮负责最终提交，避免触屏误选。
export function chooseGeneralSkillDialog(title, options) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'skill-discover' });
    const hint = el('div', {
      class: 'sd-hint',
      text: '悬停可查看技能说明；点击候选技能后，再在底部确认。',
    });
    const grid = el('div', { class: 'sd-grid' });
    const detail = el('div', { class: 'sd-detail', role: 'status', 'aria-live': 'polite' });
    const optionNodes = [];
    let selected = null;
    let ov, confirmBtn;

    const drawDetail = () => {
      clear(detail);
      if (!selected) {
        detail.classList.add('empty');
        detail.appendChild(el('div', { class: 'sd-detail-empty', text: '先选择一个技能，这里会显示完整说明。' }));
      } else {
        detail.classList.remove('empty');
        detail.appendChild(el('div', { class: 'sd-detail-head' }, [
          el('strong', { class: 'sd-detail-name', text: selected.skill?.name || selected.label }),
          el('span', { class: 'sd-detail-source', text: `${selected.general?.name || '武将'} · ${selected.skill?.type || '技能'}` }),
        ]));
        detail.appendChild(el('div', { class: 'sd-detail-desc', text: selected.skill?.desc || '暂无技能说明' }));
      }
      optionNodes.forEach(({ option, node }) => {
        const active = option === selected;
        node.classList.toggle('selected', active);
        node.setAttribute('aria-pressed', String(active));
      });
      if (confirmBtn) {
        confirmBtn.disabled = !selected;
        confirmBtn.classList.toggle('disabled', !selected);
        confirmBtn.setAttribute('aria-disabled', String(!selected));
        confirmBtn.textContent = selected ? `确认获得 · ${selected.skill?.name || selected.label}` : '请选择一个技能';
      }
    };

    options.forEach((option) => {
      const general = option.general || {};
      const skill = option.skill || { name: option.label, desc: '', type: '技能' };
      const fac = FACTION_COLOR[general.faction] || 'var(--gold)';
      const node = el('button', {
        class: 'sd-option', type: 'button', style: { '--fac': fac }, 'aria-pressed': 'false',
        onclick: () => { hideTip(); selected = option; drawDetail(); },
      }, [
        el('span', { class: 'sd-hero' }, [
          el('span', { class: 'sd-portrait', text: general.name?.[0] || '?' }),
          el('span', { class: 'sd-hero-copy' }, [
            el('span', { class: 'sd-general', text: general.name || '未知武将' }),
            el('span', { class: 'sd-title', text: general.title || '' }),
          ]),
        ]),
        el('span', { class: 'sd-skill-row' }, [
          el('strong', { class: 'sd-skill-name', text: skill.name }),
          el('span', { class: 'sd-skill-type', text: skill.type }),
        ]),
        el('span', { class: 'sd-skill-preview', text: skill.desc || '暂无技能说明' }),
        el('span', { class: 'sd-check', text: '✓' }),
      ]);
      const tip = {
        title: skill.name,
        sub: `${general.name || '武将'} · ${skill.type}`,
        desc: skill.desc || '暂无技能说明',
        accent: fac,
      };
      node.addEventListener('mouseenter', () => showTip(node, tip));
      node.addEventListener('mouseleave', hideTip);
      node.addEventListener('focus', () => showTip(node, tip));
      node.addEventListener('blur', hideTip);
      optionNodes.push({ option, node });
      grid.appendChild(node);
    });

    body.appendChild(hint);
    body.appendChild(grid);
    body.appendChild(detail);
    ov = openOverlay({
      title: title || '选择一个技能', bodyNode: body, className: 'wide skill-discover-overlay',
      buttons: [{
        label: '请选择一个技能', primary: true,
        onClick: () => {
          if (!selected) return;
          hideTip();
          ov.close();
          resolve(selected.value);
        },
      }],
    });
    confirmBtn = ov.panel.querySelector('.overlay-buttons .btn-primary');
    drawDetail();
  });
}

// 一张小卡片的 DOM（用于弹层展示）
export function miniCardNode(card, onClick) {
  const red = card.red;
  const def = CARD_DEFS[card.kind] || {};
  const typeLabel = { equip: '装备', trick: '锦囊', delayed: '延时', basic: '基本', secret: '奥秘' }[def.type] || '';
  const weaponRange = def.slot === EQUIP_SLOT.WEAPON
    ? `攻击范围 ${def.dynamicRange ? 'X' : (card.range ?? def.range)}`
    : '';
  const basicRole = def.type === 'basic'
    ? ({ sha: '\u6740', shan: '\u95ea', tao: '\u6843', jiu: '\u9152' }[def.as || card.as || card.kind] || '')
    : '';
  const node = el('div', {
    class: `mini-card ${red ? 'red' : 'black'}`,
  }, [
    el('div', { class: 'mc-corner', text: `${rankLabel(card.number)}${SUIT_SYMBOL[card.suit] || ''}` }),
    basicRole ? el('div', { class: 'mc-basic-role', text: basicRole }) : null,
    el('div', { class: 'mc-name', text: card.name }),
    el('div', { class: 'mc-type', text: weaponRange ? weaponRange.replace('攻击范围 ', '范围 ') : typeLabel }),
  ]);
  // 单击/悬停显示精美介绍（移动端无需长按）
  const accent = { equip: '#2e8b57', trick: '#8a5bba', delayed: '#d08a3a', secret: '#b186ff' }[def.type] || 'var(--gold)';
  if (def.name) attachTip(node, { title: card.name, sub: [typeLabel, weaponRange, `${rankLabel(card.number)}${SUIT_SYMBOL[card.suit] || ''}`].filter(Boolean).join(' · '), desc: def.desc || '', accent });
  if (onClick) node.addEventListener('click', () => onClick(card));
  return node;
}

export { rankLabel };
