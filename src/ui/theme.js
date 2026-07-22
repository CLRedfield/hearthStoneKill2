// ====================== 亮 / 暗主题 ======================
import { el } from './dom.js';

const THEME_KEY = 'sgs_theme';
const DARK = 'dark';
const LIGHT = 'light';

export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) === DARK ? DARK : LIGHT; }
  catch (e) { return LIGHT; }
}

export function applyTheme(theme) {
  const next = theme === DARK ? DARK : LIGHT;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === DARK ? '#0e0b09' : '#f4ecdd');
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  window.dispatchEvent(new CustomEvent('sgs-theme-change', { detail: next }));
  return next;
}

export function initTheme() { applyTheme(getTheme()); }

export function createThemeToggle(compact = false) {
  const button = el('button', {
    class: `theme-switch ${compact ? 'compact' : ''}`,
    type: 'button',
  });
  const refresh = () => {
    const dark = getTheme() === DARK;
    button.textContent = compact ? (dark ? '☀' : '☾') : (dark ? '☀ 亮色' : '☾ 暗色');
    button.title = dark ? '切换到亮色主题' : '切换到暗色主题';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(dark));
  };
  button.addEventListener('click', () => { applyTheme(getTheme() === DARK ? LIGHT : DARK); refresh(); });
  refresh();
  return button;
}
