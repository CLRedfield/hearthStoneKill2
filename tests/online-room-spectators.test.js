import test from 'node:test';
import assert from 'node:assert/strict';

import { MODE } from '../src/engine/constants.js';
import {
  MqttHostHub, moveRoomPlayerToSeat, onlineRoomMemberIds, playerAtSeat, spectatorPlayers,
} from '../src/net/online.js';

function makeRoom() {
  return {
    mode: MODE.ZHANGZHENG,
    count: 5,
    players: [
      { id: 'host', name: '房主', seat: 0, online: true },
      { id: 'fighter', name: '参战者', seat: 1, online: true },
      { id: 'watcher', name: '观战者', seat: null, online: true },
      { id: 'offline', name: '离线观战者', seat: null, online: false },
    ],
  };
}

test('观战者可以与指定普通席位玩家交换', () => {
  const room = makeRoom();

  assert.equal(moveRoomPlayerToSeat(room, 'watcher', 1), true);
  assert.equal(playerAtSeat(room, 1)?.id, 'watcher');
  assert.equal(room.players.find((p) => p.id === 'fighter')?.seat, null);
  assert.deepEqual(spectatorPlayers(room).map((p) => p.id).sort(), ['fighter', 'offline']);
});

test('房主等待名单包含在线观战者并排除离线成员', () => {
  assert.deepEqual(onlineRoomMemberIds(makeRoom(), 'host'), ['fighter', 'watcher']);
});

test('引擎尚未 setup 时也接受普通玩家和观战者的 ready', async () => {
  const bus = {
    pub() {},
    sub() { return () => {}; },
    clearRetained() { return Promise.resolve(); },
  };
  const engine = {
    config: { seats: [{ id: 'host', isHuman: true }, { id: 'fighter', isHuman: true }] },
    players: [],
    on() { return () => {}; },
    snapshot() { return { players: [] }; },
  };
  const hub = new MqttHostHub(
    'ABCDEF', engine, 'host', true, 'game-1', 'epoch-1', null, bus, null, ['fighter', 'watcher'],
  );

  hub.onReady({ ...hub.base(), playerId: 'fighter' });
  hub.onReady({ ...hub.base(), playerId: 'watcher' });
  hub.onReady({ ...hub.base(), playerId: 'intruder' });

  assert.deepEqual(await hub.waitForReady(['fighter', 'watcher'], 0), []);
  assert.equal(hub.readyPlayers.has('intruder'), false);
});
