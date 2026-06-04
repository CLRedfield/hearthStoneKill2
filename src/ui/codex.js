// ====================== 图鉴室（武将 / 卡牌总览，本地+联机通用） ======================
import { el, clear } from './dom.js';
import { openOverlay } from './prompts.js';
import { GENERAL_LIST } from '../engine/generals.js';
import { CARD_DEFS, SGS_KINDS, HS_KINDS } from '../engine/cards.js';
import { SKILLS } from '../engine/skills.js';
import {
  PACK, PACK_NAME, FACTION_NAME, FACTION_COLOR, CARD_TYPE, EQUIP_SLOT_NAME,
} from '../engine/constants.js';

const TYPE_LABEL = {
  [CARD_TYPE.BASIC]: '基本牌',
  [CARD_TYPE.TRICK]: '锦囊牌',
  [CARD_TYPE.DELAYED]: '延时锦囊',
  [CARD_TYPE.EQUIP]: '装备牌',
  [CARD_TYPE.SECRET]: '奥秘',
};
const TYPE_ORDER = [CARD_TYPE.BASIC, CARD_TYPE.TRICK, CARD_TYPE.DELAYED, CARD_TYPE.EQUIP, CARD_TYPE.SECRET];

export function openCodex() {
  const state = { tab: 'general', pack: PACK.SGS };
  const body = el('div', { class: 'codex' });

  const tabBtn = (key, label) => el('button', {
    class: `codex-tab ${state.tab === key ? 'active' : ''}`, text: label,
    onclick: () => { if (state.tab !== key) { state.tab = key; rerender(); } },
  });
  const packBtn = (pk) => el('button', {
    class: `codex-pack ${state.pack === pk ? 'active' : ''}`, text: PACK_NAME[pk],
    onclick: () => { if (state.pack !== pk) { state.pack = pk; rerender(); } },
  });

  const rerender = () => {
    clear(body);
    body.appendChild(el('div', { class: 'codex-bar' }, [
      el('div', { class: 'codex-tabs' }, [tabBtn('general', '武将'), tabBtn('card', '卡牌')]),
      el('div', { class: 'codex-packs' }, [packBtn(PACK.SGS), packBtn(PACK.HS)]),
    ]));
    body.appendChild(state.tab === 'general' ? buildGenerals(state.pack) : buildCards(state.pack));
  };

  let ov;
  ov = openOverlay({
    title: '图鉴室', bodyNode: body, className: 'wide codex-overlay', closable: true,
    buttons: [{ label: '关闭', primary: true, onClick: () => ov.close() }],
  });
  rerender();
  return ov;
}

function buildGenerals(pack) {
  const list = GENERAL_LIST.filter((g) => (g.pack || PACK.SGS) === pack);
  const grid = el('div', { class: 'codex-grid generals' });
  list.forEach((g) => {
    const color = FACTION_COLOR[g.faction] || '#8a7424';
    const skillNodes = (g.skills || []).map((id) => {
      const meta = SKILLS[id];
      if (!meta) return null;
      return el('div', { class: 'cx-skill' }, [
        el('span', { class: `cx-skill-name ${meta.lord ? 'lord' : ''}`, text: meta.name || id }),
        el('span', { class: 'cx-skill-desc', text: meta.desc || '' }),
      ]);
    }).filter(Boolean);
    const skillsBox = skillNodes.length ? el('div', { class: 'cx-skills' }, skillNodes)
      : el('div', { class: 'cx-bio', text: g.bio || '' });
    grid.appendChild(el('div', { class: 'codex-card general', style: { '--fac': color } }, [
      el('div', { class: 'cxg-head' }, [
        el('div', { class: 'cxg-portrait', text: g.name ? g.name[0] : '?' }),
        el('div', { class: 'cxg-meta' }, [
          el('div', { class: 'cxg-name', text: g.name }),
          el('div', { class: 'cxg-title', text: g.title || '' }),
          el('div', { class: 'cxg-tags' }, [
            el('span', { class: 'cxg-faction', style: { background: color }, text: FACTION_NAME[g.faction] || '' }),
            el('span', { class: 'cxg-hp', text: '体力 ' + (g.hp != null ? g.hp : '?') }),
          ]),
        ]),
      ]),
      skillsBox,
    ]));
  });
  if (!list.length) grid.appendChild(el('div', { class: 'codex-empty', text: '该包暂无武将' }));
  return grid;
}

function buildCards(pack) {
  const kinds = pack === PACK.HS ? HS_KINDS : SGS_KINDS;
  const wrap = el('div', { class: 'codex-cards' });
  const byType = {};
  kinds.forEach((k) => {
    const def = CARD_DEFS[k];
    if (!def) return;
    (byType[def.type] = byType[def.type] || []).push({ kind: k, def });
  });
  TYPE_ORDER.forEach((type) => {
    const items = byType[type];
    if (!items || !items.length) return;
    wrap.appendChild(el('div', { class: 'codex-type-label', text: `${TYPE_LABEL[type] || type}（${items.length}）` }));
    const grid = el('div', { class: 'codex-grid cards' });
    items.forEach(({ def }) => {
      const sub = type === CARD_TYPE.EQUIP
        ? [EQUIP_SLOT_NAME[def.slot], def.range != null ? `攻击范围 ${def.range}` : null].filter(Boolean).join(' · ')
        : (TYPE_LABEL[type] || '');
      grid.appendChild(el('div', { class: `codex-card card type-${type}` }, [
        el('div', { class: 'cxc-name', text: def.name }),
        sub ? el('div', { class: 'cxc-sub', text: sub }) : null,
        el('div', { class: 'cxc-desc', text: def.desc || '' }),
      ]));
    });
    wrap.appendChild(grid);
  });
  if (!wrap.children.length) wrap.appendChild(el('div', { class: 'codex-empty', text: '该包暂无卡牌' }));
  return wrap;
}
