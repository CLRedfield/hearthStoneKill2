import test from 'node:test';
import assert from 'node:assert/strict';

import { ClientRequestResponder, MqttHostHub } from '../src/net/online.js';

class FakeBus {
  constructor() {
    this.published = [];
    this.cleared = [];
  }

  pub(topic, data, opts = {}) {
    this.published.push({ topic, data, opts });
  }

  sub() {
    return () => {};
  }

  clearRetained(topic) {
    this.cleared.push(topic);
    return Promise.resolve();
  }
}

function makeHub(isOnline = () => true) {
  const bus = new FakeBus();
  const engine = {
    players: [
      { id: 'host', isHuman: true },
      { id: 'friend', isHuman: true },
    ],
    on() { return () => {}; },
    snapshot() { return { players: [] }; },
  };
  const hub = new MqttHostHub('ABCDEF', engine, 'host', false, 'game-1', 'epoch-1', isOnline, bus);
  return { hub, bus };
}

function answerLatestRequest(hub, bus, response = { type: 'end' }) {
  const sent = [...bus.published].reverse().find((item) => item.topic === hub.T.req('friend'));
  assert.ok(sent, 'host should publish a decision request');
  hub.onAction({
    ...hub.base(), reqId: sent.data.reqId, playerId: 'friend', response,
  });
}

test('missing the initial ready deadline does not permanently block later decisions', async () => {
  const { hub, bus } = makeHub();
  assert.deepEqual(await hub.waitForReady(['friend'], 0), ['friend']);

  const pending = hub.request('friend', { type: 'play_turn' }, 100);
  answerLatestRequest(hub, bus);

  assert.deepEqual(await pending, { received: true, response: { type: 'end' } });
});

test('one action timeout does not poison the next remote decision', async () => {
  const { hub, bus } = makeHub();
  assert.equal(await hub.request('friend', { type: 'play_turn' }, 5), null);

  const pending = hub.request('friend', { type: 'play_turn' }, 100);
  answerLatestRequest(hub, bus, { type: 'play', cardId: 'card-1' });

  assert.deepEqual(await pending, {
    received: true,
    response: { type: 'play', cardId: 'card-1' },
  });
  const requestDocs = bus.published.filter((item) => item.topic === hub.T.req('friend'));
  const cancellation = requestDocs.find((item) => item.data.cancelled === true);
  assert.ok(cancellation, 'a timed-out request should be cancelled on the client');
  assert.equal(cancellation.data.reqId, requestDocs[0].data.reqId);
  assert.equal(requestDocs.filter((item) => !item.data.cancelled).length, 2);
});

test('a stale presence flag does not suppress delivery to a responsive player', async () => {
  const { hub, bus } = makeHub(() => false);
  const pending = hub.request('friend', { type: 'play_turn' }, 100);
  answerLatestRequest(hub, bus);

  assert.deepEqual(await pending, { received: true, response: { type: 'end' } });
});

test('a request acknowledgement starts a fresh player decision timeout', async () => {
  const { hub, bus } = makeHub();
  const pending = hub.request('friend', { type: 'play_turn' }, 200, 0);
  const sent = [...bus.published].reverse().find((item) => item.topic === hub.T.req('friend'));

  await new Promise((resolve) => setTimeout(resolve, 120));
  hub.onAck({
    ...hub.base(), reqId: sent.data.reqId, playerId: 'friend', ack: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  answerLatestRequest(hub, bus);

  assert.deepEqual(await pending, { received: true, response: { type: 'end' } });
});


test('the host retries one pending request with the same id until it is answered', async () => {
  const { hub, bus } = makeHub();
  const pending = hub.request('friend', { type: 'play_turn' }, 200, 5);

  await new Promise((resolve) => setTimeout(resolve, 30));
  const requests = bus.published.filter((item) => item.topic === hub.T.req('friend'));
  assert.ok(requests.length >= 2, 'a pending request should be republished');
  assert.equal(new Set(requests.map((item) => item.data.reqId)).size, 1);

  answerLatestRequest(hub, bus);
  assert.deepEqual(await pending, { received: true, response: { type: 'end' } });
});

test('a duplicate MQTT request republishes the cached response without asking twice', async () => {
  let respondCount = 0;
  const published = [];
  const responder = new ClientRequestResponder({
    human: { async respond(req) { respondCount++; return { value: req.choice }; } },
    hydrate: (req) => req,
    serialize: (_type, response) => response,
    publish: (req, response) => published.push({ reqId: req.reqId, response }),
  });
  const req = { reqId: 'request-1', type: 'choose_option', choice: 'yes' };

  await responder.handle(req);
  await responder.handle(req);

  assert.equal(respondCount, 1);
  assert.deepEqual(published, [
    { reqId: 'request-1', response: { value: 'yes' } },
    { reqId: 'request-1', response: { value: 'yes' } },
  ]);
});

test('cancelling an in-flight request releases the client interaction', async () => {
  let cancelCount = 0;
  const published = [];
  const responder = new ClientRequestResponder({
    human: { respond() { return new Promise(() => {}); } },
    hydrate: (req) => req,
    serialize: (_type, response) => response,
    publish: (req, response) => published.push({ reqId: req.reqId, response }),
    cancel: () => { cancelCount++; },
  });
  const req = { reqId: 'request-2', type: 'play_turn' };

  const pending = responder.handle(req);
  await Promise.resolve();
  responder.cancelRequest(req.reqId);
  await pending;

  assert.equal(cancelCount, 1);
  assert.deepEqual(published, [{ reqId: 'request-2', response: null }]);
});
