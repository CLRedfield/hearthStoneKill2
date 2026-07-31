import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { attackRangeOf } from '../src/engine/effects.js';

function weapon(kind) {
  return { id: kind, kind, name: CARD_DEFS[kind].name, range: CARD_DEFS[kind].range };
}

function player() {
  return {
    flags: {},
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null },
  };
}

test('攻击范围会采用已装备武器的范围', () => {
  const owner = player();
  owner.equips.weapon = weapon('qinglong');

  assert.equal(attackRangeOf(owner), 3);
});

test('骨架的两件武器取较大的攻击范围', () => {
  const owner = player();
  owner.equips.weapon = weapon('zhuge');
  owner.equips2.weapon = weapon('qinglong');

  assert.equal(attackRangeOf(owner), 3);
});

test('动态武器范围在选目标时读取本回合摸牌数', () => {
  const owner = player();
  owner.equips.weapon = weapon('esinosblade');
  owner.flags.drawnThisTurn = 4;

  assert.equal(attackRangeOf(owner), 4);
});
