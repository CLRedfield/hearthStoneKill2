import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { GameEngine } from '../src/engine/game.js';

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
    id, kind, name: def.name, type: def.type, slot: def.slot,
    suit: 'diamond', number: 5, red: true,
  };
}

test('Aluneth adds two cards during the draw phase, not the start phase', async () => {
  const owner = player('owner');
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.pause = async () => {};
  engine.players = [owner];
  engine.equip(owner, card('aluneth', 'ailunisi'));
  engine.deck = Array.from({ length: 6 }, (_, i) => card(`draw-${i}`, 'tao'));

  await engine._phaseStart(owner);

  assert.equal(owner.hand.length, 0);

  await engine._phaseDraw(owner);

  assert.equal(owner.hand.length, 4);
  assert.equal(CARD_DEFS.ailunisi.drawPhaseBonus, 2);
});
