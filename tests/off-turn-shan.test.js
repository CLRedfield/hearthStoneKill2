import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ } from '../src/engine/constants.js';
import { getOneDodge } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';

function player(id, skills = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, gender: 'male',
    flags: {}, skillState: {}, skills: [...skills], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind, suit = 'spade', number = 1) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, suit, number, name: def.name, type: def.type,
    red: suit === 'heart' || suit === 'diamond',
    slot: def.slot, range: def.range,
  };
}

function engineFor(responder, turnOwner, responseCard, players = [turnOwner, responder]) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = players;
  engine.turnOwner = turnOwner;
  engine.pause = async () => {};
  engine.ask = async (asked, req) => (
    asked === responder && req.type === REQ.ASK_DODGE ? { card: responseCard } : null
  );
  return engine;
}

async function dodgeOnce(engine, responder, attacker) {
  return getOneDodge(engine, responder, {
    source: attacker,
    card: card('incoming-sha', 'sha', 'spade', 7),
  });
}

test('卡德加在回合外使用闪时，双生魔法将实体牌置于武将牌上', async () => {
  const attacker = player('attacker');
  const kadgar = player('kadgar', ['shuangsheng']);
  const shan = card('off-turn-shan', 'shan', 'heart', 2);
  kadgar.hand.push(shan);
  const engine = engineFor(kadgar, attacker, shan);

  const result = await dodgeOnce(engine, kadgar, attacker);

  assert.equal(result.shan, shan);
  assert.deepEqual(kadgar.hand, []);
  assert.deepEqual(kadgar.pile, [shan]);
  assert.equal(shan.twinStoredBy, kadgar.id);
  assert.equal(shan.twinReady, false);
  assert.equal(engine.discard.includes(shan), false);
  assert.equal(kadgar.flags.cardsUsed, undefined, '回合外响应不应污染其下个回合的用牌计数');
});

test('回合外使用闪会触发奇迹，并被翻找标记为已使用', async () => {
  const attacker = player('attacker');
  const responder = player('responder', ['edwinqj', 'fanzhao']);
  const shan = card('miracle-shan', 'shan', 'diamond', 5);
  const draw = card('miracle-draw', 'tao', 'heart', 9);
  responder.hand.push(shan);
  responder.skillState.miracleCount = 1;
  const engine = engineFor(responder, attacker, shan);
  engine.deck = [draw];

  await dodgeOnce(engine, responder, attacker);

  assert.equal(responder.skillState.miracleCount, 0);
  assert.equal(responder.hand.includes(draw), true);
  assert.equal(shan.tessUsed, true);
});

test('信徒与沉落都能收集回合外使用的对应闪', async () => {
  for (const skill of ['xintu', 'chenluo']) {
    const attacker = player(`attacker-${skill}`);
    const responder = player(`responder-${skill}`, [skill]);
    const shan = card(`shan-${skill}`, 'shan', 'club', 8);
    responder.hand.push(shan);
    const engine = engineFor(responder, attacker, shan);

    await dodgeOnce(engine, responder, attacker);

    assert.deepEqual(responder.pile, [shan], `${skill} 应收集回合外使用的黑色闪`);
    assert.equal(engine.discard.includes(shan), false);
  }
});

test('回合外使用闪不会误触仅限自己回合的用牌技能', async () => {
  const attacker = player('attacker');
  const responder = player('responder', ['xiehuo2', 'yueying', 'kanba', 'fushi2']);
  const shan = card('guarded-shan', 'shan', 'heart', 10);
  responder.hand.push(shan);
  responder.skillState.xiehuoCount = 2;
  responder.skillState.yueyingDouble = true;
  responder.skillState.yueyingFirstDone = false;
  responder.flags.fuValue = 6;
  const engine = engineFor(responder, attacker, shan);

  await dodgeOnce(engine, responder, attacker);

  assert.equal(responder.skillState.xiehuoCount, 2);
  assert.equal(responder.skillState.yueyingDouble, true);
  assert.equal(responder.skillState.yueyingFirstDone, false);
  assert.equal(responder.skillState.kanbaLast, undefined);
  assert.equal(responder.flags.extraSha, undefined);
});

test('被奥标记的闪在回合外使用时照常触发，并计入基本牌使用总数', async () => {
  const kael = player('kael');
  const attacker = player('attacker');
  const responder = player('responder');
  const shan = card('marked-shan', 'shan', 'heart', 6);
  shan.aoMark = kael.id;
  responder.hand.push(shan);
  const engine = engineFor(responder, attacker, shan, [attacker, responder, kael]);

  await dodgeOnce(engine, responder, attacker);

  assert.equal(responder.hp, 3);
  assert.equal(shan.aoMark, null);
  assert.equal(engine.usedBasic, 1);
});
