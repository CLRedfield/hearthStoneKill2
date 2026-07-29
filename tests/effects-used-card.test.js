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
    fxEvents: [],
    drawCount: 0,
    log() {},
    fx(name, event) { this.fxEvents.push({ name, ...event }); },
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
    const useEvent = game.engine.fxEvents.find((event) => event.name === 'use');
    assert.equal(useEvent.userId, game.player.id);
    assert.equal(useEvent.card.type, CARD_DEFS[kind].type);
    assert.equal(useEvent.card.name, kind === 'zhasi' ? '奥秘' : card.name);
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

test('Ancient Horn sends hero, skill type, and full description to the confirmation UI', async () => {
  const game = makeGame();
  const card = makeCard('shangguhaojiao', 3);
  game.player.generalId = 'azshara';
  let request = null;
  game.engine.agentOf = () => ({ kind: 'human' });
  game.engine.ask = async (_player, req) => {
    request = req;
    return { value: req.options[0].value };
  };

  await resolveCard(game.engine, { user: game.player, card, targets: [game.player], options: {} });

  assert.equal(request.kind, 'general_skill');
  assert.ok(request.options.length > 0);
  assert.ok(request.options.every((option) => option.general?.name));
  assert.ok(request.options.every((option) => option.skill?.name));
  assert.ok(request.options.every((option) => option.skill?.type === '锁定技' || option.skill?.type === '回合技'));
  assert.ok(request.options.every((option) => typeof option.skill?.desc === 'string' && option.skill.desc.length > 0));
});
