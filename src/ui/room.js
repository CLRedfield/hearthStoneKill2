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
  closeSeatMenu(); // 重新渲染时关闭可能残留的换座下拉
  clear(container);
  const root = el('div', { class: 'room-view' });

  // 头部
  root.appendChild(el('div', { class: 'rv-head' }, [
    el('div', { class: 'rv-title', text: state.isLocal ? '单机房间' : '联机房间' }),
    state.code ? el('div', { class: 'rv-code-row' }, [
      el('div', { class: 'rv-code', text: `房间号 ${state.code}` }),
      h.onCopyCode ? el('button', { class: 'rv-copy-btn', text: '复制邀请', onclick: () => h.onCopyCode() }) : null,
    ]) : null,
    state.code ? el('div', { class: 'rv-tip', text: '建议发送完整邀请链接，好友会自动连接同一条线路。' }) : null,
    state.connectionStatus ? el('div', { class: `rv-net-status ${state.connectionStatus}` }, [
      el('span', { class: 'rv-net-dot' }),
      el('span', { text: ({ connect: '联机正常', reconnect: '正在重连', offline: '连接已断开', 'host-offline': '房主暂时离线' })[state.connectionStatus] || '连接中' }),
    ]) : null,
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

  // 座位（右侧「换座位」按钮 → 下拉选择目标 / 每个 AI 单独调难度）
  const seatGrid = el('div', { class: 'rv-seats' });
  // 哪些座位可作为换座来源：本地=任意；房主=真人座位；普通玩家=仅自己
  const eligibleSource = (i) => {
    const s = state.seats[i];
    if (!state.canSwap) return false;
    if (state.canEdit) return state.isLocal ? true : s.kind === 'human';
    return !!s.isYou;
  };
  // 所有其它座位均可作为目标：有人则互换，无人则直接移入该空位。
  const swapTargets = (i) => state.seats
    .map((s, j) => ({ s, j }))
    .filter(({ j }) => j !== i);
  state.seats.forEach((s, i) => {
    const facecls = s.kind === 'empty' ? 'empty' : (s.kind === 'ai' ? 'ai' : 'human');
    const children = [
      el('span', { class: 'rvs-idx', text: `#${i + 1}` }),
      el('span', { class: 'rvs-name', text: s.name }),
      s.tag ? el('span', { class: `rvs-tag tag-${s.kind}`, text: s.tag }) : null,
      s.offline ? el('span', { class: 'rvs-status offline', text: '离线 · AI接管' }) : null,
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
    // 换座位按钮（最右侧）
    if (eligibleSource(i) && swapTargets(i).length) {
      children.push(el('button', {
        class: 'seat-swap-btn', title: '换座位', text: '⇄ 换座',
        onclick: (e) => { e.stopPropagation(); openSeatMenu(e.currentTarget, i, swapTargets(i), state, h); },
      }));
    }
    seatGrid.appendChild(el('div', {
      class: `rv-seat ${facecls} ${s.isYou ? 'you' : ''}`,
      dataset: { idx: String(i) },
    }, children));
  });
  const swapHint = state.canEdit ? '（可换到任意位置；✕ 踢出）' : (state.canSwap ? '（可申请换到任意位置）' : '');
  const teamHint = state.mode === MODE.DUEL2V2 ? '（1、4号位同队；2、3号位同队）' : '';
  const seatSection = el('div', { class: 'rv-section' }, [
    el('div', { class: 'rv-label', text: `座位（${state.seats.filter((s) => s.kind !== 'empty').length}/${state.seats.length}）${teamHint}${swapHint}` }),
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
    state.spectators.forEach((sp) => specRow.appendChild(el('span', { class: `rv-spec ${sp.isYou ? 'you' : ''} ${sp.offline ? 'offline' : ''}`, text: sp.name + (sp.isYou ? '（你）' : '') + (sp.offline ? ' · 离线' : '') })));
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

// ===== 换座下拉栏（精致小浮层，支持鼠标/触屏） =====
let _seatMenu = null;
function _onSeatMenuDocDown(e) { if (_seatMenu && !_seatMenu.contains(e.target)) closeSeatMenu(); }
function _onSeatMenuKey(e) { if (e.key === 'Escape') closeSeatMenu(); }
function closeSeatMenu() {
  if (!_seatMenu) return;
  _seatMenu.remove(); _seatMenu = null;
  document.removeEventListener('pointerdown', _onSeatMenuDocDown, true);
  document.removeEventListener('keydown', _onSeatMenuKey, true);
}
function openSeatMenu(anchor, fromIdx, targets, state, h) {
  const reopening = _seatMenu && _seatMenu._fromIdx === fromIdx;
  closeSeatMenu();
  if (reopening) return; // 再次点击同一按钮 = 关闭
  const fromName = state.seats[fromIdx]?.name || `#${fromIdx + 1}`;
  const menu = el('div', { class: 'seat-menu' }, [
    el('div', { class: 'seat-menu-title', text: `「${fromName}」与谁互换？` }),
    el('div', { class: 'seat-menu-list' }, targets.map(({ s, j }) => el('button', {
      class: 'seat-menu-item',
      onclick: () => { closeSeatMenu(); if (h.onSeatSwap) h.onSeatSwap(fromIdx, j); },
    }, [
      el('span', { class: 'smi-idx', text: `#${j + 1}` }),
      el('span', { class: 'smi-name', text: s.name }),
      s.tag ? el('span', { class: `smi-tag tag-${s.kind}`, text: s.tag }) : null,
    ]))),
  ]);
  menu._fromIdx = fromIdx;
  document.body.appendChild(menu);
  // 定位：锚点按钮下方，溢出屏幕则上翻 / 夹紧
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  _seatMenu = menu;
  setTimeout(() => {
    document.addEventListener('pointerdown', _onSeatMenuDocDown, true);
    document.addEventListener('keydown', _onSeatMenuKey, true);
  }, 0);
}
