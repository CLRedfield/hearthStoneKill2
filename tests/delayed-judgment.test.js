import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { REQ, TEAM } from '../src/engine/constants.js';
import { resolveCard } from '../src/engine/effects.js';
import { GameEngine } from '../src/engine/game.js';

function makeCard(id, kind, suit = 'spade', number = 7) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, name: def.name, type: def.type, suit, number,
    red: suit === 'heart' || suit === 'diamond', slot: def.slot, range: def.range,
  };
}

function makePlayer(id, hand = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, team: TEAM.A,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [...hand],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [], shields: 0,
  };
}

function makeEngine(players) {
  const engine = new GameEngine({ mode: 'test', pack: 'hs', pace: 0, agents: {} });
  engine.players = players;
  engine.pause = async () => {};
  return engine;
}

test('delayed tricks open Counterspell only immediately before judgment', async () => {
  const delayed = makeCard('corruption', 'fushishu', 'club', 6);
  const counter = makeCard('counter', 'fashufanzhi', 'spade', 11);
  const caster = makePlayer('caster');
  const target = makePlayer('target', [counter]);
  const engine = makeEngine([caster, target]);
  const requests = [];
  const fxEvents = [];
  engine.agents.target = {
    kind: 'human',
    respond(req) {
      requests.push(req);
      return req.type === REQ.ASK_NULLIFY ? { card: counter } : null;
    },
  };
  engine.on('fx', (event) => fxEvents.push(event));

  await resolveCard(engine, { user: caster, card: delayed, targets: [target], options: {} });

  assert.equal(requests.length, 0, 'placing the delayed trick must not ask for Counterspell');
  assert.equal(target.judge.length, 1);
  assert.equal(target.judge[0].delayedBy, caster.id);

  engine.deck = [makeCard('judgment', 'chongfeng', 'heart', 8)];
  await engine._phaseJudge(target);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].timing, 'judge');
  assert.match(requests[0].title, /即将判定/);
  assert.match(requests[0].title, /法术反制/);
  assert.equal(engine.deck.length, 1, 'a cancelled delayed trick must not draw a judgment card');
  assert.equal(target.judge.length, 0);
  assert.ok(engine.discard.includes(delayed));
  assert.ok(engine.discard.includes(counter));
  assert.deepEqual(fxEvents.map((event) => event.name).filter((name) => name.startsWith('judge')), [
    'judge_pending', 'judge_cancelled',
  ]);
});

test('an uncountered delayed trick emits reveal and readable result before applying its effect', async () => {
  const delayed = makeCard('corruption', 'fushishu', 'club', 6);
  delayed.delayedBy = 'caster';
  const caster = makePlayer('caster');
  const target = makePlayer('target');
  target.judge.push(delayed);
  const engine = makeEngine([caster, target]);
  const fxEvents = [];
  engine.deck = [makeCard('judgment', 'chongfeng', 'spade', 7)];
  engine.on('fx', (event) => fxEvents.push(event));

  await engine._phaseJudge(target);

  assert.equal(target.flags.skipPlay, true);
  assert.equal(target.judge.length, 0);
  const judgmentFx = fxEvents.filter((event) => event.name.startsWith('judge'));
  assert.deepEqual(judgmentFx.map((event) => event.name), [
    'judge_pending', 'judge', 'judge_result',
  ]);
  assert.equal(judgmentFx[1].sourceCard.name, '腐蚀术');
  assert.equal(judgmentFx[2].result.title, '腐蚀生效');
  assert.match(judgmentFx[2].result.detail, /跳过出牌阶段/);
});
