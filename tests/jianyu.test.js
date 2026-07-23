import test from 'node:test';
import assert from 'node:assert/strict';

import { HS_SKILLS } from '../src/engine/skills-hs.js';

function makeGame() {
  const source = {
    id: 'alleria',
    name: '奥蕾莉亚',
    alive: true,
    hp: 2,
    maxHp: 3,
    flags: { lijian2Used: true },
    skillState: {},
    hand: [],
  };
  const other = { id: 'other', name: '其他角色' };
  const engine = {
    round: 1,
    turnOwner: other,
    over: false,
    recoverCount: 0,
    drawCount: 0,
    agentOf() { return { kind: 'ai' }; },
    log() {},
    changed() {},
    async recover(player, amount) {
      this.recoverCount += amount;
      player.hp = Math.min(player.maxHp, player.hp + amount);
    },
    drawCards(_player, count) {
      this.drawCount += count;
    },
  };
  return { engine, source };
}

test('箭语仅在奥蕾莉亚自己的回合内触发，且每回合限一次', async () => {
  const { engine, source } = makeGame();
  const trigger = HS_SKILLS.jianyu.triggers.dealDamage;

  await trigger(engine, { source });
  assert.equal(engine.recoverCount, 0);
  assert.equal(engine.drawCount, 0);
  assert.equal(source.skillState.jianyuRound, undefined);

  engine.turnOwner = source;
  await trigger(engine, { source });
  assert.equal(engine.recoverCount, 1);
  assert.equal(engine.drawCount, 1);
  assert.equal(source.skillState.jianyuRound, engine.round);

  await trigger(engine, { source });
  assert.equal(engine.recoverCount, 1);
  assert.equal(engine.drawCount, 1);
});
