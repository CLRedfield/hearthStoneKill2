// ====================== 在线联机（公共 MQTT · 房主权威模式） ======================
import { el, clear } from '../ui/dom.js';
import { openOverlay, toast } from '../ui/prompts.js';
import { MODE, MODE_NAME, PACK } from '../engine/constants.js';
import { GameEngine } from '../engine/game.js';
import { AIAgent, AI_CHAOS } from '../engine/ai.js';
import { GameUI, HumanAgent } from '../ui/table.js';
import { renderRoomView, modeCapacity, nextDiff } from '../ui/room.js';
import { ChatBox } from '../ui/chat.js';
import { virtualCard } from '../engine/cards.js';
import { findCardOnPlayer } from '../engine/effects.js';
import { Emitter, deferred } from '../util.js';
import {
  MqttBus, topics, getBroker, DEFAULT_BROKER, BROKER_ALTERNATIVES, genRoomCode, genClientId,
} from './mqtt.js';

const AI_FILL = ['沧海客', '听雪', '青锋', '踏歌行', '北辰', '醉卧', '孤鸿'];
let BUS = null; // 当前会话的 MQTT 连接
let CHAT = null; // 聊天面板（整局复用，挂在 body 上）

// ---------- 入口 ----------
export async function startOnlineFlow(lobby) {
  const preferred = await promptConnect();
  if (preferred === null) return;
  const candidates = [preferred, ...BROKER_ALTERNATIVES].filter((url, i, all) => url && all.indexOf(url) === i);
  let lastError = null;
  for (const broker of candidates) {
    toast(`正在连接 ${broker.replace('wss://', '').replace('/mqtt', '')}…`);
    const bus = new MqttBus(broker);
    try {
      await bus.connect();
      BUS = bus;
      toast('联机服务器已连接 ✓', 'info', 1200);
      promptCreateOrJoin(lobby);
      return;
    } catch (e) {
      lastError = e;
      bus.end();
    }
  }
  toast('所有公共服务器均连接失败：' + (lastError?.message || '请检查网络后重试'), 'error', 5000);
}

function promptConnect() {
  return new Promise((resolve) => {
    const input = el('input', { class: 'name-input', value: getBroker(), placeholder: 'MQTT broker 地址' });
    const alts = el('div', { class: 'broker-alts' }, BROKER_ALTERNATIVES.map((u) =>
      el('button', { class: 'broker-alt', text: u.replace('wss://', '').replace('/mqtt', ''), onclick: () => { input.value = u; } })
    ));
    const body = el('div', { class: 'env-body' }, [
      el('p', { class: 'env-hint', text: '选择首选公共服务器；连接失败时会自动尝试备用线路。无需注册。' }),
      input,
      el('div', { class: 'broker-label', text: '备用服务器：' }), alts,
    ]);
    let ov;
    ov = openOverlay({
      title: '进入联机大厅', bodyNode: body,
      buttons: [
        { label: '智能连接', primary: true, onClick: () => { const v = input.value.trim(); if (!v) return toast('请输入服务器地址'); ov.close(); resolve(v); } },
        { label: '取消', onClick: () => { ov.close(); resolve(null); } },
      ],
    });
  });
}

function promptCreateOrJoin(lobby) {
  const body = el('div', { class: 'online-menu' }, [
    el('button', { class: 'menu-btn', onclick: () => { ov.close(); createRoomFlow(lobby); } }, [el('div', { class: 'mb-title', text: '创建房间' })]),
    el('button', { class: 'menu-btn', onclick: () => { ov.close(); joinRoomFlow(lobby); } }, [el('div', { class: 'mb-title', text: '加入房间' })]),
  ]);
  const ov = openOverlay({ title: '在线联机', bodyNode: body, closable: true, buttons: [] });
}

async function createRoomFlow(lobby) {
  const cfg = await promptModeCount();
  if (!cfg) return;
  const code = genRoomCode();
  enterRoom(lobby, code, genClientId(), true, cfg);
}

async function joinRoomFlow(lobby) {
  const code = await promptRoomCode();
  if (!code) return;
  enterRoom(lobby, code, genClientId(), false, null);
}

function promptModeCount() {
  return new Promise((resolve) => {
    let mode = MODE.ZHANGZHENG, count = 5;
    const body = el('div', { class: 'setup mini' });
    const modeRow = el('div', { class: 'mode-row' });
    const counts = el('div', { class: 'count-row' });
    const drawModes = () => {
      clear(modeRow);
      [[MODE.ZHANGZHENG, '军争 5-8'], [MODE.DUEL2V2, '2v2'], [MODE.SOLO, '单挑']].forEach(([m, label]) => {
        modeRow.appendChild(el('div', { class: `mode-card ${mode === m ? 'active' : ''}`, text: label, onclick: () => { mode = m; if (m === MODE.DUEL2V2) count = 4; if (m === MODE.SOLO) count = 2; drawModes(); drawCounts(); } }));
      });
    };
    const drawCounts = () => {
      clear(counts);
      if (mode !== MODE.ZHANGZHENG) return;
      counts.appendChild(el('span', { text: '人数：' }));
      [5, 6, 7, 8].forEach((n) => counts.appendChild(el('button', { class: `count-btn ${count === n ? 'active' : ''}`, text: String(n), onclick: () => { count = n; drawCounts(); } })));
    };
    body.appendChild(modeRow); body.appendChild(counts); drawModes(); drawCounts();
    let ov = openOverlay({
      title: '房间设置', bodyNode: body,
      buttons: [
        { label: '创建', primary: true, onClick: () => { ov.close(); resolve({ mode, count }); } },
        { label: '取消', onClick: () => { ov.close(); resolve(null); } },
      ],
    });
  });
}

function promptRoomCode() {
  return new Promise((resolve) => {
    const input = el('input', { class: 'name-input', placeholder: '输入 6 位房间号', maxlength: '6', style: { textTransform: 'uppercase' } });
    let ov = openOverlay({
      title: '加入房间', bodyNode: input,
      buttons: [
        { label: '加入', primary: true, onClick: () => { const v = input.value.trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(v)) return toast('请输入正确的 6 位房间号'); ov.close(); resolve(v); } },
        { label: '取消', onClick: () => { ov.close(); resolve(null); } },
      ],
    });
  });
}

// ---------- 房间等待界面 ----------
const MAX_ROOM = 12; // 含观战者的房间总人数上限
function roomCapacity(room) { return modeCapacity(room.mode, room.count) || 0; }

// 联机房间使用显式 seat 编号，空位因此可以真实存在；旧房间数据仍可自动迁移。
export function ensureRoomSeats(room) {
  const players = room.players || (room.players = []);
  const cap = roomCapacity(room);
  const used = new Set();
  const legacy = [];
  players.forEach((p) => {
    const hasSeat = Object.prototype.hasOwnProperty.call(p, 'seat');
    if (Number.isInteger(p.seat) && p.seat >= 0 && p.seat < cap && !used.has(p.seat)) used.add(p.seat);
    else if (!hasSeat) legacy.push(p);
    else p.seat = null;
  });
  legacy.forEach((p) => {
    const seat = Array.from({ length: cap }, (_, i) => i).find((i) => !used.has(i));
    p.seat = seat ?? null;
    if (seat != null) used.add(seat);
  });
  return room;
}

export function reflowRoomSeats(room) {
  const cap = roomCapacity(room);
  (room.players || []).forEach((p, i) => { p.seat = i < cap ? i : null; });
}

export function playersBySeat(room) {
  ensureRoomSeats(room);
  const seats = new Array(roomCapacity(room)).fill(null);
  (room.players || []).forEach((p) => { if (Number.isInteger(p.seat) && p.seat < seats.length) seats[p.seat] = p; });
  return seats;
}

export function spectatorPlayers(room) {
  ensureRoomSeats(room);
  const cap = roomCapacity(room);
  return (room.players || []).filter((p) => !Number.isInteger(p.seat) || p.seat < 0 || p.seat >= cap);
}

export function firstOpenSeat(room) { return playersBySeat(room).findIndex((p) => !p); }
export function playerAtSeat(room, seat) { return (room.players || []).find((p) => p.seat === seat) || null; }

export function swapRoomSeat(room, fromSeat, toSeat) {
  const cap = roomCapacity(room);
  if (!Number.isInteger(fromSeat) || !Number.isInteger(toSeat) || fromSeat < 0 || toSeat < 0 || fromSeat >= cap || toSeat >= cap || fromSeat === toSeat) return false;
  const moving = playerAtSeat(room, fromSeat);
  if (!moving) return false;
  const target = playerAtSeat(room, toSeat);
  moving.seat = toSeat;
  if (target) target.seat = fromSeat;
  return true;
}

async function copyRoomCode(code) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(code);
    toast('房间号已复制');
  } catch (e) {
    window.prompt('复制房间号', code);
  }
}

function enterRoom(lobby, code, myId, isHost, cfg) {
  const T = topics(code);
  let room = isHost
    ? { code, mode: cfg.mode, count: cfg.count, pack: cfg.pack || PACK.SGS, hostId: myId, players: [{ id: myId, name: lobby.name || '房主', seat: 0 }], status: 'waiting', aiDifficulty: 'normal' }
    : { code, players: [], count: 0, mode: '', pack: PACK.SGS, status: 'waiting', hostId: null, aiDifficulty: 'normal' };
  ensureRoomSeats(room);
  let started = false;       // 是否正在对局中
  let screen = null;
  let selectedSeat = null;
  let wasIn = false;
  let gameCleanup = [];
  let netStatus = BUS.connected ? 'connect' : 'reconnect';
  let roomSeen = isHost;

  // 聊天面板（创建一次，跨房间/对局保留）
  if (!CHAT) CHAT = new ChatBox(BUS, code, { id: myId, name: lobby.name || '玩家' });

  const publishLobby = () => { ensureRoomSeats(room); BUS.pub(T.lobby, room, { retain: true }); };
  const sendJoin = () => BUS.pub(T.join, { id: myId, name: lobby.name || '玩家' }, { qos: 1 });
  BUS.onStatus((s) => {
    netStatus = s;
    CHAT?.setStatus(s);
    if (s === 'offline') toast('⚠ 连接断开，正在自动重连…', 'error', 2500);
    else if (s === 'connect') {
      toast('✓ 联机已恢复', 'info', 1500);
      if (isHost) publishLobby(); else if (!started) sendJoin();
    }
    if (!started && screen) render(room);
  });
  const cleanupGame = () => { gameCleanup.forEach((fn) => { try { fn(); } catch (e) {} }); gameCleanup = []; };
  const exitRoom = async () => {
    if (isHost) {
      room.status = 'closed';
      publishLobby();
      await new Promise((resolve) => setTimeout(resolve, 180));
      await BUS.clearRetained(T.lobby);
    }
    BUS?.end();
    location.reload();
  };

  const showRoom = () => {
    cleanupGame();
    clear(lobby.root);
    screen = el('div', { class: 'room-screen' });
    lobby.root.appendChild(screen);
    render(room);
  };

  // 房主：再来一局 → 回到房间（所有人含淘汰/观战者仍在名单里）
  const backToRoom = () => {
    (room.players || []).forEach((p) => BUS.clearRetained(T.state(p.id)));
    BUS.clearRetained(T.spec);
    room.status = 'waiting'; delete room.spectators; selectedSeat = null; started = false;
    publishLobby(); showRoom();
  };

  // 房主：开始一局
  const startHostGame = () => {
    started = true;
    const cap = roomCapacity(room);
    const seatHumans = playersBySeat(room);
    const spectators = spectatorPlayers(room);
    const aiDiffs = room.aiDifficulties || {};
    let ai = 0;
    const seats = seatHumans.map((p, idx) => {
      if (p) return { id: p.id, name: p.name, isHuman: true };
      const id = 'ai' + ai;
      const seat = { id, name: AI_FILL[ai] || ('AI' + ai), isHuman: false, _diff: aiDiffs[idx] || 'normal' };
      ai++;
      return seat;
    });
    (room.players || []).forEach((p) => BUS.clearRetained(T.state(p.id)));
    BUS.clearRetained(T.spec);
    room.status = 'playing'; room.spectators = spectators.map((p) => p.id);
    publishLobby();

    const engine = new GameEngine({ mode: room.mode, seats, pack: room.pack || PACK.SGS });
    const ui = mountHostGame(lobby.root, engine, myId, { rematch: { label: '再来一局', fn: backToRoom } });
    const hub = new MqttHostHub(code, engine, myId, spectators.length > 0);
    engine.agents = {};
    for (const s of seats) {
      if (s.id === myId) engine.agents[s.id] = new HumanAgent(ui);
      else if (s.isHuman) engine.agents[s.id] = new RemoteAgent(hub, s.id);
      else engine.agents[s.id] = new AIAgent({ chaos: AI_CHAOS[s._diff] ?? AI_CHAOS.normal });
    }
    hub.start();
    gameCleanup.push(() => hub.stop());
    engine.run().catch((e) => { console.error(e); toast('对局错误', 'error'); });
  };

  // 客户端：进入对局（玩家 / 观战），订阅登记到 gameCleanup 以便再来一局时清理
  const enterClientGame = () => {
    started = true;
    const cap = roomCapacity(room);
    const own = (room.players || []).find((p) => p.id === myId);
    const spectator = !own || !Number.isInteger(own.seat) || own.seat < 0 || own.seat >= cap;
    const vid = spectator ? '__spectator__' : myId;
    const viewEngine = new ViewEngine(vid);
    const ui = new GameUI(viewEngine, vid, { spectator, rematch: { label: '入座下一局', fn: clientRematch } });
    const human = spectator ? null : new HumanAgent(ui);
    clear(lobby.root);
    const gameRoot = el('div', { class: 'game-root' });
    lobby.root.appendChild(gameRoot);
    ui.mountInto(gameRoot);
    toast(spectator ? '你正在观战' : '已进入对局');
    gameCleanup.push(BUS.sub(spectator ? T.spec : T.state(myId), (snap) => viewEngine.update(snap), { qos: 0 }));
    gameCleanup.push(BUS.sub(T.fx, (e) => viewEngine.pushFx(e), { qos: 0 }));
    if (!spectator) {
      const handled = new Set();
      gameCleanup.push(BUS.sub(T.req(myId), async (req) => {
        if (!req?.reqId || handled.has(req.reqId)) return;
        handled.add(req.reqId);
        const localReq = hydrateReq(viewEngine, myId, req);
        try { const resp = await human.respond(localReq); BUS.pub(T.act, { reqId: req.reqId, playerId: myId, response: serializeResponse(req.type, resp) }, { qos: 1 }); }
        catch (e) { console.error('client respond', e); BUS.pub(T.act, { reqId: req.reqId, playerId: myId, response: null }, { qos: 1 }); }
      }, { qos: 1 }));
    }
  };

  const clientRematch = () => { sendJoin(); toast('已重新报到，等待房主开始下一局'); };

  const render = (r) => {
    ensureRoomSeats(r);
    const cap = roomCapacity(r);
    const seatHumans = playersBySeat(r);
    const specHumans = spectatorPlayers(r);
    const aiDiffs = r.aiDifficulties || {};
    const seats = [];
    for (let i = 0; i < cap; i++) {
      const p = seatHumans[i];
      if (p) seats.push({ name: p.name, kind: 'human', tag: p.id === r.hostId ? '房主' : (p.id === myId ? '你' : ''), isYou: p.id === myId });
      else seats.push({ name: 'AI 补位', kind: 'empty', tag: '空位', aiDifficulty: aiDiffs[i] || 'normal' });
    }
    const spectators = specHumans.map((p) => ({ name: p.name, isYou: p.id === myId }));
    const amSpec = specHumans.some((p) => p.id === myId);
    const allowSeatChange = !!r.allowSeatChange;
    const state = {
      code, mode: r.mode || MODE.ZHANGZHENG, count: r.count || 5, seats, spectators, pack: r.pack || PACK.SGS,
      isLocal: false, canEdit: isHost,
      canSwap: isHost || allowSeatChange, canKick: isHost,
      connectionStatus: netStatus,
      showSeatChangeToggle: isHost, allowSeatChange,
      selectedSeat: isHost ? selectedSeat : null,
      waitingNote: amSpec ? '名额已满，你将作为观战者进入' : '等待房主开始…',
    };
    const h = {
      onCopyCode: () => copyRoomCode(code),
      onPack: (pk) => { room.pack = pk; publishLobby(); render(room); },
      onMode: (m) => { room.mode = m; if (m === MODE.DUEL2V2) room.count = 4; else if (m === MODE.SOLO) room.count = 2; else if (room.count < 5) room.count = 5; reflowRoomSeats(room); selectedSeat = null; publishLobby(); render(room); },
      onCount: (n) => { room.count = n; reflowRoomSeats(room); selectedSeat = null; publishLobby(); render(room); },
      onSeatDifficulty: (i) => { if (!room.aiDifficulties) room.aiDifficulties = {}; room.aiDifficulties[i] = nextDiff(room.aiDifficulties[i]); publishLobby(); render(room); },
      onToggleSeatChange: () => { room.allowSeatChange = !room.allowSeatChange; publishLobby(); render(room); },
      onKick: (i) => {
        const p = playerAtSeat(room, i);
        if (!p || p.id === room.hostId) return;
        let ov;
        ov = openOverlay({
          title: '移出玩家',
          bodyNode: el('div', { class: 'menu-list' }, [el('div', { class: 'menu-hint', text: `确定将「${p.name}」移出房间？` })]),
          buttons: [
            { label: '确定移出', danger: true, onClick: () => { ov.close(); const j = room.players.findIndex((x) => x.id === p.id); if (j >= 0) { room.players.splice(j, 1); selectedSeat = null; publishLobby(); render(room); toast(`已移出 ${p.name}`); } } },
            { label: '取消', onClick: () => ov.close() },
          ],
        });
      },
      onSeatClick: (i) => {
        if (isHost) {
          if (selectedSeat == null) { if (seats[i]?.kind === 'human') selectedSeat = i; }
          else if (selectedSeat === i) selectedSeat = null;
          else { swapRoomSeat(room, selectedSeat, i); selectedSeat = null; publishLobby(); }
          render(room);
        } else if (allowSeatChange) {
          if (seats[i]?.isYou) return;
          BUS.pub(T.move, { id: myId, toIndex: i }, { qos: 1 });
          toast(`已申请换到 #${i + 1}…`);
        }
      },
      // 有人则互换，无人则直接移动到该空位。
      onSeatSwap: (a, b) => {
        if (a === b) return;
        if (isHost) {
          if (seats[a]?.kind !== 'human' || !swapRoomSeat(room, a, b)) return;
          selectedSeat = null; publishLobby(); render(room);
        } else if (allowSeatChange) {
          if (seats[a]?.isYou) { BUS.pub(T.move, { id: myId, toIndex: b }, { qos: 1 }); toast(`已申请换到 #${b + 1}…`); }
        }
      },
      onStart: () => startHostGame(),
      onExit: () => exitRoom(),
    };
    renderRoomView(screen, state, h);
  };

  if (isHost) {
    BUS.sub(T.join, (msg) => {
      if (!room || room.status !== 'waiting' || !msg?.id) return;
      if (room.players.some((p) => p.id === msg.id)) { publishLobby(); return; }
      if (room.players.length >= MAX_ROOM) return;
      const seat = firstOpenSeat(room);
      room.players.push({ id: msg.id, name: msg.name || '玩家', seat: seat >= 0 ? seat : null });
      publishLobby(); render(room);
      toast(`${msg.name || '玩家'} ${seat >= 0 ? `加入了 #${seat + 1}` : '进入观战席'}`);
    });
    // 非房主换座申请
    BUS.sub(T.move, (msg) => {
      if (!room.allowSeatChange || room.status !== 'waiting' || !msg?.id) return;
      const moving = room.players.find((p) => p.id === msg.id);
      const from = moving?.seat;
      const to = msg.toIndex;
      if (!swapRoomSeat(room, from, to)) return;
      publishLobby(); render(room);
    });
    showRoom();
    publishLobby();
  } else {
    BUS.sub(T.lobby, (r) => {
      if (!r || !r.code) return;
      roomSeen = true;
      ensureRoomSeats(r);
      room = r;
      if (r.status === 'closed') {
        toast('房主已关闭房间', 'error', 2500);
        BUS?.end();
        setTimeout(() => location.reload(), 1600);
        return;
      }
      const inRoom = (r.players || []).some((p) => p.id === myId);
      // 被房主踢出
      if (wasIn && !inRoom && r.status === 'waiting') {
        wasIn = false;
        toast('你已被房主移出房间', 'error', 2500);
        BUS?.end();
        setTimeout(() => location.reload(), 1800);
        return;
      }
      if (inRoom) wasIn = true;
      if (r.status === 'playing' && !started) { enterClientGame(); return; }
      if (r.status === 'waiting' && started) { showRoom(); return; } // 房主再来一局 → 回到房间
      if (r.status === 'waiting') render(r);
    });
    sendJoin();
    setTimeout(() => { if (!room.players?.some((p) => p.id === myId)) sendJoin(); }, 1600);
    setTimeout(() => {
      if (!roomSeen) toast('未找到该房间，请核对房间号或确认房主仍在线', 'error', 5000);
    }, 5500);
    showRoom();
  }
}

function mountHostGame(root, engine, hostId, opts) {
  clear(root);
  const gameRoot = el('div', { class: 'game-root' });
  root.appendChild(gameRoot);
  const ui = new GameUI(engine, hostId, opts);
  ui.mountInto(gameRoot);
  return ui;
}

// 房主通讯枢纽
class MqttHostHub {
  constructor(code, engine, hostId, hasSpectators = false) {
    this.T = topics(code);
    this.engine = engine; this.hostId = hostId; this.hasSpectators = hasSpectators;
    this.reqSeq = 0;
    this.pending = new Map();
    this._timer = null; this._dirty = false; this._unsubs = []; this.stopped = false;
  }
  start() {
    this._unsubs.push(this.engine.on('change', () => this.scheduleBroadcast()));
    this._unsubs.push(this.engine.on('fx', (e) => BUS.pub(this.T.fx, e, { qos: 0 })));
    this._unsubs.push(this.engine.on('damage', (e) => BUS.pub(this.T.fx, { name: 'damage', targetId: e.target.id, amount: e.amount, nature: e.nature }, { qos: 0 })));
    this._unsubs.push(BUS.sub(this.T.act, (doc) => this.onAction(doc)));
    this.scheduleBroadcast();
  }
  stop() {
    this.stopped = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
  }
  scheduleBroadcast() {
    if (this.stopped) return;
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; if (this._dirty && !this.stopped) this.broadcast(); }, 150);
  }
  broadcast() {
    if (this.stopped) return;
    this._dirty = false;
    for (const p of this.engine.players) {
      if (p.isHuman && p.id !== this.hostId) BUS.pub(this.T.state(p.id), this.engine.snapshot(p.id), { qos: 0, retain: true });
    }
    // 观战者公共快照（隐藏所有手牌）
    if (this.hasSpectators) BUS.pub(this.T.spec, this.engine.snapshot('__spectator__'), { qos: 0, retain: true });
  }
  async request(playerId, serialReq) {
    const reqId = `${this.hostId}_${++this.reqSeq}`;
    const d = deferred();
    this.pending.set(reqId, d);
    BUS.pub(this.T.req(playerId), { reqId, ...serialReq }, { qos: 1 });
    const timer = setTimeout(() => { if (this.pending.has(reqId)) { this.pending.delete(reqId); d.resolve(null); } }, 45000);
    const res = await d.promise; clearTimeout(timer); return res;
  }
  onAction(doc) {
    const d = doc && this.pending.get(doc.reqId);
    if (d) { this.pending.delete(doc.reqId); d.resolve(doc.response); }
  }
}

class RemoteAgent {
  constructor(hub, playerId) { this.hub = hub; this.playerId = playerId; this.kind = 'remote'; }
  async respond(req) {
    const wire = await this.hub.request(this.playerId, serializeReq(req));
    return deserializeResponse(this.hub.engine, this.playerId, req.type, wire);
  }
}

// 客户端轻量引擎视图
class ViewEngine {
  constructor(viewerId) { this.viewerId = viewerId; this._snap = { players: [], logs: [] }; this.emitter = new Emitter(); this.mode = null; this.players = []; }
  on(ev, fn) { return this.emitter.on(ev, fn); }
  get discard() { return null; }
  update(snap) {
    this._snap = snap; this.mode = snap.mode;
    this.players = snap.players.map((p) => ({ ...p, skills: p.skills || [], flags: p.flags || {}, skillState: p.skillState || {}, equips: p.equips || {}, judge: p.judge || [], hand: p.hand || [] }));
    this.emitter.emit('change'); this.emitter.emit('log');
  }
  pushFx(e) {
    if (!e) return;
    if (e.name === 'damage') this.emitter.emit('damage', { target: { id: e.targetId }, amount: e.amount, nature: e.nature });
    else this.emitter.emit('fx', e);
  }
  snapshot() { return this._snap; }
  playerById(id) { return this.players.find((p) => p.id === id); }
  get alivePlayers() { return this.players.filter((p) => p.alive); }
  seatRingDistance(a, b) {
    const alive = this.players.filter((p) => p.alive || p === a || p === b);
    const ia = alive.indexOf(a), ib = alive.indexOf(b), n = alive.length;
    const d = Math.abs(ia - ib); return Math.min(d, n - d);
  }
  distance(from, to) {
    if (from === to) return 0;
    let d = this.seatRingDistance(from, to);
    if (to.equips?.plus) d += 1;
    if (from.equips?.minus) d -= 1;
    return Math.max(1, d);
  }
  attackRange(p) { const w = p.equips?.weapon; return w?.range || 1; }
  inAttackRange(from, to) { return this.distance(from, to) <= this.attackRange(from); }
  isAlly() { return false; }
}

// ====================== 请求 / 响应 序列化 ======================
function serializeReq(req) {
  const out = { type: req.type, title: req.title };
  ['count', 'from', 'options', 'visibleCards', 'handChoice', 'cards', 'skill', 'auto', 'needCard', 'kind', 'need', 'forSkill'].forEach((k) => { if (req[k] !== undefined) out[k] = req[k]; });
  if (req.dying) out.dyingId = req.dying.id;
  if (req.target) out.targetId = req.target.id;
  if (req.fromPlayer) out.fromPlayer = req.fromPlayer;
  return out;
}
function hydrateReq(viewEngine, myId, serial) {
  const req = { ...serial, engine: viewEngine, player: viewEngine.playerById(myId) };
  if (serial.dyingId) req.dying = viewEngine.playerById(serial.dyingId);
  return req;
}
function cardToWire(card) {
  if (!card) return null;
  if (card.virtual) return { virtual: true, kind: card.kind, suit: card.suit, number: card.number, red: card.red, src: (card.sourceCards || []).map((c) => c.id) };
  return { id: card.id };
}
function wireToCard(engine, player, wire) {
  if (!wire) return null;
  if (wire.virtual) {
    const src = (wire.src || []).map((id) => findCardOnPlayer(player, id)).filter(Boolean);
    return virtualCard(wire.kind, src, { suit: wire.suit, number: wire.number, red: wire.red });
  }
  if (wire.id) return findCardOnPlayer(player, wire.id);
  return null;
}
function serializeResponse(type, resp) {
  if (!resp) return resp;
  const out = { ...resp };
  if (resp.card && typeof resp.card === 'object') out.card = cardToWire(resp.card);
  return out;
}
function deserializeResponse(engine, playerId, type, wire) {
  if (!wire) return wire;
  const player = engine.playerById(playerId);
  const out = { ...wire };
  if (wire.card && typeof wire.card === 'object') out.card = wireToCard(engine, player, wire.card);
  return out;
}
