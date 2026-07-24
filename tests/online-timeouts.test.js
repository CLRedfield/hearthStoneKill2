import test from 'node:test';
import assert from 'node:assert/strict';

import { ONLINE_TIMEOUTS } from '../src/net/online.js';

test('online readiness, presence, delivery, and acknowledged action timeouts use the configured limits', () => {
  assert.deepEqual(ONLINE_TIMEOUTS, {
    ready: 16_000,
    presence: 32_000,
    delivery: 36_000,
    action: 90_000,
  });
});
