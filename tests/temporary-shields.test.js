import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';

function player(id) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    temporaryShields: 3, shieldCards: [], shields: 0,
  };
}

function engineWith(players) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = players;
  engine.pause = async () => {};
  return engine;
}

test('炉石杀角色开局获得3点临时护盾', () => {
  const engine = new GameEngine({
    mode: 'solo', pack: 'hs', pace: 0,
    seats: [
      { id: 'a', name: 'a', isHuman: true },
      { id: 'b', name: 'b', isHuman: false },
    ],
  });

  engine._buildPlayers();

  assert.deepEqual(engine.players.map((p) => p.temporaryShields), [3, 3]);
});

test('角色自己的每个回合结束时临时护盾减少1点', async () => {
  const current = player('current');
  const other = player('other');
  const dead = player('dead');
  dead.alive = false;
  const engine = engineWith([current, other, dead]);

  await engine._phaseEnd(current);

  assert.equal(current.temporaryShields, 2);
  assert.equal(other.temporaryShields, 3);
  assert.equal(dead.temporaryShields, 3);
});

test('临时护盾优先于盾抵伤且损坏时不摸牌', async () => {
  const source = player('source');
  const target = player('target');
  target.temporaryShields = 2;
  target.shields = 1;
  target.shieldCards.push({ id: 'shield-card', name: '盾牌' });
  const engine = engineWith([source, target]);
  engine.deck.push({ id: 'draw-card', name: '测试牌' });

  await engine.dealDamage({ source, target, amount: 2 });

  assert.equal(target.temporaryShields, 0);
  assert.equal(target.shields, 1, '临时护盾应先于盾消耗');
  assert.equal(target.hand.length, 0, '临时护盾损坏后不应摸牌');
  assert.equal(target.hp, 4);

  await engine.dealDamage({ source, target, amount: 1 });

  assert.equal(target.shields, 0);
  assert.equal(target.hand.length, 1, '普通盾损坏后仍应摸牌');
  assert.equal(target.hp, 4);
});

test('联机快照包含临时护盾点数', () => {
  const target = player('target');
  target.temporaryShields = 2;
  const engine = engineWith([target]);

  assert.equal(engine.snapshot().players[0].temporaryShields, 2);
});
