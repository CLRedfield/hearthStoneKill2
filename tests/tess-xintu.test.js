import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';
import { CARD_DEFS } from '../src/engine/cards.js';
import { PHASE, REQ } from '../src/engine/constants.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function card(id, kind, suit = 'spade', number = 1) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, suit, number, name: def.name, type: def.type,
    red: suit === 'heart' || suit === 'diamond',
    slot: def.slot, range: def.range,
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

test('苔丝在实际摸牌前根据最终摸牌数进入发现界面', async () => {
  const tess = player('tess', ['faxian']);
  const old = card('old', 'shan', 'heart', 2);
  const a = card('a', 'sha', 'spade', 3);
  const b = card('b', 'tao', 'heart', 4);
  const c = card('c', 'wuzhong', 'club', 5);
  const d = card('d', 'jiu', 'diamond', 6);
  tess.hand.push(old);

  let request;
  const engine = new GameEngine({
    mode: 'test', pack: 'hs', pace: 0,
    agents: {
      tess: {
        kind: 'human',
        respond(req) {
          request = req;
          assert.equal(req.type, REQ.GUANXING);
          assert.deepEqual(req.cards.map((x) => x.id), ['a', 'b', 'c']);
          assert.deepEqual(tess.hand.map((x) => x.id), ['old'], '进入发现界面时还没有摸牌');
          return { top: ['c', 'a'], bottom: ['b'] };
        },
      },
    },
  });
  engine.players = [tess];
  engine.deck = [a, b, c, d];

  await engine._phaseDraw(tess);

  assert.match(request.title, /摸 2 张牌前/);
  assert.deepEqual(tess.hand.map((x) => x.id), ['old', 'c', 'a']);
  assert.deepEqual(engine.deck.map((x) => x.id), ['d', 'b']);
});

test('信徒储存黑色基本/锦囊，限定技发动后从牌框重打且不失去技能', async () => {
  const zerila = player('zerila', ['shengchu', 'xukongci', 'xintu']);
  const stored = card('stored', 'wuzhong', 'club', 7);
  const drawA = card('draw-a', 'shan', 'heart', 8);
  const drawB = card('draw-b', 'sha', 'spade', 9);
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = [zerila];
  engine.turnOwner = zerila;
  engine.phase = PHASE.PLAY;
  engine.deck = [drawA, drawB];
  engine.discard = [stored];

  HS_SKILLS.xintu.triggers.usedCard(engine, { player: zerila, card: stored });
  assert.deepEqual(zerila.pile.map((x) => x.id), ['stored']);
  assert.equal(engine.discard.includes(stored), false);

  await HS_SKILLS.xintu.action(engine, { player: zerila });
  assert.equal(zerila.skillState.xintuUsed, true);
  assert.equal(zerila.flags.xintuReplay, true);
  assert.deepEqual(zerila.hand, [], '发动时不应把牌收回手牌');
  assert.deepEqual(zerila.skills, ['shengchu', 'xukongci', 'xintu'], '发动后不应失去技能');

  await engine._handlePlay(zerila, {
    type: 'play', card: stored, targets: [zerila], sourcePile: 'xintu',
  });

  assert.equal(zerila.pile.includes(stored), false, '重打后应离开信徒牌框');
  assert.equal(engine.discard.includes(stored), true, '重打结算后应正常进入弃牌堆');
  assert.deepEqual(zerila.hand.map((x) => x.id), ['draw-a', 'draw-b']);
  assert.deepEqual(zerila.skills, ['shengchu', 'xukongci', 'xintu']);
});

test('神圣之触选择后回复1、摸2并阻止本回合造成伤害', async () => {
  const zerila = player('zerila', ['shengchu', 'xukongci']);
  const target = player('target');
  const drawA = card('touch-a', 'shan', 'heart', 10);
  const drawB = card('touch-b', 'sha', 'spade', 11);
  let request;
  const engine = new GameEngine({
    mode: 'test', pack: 'hs', pace: 0,
    agents: {
      zerila: {
        kind: 'human',
        respond(req) {
          request = req;
          return { value: 'shengchu' };
        },
      },
    },
  });
  engine.pause = async () => {};
  engine.players = [zerila, target];
  engine.turnOwner = zerila;
  engine.deck = [drawA, drawB];
  zerila.hp = 3;

  await HS_SKILLS.shengchu.triggers.startPhase(engine, { player: zerila });

  assert.equal(request.type, REQ.CHOOSE_OPTION);
  assert.equal(zerila.skillState.zerilaActive, 'shengchu');
  assert.equal(zerila.hp, 4);
  assert.deepEqual(zerila.hand.map((x) => x.id), ['touch-a', 'touch-b']);

  await engine.dealDamage({ source: zerila, target, amount: 2 });
  assert.equal(target.hp, 4, '泽瑞拉在神圣之触生效回合内不能造成伤害');

  await engine.dealDamage({ source: target, target: zerila, amount: 1 });
  assert.equal(zerila.hp, 3, '神圣之触不阻止其他角色造成伤害');
});
