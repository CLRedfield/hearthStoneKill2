// ====================== 应用入口 ======================
import { Lobby } from './ui/lobby.js';
import { initTheme } from './ui/theme.js';
import { resumeOnlineSession } from './net/online.js';

function boot() {
  initTheme();
  const app = document.getElementById('app');
  // 短暂展示开场动画后进入大厅
  setTimeout(() => {
    const lobby = new Lobby(app);
    lobby.show();
    resumeOnlineSession(lobby);
  }, 900);
}

window.addEventListener('DOMContentLoaded', boot);

// 全局错误兜底，便于调试
window.addEventListener('error', (e) => console.error('[global]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[promise]', e.reason));
