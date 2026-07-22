// ====================== 玩家随机昵称 ======================
const NAME_KEY = 'sgs_player_name';
const PREFIXES = ['青灯', '墨羽', '长风', '听雨', '踏月', '流云', '赤霄', '星河', '苍松', '锦书', '归雁', '问剑'];
const SUFFIXES = ['游侠', '谋士', '旅人', '棋客', '酒徒', '军师', '隐者', '先锋', '守夜人', '策士', '剑客', '掌旗官'];

export function generatePlayerName() {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  const mark = String(Math.floor(Math.random() * 90) + 10);
  return `${prefix}${suffix}${mark}`;
}

export function savePlayerName(value) {
  const name = String(value || '').trim().slice(0, 16);
  if (!name) return '';
  try { sessionStorage.setItem(NAME_KEY, name); } catch (e) {}
  return name;
}

export function getOrCreatePlayerName() {
  try {
    const saved = sessionStorage.getItem(NAME_KEY);
    if (saved?.trim()) return saved.trim().slice(0, 16);
  } catch (e) {}
  return savePlayerName(generatePlayerName());
}
