import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';
import { CARD_DEFS } from '../src/engine/cards.js';

function player(id) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind) {
  const def = CARD_DEFS[kind];
  return {
    id,
    kind,
    name: def.name,
    type: def.type,
    slot: def.slot,
    suit: 'spade',
    number: 2,
    red: false,
  };
}

test('防护长袍在累计受到2点实际伤害后自动进入弃牌堆', async () => {
  const source = player('source');
  const target = player('target');
  const robe = card('robe-1', 'robe');
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.pause = async () => {};
  engine.players = [source, target];
  engine.turnOwner = source;

  robe.damageTaken = 99;
  engine.equip(target, robe);
  assert.equal(robe.damageTaken, 0, '重新装备时应重置伤害累计');

  await engine.dealDamage({ source, target, amount: 1 });

  assert.equal(target.hp, 3);
  assert.equal(robe.damageTaken, 1);
  assert.equal(target.equips.armor, robe);
  assert.equal(engine.discard.includes(robe), false);

  await engine.dealDamage({ source, target, amount: 1 });

  assert.equal(target.hp, 2);
  assert.equal(robe.damageTaken, 2);
  assert.equal(target.equips.armor, null);
  assert.equal(engine.discard.includes(robe), true);
});
