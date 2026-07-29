import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_DEFS } from '../src/engine/cards.js';
import { MODE, REQ, TEAM } from '../src/engine/constants.js';
import { GameEngine } from '../src/engine/game.js';
import { generalPool, getGeneral } from '../src/engine/generals.js';
import { cardPlayOptions } from '../src/engine/responses.js';
import { HS_SKILLS } from '../src/engine/skills-hs.js';

function makeCard(id, kind, number) {
  const def = CARD_DEFS[kind];
  return {
    id, kind, number, name: def.name, type: def.type,
    suit: 'spade', red: false, slot: def.slot, range: def.range,
  };
}

function makePlayer(id, hand = []) {
  return {
    id, name: id, alive: true, hp: 4, maxHp: 4, team: TEAM.A,
    flags: {}, skillState: {}, skills: [], lordSkills: [], hand: [...hand],
    equips: { weapon: null, armor: null, plus: null, minus: null },
    equips2: { weapon: null, armor: null }, judge: [], secrets: [], pile: [],
    shieldCards: [],
  };
}

test('Power Word: Shield requires choosing any living player as its target', () => {
  const shield = makeCard('shield', 'zhenyanshudun', 2);
  const caster = makePlayer('caster', [shield]);
  const ally = makePlayer('ally');
  const engine = { alivePlayers: [caster, ally] };

  const options = cardPlayOptions(engine, caster, shield);

  assert.equal(options.length, 1);
  assert.equal(options[0].needTarget, true);
});

test('local free choice gives the human the full pool while AI still gets three candidates', async () => {
  const seats = [
    { id: 'human', name: 'Human', isHuman: true, team: TEAM.A },
    { id: 'ai', name: 'AI', isHuman: false, team: TEAM.B },
  ];
  const engine = new GameEngine({
    mode: MODE.SOLO, seats, pack: 'sgs', freeGeneralChoice: true, pace: 0,
  });
  let humanOptions;
  let aiOptions;
  engine.agents = {
    human: {
      kind: 'human',
      respond(req) {
        humanOptions = req.options;
        return { value: req.options.at(-1).value };
      },
    },
    ai: {
      kind: 'ai',
      respond(req) {
        aiOptions = req.options;
        return { value: req.options[0].value };
      },
    },
  };

  engine._buildPlayers();
  await engine._chooseGenerals();

  assert.equal(humanOptions.length, generalPool('sgs').length);
  assert.equal(aiOptions.length, 3);
  assert.notEqual(engine.players[0].generalId, engine.players[1].generalId);
});

test('Poison Fog lets the affected player choose the higher-numbered discard', async () => {
  const played = makeCard('played', 'jiu', 1);
  const lowCost = makeCard('low', 'sha', 5);
  const chosenCost = makeCard('chosen', 'tao', 12);
  const target = makePlayer('target', [played, lowCost, chosenCost]);
  const loatheb = makePlayer('loatheb');
  loatheb.team = TEAM.B;
  loatheb.skillState.duwuTarget = target.id;

  let request;
  const engine = new GameEngine({ mode: MODE.SOLO, pack: 'hs', pace: 0 });
  engine.players = [target, loatheb];
  engine.turnOwner = target;
  engine.turnUsedCards = [];
  engine.pause = async () => {};
  engine.agents = {
    target: {
      kind: 'human',
      respond(req) {
        request = req;
        return { value: chosenCost.id };
      },
    },
  };

  await engine._handlePlay(target, { card: played, targets: [target] });

  assert.equal(request.type, REQ.CHOOSE_OPTION);
  assert.deepEqual(request.options.map((option) => option.value), [lowCost.id, chosenCost.id]);
  assert.equal(target.hand.includes(lowCost), true);
  assert.equal(target.hand.includes(chosenCost), false);
  assert.equal(engine.discard.includes(chosenCost), true);
});

test('player choice prompts preserve the public team label', async () => {
  const chooser = makePlayer('chooser');
  const target = makePlayer('target');
  target.team = TEAM.B;
  target.general = { name: '目标武将' };
  const engine = new GameEngine({ mode: MODE.DUEL2V2, pack: 'hs', pace: 0 });
  engine.players = [chooser, target];
  let received;
  engine.agents = {
    chooser: {
      kind: 'human',
      respond(req) { received = req; return { value: target.id }; },
    },
  };

  await engine.ask(chooser, {
    type: REQ.CHOOSE_OPTION,
    title: '选择角色',
    options: [{ value: target.id, label: target.name }],
  });

  assert.equal(received.options[0].player.team, TEAM.B);
  assert.equal(received.options[0].player.general, '目标武将');
});

test('Arcane lets a human choose which enemy has a hand card revealed', async () => {
  const owner = makePlayer('antonidas');
  const first = makePlayer('first', [makeCard('first-card', 'sha', 3)]);
  const chosen = makePlayer('chosen', [makeCard('chosen-card', 'shan', 7)]);
  first.team = TEAM.B;
  chosen.team = TEAM.B;
  const requests = [];
  const engine = {
    alivePlayers: [owner, first, chosen],
    agentOf() { return { kind: 'human' }; },
    isAlly(a, b) { return a.team === b.team; },
    async ask(_player, req) {
      requests.push(req);
      return { value: requests.length === 1 ? 'mark' : chosen.id };
    },
    playerById(id) { return this.alivePlayers.find((p) => p.id === id); },
    log() {}, changed() {},
  };

  await HS_SKILLS.ao.triggers.cardTwice(engine, { player: owner });

  assert.equal(requests.length, 2);
  assert.match(requests[1].title, /选择要明置手牌的角色/);
  assert.equal(first.hand[0].aoMark, undefined);
  assert.equal(chosen.hand[0].aoMark, owner.id);
});

test('replaying a targeted card lets a human choose the new target', async () => {
  const owner = makePlayer('owner');
  const first = makePlayer('first');
  const chosen = makePlayer('chosen');
  first.team = TEAM.B;
  chosen.team = TEAM.B;
  owner.skillState.xiehuoCount = 2;
  const used = makeCard('used', 'sha', 9);
  const engine = new GameEngine({ mode: MODE.DUEL2V2, pack: 'hs', pace: 0 });
  engine.players = [owner, first, chosen];
  engine.turnOwner = owner;
  engine.pause = async () => {};
  engine.drawCards = () => [];
  let targetRequest;
  engine.agents = {
    owner: {
      kind: 'human',
      respond(req) {
        if (req.title?.startsWith('再次使用')) targetRequest = req;
        return { value: chosen.id };
      },
    },
  };

  await HS_SKILLS.xiehuo2.triggers.usedCard(engine, { player: owner, card: used });

  assert.equal(targetRequest.type, REQ.CHOOSE_OPTION);
  assert.deepEqual(targetRequest.options.map((o) => o.value).sort(), [chosen.id, first.id].sort());
  assert.equal(first.hp, 4);
  assert.equal(chosen.hp, 3);
});

test('Recycle lets the turn player choose exactly which cards to give', async () => {
  const cards = [
    makeCard('keep', 'sha', 2),
    makeCard('give-a', 'shan', 7),
    makeCard('give-b', 'tao', 9),
  ];
  const turnPlayer = makePlayer('turn-player', cards);
  turnPlayer.flags.lastDiscardCount = 2;
  const owner = makePlayer('kelthuzad');
  let request;
  const engine = {
    async ask(askedPlayer, req) {
      assert.equal(askedPlayer, turnPlayer);
      request = req;
      return { selected: ['give-b', 'give-a'] };
    },
    log() {},
    changed() {},
  };

  await HS_SKILLS.huishou.triggers.anyEndPhase(engine, { owner, turnPlayer });

  assert.equal(request.type, REQ.GUANXING);
  assert.equal(request.mode, 'select_cards');
  assert.equal(request.minCount, 2);
  assert.equal(request.maxCount, 2);
  assert.deepEqual(turnPlayer.hand.map((card) => card.id), ['keep']);
  assert.deepEqual(owner.hand.map((card) => card.id), ['give-b', 'give-a']);
});

test('Arcane discards the thawed card and lets its owner choose the card given to Chenyong', async () => {
  const frozen = makeCard('frozen', 'sha', 4);
  frozen.frozen = true;
  frozen.frozenBy = 'chenyong';
  const kept = makeCard('kept', 'shan', 6);
  const given = makeCard('given', 'tao', 9);
  const owner = makePlayer('owner', [frozen, kept, given]);
  const chenyong = makePlayer('chenyong');
  chenyong.skills = ['binhuo', 'aoshu'];
  chenyong.team = TEAM.B;
  const requests = [];
  const engine = new GameEngine({ mode: MODE.SOLO, pack: 'hs', pace: 0 });
  engine.players = [owner, chenyong];
  engine.agents = {
    owner: {
      kind: 'human',
      respond(req) {
        requests.push(req);
        if (req.type === REQ.CHOOSE_OPTION) return { value: 'give' };
        return { selected: [given.id] };
      },
    },
  };

  await engine._thawPlayer(owner);

  assert.deepEqual(requests.map((req) => req.type), [REQ.CHOOSE_OPTION, REQ.GUANXING]);
  assert.deepEqual(requests[1].cards.map((card) => card.id), [kept.id, given.id]);
  assert.equal(engine.discard.includes(frozen), true);
  assert.deepEqual(owner.hand.map((card) => card.id), [kept.id]);
  assert.deepEqual(chenyong.hand.map((card) => card.id), [given.id]);
});

test('Chenyong general choice text matches the current Arcane resolution', () => {
  const bio = getGeneral('chenyong').bio;
  assert.match(bio, /拥有者抉择/);
  assert.match(bio, /弃掉该牌并选择1张手牌交给你/);
  assert.doesNotMatch(bio, /冻结后你摸1张/);
});

test('Frost now reduces the next hand limit by two', async () => {
  const owner = makePlayer('kelthuzad');
  const target = makePlayer('target');
  const engine = {
    playerById(id) { return id === target.id ? target : null; },
    log() {},
  };

  await HS_SKILLS.hanshuang.action(engine, { player: owner, move: { targetId: target.id } });

  assert.equal(target.frostHandLimit, 2);
  assert.match(HS_SKILLS.hanshuang.desc, /-2/);
});
