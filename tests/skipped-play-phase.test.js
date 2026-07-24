import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';
import { CARD_DEFS } from '../src/engine/cards.js';

function makePlayer(delayedKind) {
  const def = CARD_DEFS[delayedKind];
  return {
    id: 'player',
    name: 'Player',
    alive: true,
    hp: 4,
    maxHp: 4,
    flags: {},
    skillState: {},
    skills: [],
    lordSkills: [],
    hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null },
    judge: [{ id: delayedKind, kind: delayedKind, name: def.name, type: def.type }],
    secrets: [],
    pile: [],
    shieldCards: [],
  };
}

for (const delayedKind of ['lebu', 'fushishu']) {
  test(`${CARD_DEFS[delayedKind].name} skips play but keeps draw, discard, and end phases`, async () => {
    const player = makePlayer(delayedKind);
    const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
    const phases = [];

    engine.players = [player];
    engine.pause = async () => {};
    engine._phaseStart = async () => {};
    engine.doJudge = async () => ({ suit: 'spade', number: 7 });
    engine._phaseDraw = async () => { phases.push('draw'); };
    engine._phasePlay = async () => { phases.push('play'); };
    engine._phaseDiscard = async () => { phases.push('discard'); };
    engine._phaseEnd = async () => { phases.push('end'); };

    await engine.runTurn(player);

    assert.equal(player.flags.skipPlay, true);
    assert.deepEqual(phases, ['draw', 'discard', 'end']);
  });
}
