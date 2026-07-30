import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { GameEngine } from '../src/engine/game.js';

function card(id, kind = 'shan', suit = 'heart', number = 2) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, suit, number, name: def.name, type: def.type,
    red: suit === 'heart' || suit === 'diamond',
    slot: def.slot, range: def.range,
  };
}

function player(id, borrowedSkill) {
  return {
    id, name: id, alive: true, hp: 3, maxHp: 4,
    flags: {}, skillState: { yuanyuBorrow: borrowedSkill },
    skills: ['yuanyuhuo', borrowedSkill], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

test('渊狱火借得的结束阶段技能完整生效后才消失', async () => {
  const malchezaar = player('malchezaar', 'kanba');
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = [malchezaar];
  engine.deck = [card('drawn')];
  engine.pause = async () => {};

  const drawCards = engine.drawCards.bind(engine);
  engine.drawCards = (owner, count, ...args) => {
    assert.equal(owner.skills.includes('kanba'), true, '技能效果结算时仍应持有借得的技能');
    return drawCards(owner, count, ...args);
  };

  await engine._phaseEnd(malchezaar);

  assert.deepEqual(malchezaar.hand.map((c) => c.id), ['drawn']);
  assert.equal(malchezaar.skills.includes('kanba'), false);
  assert.equal(malchezaar.skillState.yuanyuBorrow, null);
});

test('渊狱火借得的任意角色结束阶段技能不会被提前移除', async () => {
  const malchezaar = player('malchezaar', 'haigu');
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = [malchezaar];
  engine.pause = async () => {};

  await engine._phaseEnd(malchezaar);

  assert.equal(malchezaar.hp, malchezaar.maxHp, '骸骨重铸应在临时技能消失前生效');
  assert.equal(malchezaar.skills.includes('haigu'), false);
  assert.equal(malchezaar.skillState.yuanyuBorrow, null);
});
