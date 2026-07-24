import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { validTargets } from '../src/engine/effects.js';

function player(id, hand = []) {
  return {
    id, name: id, alive: true, flags: {}, skillState: {}, skills: [], lordSkills: [], hand,
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
  };
}

function card(id, kind) {
  const def = CARD_DEFS[kind];
  return { id, kind, name: def.name, type: def.type, suit: 'spade', number: 2, red: false };
}

test('Mind Vision ignores distance while Snatch remains limited to distance one', () => {
  const user = player('user');
  const near = player('near', [card('near-card', 'tao')]);
  const far = player('far', [card('far-card', 'tao')]);
  const empty = player('empty');
  const engine = {
    alivePlayers: [user, near, far, empty],
    distance(_from, target) { return target === near ? 1 : 2; },
  };

  const mindVision = card('mind-vision', 'xinlingshijie');
  const snatch = card('snatch', 'shunshou');

  assert.deepEqual(validTargets(engine, user, mindVision).map((p) => p.id), ['near', 'far']);
  assert.deepEqual(validTargets(engine, user, snatch).map((p) => p.id), ['near']);
  assert.equal(CARD_DEFS.xinlingshijie.noDist, true);
  assert.equal(CARD_DEFS.xinlingshijie.target, 'one_has_card');
  assert.equal(CARD_DEFS.shunshou.target, 'one_in_1_has_card');
});
