// 角色区域中的实体牌。未注明弃置区域时，手牌、装备、判定牌和奥秘都可被弃置。
export function equipmentCards(player) {
  return [
    ...Object.values(player?.equips || {}),
    ...Object.values(player?.equips2 || {}),
  ].filter(Boolean);
}

export function discardableCards(player, from = 'all') {
  if (!player) return [];
  if (from === 'hand') return [...(player.hand || [])];
  return [
    ...(player.hand || []),
    ...equipmentCards(player),
    ...(player.judge || []),
    ...(player.secrets || []),
  ];
}

// “获得一张牌”沿用原区域规则，不因通用弃牌规则而包含奥秘。
export function gainableCards(player) {
  if (!player) return [];
  return [
    ...(player.hand || []),
    ...equipmentCards(player),
    ...(player.judge || []),
  ];
}

export function findDiscardableCard(player, ref, from = 'all') {
  if (typeof ref !== 'string') return ref;
  return discardableCards(player, from).find((card) => card.id === ref) || null;
}
