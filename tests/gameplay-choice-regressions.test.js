import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { MODE, REQ, TEAM } from '../src/engine/constants.js';
import { GameEngine } from '../src/engine/game.js';
import { generalPool } from '../src/engine/generals.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function makeCard(id, kind, number) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, number, name: def.name, type: def.type,
    suit: 'spade', red: false, slot: def.slot, range: def.range,
  };
}

function makePlayer(id, hand = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, team: TEAM.A,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [...hand],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [],
  };
}

test('local free choice gives the human the full pool while AI still gets three candidates', async () => {
  const seats = [
    { id: 'human', name: 'Human', isHuman: true, team: TEAM.A },
    { id: 'ai', name: 'AI', isHuman: false, team: TEAM.B },
  ];
  const engine = new GameEngine({
    mode: MODE.SOLO, seats, pack: 'sgs', freeGeneralChoice: true, pace: 0,
  });
  let humanOptions;
  let aiOptions;
  engine.agents = {
    human: {
      kind: 'human',
      respond(req) {
        humanOptions = req.options;
        return { value: req.options.at(-1).value };
      },
    },
    ai: {
      kind: 'ai',
      respond(req) {
        aiOptions = req.options;
        return { value: req.options[0].value };
      },
    },
  };

  engine._buildPlayers();
  await engine._chooseGenerals();

  assert.equal(humanOptions.length, generalPool('sgs').length);
  assert.equal(aiOptions.length, 3);
  assert.notEqual(engine.players[0].generalId, engine.players[1].generalId);
});

test('Poison Fog lets the affected player choose the higher-numbered discard', async () => {
  const played = makeCard('played', 'jiu', 1);
  const lowCost = makeCard('low', 'sha', 5);
  const chosenCost = makeCard('chosen', 'tao', 12);
  const target = makePlayer('target', [played, lowCost, chosenCost]);
  const loatheb = makePlayer('loatheb');
  loatheb.team = TEAM.B;
  loatheb.skillState.duwuTarget = target.id;

  let request;
  const engine = new GameEngine({ mode: MODE.SOLO, pack: 'hs', pace: 0 });
  engine.players = [target, loatheb];
  engine.turnOwner = target;
  engine.turnUsedCards = [];
  engine.pause = async () => {};
  engine.agents = {
    target: {
      kind: 'human',
      respond(req) {
        request = req;
        return { value: chosenCost.id };
      },
    },
  };

  await engine._handlePlay(target, { card: played, targets: [target] });

  assert.equal(request.type, REQ.CHOOSE_OPTION);
  assert.deepEqual(request.options.map((option) => option.value), [lowCost.id, chosenCost.id]);
  assert.equal(target.hand.includes(lowCost), true);
  assert.equal(target.hand.includes(chosenCost), false);
  assert.equal(engine.discard.includes(chosenCost), true);
});

test('Recycle lets the turn player choose exactly which cards to give', async () => {
  const cards = [
    makeCard('keep', 'sha', 2),
    makeCard('give-a', 'shan', 7),
    makeCard('give-b', 'tao', 9),
  ];
  const turnPlayer = makePlayer('turn-player', cards);
  turnPlayer.flags.lastDiscardCount = 2;
  const owner = makePlayer('kelthuzad');
  let request;
  const engine = {
    async ask(askedPlayer, req) {
      assert.equal(askedPlayer, turnPlayer);
      request = req;
      return { selected: ['give-b', 'give-a'] };
    },
    log() {},
    changed() {},
  };

  await HS_SKILLS.huishou.triggers.anyEndPhase(engine, { owner, turnPlayer });

  assert.equal(request.type, REQ.GUANXING);
  assert.equal(request.mode, 'select_cards');
  assert.equal(request.minCount, 2);
  assert.equal(request.maxCount, 2);
  assert.deepEqual(turnPlayer.hand.map((card) => card.id), ['keep']);
  assert.deepEqual(owner.hand.map((card) => card.id), ['give-b', 'give-a']);
});

test('Frost now reduces the next hand limit by two', async () => {
  const owner = makePlayer('kelthuzad');
  const target = makePlayer('target');
  const engine = {
    playerById(id) { return id === target.id ? target : null; },
    log() {},
  };

  await HS_SKILLS.hanshuang.action(engine, { player: owner, move: { targetId: target.id } });

  assert.equal(target.frostHandLimit, 2);
  assert.match(HS_SKILLS.hanshuang.desc, /-2/);
});
