import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { resolveCard } from '../src/engine/effects.js';

function makeCard(kind, number) {
  const def = CARD_DEFS[kind];
  return {
    id: `${kind}_${number}`,
    kind,
    name: def.name,
    type: def.type,
    suit: 'spade',
    number,
    red: false,
    slot: def.slot,
    range: def.range,
  };
}

function makeGame() {
  const player = {
    id: 'yshaarj',
    name: 'Yshaarj',
    alive: true,
    flags: { fuValue: 5, drawnThisTurn: 0 },
    skillState: {},
    skills: ['fushi2'],
    lordSkills: [],
    hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null },
    judge: [],
    secrets: [],
    pile: [],
  };
  const engine = {
    turnOwner: player,
    turnUsedCards: [],
    alivePlayers: [player],
    over: false,
    discard: [],
    drawCount: 0,
    log() {},
    fx() {},
    changed() {},
    pause: async () => {},
    noteSpellUse: async () => {},
    toDiscard(cards) { this.discard.push(...cards); },
    equip(owner, card) { owner.equips[card.slot] = card; },
    drawCards(owner, count) {
      this.drawCount += count;
      const cards = Array.from({ length: count }, (_, i) => ({ id: `drawn_${i}` }));
      owner.hand.push(...cards);
      return cards;
    },
  };
  return { engine, player };
}

for (const [label, kind, number, getTargets] of [
  ['basic card', 'yueshi', 7, () => []],
  ['equipment', 'wukehandong', 7, () => []],
  ['secret', 'zhasi', 11, ({ player }) => [player]],
  ['delayed trick', 'pingzhuangshandian', 9, ({ player }) => [player]],
]) {
  test(`Corruption draws after using a qualifying ${label}`, async () => {
    const game = makeGame();
    const card = makeCard(kind, number);

    await resolveCard(game.engine, {
      user: game.player,
      card,
      targets: getTargets(game),
      options: {},
    });

    assert.equal(game.engine.drawCount, 1);
    assert.equal(game.player.flags.cardsUsed, 1);
  });
}

test('a rejected duplicate secret does not trigger Corruption', async () => {
  const game = makeGame();
  const existing = makeCard('zhasi', 8);
  const duplicate = makeCard('zhasi', 11);
  game.player.secrets.push(existing);

  await resolveCard(game.engine, {
    user: game.player,
    card: duplicate,
    targets: [game.player],
    options: {},
  });

  assert.equal(game.engine.drawCount, 0);
  assert.equal(game.player.flags.cardsUsed, undefined);
});
