import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { GameEngine } from '../src/engine/game.js';
import { cardPlayOptions, peachOptions, shaOptions } from '../src/engine/responses.js';
import { GameUI } from '../src/ui/table.js';

function card(id, kind, suit = 'spade', number = 2) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type, slot: def.slot, range: def.range,
    suit, number, red: suit === 'heart' || suit === 'diamond',
  };
}

function player(id = 'marrowgar') {
  return {
    id, name: '玛洛加尔', alive: true, hp: 2, maxHp: 3,
    general: { name: '玛洛加尔' }, flags: {}, skillState: {},
    skills: ['haigu', 'gujia'], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

test('骸骨重铸禁止在出牌阶段主动使用桃，但濒死时仍可使用', async () => {
  const marrowgar = player();
  const peach = card('peach', 'tao', 'heart');
  marrowgar.hand.push(peach);
  const view = { alivePlayers: [marrowgar] };

  assert.equal(cardPlayOptions(view, marrowgar, peach).some((option) => option.kind === 'tao'), false);
  assert.equal(peachOptions(view, marrowgar, true, marrowgar).some((option) => option.card === peach), true);

  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = [marrowgar];
  engine.turnOwner = marrowgar;
  await engine._handlePlay(marrowgar, { type: 'play', card: peach, targets: [] });
  assert.equal(marrowgar.hand.includes(peach), true);
  assert.equal(marrowgar.hp, 2);
});

test('玛洛加尔在自己的回合濒死恢复到1点后立即跳到结束阶段', async () => {
  const marrowgar = player();
  const peach = card('peach', 'tao', 'heart');
  marrowgar.hp = 0;
  marrowgar.hand.push(peach);
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = [marrowgar];
  engine.turnOwner = marrowgar;
  engine.skipToEnd = false;
  engine.pause = async () => {};
  engine.ask = async () => ({ card: peach });

  await engine._dying(marrowgar, null);

  assert.equal(marrowgar.hp, 1);
  assert.equal(engine.skipToEnd, true);
  assert.equal(marrowgar.flags.skipDraw, true);
  assert.equal(marrowgar.flags.skipPlay, true);
  assert.equal(marrowgar.flags.skipDiscard, true);
});

test('骨架副武器栏的丈八蛇矛和方天画戟都能生效', () => {
  const marrowgar = player();
  const first = card('first', 'shan', 'heart');
  const second = card('second', 'jiu', 'spade');
  marrowgar.hand.push(first, second);
  marrowgar.equips2.weapon = card('zhangba', 'zhangba');

  assert.equal(shaOptions({}, marrowgar).some((option) => option.card.virtual), true);

  marrowgar.equips2.weapon = card('fangtian', 'fangtian');
  const lastSha = card('last-sha', 'sha');
  marrowgar.hand = [lastSha];
  const engine = { playerById: (id) => (id === marrowgar.id ? marrowgar : null) };
  const ui = new GameUI(engine, marrowgar.id);
  ui.activeOption = { kind: 'sha', card: lastSha };

  assert.equal(ui._maxTargets(), 3);
});
