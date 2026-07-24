import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ } from '../src/engine/constants.js';
import { resolveCard } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';

function player(id) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, gender: 'male',
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind, suit = 'spade') {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type, slot: def.slot,
    suit, number: 2, red: suit === 'heart' || suit === 'diamond',
  };
}

test('灵魂之火指定目标后就弃使用者一张牌，即使随后被闪避', async () => {
  const user = player('user');
  const target = player('target');
  const soulFire = card('soul-fire', 'linghunzhihuo', 'heart');
  const discardedByTarget = card('cost', 'tao', 'club');
  const dodge = card('dodge', 'shan', 'diamond');
  user.hand.push(discardedByTarget);
  target.hand.push(dodge);

  const requests = [];
  const engine = new GameEngine({
    mode: 'test',
    pack: 'hs',
    pace: 0,
    agents: {
      target: {
        kind: 'human',
        async respond(req) {
          requests.push(req.type);
          if (req.type === REQ.CHOOSE_CARD) return { card: 'hand' };
          if (req.type === REQ.ASK_DODGE) return { card: dodge };
          return null;
        },
      },
    },
  });
  engine.pause = async () => {};
  engine.players = [user, target];
  engine.turnOwner = user;

  await resolveCard(engine, { user, card: soulFire, targets: [target], options: {} });

  assert.deepEqual(requests.slice(0, 2), [REQ.CHOOSE_CARD, REQ.ASK_DODGE]);
  assert.equal(user.hand.includes(discardedByTarget), false);
  assert.equal(engine.discard.includes(discardedByTarget), true);
  assert.equal(target.hp, 4, '闪避后不应受到伤害');
});
