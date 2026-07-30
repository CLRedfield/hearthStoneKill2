import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { MODE, TEAM } from '../src/engine/constants.js';
import { GameEngine } from '../src/engine/game.js';
import { activeSkillOptions } from '../src/engine/responses.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function card(id, kind = 'sha') {
  const def = CARD_DEFS[kind];
  return { id, kind, name: def.name, type: def.type, suit: 'spade', number: 2, red: false };
}

function player(id, { hp = 4, maxHp = 4, hand = [] } = {}) {
  return {
    id, name: id, alive: true, hp, maxHp, team: TEAM.A,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [...hand],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

test('终结以目标当前生命值造成强制伤害，且空场条件无论是否满足都摸一张牌', async () => {
  const mech = player('mechcthun', { hp: 2, maxHp: 3 });
  const victim = player('victim', { hp: 3, maxHp: 5 });
  victim.team = TEAM.B;
  const order = [];
  const damageCalls = [];
  let draws = 0;
  const engine = {
    alivePlayers: [mech, victim],
    isAlly(a, b) { return a.team === b.team; },
    async dealDamage(data) { damageCalls.push(data); order.push('damage'); },
    drawCards(target, count) { draws += count; target.hand.push(card(`draw-${draws}`)); order.push('draw'); },
    log() {},
  };

  await HS_SKILLS.zhongjie.triggers.damaged(engine, { player: mech });

  assert.equal(damageCalls.length, 1);
  assert.equal(damageCalls[0].source, mech);
  assert.equal(damageCalls[0].target, victim);
  assert.equal(damageCalls[0].amount, 3);
  assert.equal(damageCalls[0].dodgeable, undefined, '未设置 dodgeable 即为强制伤害');
  assert.deepEqual(order, ['damage', 'draw']);
  assert.equal(draws, 1);

  await HS_SKILLS.zhongjie.triggers.damaged(engine, { player: mech });

  assert.equal(damageCalls.length, 1, '有手牌时不触发反击');
  assert.equal(draws, 2, '未触发反击时仍摸一张牌');
});

test('同化弃置两张牌，使存活目标增加体力上限并回复体力', async () => {
  const first = card('first');
  const second = card('second', 'shan');
  const mech = player('mechcthun', { hp: 3, maxHp: 3, hand: [first, second] });
  mech.skills = ['tonghua'];
  const target = player('target', { hp: 2, maxHp: 4 });
  const engine = new GameEngine({ mode: MODE.SOLO, pack: 'hs', pace: 0 });
  engine.players = [mech, target];

  assert.equal(activeSkillOptions(engine, mech).some((option) => option.skill === 'tonghua'), true);
  await HS_SKILLS.tonghua.action(engine, {
    player: mech,
    move: { cards: [first.id, second.id], targetId: target.id },
  });

  assert.deepEqual(mech.hand, []);
  assert.deepEqual(engine.discard, [first, second]);
  assert.equal(target.maxHp, 5);
  assert.equal(target.hp, 3);
});

test('同化不能用重复的同一张牌支付两张牌的费用', async () => {
  const only = card('only');
  const mech = player('mechcthun', { hp: 3, maxHp: 3, hand: [only] });
  const target = player('target', { hp: 2, maxHp: 4 });
  const engine = new GameEngine({ mode: MODE.SOLO, pack: 'hs', pace: 0 });
  engine.players = [mech, target];

  await HS_SKILLS.tonghua.action(engine, {
    player: mech,
    move: { cards: [only.id, only.id], targetId: target.id },
  });

  assert.deepEqual(mech.hand, [only]);
  assert.equal(target.maxHp, 4);
  assert.equal(target.hp, 2);
});
