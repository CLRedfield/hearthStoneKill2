// ====================== 全局枚举与常量 ======================

// 花色
export const SUIT = {
  SPADE: 'spade',     // 黑桃 ♠
  HEART: 'heart',     // 红桃 ♥
  CLUB: 'club',       // 梅花 ♣
  DIAMOND: 'diamond', // 方块 ♦
};

export const SUIT_SYMBOL = {
  [SUIT.SPADE]: '♠',
  [SUIT.HEART]: '♥',
  [SUIT.CLUB]: '♣',
  [SUIT.DIAMOND]: '♦',
};

export const SUIT_NAME = {
  [SUIT.SPADE]: '黑桃',
  [SUIT.HEART]: '红桃',
  [SUIT.CLUB]: '梅花',
  [SUIT.DIAMOND]: '方块',
};

// 红/黑
export const isRed = (suit) => suit === SUIT.HEART || suit === SUIT.DIAMOND;
export const isBlack = (suit) => suit === SUIT.SPADE || suit === SUIT.CLUB;

// 点数显示
export const RANK_LABEL = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K',
};
export const rankLabel = (n) => RANK_LABEL[n] || String(n);

// 牌的类别
export const CARD_TYPE = {
  BASIC: 'basic',       // 基本牌
  TRICK: 'trick',       // 锦囊牌（即时）
  DELAYED: 'delayed',   // 延时锦囊
  EQUIP: 'equip',       // 装备牌
  SECRET: 'secret',     // 奥秘（炉石杀：盖放，满足条件时触发）
};

// 装备子类
export const EQUIP_SLOT = {
  WEAPON: 'weapon',       // 武器
  ARMOR: 'armor',         // 防具
  OFFENSE_HORSE: 'minus', // 进攻马 -1
  DEFENSE_HORSE: 'plus',  // 防御马 +1
};

export const EQUIP_SLOT_NAME = {
  [EQUIP_SLOT.WEAPON]: '武器',
  [EQUIP_SLOT.ARMOR]: '防具',
  [EQUIP_SLOT.OFFENSE_HORSE]: '-1马',
  [EQUIP_SLOT.DEFENSE_HORSE]: '+1马',
};

// 势力
export const FACTION = {
  WEI: 'wei',   // 魏
  SHU: 'shu',   // 蜀
  WU: 'wu',     // 吴
  QUN: 'qun',   // 群
  // 炉石杀阵营
  NEUTRAL: 'neutral',   // 中立
  SCOURGE: 'scourge',   // 天灾
  ALLIANCE: 'alliance', // 联盟
  OLDGOD: 'oldgod',     // 古神
  HORDE: 'horde',       // 部落
  LEGION: 'legion',     // 军团
};

export const FACTION_NAME = {
  [FACTION.WEI]: '魏',
  [FACTION.SHU]: '蜀',
  [FACTION.WU]: '吴',
  [FACTION.QUN]: '群',
  [FACTION.NEUTRAL]: '中立',
  [FACTION.SCOURGE]: '天灾',
  [FACTION.ALLIANCE]: '联盟',
  [FACTION.OLDGOD]: '古神',
  [FACTION.HORDE]: '部落',
  [FACTION.LEGION]: '军团',
};

export const FACTION_COLOR = {
  [FACTION.WEI]: '#3b6fb0',
  [FACTION.SHU]: '#c0392b',
  [FACTION.WU]: '#2e8b57',
  [FACTION.QUN]: '#7d7d7d',
  [FACTION.NEUTRAL]: '#b39a66',
  [FACTION.SCOURGE]: '#5a8ed0',
  [FACTION.ALLIANCE]: '#3fa9c2',
  [FACTION.OLDGOD]: '#8a5fd6',
  [FACTION.HORDE]: '#d96a45',
  [FACTION.LEGION]: '#6fb84a',
};

// 武将包
export const PACK = { SGS: 'sgs', HS: 'hs' };
export const PACK_NAME = { [PACK.SGS]: '三国杀', [PACK.HS]: '炉石杀' };

// 身份（军争模式）
export const IDENTITY = {
  LORD: 'lord',         // 主公
  LOYALIST: 'loyalist', // 忠臣
  REBEL: 'rebel',       // 反贼
  TRAITOR: 'traitor',   // 内奸
};

export const IDENTITY_NAME = {
  [IDENTITY.LORD]: '主公',
  [IDENTITY.LOYALIST]: '忠臣',
  [IDENTITY.REBEL]: '反贼',
  [IDENTITY.TRAITOR]: '内奸',
};

// 游戏模式
export const MODE = {
  ZHANGZHENG: 'zhanzheng', // 军争（身份场 5-8）
  DUEL2V2: '2v2',          // 2v2
  SOLO: 'solo',            // 单挑 1v1
};

export const MODE_NAME = {
  [MODE.ZHANGZHENG]: '军争模式',
  [MODE.DUEL2V2]: '2v2 模式',
  [MODE.SOLO]: '单挑模式',
};

// 回合阶段
export const PHASE = {
  START: 'start',     // 准备
  JUDGE: 'judge',     // 判定
  DRAW: 'draw',       // 摸牌
  PLAY: 'play',       // 出牌
  DISCARD: 'discard', // 弃牌
  END: 'end',         // 结束
};

export const PHASE_NAME = {
  [PHASE.START]: '准备阶段',
  [PHASE.JUDGE]: '判定阶段',
  [PHASE.DRAW]: '摸牌阶段',
  [PHASE.PLAY]: '出牌阶段',
  [PHASE.DISCARD]: '弃牌阶段',
  [PHASE.END]: '结束阶段',
};

// 决策请求类型（Agent 接口用）
export const REQ = {
  PLAY_TURN: 'play_turn',     // 出牌阶段：选择一个动作
  ASK_DODGE: 'ask_dodge',     // 请求一张闪
  ASK_PEACH: 'ask_peach',     // 濒死求桃
  ASK_SHA: 'ask_sha',         // 请求一张杀（决斗/借刀）
  ASK_NULLIFY: 'ask_nullify', // 是否无懈可击
  CHOOSE_TARGET: 'choose_target',
  CHOOSE_CARD: 'choose_card',
  CHOOSE_OPTION: 'choose_option',
  DISCARD_CARDS: 'discard_cards',
  GUANXING: 'guanxing',       // 观星
  SELECT_PLAYERS: 'select_players',
  SWAP_CARDS: 'swap_cards',
  ASK_SKILL: 'ask_skill',     // 是否发动某技能
};

// 队伍（2v2）
export const TEAM = { A: 'A', B: 'B' };
