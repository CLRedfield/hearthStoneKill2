import test from 'node:test';
import assert from 'node:assert/strict';

import { MODE, TEAM } from '../src/engine/constants.js';
import { GameEngine } from '../src/engine/game.js';

test('联机选将会同时向所有真人玩家发出请求', async () => {
  const seats = [
    { id: 'first', name: '一号', isHuman: true, team: TEAM.A },
    { id: 'second', name: '二号', isHuman: true, team: TEAM.B },
  ];
  const engine = new GameEngine({
    mode: MODE.SOLO,
    seats,
    pack: 'sgs',
    pace: 0,
    simultaneousGeneralChoice: true,
  });
  const requests = new Map();
  const resolvers = new Map();
  engine.agents = Object.fromEntries(seats.map((seat) => [seat.id, {
    kind: 'human',
    respond(req) {
      requests.set(seat.id, req);
      return new Promise((resolve) => resolvers.set(seat.id, resolve));
    },
  }]));

  engine._buildPlayers();
  const choosing = engine._chooseGenerals();
  await Promise.resolve();

  assert.deepEqual([...requests.keys()].sort(), ['first', 'second']);
  const firstCandidates = requests.get('first').options.map((o) => o.value);
  const secondCandidates = requests.get('second').options.map((o) => o.value);
  assert.equal(firstCandidates.some((id) => secondCandidates.includes(id)), false);

  for (const [id, resolve] of resolvers) {
    resolve({ value: requests.get(id).options[0].value });
  }
  await choosing;

  assert.ok(engine.players.every((p) => p.generalId));
});
