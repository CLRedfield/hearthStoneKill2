import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ } from '../src/engine/constants.js';
import { resolveCard } from '../src/engine/effects.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function makeCard(id, number, kind = 'sha', suit = 'spade') {
  const def = CARD_DEFS[kind] || {};
  return {
    id, kind, name: def.name || kind, type: def.type, number, suit,
    red: suit === 'heart' || suit === 'diamond', slot: def.slot, range: def.range,
  };
}

test('唤醒让玩家批量选择点数和至少24的牌', async () => {
  const cards = [makeCard('ten', 10), makeCard('fourteen', 14), makeCard('spare', 8)];
  const player = { id: 'magtheridon', name: '玛瑟里顿', alive: true, hand: [...cards], flags: {}, skillState: {} };
  const enemy = { id: 'enemy', name: '敌人', alive: true };
  let request;
  const discarded = [];
  const engine = {
    alivePlayers: [player, enemy], over: false,
    agentOf() { return { kind: 'human' }; },
    async ask(_owner, req) { request = req; return { selected: ['ten', 'fourteen'] }; },
    discardCards(_owner, chosen) { discarded.push(...chosen); },
    log() {},
    async dealDamage(info) { this.damage = info; },
  };

  await HS_SKILLS.huanxing.triggers.startPhase(engine, { player });

  assert.equal(request.type, REQ.GUANXING);
  assert.equal(request.mode, 'select_cards');
  assert.equal(request.minSum, 24);
  assert.deepEqual(discarded.map((c) => c.id), ['ten', 'fourteen']);
  assert.equal(player.skillState.awake, true);
  assert.equal(engine.damage.target, enemy);
});

test('组合后的低语一次选择三张锦囊牌', async () => {
  const tricks = [
    makeCard('trick1', 3, 'wuzhong'),
    makeCard('trick2', 5, 'guohe'),
    makeCard('trick3', 7, 'juedou'),
  ];
  const player = { id: 'cthun', name: '克苏恩', flags: {}, skillState: { zuheAwake: true }, hand: [] };
  const target = { id: 'target', name: '目标', hand: [...tricks], equips: {} };
  let request;
  const discarded = [];
  const engine = {
    alivePlayers: [player, target], over: false,
    agentOf() { return { kind: 'human' }; },
    async ask(_owner, req) { request = req; return { selected: tricks.map((c) => c.id) }; },
    discardCards(_owner, chosen) { discarded.push(...chosen); },
    log() {},
    async dealDamage(info) { this.damage = info; },
  };

  await HS_SKILLS.diyu.action(engine, { player });

  assert.equal(request.mode, 'select_cards');
  assert.equal(request.minCount, 3);
  assert.equal(request.maxCount, 3);
  assert.deepEqual(discarded.map((c) => c.id), tricks.map((c) => c.id));
  assert.equal(engine.damage, undefined);
});

test('亡语通过一次分配界面交出任意张手牌', async () => {
  const drawn = [makeCard('draw1', 2), makeCard('draw2', 4), makeCard('draw3', 6)];
  const player = { id: 'yogg', name: '尤格萨隆', alive: false, hand: [], flags: {}, skillState: {} };
  const target = { id: 'ally', name: '队友', alive: true, hand: [] };
  const requests = [];
  const engine = {
    alivePlayers: [target], over: false,
    agentOf() { return { kind: 'human' }; },
    drawCards(owner) { owner.hand.push(...drawn); return drawn; },
    async ask(_owner, req) {
      requests.push(req);
      if (req.type === REQ.CHOOSE_OPTION) return { value: target.id };
      return { selected: drawn.map((c) => c.id) };
    },
    playerById(id) { return id === target.id ? target : null; },
    isAlly() { return true; },
    log() {}, changed() {},
  };

  await HS_SKILLS.yawu.triggers.death(engine, { player });

  const selectReq = requests.find((req) => req.mode === 'select_cards');
  assert.equal(selectReq.minCount, 0);
  assert.equal(selectReq.maxCount, drawn.length);
  assert.deepEqual(target.hand.map((c) => c.id), drawn.map((c) => c.id));
  assert.equal(player.hand.length, 0);
});

test('旋转在双栏界面中同时选择获得和交出的牌', async () => {
  const own = makeCard('own', 4);
  const theirs = makeCard('theirs', 9);
  const player = { id: 'silas', name: '希拉斯', flags: {}, hand: [own] };
  const target = { id: 'target', name: '目标', alive: true, hand: [theirs] };
  let request;
  const engine = {
    playerById(id) { return id === target.id ? target : null; },
    agentOf() { return { kind: 'human' }; },
    async ask(_owner, req) { request = req; return { left: theirs.id, right: own.id }; },
    log() {}, changed() {},
  };

  await HS_SKILLS.xuanzhuan.action(engine, { player, move: { targetId: target.id } });

  assert.equal(request.type, REQ.SWAP_CARDS);
  assert.deepEqual(player.hand.map((c) => c.id), [theirs.id]);
  assert.deepEqual(target.hand.map((c) => c.id), [own.id]);
});

test('元素之力用一次多选请求选择至多两名伤害目标', async () => {
  const player = { id: 'brukan', name: '布鲁坎', alive: true, hand: [], equips: {}, hp: 4, maxHp: 4 };
  const targets = ['a', 'b', 'c'].map((id) => ({ id, name: id, alive: true, hand: [], equips: {}, hp: 3, maxHp: 4 }));
  let request;
  const damaged = [];
  const engine = {
    alivePlayers: [player, ...targets], over: false,
    agentOf() { return { kind: 'human' }; },
    async doJudge() { return { suit: 'spade' }; },
    async ask(_owner, req) { request = req; return { ids: ['a', 'b'] }; },
    playerById(id) { return this.alivePlayers.find((p) => p.id === id); },
    isAlly() { return false; },
    log() {},
    async dealDamage(info) { damaged.push(info); },
  };

  await HS_SKILLS.yuansu.triggers.startPhase(engine, { player });

  assert.equal(request.type, REQ.SELECT_PLAYERS);
  assert.equal(request.maxCount, 2);
  assert.deepEqual(damaged.map((x) => x.target.id), ['a', 'b']);
});

test('伦鲁迪洛尔要求一次选择三张不同花色的牌', async () => {
  const hand = [
    makeCard('spade', 2, 'sha', 'spade'),
    makeCard('heart', 3, 'shan', 'heart'),
    makeCard('club', 4, 'sha', 'club'),
    makeCard('diamond', 5, 'shan', 'diamond'),
  ];
  const weapon = makeCard('runblade', 8, 'runblade', 'spade');
  const player = {
    id: 'hunter', name: '猎人', alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [...hand],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
  };
  let request;
  const discarded = [];
  const engine = {
    turnOwner: player, turnUsedCards: [], alivePlayers: [player], over: false, discard: [],
    agentOf() { return { kind: 'human' }; },
    async ask(_owner, req) { request = req; return { selected: ['spade', 'heart', 'club'] }; },
    _handLimitBase() { return 4; },
    equip(owner, card) { owner.equips.weapon = card; },
    discardCards(_owner, cards) { discarded.push(...cards); player.hand = player.hand.filter((c) => !cards.includes(c)); },
    drawCards() { return []; },
    log() {}, fx() {}, changed() {}, pause: async () => {},
  };

  await resolveCard(engine, { user: player, card: weapon, targets: [], options: {} });

  assert.equal(request.mode, 'select_cards');
  assert.equal(request.minCount, 3);
  assert.equal(request.distinctSuits, true);
  assert.deepEqual(discarded.map((c) => c.id), ['spade', 'heart', 'club']);
});