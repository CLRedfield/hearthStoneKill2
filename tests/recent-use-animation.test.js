import test from 'node:test';
import assert from 'node:assert/strict';

import { GameUI } from '../src/ui/table.js';

function stubWrap() {
  return {
    firstChild: null,
    querySelector: () => null,
    removeChild() {},
    appendChild() {},
  };
}

test('recent-use entrance animation is enabled only for its first successful render', () => {
  const ui = new GameUI({ snapshot: () => ({ over: false }) }, 'viewer');
  const wrap = stubWrap();
  ui.root = { querySelector: () => wrap };
  ui.recentUses.set('player', { animate: true });

  const animationStates = [];
  ui._renderTopBar = () => ({});
  ui._renderOpponents = () => {
    animationStates.push(ui.recentUses.get('player').animate);
    return {};
  };
  ui._renderCenter = () => ({});
  ui._renderSelf = () => ({});
  ui._renderActionBar = () => ({});
  ui._renderLogPanel = () => ({});

  ui.render();
  ui.render();

  assert.deepEqual(animationStates, [true, false]);
});

test('a failed frame does not consume the pending recent-use animation', () => {
  const ui = new GameUI({ snapshot: () => ({ over: false }) }, 'viewer');
  ui.root = { querySelector: () => stubWrap() };
  ui.recentUses.set('player', { animate: true });
  ui._renderTopBar = () => { throw new Error('render failed'); };

  assert.throws(() => ui.render(), /render failed/);
  assert.equal(ui.recentUses.get('player').animate, true);
});
