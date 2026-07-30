import test from 'node:test';
import assert from 'node:assert/strict';

import { HS_SKILLS } from '../src/engine/skills-hs.js';

function player(id, handCount, hp = 5) {
  return {
    id, name: id, alive: true, hp, hand: Array.from({ length: handCount }, (_, i) => ({ id: `${id}-${i}` })),
    flags: {}, skillState: {}, skills: [], lordSkills: [],
  };
}

test('冰封按每名目标自己的手牌数计算，并且至多结算三名不同角色', async () => {
  const rokhara = player('rokhara', 10);
  const few = player('few', 1);
  const middle = player('middle', 5);
  const many = player('many', 7);
  const fourth = player('fourth', 20);
  const players = [rokhara, few, middle, many, fourth];
  const frozen = [];
  const engine = {
    playerById(id) { return players.find((p) => p.id === id); },
    freezeHand(target, count) { frozen.push([target.id, count]); },
    log() {},
  };

  await HS_SKILLS.bingfeng.action(engine, {
    player: rokhara,
    move: { targetIds: [few.id, middle.id, few.id, many.id, fourth.id] },
  });

  assert.deepEqual(frozen, [['few', 2], ['middle', 2], ['many', 4]]);
  assert.equal(rokhara.flags.bingfengUsed, true);
});

test('复生在体力小于等于3时同时增加摸牌数和杀伤害', () => {
  const rokhara = player('rokhara', 0, 3);

  assert.equal(HS_SKILLS.fusheng.triggers.drawCount(null, { player: rokhara, base: 2 }), 3);
  assert.equal(HS_SKILLS.fusheng.triggers.shaDamage(null, { user: rokhara, base: 1 }), 2);

  rokhara.hp = 4;
  assert.equal(HS_SKILLS.fusheng.triggers.drawCount(null, { player: rokhara, base: 2 }), 2);
  assert.equal(HS_SKILLS.fusheng.triggers.shaDamage(null, { user: rokhara, base: 1 }), 1);
});
