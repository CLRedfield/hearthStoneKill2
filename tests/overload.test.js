import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ } from '../src/engine/constants.js';
import { GameEngine } from '../src/engine/game.js';

function card(id, kind = 'sha', suit = 'spade', number = 1) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, suit, number, name: def.name, type: def.type,
    red: suit === 'heart' || suit === 'diamond',
  };
}

function player(id, skills = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [...skills], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function engineWith(player, deck) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = [player];
  engine.deck = deck;
  return engine;
}

test('过载大于摸牌数时不摸牌，并保留未抵扣的过载', () => {
  const p = player('overloaded');
  p.overload = 5;
  const deck = [card('a'), card('b'), card('c')];
  const engine = engineWith(p, deck);

  const got = engine.drawCards(p, 2);

  assert.deepEqual(got, []);
  assert.equal(p.overload, 3);
  assert.deepEqual(engine.deck.map((c) => c.id), ['a', 'b', 'c']);
});

test('过载不大于摸牌数时，摸牌数减去过载且过载归零', () => {
  const p = player('overloaded');
  p.overload = 2;
  const engine = engineWith(p, [card('a'), card('b'), card('c'), card('d'), card('e')]);

  const got = engine.drawCards(p, 5);

  assert.deepEqual(got.map((c) => c.id), ['a', 'b', 'c']);
  assert.equal(p.overload, 0);
  assert.deepEqual(engine.deck.map((c) => c.id), ['d', 'e']);
});

test('摸牌阶段先抵扣过载，再把最终摸牌数交给摸牌前技能', async () => {
  const tess = player('tess', ['faxian']);
  tess.overload = 1;
  let request;
  const engine = new GameEngine({
    mode: 'test', pack: 'hs', pace: 0,
    agents: {
      tess: {
        kind: 'human',
        respond(req) {
          request = req;
          return { top: ['b'], bottom: ['a'] };
        },
      },
    },
  });
  engine.players = [tess];
  engine.deck = [card('a'), card('b'), card('c')];

  await engine._phaseDraw(tess);

  assert.equal(request.type, REQ.GUANXING);
  assert.match(request.title, /摸 1 张牌前/);
  assert.deepEqual(request.cards.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(tess.hand.map((c) => c.id), ['b']);
  assert.equal(tess.overload, 0);
  assert.deepEqual(engine.deck.map((c) => c.id), ['c', 'a']);
});
