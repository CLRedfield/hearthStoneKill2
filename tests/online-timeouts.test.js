import test from 'node:test';
import assert from 'node:assert/strict';

import { ONLINE_TIMEOUTS } from '../src/net/online.js';

test('online readiness, presence, and action timeouts use the doubled limits', () => {
  assert.deepEqual(ONLINE_TIMEOUTS, {
    ready: 16_000,
    presence: 32_000,
    action: 36_000,
  });
});
