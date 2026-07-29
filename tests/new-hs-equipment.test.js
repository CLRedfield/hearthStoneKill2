import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeck, CARD_DEFS } from '../src/engine/cards.js';
import { resolveCard } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';

function player(id, seat = 0) {
  return {
    id, seat, name: id, alive: true, hp: 4, maxHp: 4,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type, slot: def.slot, range: def.range,
    suit: kind === 'dragonsoul' || kind === 'thunderelephant' ? 'heart' : 'club',
    number: kind === 'warhorse' ? 10 : kind === 'dragonsoul' ? 3 : 5,
    red: kind === 'dragonsoul' || kind === 'thunderelephant',
  };
}

function engineWith(players, agents = {}) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents });
  engine.players = players;
  engine.pause = async () => {};
  return engine;
}

test('炉石杀牌堆加入指定数量与牌面的四种装备', () => {
  const deck = buildDeck('hs');
  const expected = {
    dragonsoul: { count: 1, suit: 'heart', number: 3 },
    warhorse: { count: 2, suit: 'club', number: 10 },
    thunderelephant: { count: 3, suit: 'heart', number: 5 },
    sworddragon: { count: 3, suit: 'club', number: 5 },
  };

  assert.equal(deck.length, 198);
  for (const [kind, spec] of Object.entries(expected)) {
    const cards = deck.filter((item) => item.kind === kind);
    assert.equal(cards.length, spec.count, `${CARD_DEFS[kind].name}数量应正确`);
    assert.ok(cards.every((item) => item.suit === spec.suit && item.number === spec.number));
  }
});

test('巨龙之魂在自己回合第三张牌后获得并冻结弃牌', async () => {
  const owner = player('owner');
  owner.flags.cardsUsed = 2;
  owner.equips.weapon = card('dragon-soul', 'dragonsoul');
  const reward = card('reward', 'sworddragon');
  const agents = {
    owner: {
      kind: 'human',
      async respond(req) {
        if (req.kind === 'dragons_soul') return { value: reward.id };
        return null;
      },
    },
  };
  const engine = engineWith([owner], agents);
  engine.turnOwner = owner;
  engine.discard.push(reward);

  await resolveCard(engine, {
    user: owner,
    card: card('armor', 'wukehandong'),
    targets: [],
    options: {},
  });

  assert.equal(owner.flags.cardsUsed, 3);
  assert.equal(owner.flags.dragonsSoulRewards, 1);
  assert.equal(owner.hand.includes(reward), true);
  assert.equal(reward.frozen, true);
  assert.equal(engine.discard.includes(reward), false);
});

test('战马独占坐骑区并同时提供距离加减', () => {
  const owner = player('owner', 0);
  const near = player('near', 1);
  const target = player('target', 2);
  const fourth = player('fourth', 3);
  owner.equips.minus = card('elephant', 'thunderelephant');
  owner.equips.plus = card('sword', 'sworddragon');
  const engine = engineWith([owner, near, target, fourth]);
  const horse = card('warhorse', 'warhorse');

  engine.equip(owner, horse);

  assert.equal(owner.equips.plus, horse);
  assert.equal(owner.equips.minus, null);
  assert.equal(engine.discard.some((item) => item.id === 'elephant'), true);
  assert.equal(engine.discard.some((item) => item.id === 'sword'), true);
  assert.equal(engine.distance(owner, target), 1, '战马应具有-1马效果');
  assert.equal(engine.distance(target, owner), 3, '战马应具有+1马效果');
});

test('战马进入弃牌堆后可弃一张牌重新装备', async () => {
  const owner = player('owner');
  const horse = card('warhorse', 'warhorse');
  const cost = card('cost', 'chongfeng');
  owner.equips.plus = horse;
  owner.hand.push(cost);
  const agents = {
    owner: {
      kind: 'human',
      async respond(req) {
        if (req.kind === 'battlehorse_recycle') return { value: 'yes' };
        if (req.type === 'discard_cards') return { cards: [cost.id] };
        return null;
      },
    },
  };
  const engine = engineWith([owner], agents);

  engine.discardCards(owner, [horse]);
  await engine.resolvePendingBattlehorses();

  assert.equal(owner.equips.plus, horse);
  assert.equal(owner.hand.includes(cost), false);
  assert.equal(engine.discard.includes(cost), true);
  assert.equal(engine.discard.includes(horse), false);
});

test('雷象与剑龙可弃置自身免疫普通伤害，但不能免疫强制伤害', async () => {
  const source = player('source', 0);
  const target = player('target', 1);
  const sword = card('sword', 'sworddragon');
  target.equips.plus = sword;
  const agents = {
    target: {
      kind: 'human',
      async respond(req) {
        if (req.kind === 'mount_immunity') return { value: sword.id };
        return null;
      },
    },
  };
  const engine = engineWith([source, target], agents);

  await engine.dealDamage({ source, target, amount: 1, normalDamage: true });
  assert.equal(target.hp, 4);
  assert.equal(target.equips.plus, null);
  assert.equal(engine.discard.includes(sword), true);

  const elephant = card('elephant', 'thunderelephant');
  target.equips.minus = elephant;
  await engine.dealDamage({ source, target, amount: 1 });
  assert.equal(target.hp, 3);
  assert.equal(target.equips.minus, elephant);
});
