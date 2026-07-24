import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';
import { CARD_DEFS } from '../src/engine/cards.js';
import { PHASE } from '../src/engine/constants.js';
import { resolveCard } from '../src/engine/effects.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function player(id, skills = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4,
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

test('双生魔法保存实体牌，并在下个回合解锁后允许从牌框使用', async () => {
  const kadgar = player('kadgar', ['shuangsheng', 'shikongmen']);
  const used = card('used', 'wuzhong', 'club', 7);
  const draws = [
    card('draw-1', 'shan', 'heart', 2),
    card('draw-2', 'sha', 'spade', 3),
    card('draw-3', 'tao', 'heart', 4),
    card('draw-4', 'jiu', 'diamond', 5),
  ];
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.pause = async () => {};
  engine.players = [kadgar];
  engine.turnOwner = kadgar;
  engine.deck = [...draws];

  await resolveCard(engine, { user: kadgar, card: used, targets: [kadgar], options: {} });

  assert.deepEqual(kadgar.pile.map((c) => c.id), ['used']);
  assert.equal(used.twinStoredBy, kadgar.id);
  assert.equal(used.twinReady, false);
  assert.equal(engine.discard.includes(used), false);

  HS_SKILLS.shuangsheng.triggers.startPhase(engine, { player: kadgar });
  assert.equal(used.twinReady, true);

  engine.phase = PHASE.PLAY;
  await engine._handlePlay(kadgar, {
    type: 'play', card: used, targets: [kadgar], sourcePile: 'twin',
  });

  assert.deepEqual(kadgar.hand.map((c) => c.id), ['draw-1', 'draw-2', 'draw-3', 'draw-4']);
  assert.deepEqual(kadgar.pile.map((c) => c.id), ['used']);
  assert.equal(used.twinReady, false, '牌框中的牌使用后应等待下个回合重新解锁');
  assert.equal(engine.discard.includes(used), false);
});

test('时空之门弃置4张双生牌，并在额外回合后恢复正常座次', async () => {
  const kadgar = player('kadgar', ['shuangsheng', 'shikongmen']);
  const next = player('next');
  const extra = player('extra');
  const stored = [
    card('stored-1', 'sha', 'spade', 1),
    card('stored-2', 'shan', 'heart', 2),
    card('stored-3', 'tao', 'diamond', 3),
    card('stored-4', 'wuzhong', 'club', 4),
    card('stored-5', 'jiu', 'spade', 5),
  ];
  stored.forEach((c) => {
    c.twinStoredBy = kadgar.id;
    c.twinReady = true;
  });
  kadgar.pile.push(...stored);
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.pause = async () => {};
  engine.players = [kadgar, next, extra];
  engine.turnIndex = 0;
  engine.turnOwner = kadgar;

  await HS_SKILLS.shikongmen.action(engine, {
    player: kadgar,
    move: { cards: stored.slice(0, 4).map((c) => c.id), targetId: extra.id },
  });

  assert.equal(kadgar.flags.shikongmenUsed, true);
  assert.deepEqual(kadgar.pile.map((c) => c.id), ['stored-5']);
  assert.deepEqual(engine.discard.map((c) => c.id), ['stored-1', 'stored-2', 'stored-3', 'stored-4']);

  engine._advanceTurn();
  assert.equal(engine.current, extra, '额外回合应紧接当前回合执行');

  engine._advanceTurn();
  assert.equal(engine.current, next, '额外回合结束后应回到原本的下一名角色');
});
