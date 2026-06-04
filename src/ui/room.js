// ====================== 统一房间视图（本地 / 联机共用） ======================
import { el, clear } from './dom.js';
import { MODE, MODE_NAME, IDENTITY, IDENTITY_NAME, FACTION_COLOR, PACK, PACK_NAME } from '../engine/constants.js';

export const AI_DIFFICULTIES = [
  { key: 'easy', name: '简单', desc: '行动随机性高' },
  { key: 'normal', name: '普通', desc: '均衡对手' },
  { key: 'hard', name: '困难', desc: '几乎不失误' },
];
export const DIFF_SHORT = { easy: '简', normal: '普', hard: '难' };
export const DIFF_ORDER = ['easy', 'normal', 'hard'];
export const nextDiff = (d) => DIFF_ORDER[(DIFF_ORDER.indexOf(d || 'normal') + 1) % DIFF_ORDER.length];

// 各模式的参战人数上限
export function modeCapacity(mode, count) {
  if (mode === MODE.SOLO) return 2;
  if (mode === MODE.DUEL2V2) return 4;
  return count; // 军争
}

const MODES = [
  { mode: MODE.ZHANGZHENG, name: '军争', sub: '5-8 人' },
  { mode: MODE.DUEL2V2, name: '2v2', sub: '4 人' },
  { mode: MODE.SOLO, name: '单挑', sub: '2 人' },
];

const IDENTITY_OPTS = [
  { value: null, label: '随机' },
  { value: IDENTITY.LORD, label: '主公' },
  { value: IDENTITY.LOYALIST, label: '忠臣' },
  { value: IDENTITY.REBEL, label: '反贼' },
  { value: IDENTITY.TRAITOR, label: '内奸' },
];

// 渲染房间视图到 container
export function renderRoomView(container, state, h) {
  clear(container);
  const root = el('div', { class: 'room-view' });

  // 头部
  root.appendChild(el('div', { class: 'rv-head' }, [
    el('div', { class: 'rv-title', text: state.isLocal ? '单机房间' : '联机房间' }),
    state.code ? el('div', { class: 'rv-code', text: `房间号 ${state.code}` }) : null,
    state.code ? el('div', { class: 'rv-tip', text: '把房间号发给朋友，让其「加入房间」。' }) : null,
  ]));

  // 武将包选择
  if (state.pack !== undefined) {
    const packRow = el('div', { class: 'rv-modes' });
    [PACK.SGS, PACK.HS].forEach((pk) => {
      packRow.appendChild(el('div', {
        class: `rv-mode ${state.pack === pk ? 'active' : ''} ${state.canEdit ? '' : 'locked'}`,
        onclick: () => { if (state.canEdit && state.pack !== pk) h.onPack(pk); },
      }, [el('div', { class: 'rvm-name', text: PACK_NAME[pk] }), el('div', { class: 'rvm-sub', text: pk === PACK.SGS ? '魏蜀吴群' : '炉石英雄' })]));
    });
    root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: '武将包' }), packRow]));
  }

  // 模式选择
  const modeRow = el('div', { class: 'rv-modes' });
  MODES.forEach((m) => {
    modeRow.appendChild(el('div', {
      class: `rv-mode ${state.mode === m.mode ? 'active' : ''} ${state.canEdit ? '' : 'locked'}`,
      onclick: () => { if (state.canEdit && state.mode !== m.mode) h.onMode(m.mode); },
    }, [el('div', { class: 'rvm-name', text: m.name }), el('div', { class: 'rvm-sub', text: m.sub })]));
  });
  root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: '模式' }), modeRow]));

  // 人数（仅军争）
  if (state.mode === MODE.ZHANGZHENG) {
    const counts = el('div', { class: 'rv-counts' });
    [5, 6, 7, 8].forEach((n) => counts.appendChild(el('button', {
      class: `count-btn ${state.count === n ? 'active' : ''} ${state.canEdit ? '' : 'locked'}`, text: String(n),
      onclick: () => { if (state.canEdit) h.onCount(n); },
    })));
    root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: '人数' }), counts]));
  }

  // 座位（可点击换位 / 每个 AI 单独调难度）
  const seatGrid = el('div', { class: 'rv-seats' });
  state.seats.forEach((s, i) => {
    const facecls = s.kind === 'empty' ? 'empty' : (s.kind === 'ai' ? 'ai' : 'human');
    const isSel = state.selectedSeat === i;
    const children = [
      el('span', { class: 'rvs-idx', text: `#${i + 1}` }),
      el('span', { class: 'rvs-name', text: s.name }),
      s.tag ? el('span', { class: `rvs-tag tag-${s.kind}`, text: s.tag }) : null,
    ];
    if ((s.kind === 'ai' || s.kind === 'empty') && state.canEdit) {
      children.push(el('button', {
        class: 'seat-diff', title: '点击切换该 AI 难度', text: DIFF_SHORT[s.aiDifficulty || 'normal'],
        onclick: (e) => { e.stopPropagation(); h.onSeatDifficulty(i); },
      }));
    }
    // 踢人（房主，针对其他真人）
    if (state.canKick && s.kind === 'human' && !s.isYou) {
      children.push(el('button', {
        class: 'seat-kick', title: '踢出该玩家', text: '✕',
        onclick: (e) => { e.stopPropagation(); h.onKick(i); },
      }));
    }
    const seatEl = el('div', {
      class: `rv-seat ${facecls} ${s.isYou ? 'you' : ''} ${isSel ? 'sel' : ''} ${state.canSwap ? 'swap' : ''}`,
      dataset: { idx: String(i) },
    }, children);
    if (state.canSwap) attachSeatInteract(seatEl, i, seatGrid, h);
    seatGrid.appendChild(seatEl);
  });
  const swapHint = state.canEdit ? '（点两个座位互换，或直接拖动座位；✕ 踢出）' : (state.canSwap ? '（点或拖动座位申请换位）' : '');
  const seatSection = el('div', { class: 'rv-section' }, [
    el('div', { class: 'rv-label', text: `座位（${state.seats.filter((s) => s.kind !== 'empty').length}/${state.seats.length}）${swapHint}` }),
    seatGrid,
  ]);
  // 房主开关：是否允许玩家自由换座
  if (state.showSeatChangeToggle) {
    seatSection.appendChild(el('button', {
      class: `chip-btn seat-toggle ${state.allowSeatChange ? 'active' : ''}`,
      text: state.allowSeatChange ? '✓ 允许玩家自由换座' : '允许玩家自由换座',
      onclick: () => h.onToggleSeatChange(),
    }));
  }
  root.appendChild(seatSection);

  // 观战席
  if (state.spectators && state.spectators.length) {
    const specRow = el('div', { class: 'rv-spectators' });
    state.spectators.forEach((sp) => specRow.appendChild(el('span', { class: `rv-spec ${sp.isYou ? 'you' : ''}`, text: sp.name + (sp.isYou ? '（你）' : '') })));
    root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: `观战席（${state.spectators.length}）` }), specRow]));
  }

  // 本地专属：指定身份 + AI 难度
  if (state.isLocal) {
    if (state.mode === MODE.ZHANGZHENG) {
      const idRow = el('div', { class: 'rv-chips' });
      IDENTITY_OPTS.forEach((o) => idRow.appendChild(el('button', {
        class: `chip-btn ${(state.myIdentity ?? null) === o.value ? 'active' : ''}`, text: o.label,
        onclick: () => h.onIdentity(o.value),
      })));
      root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: '我的身份' }), idRow]));
    } else if (state.mode === MODE.DUEL2V2) {
      const teamRow = el('div', { class: 'rv-chips' });
      [['A', 'A 队'], ['B', 'B 队']].forEach(([v, label]) => teamRow.appendChild(el('button', {
        class: `chip-btn ${state.myTeam === v ? 'active' : ''}`, text: label, onclick: () => h.onTeam(v),
      })));
      root.appendChild(el('div', { class: 'rv-section' }, [el('div', { class: 'rv-label', text: '我的队伍' }), teamRow]));
    }
  }

  // 操作
  const actions = el('div', { class: 'rv-actions' });
  if (state.canEdit) actions.appendChild(el('button', { class: 'btn btn-primary big', text: '开始游戏', onclick: () => h.onStart() }));
  else actions.appendChild(el('div', { class: 'room-wait', text: state.waitingNote || '等待房主开始…' }));
  actions.appendChild(el('button', { class: 'btn btn-ghost', text: '退出', onclick: () => h.onExit() }));
  root.appendChild(actions);

  container.appendChild(root);
}

// 座位交互：轻点=沿用原“点击换位”，拖动=拖到另一座位上互换（支持触屏/鼠标）
function attachSeatInteract(seatEl, idx, grid, h) {
  seatEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // 座位上的难度/踢人按钮自行处理
    if (e.button != null && e.button !== 0) return; // 仅左键/触摸
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    let moved = false, dropIdx = null;
    try { seatEl.setPointerCapture(e.pointerId); } catch (_) {}
    const clearTargets = () => grid.querySelectorAll('.rv-seat.drop-target').forEach((n) => n.classList.remove('drop-target'));
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
      moved = true; seatEl.classList.add('dragging');
      clearTargets();
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.rv-seat');
      if (over && over !== seatEl && grid.contains(over)) { over.classList.add('drop-target'); dropIdx = Number(over.dataset.idx); }
      else dropIdx = null;
    };
    const onUp = () => {
      seatEl.removeEventListener('pointermove', onMove);
      seatEl.removeEventListener('pointerup', onUp);
      seatEl.removeEventListener('pointercancel', onUp);
      seatEl.classList.remove('dragging'); clearTargets();
      try { seatEl.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        if (dropIdx != null && dropIdx !== idx) {
          if (h.onSeatSwap) h.onSeatSwap(idx, dropIdx);
          else { h.onSeatClick(idx); h.onSeatClick(dropIdx); }
        }
      } else {
        h.onSeatClick(idx); // 轻点 = 原有点击换位逻辑
      }
    };
    seatEl.addEventListener('pointermove', onMove);
    seatEl.addEventListener('pointerup', onUp);
    seatEl.addEventListener('pointercancel', onUp);
  });
}
