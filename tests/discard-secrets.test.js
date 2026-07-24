import test from 'node:test';
import assert from 'node:assert/strict';

import { AIAgent } from '../src/engine/ai.js';
import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ } from '../src/engine/constants.js';
import { resolveCard, validTargets } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';
import { activeSkillOptions } from '../src/engine/responses.js';
import { triggerSkill } from '../src/engine/skills.js';
import { discardableCards } from '../src/engine/zones.js';

function player(id) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, gender: 'male',
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function card(id, kind, suit = 'spade', number = 2) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type, slot: def.slot, range: def.range,
    suit, number, red: suit === 'heart' || suit === 'diamond',
  };
}

test('未限定区域的弃牌候选包含手牌、两套装备、判定牌和奥秘', () => {
  const p = player('owner');
  const hand = card('hand', 'tao');
  const equip = card('equip', 'zhuge');
  const equip2 = card('equip2', 'qinglong');
  const judge = card('judge', 'lebu');
  const secret = card('secret', 'zhasi');
  p.hand.push(hand);
  p.equips.weapon = equip;
  p.equips2.weapon = equip2;
  p.judge.push(judge);
  p.secrets.push(secret);

  assert.deepEqual(discardableCards(p), [hand, equip, equip2, judge, secret]);
  assert.deepEqual(discardableCards(p, 'hand'), [hand], '明确写手牌时仍只能弃手牌');
});

test('AI 的通用弃牌可以选择仅有的奥秘，手牌限制不会越区', () => {
  const p = player('ai');
  const secret = card('secret', 'zhasi');
  p.secrets.push(secret);
  const ai = new AIAgent({ chaos: 0 });

  assert.deepEqual(ai.discard({ player: p, count: 1, from: 'all' }), { cards: [secret.id] });
  assert.deepEqual(ai.discard({ player: p, count: 1, from: 'hand' }), { cards: [] });
});

test('未限定弃牌区域的主动技能在只有奥秘时仍可发动', () => {
  const p = player('active');
  p.skills = ['zhiheng', 'lijian', 'yinxue', 'guangming', 'xiehuo', 'xuwu', 'monengshandian', 'daidu', 'fushi2'];
  p.secrets.push(
    card('secret-1', 'zhasi', 'spade', 3),
    card('secret-2', 'baozhafuwen', 'heart', 5),
    card('secret-3', 'wudao', 'club', 7),
  );
  const male1 = player('male-1');
  const male2 = player('male-2');
  const engine = { alivePlayers: [p, male1, male2], discard: [] };

  const available = new Set(activeSkillOptions(engine, p).map((option) => option.skill));

  for (const skill of p.skills) assert.equal(available.has(skill), true, `${skill} 应能用奥秘支付未限定的弃牌费用`);
  for (const handOnly of ['rende', 'qingnang', 'fanjian']) {
    p.skills.push(handOnly);
    assert.equal(
      activeSkillOptions(engine, p).some((option) => option.skill === handOnly),
      false,
      `${handOnly} 明确要求手牌，不应因有奥秘而可发动`,
    );
  }
});

test('主动技能服务端接受通用弃置的奥秘，但拒绝冒充手牌的奥秘', async () => {
  const p = player('owner');
  const corruptionCost = card('corruption-cost', 'zhasi', 'spade', 9);
  p.secrets.push(corruptionCost);
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = [p];

  await triggerSkill(engine, 'active:fushi2', { player: p, move: { cardId: corruptionCost.id } });
  assert.deepEqual(p.secrets, []);
  assert.equal(engine.discard.includes(corruptionCost), true);
  assert.equal(p.flags.fuValue, 9);

  const handOnlyCost = card('hand-only-cost', 'zhasi', 'heart', 6);
  p.secrets.push(handOnlyCost);
  p.hp = 3;
  await triggerSkill(engine, 'active:qingnang', { player: p, move: { cardId: handOnlyCost.id } });
  assert.deepEqual(p.secrets, [handOnlyCost]);
  assert.equal(p.hp, 3);
  assert.equal(p.skillState.qingnangUsed, undefined);
});

test('弃置奥秘会真正移出奥秘区并清除蛊惑标记', () => {
  const p = player('owner');
  const secret = card('secret', 'sha');
  secret.guhuoBy = 'hagatha';
  secret.guhuoDmg = 2;
  secret.guhuoNature = 'fire';
  p.secrets.push(secret);
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = [p];

  engine.discardCards(p, [secret]);

  assert.deepEqual(p.secrets, []);
  assert.equal(engine.discard.includes(secret), true);
  assert.equal(secret.guhuoBy, null);
  assert.equal(secret.guhuoDmg, null);
  assert.equal(secret.guhuoNature, null);
});

test('过河拆桥可弃置目标唯一的奥秘，但不会泄露奥秘牌面', async () => {
  const user = player('user');
  const target = player('target');
  const secret = card('secret', 'zhasi');
  const guohe = card('guohe', 'guohe');
  const shunshou = card('shunshou', 'shunshou');
  target.secrets.push(secret);

  const requests = [];
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0 });
  engine.players = [user, target];
  engine.turnOwner = user;
  engine.pause = async () => {};
  engine.ask = async (asked, req) => {
    if (asked === user && req.type === REQ.CHOOSE_CARD) {
      requests.push(req);
      return { card: 'secret' };
    }
    return null;
  };

  assert.deepEqual(validTargets(engine, user, guohe), [target]);
  assert.deepEqual(validTargets(engine, user, shunshou), [], '获得牌的效果不应套用弃置奥秘规则');

  await resolveCard(engine, { user, card: shunshou, targets: [target], options: {} });
  assert.deepEqual(target.secrets, [secret], '顺手牵羊即使被异常提交目标也不能获得奥秘');
  assert.equal(requests.length, 0);

  await resolveCard(engine, { user, card: guohe, targets: [target], options: {} });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].secretChoice, { secretCount: 1 });
  assert.equal(requests[0].visibleCards.some((entry) => entry.card.id === secret.id), false);
  assert.deepEqual(target.secrets, []);
  assert.equal(engine.discard.includes(secret), true);
});
