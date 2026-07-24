import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { resolveCard } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';
import { getGeneral } from '../src/engine/generals.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function player(id, hp = 4) {
  return {
    id, name: id, alive: true, hp, maxHp: hp, gender: 'male',
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function sha(id) {
  const def = CARD_DEFS.sha;
  return {
    id, kind: 'sha', name: def.name, type: def.type,
    suit: 'spade', number: 7, red: false,
  };
}

function engineWith(players) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = players;
  engine.turnOwner = players[0];
  engine.pause = async () => {};
  engine.ask = async () => null;
  return engine;
}

test('洛欧塞布的基础体力为6', () => {
  assert.equal(getGeneral('loatheb').hp, 6);
});

test('孢子会增加下一张杀对其他角色的伤害', async () => {
  const attacker = player('attacker');
  const loatheb = player('loatheb', 6);
  const target = player('target');
  loatheb.skills = ['baozi'];
  const engine = engineWith([attacker, loatheb, target]);

  await HS_SKILLS.baozi.triggers.damaged(engine, { player: loatheb });
  await resolveCard(engine, { user: attacker, card: sha('sha-other'), targets: [target], options: {} });

  assert.equal(target.hp, 2);
});

test('孢子不会增加下一张杀对洛欧塞布自己的伤害', async () => {
  const attacker = player('attacker');
  const loatheb = player('loatheb', 6);
  loatheb.skills = ['baozi'];
  const engine = engineWith([attacker, loatheb]);

  await HS_SKILLS.baozi.triggers.damaged(engine, { player: loatheb });
  await resolveCard(engine, { user: attacker, card: sha('sha-self'), targets: [loatheb], options: {} });

  assert.equal(loatheb.hp, 5);
});
