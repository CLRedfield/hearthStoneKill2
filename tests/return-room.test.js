import test from 'node:test';
import assert from 'node:assert/strict';

import { GameUI } from '../src/ui/table.js';

test('房主可结束当前对局并返回房间，而不会触发退出房间', async () => {
  let returned = 0;
  let exited = 0;
  let closed = 0;
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => true;

  try {
    const ui = new GameUI({}, 'host', {
      returnRoomAction: async () => { returned++; },
      exitAction: async () => { exited++; },
    });

    await ui._returnToRoom({ close: () => { closed++; } });

    assert.equal(returned, 1);
    assert.equal(exited, 0);
    assert.equal(closed, 1);
  } finally {
    if (oldConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = oldConfirm;
  }
});

test('取消确认时保持在当前对局', async () => {
  let returned = 0;
  const oldConfirm = globalThis.confirm;
  globalThis.confirm = () => false;

  try {
    const ui = new GameUI({}, 'host', {
      returnRoomAction: async () => { returned++; },
    });

    await ui._returnToRoom();

    assert.equal(returned, 0);
  } finally {
    if (oldConfirm === undefined) delete globalThis.confirm;
    else globalThis.confirm = oldConfirm;
  }
});
