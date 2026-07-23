import test from 'node:test';
import assert from 'node:assert/strict';

import { clearCardFreeze, removeFromHand } from '../src/util.js';
import { GameEngine } from '../src/engine/game.js';

test('a frozen card loses every freeze marker as soon as it leaves a hand', () => {
  const card = { id: 'frozen', frozen: true, frozenBy: 'freezer', frostTrapTurns: 2 };
  const hand = [card];

  assert.equal(removeFromHand(hand, card), true);
  assert.deepEqual(hand, []);
  assert.equal(card.frozen, undefined);
  assert.equal(card.frozenBy, undefined);
  assert.equal(card.frostTrapTurns, undefined);
});

test('all frozen cards stay frozen through the turn, then thaw before discard', async () => {
  const frozenBeforeTurn = { id: 'before', frozen: true };
  const frozenDuringTurn = { id: 'during' };
  const player = {
    id: 'player', name: 'Player', alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [], lordSkills: [],
    hand: [frozenBeforeTurn, frozenDuringTurn],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null },
    judge: [], secrets: [], pile: [], shieldCards: [],
  };
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = [player];
  engine.pause = async () => {};
  engine._phaseJudge = async () => {};
  engine._phaseDraw = async () => {};
  engine._phasePlay = async () => {
    assert.equal(frozenBeforeTurn.frozen, true, 'turn start must not thaw old freezes');
    frozenDuringTurn.frozen = true;
    frozenDuringTurn.frostTrapTurns = 2;
  };

  let discardReached = false;
  engine._phaseDiscard = async () => {
    discardReached = true;
    assert.equal(frozenBeforeTurn.frozen, undefined);
    assert.equal(frozenDuringTurn.frozen, undefined);
    assert.equal(frozenDuringTurn.frostTrapTurns, undefined);
  };
  engine._phaseEnd = async () => {};

  await engine.runTurn(player);
  assert.equal(discardReached, true);
});

test('clearing an already thawed card is harmless', () => {
  assert.equal(clearCardFreeze({ id: 'plain' }), false);
});
