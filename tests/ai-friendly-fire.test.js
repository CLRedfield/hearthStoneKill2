import test from 'node:test';
import assert from 'node:assert/strict';

import { AIAgent } from '../src/engine/ai.js';
import { CARD_DEFS } from '../src/engine/cards.js';
import { hostileShaTargets } from '../src/engine/effects.js';

function player(id, team) {
  return {
    id, team, name: id, alive: true, hp: 4, maxHp: 4, gender: 'male',
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind = 'sha') {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type,
    suit: 'spade', number: 7, red: false,
  };
}

function engineFor(players, inRange = () => true) {
  return {
    alivePlayers: players,
    discard: [],
    inAttackRange: inRange,
    isAlly: (a, b) => a.team === b.team,
  };
}

test('AI 的敌方杀目标会排除同阵营角色', () => {
  const aiPlayer = player('ai', 'A');
  const ally = player('ally', 'A');
  const enemy = player('enemy', 'B');
  const engine = engineFor([aiPlayer, ally, enemy]);

  assert.deepEqual(hostileShaTargets(engine, aiPlayer), [enemy]);
});

test('随机失误分支只在敌人之间随机出杀', () => {
  const aiPlayer = player('ai', 'A');
  const ally = player('ally', 'A');
  const enemy = player('enemy', 'B');
  const sha = card('sha-1');
  aiPlayer.hand.push(sha);
  const engine = engineFor([aiPlayer, ally, enemy]);
  const ai = new AIAgent({ chaos: 1 });
  const originalRandom = Math.random;
  const rolls = [0, 0.9, 0.9];

  try {
    Math.random = () => rolls.shift() ?? 0.9;
    const move = ai._randomMove({ engine, player: aiPlayer });
    assert.equal(move.type, 'play');
    assert.equal(move.card, sha);
    assert.deepEqual(move.targets, [enemy]);
  } finally {
    Math.random = originalRandom;
  }
});

test('只有队友在攻击范围内时，随机 AI 不会出杀', () => {
  const aiPlayer = player('ai', 'A');
  const ally = player('ally', 'A');
  aiPlayer.hand.push(card('sha-1'));
  const engine = engineFor([aiPlayer, ally]);
  const ai = new AIAgent({ chaos: 1 });

  assert.deepEqual(ai._randomMove({ engine, player: aiPlayer }), { type: 'end' });
});

test('信徒重放没有可攻击敌人时不会回退砍队友', () => {
  const aiPlayer = player('ai', 'A');
  const ally = player('ally', 'A');
  const enemy = player('enemy', 'B');
  const storedSha = card('stored-sha');
  aiPlayer.flags.xintuReplay = true;
  aiPlayer.pile.push(storedSha);
  const engine = engineFor(
    [aiPlayer, ally, enemy],
    (_source, target) => target === ally,
  );
  const ai = new AIAgent({ chaos: 0 });

  assert.deepEqual(ai.playTurn({ engine, player: aiPlayer }), { type: 'end' });
});
