import test from 'node:test';
import assert from 'node:assert/strict';

import { GameEngine } from '../src/engine/game.js';
import { CARD_DEFS } from '../src/engine/cards.js';
import { PHASE } from '../src/engine/constants.js';
import { resolveCard } from '../src/engine/effects.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';
import { activeSkillOptions } from '../src/engine/responses.js';
import { GameUI } from '../src/ui/table.js';

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
  assert.deepEqual(kadgar.pile, []);
  assert.equal(used.twinStoredBy, undefined);
  assert.equal(used.twinReady, undefined);
  assert.equal(engine.discard.includes(used), true, '牌框中的牌使用后应进入弃牌堆');
  assert.equal(kadgar.skillState.shikongmenCount, 1);
});

test('时空之门累计使用4张双生牌后获得发动次数，并在额外回合后恢复正常座次', async () => {
  const kadgar = player('kadgar', ['shuangsheng', 'shikongmen']);
  const next = player('next');
  const extra = player('extra');
  const stored = Array.from({ length: 4 }, (_, i) => card(`stored-${i + 1}`, 'wuzhong', 'club', i + 1));
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
  engine.phase = PHASE.PLAY;
  engine.deck = Array.from({ length: 8 }, (_, i) => card(`draw-${i + 1}`, i % 2 ? 'shan' : 'sha', 'spade', i + 1));

  for (const twin of stored) {
    await engine._handlePlay(kadgar, {
      type: 'play', card: twin, targets: [kadgar], sourcePile: 'twin',
    });
  }

  assert.equal(kadgar.skillState.shikongmenCount, 4);
  assert.equal(activeSkillOptions(engine, kadgar).some((option) => option.skill === 'shikongmen'), true);
  assert.deepEqual(kadgar.pile, []);
  assert.deepEqual(engine.discard.map((c) => c.id), stored.map((c) => c.id));

  await HS_SKILLS.shikongmen.action(engine, {
    player: kadgar,
    move: { targetId: extra.id },
  });

  assert.equal(kadgar.skillState.shikongmenCount, 0);
  assert.equal(kadgar.flags.shikongmenUsed, true);
  assert.equal(activeSkillOptions(engine, kadgar).some((option) => option.skill === 'shikongmen'), false);

  engine._advanceTurn();
  assert.equal(engine.current, extra, '额外回合应紧接当前回合执行');

  engine._advanceTurn();
  assert.equal(engine.current, next, '额外回合结束后应回到原本的下一名角色');
});

test('卡德加回合开始解锁双生牌时资源栏可以正常渲染', () => {
  const kadgar = player('kadgar', ['shuangsheng', 'shikongmen']);
  const stored = card('stored', 'wuzhong', 'club', 7);
  stored.twinStoredBy = kadgar.id;
  stored.twinReady = true;
  kadgar.pile.push(stored);
  const snapshot = { turnId: kadgar.id, phase: PHASE.START };
  const engine = {
    snapshot: () => snapshot,
    playerById: (id) => (id === kadgar.id ? kadgar : null),
  };
  const ui = new GameUI(engine, kadgar.id);

  const startPhaseItems = ui._resourceItems(kadgar);
  const twinAtStart = startPhaseItems.find((item) => item.key === 'twin');
  assert.equal(twinAtStart.value, 1);
  assert.equal(twinAtStart.active, false);

  snapshot.phase = PHASE.PLAY;
  const twinAtPlay = ui._resourceItems(kadgar).find((item) => item.key === 'twin');
  assert.equal(twinAtPlay.active, true);
  assert.match(twinAtPlay.preview[0], /可用/);
});

test('牌桌组件渲染失败时保留上一帧而不是清空屏幕', () => {
  const ui = new GameUI({ snapshot: () => ({}) }, 'kadgar');
  const sentinel = {};
  let removed = false;
  const wrap = {
    firstChild: sentinel,
    querySelector: () => null,
    removeChild() {
      removed = true;
      this.firstChild = null;
    },
    appendChild() {},
  };
  ui.root = { querySelector: () => wrap };
  ui._renderTopBar = () => { throw new Error('render failed'); };

  assert.throws(() => ui.render(), /render failed/);
  assert.equal(removed, false);
  assert.equal(wrap.firstChild, sentinel);
});
