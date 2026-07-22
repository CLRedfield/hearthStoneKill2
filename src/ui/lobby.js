// ====================== 大厅 / 开始界面 ======================
import { el, clear } from './dom.js';
import { toast, openOverlay } from './prompts.js';
import { MODE, MODE_NAME, IDENTITY, TEAM, PACK } from '../engine/constants.js';
import { GameEngine, identityDistribution } from '../engine/game.js';
import { AIAgent, AI_CHAOS } from '../engine/ai.js';
import { GameUI, HumanAgent } from './table.js';
import { startOnlineFlow } from '../net/online.js';
import { renderRoomView, modeCapacity, nextDiff } from './room.js';
import { openCodex } from './codex.js';
import { shuffle } from '../util.js';
import { createThemeToggle } from './theme.js';
import { generatePlayerName, getOrCreatePlayerName, savePlayerName } from './player-name.js';

// AI 昵称（刻意区别于武将名，避免与所选武将混淆）
const AI_NAMES = ['沧海客', '听雪', '青锋', '踏歌行', '北辰', '醉卧', '孤鸿', '云生', '寒江'];

export class Lobby {
  constructor(root) {
    this.root = root; this.screen = 'home';
    this.mode = MODE.ZHANGZHENG; this.count = 5; this.name = getOrCreatePlayerName();
    this.myIdentity = null; this.myTeam = TEAM.A; this.pack = PACK.SGS;
    this.localSeats = null; this.selectedSeat = null;
  }

  show() { this.screen = 'home'; this.render(); }

  render() {
    clear(this.root);
    const stage = el('div', { class: 'lobby' });
    stage.appendChild(this._bg());
    if (this.screen === 'home') stage.appendChild(createThemeToggle());
    const content = el('div', { class: 'lobby-content' });
    content.appendChild(this._title(this.screen !== 'home'));
    if (this.screen === 'home') content.appendChild(this._home());
    else if (this.screen === 'local') content.appendChild(this._localRoom());
    stage.appendChild(content);
    this.root.appendChild(stage);
  }

  // 仅装饰背景（绝对定位，置于底层）
  _bg() {
    const embers = el('div', { class: 'embers' });
    for (let i = 0; i < 14; i++) {
      embers.appendChild(el('span', { class: 'ember', style: { left: (Math.random() * 100) + '%', '--d': (8 + Math.random() * 10).toFixed(1) + 's', '--delay': (-Math.random() * 12).toFixed(1) + 's', '--sz': (3 + Math.random() * 5).toFixed(0) + 'px' } }));
    }
    return el('div', { class: 'lobby-bg' }, [
      el('div', { class: 'ink-1' }), el('div', { class: 'ink-2' }), el('div', { class: 'ink-3' }), embers,
    ]);
  }

  // 标题块（正常流，位于面板上方）
  _title(compact) {
    const factions = el('div', { class: 'faction-emblems' }, [
      el('span', { class: 'fe wei', text: '魏' }), el('span', { class: 'fe shu', text: '蜀' }),
      el('span', { class: 'fe wu', text: '吴' }), el('span', { class: 'fe qun', text: '群' }),
    ]);
    return el('div', { class: `lobby-title ${compact ? 'compact' : ''}` }, [
      el('div', { class: 'lt-seal', text: '杀' }),
      el('div', { class: 'lt-main', text: '三国杀' }),
      el('div', { class: 'lt-rule' }, [el('span', { class: 'lt-diamond' })]),
      el('div', { class: 'lt-sub', text: '基础版 · 军争 / 2v2 / 单挑' }),
      compact ? null : factions,
    ]);
  }

  _home() {
    const panel = el('div', { class: 'home-panel' });
    const nameInput = el('input', {
      class: 'name-input', value: this.name, maxlength: '16', autocomplete: 'nickname',
      oninput: (e) => { this.name = e.target.value.slice(0, 16); if (this.name.trim()) savePlayerName(this.name); },
      onblur: () => { if (!this.name.trim()) { this.name = getOrCreatePlayerName(); this.render(); } },
    });
    panel.appendChild(el('div', { class: 'home-row' }, [
      el('label', { text: '昵称' }),
      el('div', { class: 'name-field' }, [
        nameInput,
        el('button', {
          class: 'name-randomize', type: 'button', title: '重新随机昵称', 'aria-label': '重新随机昵称', text: '🎲',
          onclick: () => { this.name = savePlayerName(generatePlayerName()); this.render(); },
        }),
      ]),
    ]));
    panel.appendChild(el('div', { class: 'home-buttons' }, [
      el('button', { class: 'menu-btn big', onclick: () => { this.screen = 'local'; this.render(); } }, [
        el('div', { class: 'mb-icon', text: '⚔' }),
        el('div', { class: 'mb-title', text: '单机对战' }),
        el('div', { class: 'mb-desc', text: '与 AI 同场较量' }),
      ]),
      el('button', { class: 'menu-btn big', onclick: () => startOnlineFlow(this) }, [
        el('div', { class: 'mb-icon', text: '🌐' }),
        el('div', { class: 'mb-title', text: '在线联机' }),
        el('div', { class: 'mb-desc', text: '公共服务器创建/加入房间' }),
      ]),
    ]));
    panel.appendChild(el('button', { class: 'btn codex-entry', onclick: () => openCodex() }, [
      el('span', { text: '📖 图鉴室' }),
      el('span', { class: 'codex-entry-sub', text: '武将技能 / 卡牌总览' }),
    ]));
    panel.appendChild(el('div', { class: 'home-footer', text: '运筹帷幄之中，决胜千里之外' }));
    return panel;
  }

  // 确保 localSeats 与当前模式人数一致（1 个真人 + 若干 AI），保留已设难度
  _ensureLocalSeats() {
    const cap = modeCapacity(this.mode, this.count);
    if (!this.localSeats) this.localSeats = [];
    let human = this.localSeats.find((s) => s.kind === 'human');
    if (!human) human = { kind: 'human' };
    human.name = this.name || '玩家';
    let ais = this.localSeats.filter((s) => s.kind === 'ai');
    while (ais.length < cap - 1) ais.push({ kind: 'ai', name: AI_NAMES[ais.length] || ('电脑' + (ais.length + 1)), diff: 'normal' });
    ais = ais.slice(0, cap - 1);
    // 若现有顺序长度匹配则保留顺序，否则重排为 [人, ...AI]
    const kept = this.localSeats.filter((s) => (s.kind === 'human') || ais.includes(s));
    if (kept.length === cap && kept.includes(human)) this.localSeats = kept;
    else this.localSeats = [human, ...ais];
  }

  _localRoom() {
    const panel = el('div', { class: 'home-panel room-panel' });
    this._ensureLocalSeats();
    const seats = this.localSeats.map((s, i) => ({
      kind: s.kind, name: s.kind === 'human' ? (this.name || '玩家') : s.name,
      tag: s.kind === 'human' ? '你' : '电脑', isYou: s.kind === 'human', aiDifficulty: s.diff,
    }));
    const state = {
      code: null, mode: this.mode, count: this.count, seats, spectators: [], pack: this.pack,
      isLocal: true, canEdit: true, canSwap: true, selectedSeat: this.selectedSeat,
      myIdentity: this.myIdentity, myTeam: this.myTeam,
    };
    const h = {
      onPack: (pk) => { this.pack = pk; this.render(); },
      onMode: (m) => { this.mode = m; if (m === MODE.DUEL2V2) this.count = 4; else if (m === MODE.SOLO) this.count = 2; else if (this.count < 5) this.count = 5; this.selectedSeat = null; this._ensureLocalSeats(); this.render(); },
      onCount: (n) => { this.count = n; this.selectedSeat = null; this._ensureLocalSeats(); this.render(); },
      onSeatDifficulty: (i) => { const s = this.localSeats[i]; if (s && s.kind === 'ai') s.diff = nextDiff(s.diff); this.render(); },
      onSeatClick: (i) => {
        if (this.selectedSeat == null) this.selectedSeat = i;
        else if (this.selectedSeat === i) this.selectedSeat = null;
        else { const a = this.selectedSeat; const t = this.localSeats[a]; this.localSeats[a] = this.localSeats[i]; this.localSeats[i] = t; this.selectedSeat = null; }
        this.render();
      },
      onSeatSwap: (a, b) => {
        if (a === b) return;
        const t = this.localSeats[a]; this.localSeats[a] = this.localSeats[b]; this.localSeats[b] = t;
        this.selectedSeat = null; this.render();
      },
      onIdentity: (v) => { this.myIdentity = v; this.render(); },
      onTeam: (t) => { this.myTeam = t; this.render(); },
      onStart: () => this.startLocal(),
      onExit: () => { this.screen = 'home'; this.render(); },
    };
    renderRoomView(panel, state, h);
    return panel;
  }

  startLocal() {
    this._ensureLocalSeats();
    const cap = this.localSeats.length;
    const seats = this.localSeats.map((s, i) => ({
      id: 'p' + i, name: s.kind === 'human' ? (this.name || '玩家') : s.name,
      isHuman: s.kind === 'human', _diff: s.diff || 'normal', _kind: s.kind,
    }));
    const hIdx = this.localSeats.findIndex((s) => s.kind === 'human');

    // 指定身份 / 阵营（按真人所在座位）
    if (this.mode === MODE.ZHANGZHENG) {
      const ids = buildIdentities(cap, hIdx, this.myIdentity);
      seats.forEach((s, i) => { s.identity = ids[i]; });
    } else if (this.mode === MODE.DUEL2V2) {
      const evenTeam = (hIdx % 2 === 0) ? this.myTeam : (this.myTeam === TEAM.B ? TEAM.A : TEAM.B);
      seats.forEach((s, i) => { s.team = (i % 2 === 0) ? evenTeam : (evenTeam === TEAM.A ? TEAM.B : TEAM.A); });
    } else {
      seats.forEach((s, i) => { s.team = i === hIdx ? TEAM.A : TEAM.B; });
    }

    const engine = new GameEngine({ mode: this.mode, seats, pack: this.pack });
    const ui = new GameUI(engine, seats[hIdx].id, { rematch: { label: '再来一局', fn: () => this.startLocal() } });
    const agents = {};
    seats.forEach((s) => {
      agents[s.id] = s.isHuman ? new HumanAgent(ui) : new AIAgent({ chaos: AI_CHAOS[s._diff] ?? AI_CHAOS.normal });
    });
    engine.agents = agents;

    clear(this.root);
    const gameRoot = el('div', { class: 'game-root' });
    this.root.appendChild(gameRoot);
    ui.mountInto(gameRoot);
    engine.run().catch((e) => { console.error(e); toast('对局发生错误，请刷新', 'error', 4000); });
  }
}

// 生成身份数组：真人所在座位 hIdx 为指定身份（为空随机），其余随机
function buildIdentities(n, hIdx, chosen) {
  const pool = identityDistribution(n).map((s) => s.identity); // 含 1 主公 的多重集合
  const arr = new Array(n).fill(null);
  if (chosen != null && pool.includes(chosen)) { arr[hIdx] = chosen; pool.splice(pool.indexOf(chosen), 1); }
  const rest = shuffle(pool);
  let k = 0;
  for (let i = 0; i < n; i++) if (arr[i] == null) arr[i] = rest[k++];
  return arr;
}

// 供 online.js 复用：用既有引擎挂载牌桌
export function mountGame(root, engine, viewerId) {
  const ui = new GameUI(engine, viewerId);
  clear(root);
  const gameRoot = el('div', { class: 'game-root' });
  root.appendChild(gameRoot);
  ui.mountInto(gameRoot);
  return ui;
}
