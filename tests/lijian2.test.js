import test from 'node:test';
import assert from 'node:assert/strict';

import { REQ } from '../src/engine/constants.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function card(id, number, frozen = false) {
  return { id, kind: 'sha', name: '杀', number, frozen };
}

test('利箭使用观星式界面一次选择符合标点数倍数的手牌', async () => {
  const first = card('first', 1);
  const second = card('second', 2);
  const frozen = card('frozen', 6, true);
  const mark = card('mark', 3);
  const player = {
    id: 'alleria',
    name: '奥蕾莉亚',
    flags: {},
    hand: [first, second, frozen],
    equips: {},
    judge: [],
  };
  const target = {
    id: 'target',
    name: '目标',
    hp: 4,
    hand: [mark],
    equips: {},
    judge: [],
  };
  const requests = [];
  const discarded = [];
  const engine = {
    playerById(id) { return id === target.id ? target : null; },
    agentOf() { return { kind: 'human' }; },
    async ask(_owner, req) {
      requests.push(req);
      if (req.type === REQ.DISCARD_CARDS) return { cards: [mark.id] };
      if (req.type === REQ.GUANXING) return { selected: [first.id, second.id] };
      return { value: 'dmg' };
    },
    discardCards(owner, cards) {
      discarded.push(...cards);
      owner.hand = owner.hand.filter((c) => !cards.includes(c));
    },
    log() {},
    async dealDamage(info) { this.damage = info; },
    drawCards() {},
  };

  await HS_SKILLS.lijian2.action(engine, { player, move: { targetId: target.id } });

  const selectReq = requests.find((req) => req.type === REQ.GUANXING);
  assert.equal(selectReq.mode, 'select_cards');
  assert.equal(selectReq.multipleOf, 3);
  assert.deepEqual(selectReq.cards.map((c) => c.id), [first.id, second.id]);
  assert.deepEqual(discarded.map((c) => c.id), [mark.id, first.id, second.id]);
  assert.equal(engine.damage.amount, 2);
});
