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
  MqttBus, topics, getBroker, BROKER_ALTERNATIVES, PROTOCOL_VERSION, genRoomCode, genClientId,
} from './mqtt.js';

const AI_FILL = ['沧海客', '听雪', '青锋', '踏歌行', '北辰', '醉卧', '孤鸿'];
let BUS = null; // 当前会话的 MQTT 连接
let CHAT = null; // 聊天面板（整局复用，挂在 body 上）
let CONNECTION_BUSY = false;
const ONLINE_SESSION_KEY = 'sgs_online_session_v1';
const ROOM_CODE_RE = /^[A-Z2-9]{6}$/;

export const ONLINE_TIMEOUTS = Object.freeze({
  ready: 16_000,
  presence: 32_000,
  action: 36_000,
});

function loadOnlineSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(ONLINE_SESSION_KEY) || 'null');
    return ROOM_CODE_RE.test(String(value?.code || '')) && validPlayerId(value?.myId) ? value : null;
  } catch (e) { return null; }
}

function storeOnlineSession(value) {
  try { sessionStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(value)); } catch (e) {}
}

function forgetOnlineSession() {
  try { sessionStorage.removeItem(ONLINE_SESSION_KEY); } catch (e) {}
}

function cleanName(value, fallback = '玩家') {
  const name = typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16) : '';
  return name || fallback;
}

function validPlayerId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(value);
}

function normalizeBroker(value) {
  try {
    const raw = String(value || '').trim();
    if (raw.length > 240) return null;
    const url = new URL(raw);
    if (url.protocol !== 'wss:' || url.username || url.password) return null;
    return url.toString().replace(/\/$/, '');
  } catch (e) { return null; }
}

function validRoomDoc(value, code) {
  if (!value || value.code !== code || !ROOM_CODE_RE.test(code) || value.protocolVersion !== PROTOCOL_VERSION) return false;
  if (typeof value.roomEpoch !== 'string' || !/^[a-zA-Z0-9_-]{6,48}$/.test(value.roomEpoch)) return false;
  if (!validPlayerId(value.hostId) || !['waiting', 'playing', 'closed'].includes(value.status)) return false;
  if (![MODE.ZHANGZHENG, MODE.DUEL2V2, MODE.SOLO].includes(value.mode)) return false;
  if (!Number.isInteger(value.count) || value.count < 2 || value.count > 8) return false;
  if (!Array.isArray(value.players) || value.players.length > 12) return false;
  const ids = new Set();
  for (const player of value.players) {
    if (!player || !validPlayerId(player.id) || ids.has(player.id) || typeof player.name !== 'string' || player.name.length > 32) return false;
    if (player.seat != null && (!Number.isInteger(player.seat) || player.seat < 0 || player.seat > 7)) return false;
    ids.add(player.id);
  }
  if (!ids.has(value.hostId)) return false;
  if (value.status === 'playing' && (typeof value.gameId !== 'string' || value.gameId.length > 48)) return false;
  return value.revision == null || (Number.isSafeInteger(value.revision) && value.revision >= 0);
}
function brokerCandidates(preferred, exact = false) {
  const first = normalizeBroker(preferred);
  const list = exact ? [first] : [first, BUS?.broker, getBroker(), ...BROKER_ALTERNATIVES];
  return list.map(normalizeBroker).filter((url, i, all) => url && all.indexOf(url) === i);
}

async function connectBroker(broker) {
  const target = normalizeBroker(broker);
  if (!target) throw new Error('服务器地址无效，仅支持 wss://');
  if (BUS?.broker === target && BUS.connected) return BUS;
  const next = new MqttBus(target);
  try { await next.connect(); }
  catch (e) { next.end(); throw e; }
  const previous = BUS;
  BUS = next;
  if (previous && previous !== next) previous.end();
  return next;
}

async function connectFirst(candidates) {
  let lastError = null;
  for (const broker of candidates) {
    toast(`正在连接 ${broker.replace('wss://', '').replace('/mqtt', '')}…`);
    try { return await connectBroker(broker); }
    catch (e) { lastError = e; }
  }
  throw lastError || new Error('没有可用的联机服务器');
}

function parseJoinInput(raw) {
  const value = String(raw || '').trim();
  const direct = value.toUpperCase();
  if (ROOM_CODE_RE.test(direct)) return { code: direct, broker: null };
  try {
    const url = new URL(value, location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const code = String(url.searchParams.get('room') || hash.get('room') || '').toUpperCase();
    const broker = normalizeBroker(url.searchParams.get('broker') || hash.get('broker'));
    return ROOM_CODE_RE.test(code) ? { code, broker } : null;
  } catch (e) { return null; }
}

function roomInvite(code) {
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('broker');
  url.hash = new URLSearchParams({ room: code, broker: BUS?.broker || getBroker() }).toString();
  return url.toString();
}

function clearRoomInvite() {
  try {
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (!url.searchParams.has('room') && !hash.has('room')) return;
    url.searchParams.delete('room');
    url.searchParams.delete('broker');
    url.hash = '';
    history.replaceState(null, '', url.toString());
  } catch (e) {}
}

async function locateRoom(code, preferredBroker = null, exactBroker = false) {
  let lastError = null;
  for (const broker of brokerCandidates(preferredBroker, exactBroker)) {
    try {
      await connectBroker(broker);
      const T = topics(code);
      const [room, heartbeat] = await Promise.all([
        BUS.waitFor(T.lobby, 1600, { qos: 1 }),
        BUS.waitFor(T.hostHeartbeat, 1600, { qos: 0 }),
      ]);
      const heartbeatAge = Date.now() - Number(heartbeat?.ts || 0);
      const hostAlive = heartbeat?.v === PROTOCOL_VERSION && heartbeat.roomEpoch === room?.roomEpoch
        && heartbeat.hostId === room?.hostId && heartbeat.status === 'online'
        && heartbeatAge >= -300000 && heartbeatAge <= 30000;
      if (validRoomDoc(room, code) && room.status !== 'closed' && hostAlive) return { room, broker };
    } catch (e) { lastError = e; }
  }
  if (lastError && !BUS?.connected) throw lastError;
  return null;
}
// 刷新后只恢复原 broker 上已确认存在的房间；邀请链接也可直接加入。
export async function resumeOnlineSession(lobby) {
  if (CONNECTION_BUSY) return false;
  const saved = loadOnlineSession();
  const invite = !saved ? parseJoinInput(location.href) : null;
  if (!saved && !invite) return false;
  CONNECTION_BUSY = true;
  const code = saved?.code || invite.code;
  toast(`${saved ? '正在重新连接' : '正在加入'}房间 ${code}…`);
  try {
    if (saved?.isHost) {
      await connectFirst(brokerCandidates(saved.broker || getBroker(), true));
      enterRoom(lobby, code, saved.myId, true, saved.cfg || null, saved.room || null);
    } else {
      const broker = saved?.broker || invite?.broker || null;
      const found = await locateRoom(code, broker, !!broker);
      if (!found) throw new Error('房间不存在，或房主已离线');
      enterRoom(lobby, code, saved?.myId || genClientId(), false, null, found.room);
    }
    toast(`已连接房间 ${code}`, 'info', 1800);
    return true;
  } catch (e) {
    if (saved) forgetOnlineSession();
    if (invite) clearRoomInvite();
    BUS?.end(); BUS = null;
    toast('自动重连失败：' + (e?.message || '请稍后重试'), 'error', 4000);
    return false;
  } finally { CONNECTION_BUSY = false; }
}

// ---------- 入口 ----------
export async function startOnlineFlow(lobby) {
  if (CONNECTION_BUSY) return toast('联机连接正在进行，请稍候');
  CONNECTION_BUSY = true;
  try {
    const preferred = await promptConnect();
    if (preferred === null) return;
    await connectFirst(brokerCandidates(preferred));
    toast('联机服务器已连接 ✓', 'info', 1200);
    promptCreateOrJoin(lobby);
  } catch (e) {
    toast('所有公共服务器均连接失败：' + (e?.message || '请检查网络后重试'), 'error', 5000);
  } finally { CONNECTION_BUSY = false; }
}

function promptConnect() {
  return new Promise((resolve) => {
    const input = el('input', { class: 'name-input', value: getBroker(), placeholder: 'MQTT broker 地址' });
    const alts = el('div', { class: 'broker-alts' }, BROKER_ALTERNATIVES.map((u) =>
      el('button', { class: 'broker-alt', text: u.replace('wss://', '').replace('/mqtt', ''), onclick: () => { input.value = u; } })
    ));
    const body = el('div', { class: 'env-body' }, [
      el('p', { class: 'env-hint', text: '选择首选公共服务器；房间邀请会记录实际线路，好友无需猜服务器。' }),
      input,
      el('div', { class: 'broker-label', text: '备用服务器：' }), alts,
    ]);
    let ov;
    ov = openOverlay({
      title: '进入联机大厅', bodyNode: body,
      buttons: [
        { label: '智能连接', primary: true, onClick: () => { const v = normalizeBroker(input.value); if (!v) return toast('请输入有效的 wss:// 服务器地址'); ov.close(); resolve(v); } },
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
  let code = null;
  for (let i = 0; i < 8; i++) {
    const candidate = genRoomCode();
    const existing = await BUS.waitFor(topics(candidate).lobby, 550, { qos: 1 });
    if (!existing || existing.status === 'closed') { code = candidate; break; }
  }
  if (!code) return toast('暂时无法分配房间号，请重试', 'error', 3500);
  enterRoom(lobby, code, genClientId(), true, cfg);
}

async function joinRoomFlow(lobby) {
  const invite = await promptRoomCode();
  if (!invite) return;
  toast(`正在查找房间 ${invite.code}…`);
  try {
    const found = await locateRoom(invite.code, invite.broker, !!invite.broker);
    if (!found) return toast('未找到房间；请让房主重新复制完整邀请链接', 'error', 4500);
    enterRoom(lobby, invite.code, genClientId(), false, null, found.room);
  } catch (e) { toast('加入失败：' + (e?.message || '网络异常'), 'error', 4500); }
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
    const input = el('input', { class: 'name-input', placeholder: '粘贴邀请链接，或输入 6 位房间号', maxlength: '512' });
    let ov = openOverlay({
      title: '加入房间', bodyNode: input,
      buttons: [
        { label: '加入', primary: true, onClick: () => { const value = parseJoinInput(input.value); if (!value) return toast('请输入正确的邀请链接或 6 位房间号'); ov.close(); resolve(value); } },
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

async function copyRoomInvite(code) {
  const invite = roomInvite(code);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(invite);
    toast('完整邀请链接已复制');
  } catch (e) {
    window.prompt('复制完整邀请链接', invite);
  }
}
function enterRoom(lobby, code, myId, isHost, cfg, initialRoom = null) {
  const T = topics(code);
  const epoch = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const freshHostRoom = {
    protocolVersion: PROTOCOL_VERSION, roomEpoch: epoch, revision: 0,
    code, mode: cfg?.mode || MODE.ZHANGZHENG, count: cfg?.count || 5, pack: cfg?.pack || PACK.SGS,
    hostId: myId, players: [{ id: myId, name: cleanName(lobby.name, '房主'), seat: 0, online: true }],
    status: 'waiting', aiDifficulty: 'normal',
  };
  let room = isHost
    ? (initialRoom?.code === code ? initialRoom : freshHostRoom)
    : (validRoomDoc(initialRoom, code) ? initialRoom : { protocolVersion: PROTOCOL_VERSION, roomEpoch: null, revision: 0, code, players: [], count: 0, mode: '', pack: PACK.SGS, status: 'waiting', hostId: null, aiDifficulty: 'normal' });
  const interruptedGame = isHost && room.status === 'playing';
  if (isHost) {
    room.protocolVersion = PROTOCOL_VERSION;
    room.roomEpoch = room.roomEpoch || epoch;
    room.revision = Number.isInteger(room.revision) ? room.revision : 0;
    room.hostId = myId;
    const host = (room.players || (room.players = [])).find((p) => p.id === myId);
    if (host) { host.name = cleanName(lobby.name, host.name || '房主'); host.online = true; }
    else room.players.unshift({ id: myId, name: cleanName(lobby.name, '房主'), seat: 0, online: true });
    if (room.status === 'playing') { room.status = 'waiting'; delete room.spectators; delete room.gameId; }
  }
  ensureRoomSeats(room);
  if (interruptedGame) {
    (room.players || []).forEach((p) => { BUS.clearRetained(T.state(p.id)); BUS.clearRetained(T.req(p.id)); });
    BUS.clearRetained(T.spec);
  }

  let started = false;
  let screen = null;
  let selectedSeat = null;
  let wasIn = !isHost && (room.players || []).some((p) => p.id === myId);
  let gameCleanup = [];
  let roomCleanup = [];
  let exiting = false;
  let netStatus = BUS.connected ? 'connect' : 'reconnect';
  let roomSeen = isHost || validRoomDoc(initialRoom, code);
  let lastRoomRevision = Number.isInteger(room.revision) ? room.revision : -1;
  let lastHostHeartbeat = Date.now();
  const presenceSeen = new Map((room.players || []).map((p) => [p.id, Date.now()]));
  const rememberSession = () => storeOnlineSession({
    code, myId, isHost, broker: BUS?.broker || getBroker(), name: cleanName(lobby.name),
    cfg: { mode: room.mode || cfg?.mode, count: room.count || cfg?.count, pack: room.pack || cfg?.pack || PACK.SGS },
    room: isHost ? room : null,
  });
  const messageBase = () => ({ v: PROTOCOL_VERSION, roomEpoch: room.roomEpoch });
  const sendReady = () => {
    if (!isHost && room.gameId) BUS.pub(T.ready, { ...messageBase(), playerId: myId, gameId: room.gameId }, { qos: 1 });
  };
  const sendPresence = () => {
    if (!isHost && room.roomEpoch) BUS.pub(T.presence, { ...messageBase(), id: myId, ts: Date.now() }, { qos: 0 });
  };
  rememberSession();

  if (!CHAT) CHAT = new ChatBox(BUS, code, { id: myId, name: cleanName(lobby.name) }, {
    getRoomEpoch: () => room.roomEpoch,
    isMember: (id) => room.players?.some((p) => p.id === id),
  });

  const publishLobby = () => {
    if (!isHost) return;
    ensureRoomSeats(room);
    room.protocolVersion = PROTOCOL_VERSION;
    room.revision = (Number.isInteger(room.revision) ? room.revision : 0) + 1;
    lastRoomRevision = room.revision;
    rememberSession();
    BUS.pub(T.lobby, room, { retain: true });
  };
  const publishHostHeartbeat = (status = 'online') => {
    if (isHost) BUS.pub(T.hostHeartbeat, { ...messageBase(), hostId: myId, status, ts: Date.now() }, { qos: 0, retain: true });
  };
  const sendJoin = () => {
    rememberSession();
    BUS.pub(T.join, { ...messageBase(), id: myId, name: cleanName(lobby.name) }, { qos: 1 });
  };
  const cleanupGame = () => { gameCleanup.forEach((fn) => { try { fn(); } catch (e) {} }); gameCleanup = []; };
  const cleanupRoom = () => { roomCleanup.forEach((fn) => { try { fn(); } catch (e) {} }); roomCleanup = []; };

  BUS.onStatus((s) => {
    netStatus = s;
    CHAT?.setStatus(s);
    if (s === 'offline') toast('⚠ 连接断开，正在自动重连…', 'error', 2500);
    else if (s === 'connect') {
      toast('✓ 联机已恢复', 'info', 1500);
      if (isHost) { publishHostHeartbeat(); publishLobby(); }
      else { sendPresence(); if (!started) sendJoin(); else sendReady(); }
    }
    if (!started && screen) render(room);
  });

  const exitRoom = async () => {
    if (exiting) return;
    exiting = true;
    cleanupGame();
    if (isHost) {
      room.status = 'closed';
      publishLobby();
      publishHostHeartbeat('closed');
      await new Promise((resolve) => setTimeout(resolve, 180));
      await Promise.all([BUS.clearRetained(T.lobby), BUS.clearRetained(T.hostHeartbeat)]);
    } else if (room.roomEpoch) {
      BUS.pub(T.leave, { ...messageBase(), id: myId }, { qos: 1 });
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    cleanupRoom();
    forgetOnlineSession();
    clearRoomInvite();
    CHAT?.destroy?.(); CHAT = null;
    BUS?.end(); BUS = null;
    location.reload();
  };

  const showRoom = () => {
    cleanupGame();
    started = false;
    clear(lobby.root);
    screen = el('div', { class: 'room-screen' });
    lobby.root.appendChild(screen);
    render(room);
  };

  const backToRoom = () => {
    (room.players || []).forEach((p) => { BUS.clearRetained(T.state(p.id)); BUS.clearRetained(T.req(p.id)); });
    BUS.clearRetained(T.spec);
    room.status = 'waiting'; delete room.spectators; delete room.gameId; selectedSeat = null; started = false;
    publishLobby(); showRoom();
  };

  const startHostGame = async () => {
    if (started) return;
    const cap = roomCapacity(room);
    const seatHumans = playersBySeat(room);
    if (!seatHumans.some((p) => p?.id === myId)) return toast('房主需要先坐入任意一个参战座位', 'error');
    started = true;
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
    (room.players || []).forEach((p) => { BUS.clearRetained(T.state(p.id)); BUS.clearRetained(T.req(p.id)); });
    BUS.clearRetained(T.spec);
    room.gameId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

    const engine = new GameEngine({ mode: room.mode, seats, pack: room.pack || PACK.SGS });
    const ui = mountHostGame(lobby.root, engine, myId, {
      rematch: { label: '返回房间', fn: backToRoom },
      exitAction: exitRoom, exitLabel: '关闭房间并退出', exitConfirm: '确定关闭联机房间并退出？当前对局将结束。',
    });
    gameCleanup.push(() => ui.destroy?.());
    const hub = new MqttHostHub(code, engine, myId, spectators.length > 0, room.gameId, room.roomEpoch,
      (playerId) => room.players?.find((p) => p.id === playerId)?.online !== false);
    engine.agents = {};
    for (const s of seats) {
      if (s.id === myId) engine.agents[s.id] = new HumanAgent(ui);
      else if (s.isHuman) engine.agents[s.id] = new RemoteAgent(hub, s.id);
      else engine.agents[s.id] = new AIAgent({ chaos: AI_CHAOS[s._diff] ?? AI_CHAOS.normal });
    }
    hub.start();
    gameCleanup.push(() => hub.stop());
    room.status = 'playing'; room.spectators = spectators.map((p) => p.id);
    publishLobby();

    const remoteIds = seats.filter((s) => s.isHuman && s.id !== myId && room.players?.find((p) => p.id === s.id)?.online !== false).map((s) => s.id);
    if (remoteIds.length) toast('等待其他玩家进入对局…', 'info', 1800);
    const missing = await hub.waitForReady(remoteIds, ONLINE_TIMEOUTS.ready);
    if (missing.length) toast('部分玩家尚未进入，暂由 AI 接管其操作', 'error', 3000);
    if (!started || room.status !== 'playing') return;
    engine.run().catch((e) => { console.error(e); toast('对局错误', 'error'); });
  };

  const enterClientGame = () => {
    started = true;
    const cap = roomCapacity(room);
    const own = (room.players || []).find((p) => p.id === myId);
    const spectator = !own || !Number.isInteger(own.seat) || own.seat < 0 || own.seat >= cap;
    const vid = spectator ? '__spectator__' : myId;
    const viewEngine = new ViewEngine(vid, room.gameId);
    const ui = new GameUI(viewEngine, vid, {
      spectator, exitAction: exitRoom, exitLabel: '退出联机房间', exitConfirm: '确定退出联机房间？',
    });
    const human = spectator ? null : new HumanAgent(ui);
    clear(lobby.root);
    const gameRoot = el('div', { class: 'game-root' });
    lobby.root.appendChild(gameRoot);
    ui.mountInto(gameRoot);
    gameCleanup.push(() => ui.destroy?.());
    toast(spectator ? '你正在观战' : '已进入对局');
    gameCleanup.push(BUS.sub(spectator ? T.spec : T.state(myId), (doc) => {
      if (doc?.v !== PROTOCOL_VERSION || doc.gameId !== room.gameId) return;
      viewEngine.updateEnvelope(doc);
    }, { qos: 0 }));
    gameCleanup.push(BUS.sub(T.fx, (doc) => {
      if (doc?.v !== PROTOCOL_VERSION || doc.gameId !== room.gameId) return;
      viewEngine.pushFx(doc.event);
    }, { qos: 0 }));
    if (!spectator) {
      const handled = new Set();
      gameCleanup.push(BUS.sub(T.req(myId), async (req) => {
        if (req?.v !== PROTOCOL_VERSION || req.gameId !== room.gameId || !req.reqId || handled.has(req.reqId) || typeof req.type !== 'string') return;
        handled.add(req.reqId);
        if (handled.size > 240) handled.delete(handled.values().next().value);
        const localReq = hydrateReq(viewEngine, myId, req);
        try {
          const resp = await human.respond(localReq);
          BUS.pub(T.act, { ...messageBase(), gameId: room.gameId, reqId: req.reqId, playerId: myId, response: serializeResponse(req.type, resp) }, { qos: 1 });
        } catch (e) {
          console.error('client respond', e);
          BUS.pub(T.act, { ...messageBase(), gameId: room.gameId, reqId: req.reqId, playerId: myId, response: null }, { qos: 1 });
        }
      }, { qos: 1 }));
      sendReady();
    }
  };

  const render = (r) => {
    ensureRoomSeats(r);
    const cap = roomCapacity(r);
    const seatHumans = playersBySeat(r);
    const specHumans = spectatorPlayers(r);
    const aiDiffs = r.aiDifficulties || {};
    const seats = [];
    for (let i = 0; i < cap; i++) {
      const p = seatHumans[i];
      if (p) seats.push({ name: p.name, kind: 'human', tag: p.id === r.hostId ? '房主' : (p.id === myId ? '你' : ''), isYou: p.id === myId, offline: p.online === false });
      else seats.push({ name: 'AI 补位', kind: 'empty', tag: '空位', aiDifficulty: aiDiffs[i] || 'normal' });
    }
    const spectators = specHumans.map((p) => ({ name: p.name, isYou: p.id === myId, offline: p.online === false }));
    const amSpec = specHumans.some((p) => p.id === myId);
    const allowSeatChange = !!r.allowSeatChange;
    const state = {
      code, mode: r.mode || MODE.ZHANGZHENG, count: r.count || 5, seats, spectators, pack: r.pack || PACK.SGS,
      isLocal: false, canEdit: isHost,
      canSwap: isHost || allowSeatChange, canKick: isHost,
      connectionStatus: netStatus,
      showSeatChangeToggle: isHost, allowSeatChange,
      selectedSeat: isHost ? selectedSeat : null,
      waitingNote: netStatus === 'host-offline' ? '房主连接中断，正在等待恢复…' : (amSpec ? '名额已满，你将作为观战者进入' : '等待房主开始…'),
    };
    const h = {
      onCopyCode: () => copyRoomInvite(code),
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
            { label: '确定移出', danger: true, onClick: () => { ov.close(); const j = room.players.findIndex((x) => x.id === p.id); if (j >= 0) { room.players.splice(j, 1); presenceSeen.delete(p.id); selectedSeat = null; publishLobby(); render(room); toast(`已移出 ${p.name}`); } } },
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
          BUS.pub(T.move, { ...messageBase(), id: myId, toIndex: i }, { qos: 1 });
          toast(`已申请换到 #${i + 1}…`);
        }
      },
      onSeatSwap: (a, b) => {
        if (a === b) return;
        if (isHost) {
          if (seats[a]?.kind !== 'human' || !swapRoomSeat(room, a, b)) return;
          selectedSeat = null; publishLobby(); render(room);
        } else if (allowSeatChange && seats[a]?.isYou) {
          BUS.pub(T.move, { ...messageBase(), id: myId, toIndex: b }, { qos: 1 });
          toast(`已申请换到 #${b + 1}…`);
        }
      },
      onStart: () => startHostGame(),
      onExit: () => exitRoom(),
    };
    renderRoomView(screen, state, h);
  };

  if (isHost) {
    roomCleanup.push(BUS.sub(T.join, (msg) => {
      if (room.status !== 'waiting' || msg?.v !== PROTOCOL_VERSION || msg.roomEpoch !== room.roomEpoch || !validPlayerId(msg.id)) return;
      const existing = room.players.find((p) => p.id === msg.id);
      if (existing) {
        existing.name = cleanName(msg.name, existing.name);
        existing.online = true;
        presenceSeen.set(existing.id, Date.now());
        publishLobby(); if (!started) render(room); return;
      }
      if (room.players.length >= MAX_ROOM) return;
      const seat = firstOpenSeat(room);
      const player = { id: msg.id, name: cleanName(msg.name), seat: seat >= 0 ? seat : null, online: true };
      room.players.push(player);
      presenceSeen.set(player.id, Date.now());
      publishLobby(); render(room);
      toast(`${player.name} ${seat >= 0 ? `加入了 #${seat + 1}` : '进入观战席'}`);
    }));
    roomCleanup.push(BUS.sub(T.move, (msg) => {
      if (!room.allowSeatChange || room.status !== 'waiting' || msg?.v !== PROTOCOL_VERSION || msg.roomEpoch !== room.roomEpoch || !validPlayerId(msg.id)) return;
      const moving = room.players.find((p) => p.id === msg.id);
      if (!swapRoomSeat(room, moving?.seat, msg.toIndex)) return;
      publishLobby(); render(room);
    }));
    roomCleanup.push(BUS.sub(T.presence, (msg) => {
      if (msg?.v !== PROTOCOL_VERSION || msg.roomEpoch !== room.roomEpoch || !validPlayerId(msg.id)) return;
      const player = room.players.find((p) => p.id === msg.id);
      if (!player || player.id === room.hostId) return;
      presenceSeen.set(player.id, Date.now());
      if (player.online === false) { player.online = true; publishLobby(); if (!started) render(room); toast(`${player.name} 已重新连接`); }
    }, { qos: 0 }));
    roomCleanup.push(BUS.sub(T.leave, (msg) => {
      if (msg?.v !== PROTOCOL_VERSION || msg.roomEpoch !== room.roomEpoch || !validPlayerId(msg.id) || msg.id === room.hostId) return;
      const index = room.players.findIndex((p) => p.id === msg.id);
      if (index < 0) return;
      const player = room.players[index];
      presenceSeen.delete(player.id);
      if (room.status === 'waiting') room.players.splice(index, 1);
      else player.online = false;
      publishLobby(); if (!started) render(room);
      toast(`${player.name} 已离开房间`);
    }));
    const heartbeatTimer = setInterval(() => publishHostHeartbeat(), 4000);
    const presenceTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (let i = room.players.length - 1; i >= 0; i--) {
        const player = room.players[i];
        if (player.id === room.hostId) continue;
        const seen = presenceSeen.get(player.id) || 0;
        const online = now - seen <= ONLINE_TIMEOUTS.presence;
        if (player.online !== online) { player.online = online; changed = true; if (!online) toast(`${player.name} 已掉线，操作将由 AI 接管`, 'error', 2600); }
        if (room.status === 'waiting' && !online && now - seen > 90000) { room.players.splice(i, 1); presenceSeen.delete(player.id); changed = true; }
      }
      if (changed) { publishLobby(); if (!started) render(room); }
    }, 4000);
    roomCleanup.push(() => clearInterval(heartbeatTimer), () => clearInterval(presenceTimer));
    showRoom();
    publishHostHeartbeat();
    publishLobby();
  } else {
    roomCleanup.push(BUS.sub(T.hostHeartbeat, (doc) => {
      if (doc?.v !== PROTOCOL_VERSION || doc.roomEpoch !== room.roomEpoch || doc.hostId !== room.hostId) return;
      if (doc.status === 'closed') return;
      lastHostHeartbeat = Date.now();
      if (BUS.connected && netStatus === 'host-offline') { netStatus = 'connect'; CHAT?.setStatus('connect'); if (!started && screen) render(room); }
    }, { qos: 0 }));
    roomCleanup.push(BUS.sub(T.lobby, (r) => {
      if (!validRoomDoc(r, code) || (room.roomEpoch && r.roomEpoch !== room.roomEpoch)) return;
      if (Number.isInteger(r.revision) && r.revision < lastRoomRevision) return;
      lastRoomRevision = Number.isInteger(r.revision) ? r.revision : lastRoomRevision;
      roomSeen = true;
      ensureRoomSeats(r);
      room = r;
      rememberSession();
      if (r.status === 'closed') {
        toast('房主已关闭房间', 'error', 2500);
        forgetOnlineSession(); clearRoomInvite(); cleanupGame(); cleanupRoom(); CHAT?.destroy?.(); CHAT = null; BUS?.end(); BUS = null;
        setTimeout(() => location.reload(), 1600);
        return;
      }
      const inRoom = (r.players || []).some((p) => p.id === myId);
      if (wasIn && !inRoom && r.status === 'waiting') {
        wasIn = false;
        toast('你已被房主移出房间', 'error', 2500);
        forgetOnlineSession(); clearRoomInvite(); cleanupGame(); cleanupRoom(); CHAT?.destroy?.(); CHAT = null; BUS?.end(); BUS = null;
        setTimeout(() => location.reload(), 1800);
        return;
      }
      if (inRoom) wasIn = true;
      if (r.status === 'playing' && !started) { enterClientGame(); return; }
      if (r.status === 'waiting' && started) { showRoom(); return; }
      if (r.status === 'waiting' && screen) render(r);
    }));
    const presenceTimer = setInterval(sendPresence, 4000);
    const hostTimer = setInterval(() => {
      if (BUS.connected && Date.now() - lastHostHeartbeat > ONLINE_TIMEOUTS.presence && netStatus !== 'host-offline') {
        netStatus = 'host-offline'; CHAT?.setStatus('host-offline'); toast('房主连接中断，正在等待恢复…', 'error', 3000);
        if (!started && screen) render(room);
      }
    }, 4000);
    roomCleanup.push(() => clearInterval(presenceTimer), () => clearInterval(hostTimer));
    sendJoin(); sendPresence();
    setTimeout(() => { if (!wasIn && !exiting) sendJoin(); }, 1600);
    setTimeout(() => {
      if (!wasIn && !exiting) {
        exiting = true;
        toast(roomSeen ? '房间已满或加入请求未被接受，即将返回大厅' : '房间已失效，即将返回大厅', 'error', 4200);
        forgetOnlineSession(); clearRoomInvite(); cleanupRoom(); CHAT?.destroy?.(); CHAT = null; BUS?.end(); BUS = null;
        setTimeout(() => location.reload(), 1800);
      }
    }, 6500);
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
  constructor(code, engine, hostId, hasSpectators = false, gameId = null, roomEpoch = null, isPlayerOnline = null) {
    this.T = topics(code);
    this.engine = engine;
    this.hostId = hostId;
    this.hasSpectators = hasSpectators;
    this.gameId = gameId;
    this.roomEpoch = roomEpoch;
    this.isPlayerOnline = isPlayerOnline || (() => true);
    this.reqSeq = 0;
    this.stateSeq = 0;
    this.pending = new Map();
    this.readyPlayers = new Set();
    this.failedPlayers = new Set();
    this._timer = null;
    this._dirty = false;
    this._unsubs = [];
    this.stopped = false;
  }
  base() { return { v: PROTOCOL_VERSION, roomEpoch: this.roomEpoch, gameId: this.gameId }; }
  start() {
    this._unsubs.push(this.engine.on('change', () => this.scheduleBroadcast()));
    this._unsubs.push(this.engine.on('fx', (event) => BUS.pub(this.T.fx, { ...this.base(), event }, { qos: 0 })));
    this._unsubs.push(this.engine.on('damage', (e) => BUS.pub(this.T.fx, { ...this.base(), event: { name: 'damage', targetId: e.target.id, amount: e.amount, nature: e.nature } }, { qos: 0 })));
    this._unsubs.push(BUS.sub(this.T.act, (doc) => this.onAction(doc)));
    this._unsubs.push(BUS.sub(this.T.ready, (doc) => {
      if (doc?.v !== PROTOCOL_VERSION || doc.roomEpoch !== this.roomEpoch || doc.gameId !== this.gameId || !validPlayerId(doc.playerId)) return;
      if (!this.engine.players.some((p) => p.isHuman && p.id === doc.playerId)) return;
      this.readyPlayers.add(doc.playerId);
      this.failedPlayers.delete(doc.playerId);
    }));
    this.scheduleBroadcast();
  }
  stop() {
    this.stopped = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
    for (const pending of this.pending.values()) { BUS.clearRetained(this.T.req(pending.playerId)); pending.d.resolve(null); }
    this.pending.clear();
  }
  async waitForReady(playerIds, timeoutMs = ONLINE_TIMEOUTS.ready) {
    const deadline = Date.now() + timeoutMs;
    let missing = playerIds.filter((id) => !this.readyPlayers.has(id));
    while (missing.length && Date.now() < deadline && !this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      missing = playerIds.filter((id) => !this.readyPlayers.has(id));
    }
    missing.forEach((id) => this.failedPlayers.add(id));
    return missing;
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
    const stateSeq = ++this.stateSeq;
    for (const p of this.engine.players) {
      if (p.isHuman && p.id !== this.hostId) {
        BUS.pub(this.T.state(p.id), { ...this.base(), stateSeq, snapshot: this.engine.snapshot(p.id) }, { qos: 0, retain: true });
      }
    }
    if (this.hasSpectators) BUS.pub(this.T.spec, { ...this.base(), stateSeq, snapshot: this.engine.snapshot('__spectator__') }, { qos: 0, retain: true });
  }
  async request(playerId, serialReq) {
    if (this.stopped || this.failedPlayers.has(playerId) || !this.isPlayerOnline(playerId)) return null;
    const reqId = `${this.gameId}:${++this.reqSeq}`;
    const d = deferred();
    this.pending.set(reqId, { d, playerId });
    BUS.pub(this.T.req(playerId), { ...this.base(), reqId, ...serialReq }, { qos: 1, retain: true });
    const timer = setTimeout(() => {
      const pending = this.pending.get(reqId);
      if (pending) {
        this.pending.delete(reqId);
        this.failedPlayers.add(playerId);
        pending.d.resolve(null);
      }
    }, ONLINE_TIMEOUTS.action);
    const result = await d.promise;
    clearTimeout(timer);
    await BUS.clearRetained(this.T.req(playerId));
    return result;
  }
  onAction(doc) {
    if (doc?.v !== PROTOCOL_VERSION || doc.roomEpoch !== this.roomEpoch || doc.gameId !== this.gameId || !validPlayerId(doc.playerId)) return;
    this.failedPlayers.delete(doc.playerId);
    const pending = this.pending.get(doc.reqId);
    if (!pending || doc.playerId !== pending.playerId) return;
    this.pending.delete(doc.reqId);
    pending.d.resolve({ received: true, response: doc.response ?? null });
  }
}

class RemoteAgent {
  constructor(hub, playerId) {
    this.hub = hub;
    this.playerId = playerId;
    this.kind = 'remote';
    this.fallback = new AIAgent({ chaos: AI_CHAOS.normal });
  }
  async respond(req) {
    const result = await this.hub.request(this.playerId, serializeReq(req));
    if (!result?.received) return this.fallback.respond(req);
    return deserializeResponse(this.hub.engine, this.playerId, req.type, result.response);
  }
}

// 客户端轻量引擎视图
class ViewEngine {
  constructor(viewerId, gameId = null) {
    this.viewerId = viewerId;
    this.gameId = gameId;
    this.stateSeq = -1;
    this._snap = { players: [], logs: [] };
    this.emitter = new Emitter();
    this.mode = null;
    this.players = [];
  }
  on(ev, fn) { return this.emitter.on(ev, fn); }
  get discard() { return this._snap.discard || []; }
  updateEnvelope(doc) {
    if (!doc || doc.gameId !== this.gameId || !Number.isInteger(doc.stateSeq) || doc.stateSeq <= this.stateSeq) return;
    this.stateSeq = doc.stateSeq;
    this.update(doc.snapshot);
  }
  update(snap) {
    if (!snap || !Array.isArray(snap.players)) return;
    this._snap = snap;
    this.mode = snap.mode;
    this.players = snap.players.map((p) => ({ ...p, skills: p.skills || [], flags: p.flags || {}, skillState: p.skillState || {}, resourceState: p.resourceState || {}, equips: p.equips || {}, judge: p.judge || [], pile: p.pile || [], hand: p.hand || [] }));
    this.emitter.emit('change'); this.emitter.emit('log');
  }
  pushFx(e) {
    if (!e || typeof e.name !== 'string') return;
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
[
    'count', 'from', 'options', 'visibleCards', 'handChoice', 'cards', 'mode',
    'minCount', 'maxCount', 'minSum', 'multipleOf', 'distinctSuits',
    'hint', 'selectedLabel', 'availableLabel', 'confirmLabel', 'cancelLabel',
    'players', 'leftCards', 'rightCards', 'leftLabel', 'rightLabel',
    'skill', 'auto', 'needCard', 'kind', 'need', 'forSkill',
  ].forEach((k) => { if (req[k] !== undefined) out[k] = req[k]; });
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
  if (wire.id) return findCardOnPlayer(player, wire.id) || (player.pile || []).find((c) => c.id === wire.id);
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
