// ====================== 三国杀 武将 ======================
import { FACTION } from '../constants.js';

export const SGS_GENERALS = {
  // ---------------- 魏 ----------------
  caocao: {
    id: 'caocao', name: '曹操', faction: FACTION.WEI, hp: 4, title: '魏武帝',
    skills: ['jianxiong'], lordSkills: ['hujia'],
    bio: '奸雄：当你受到伤害后，你可以获得对你造成伤害的牌。',
  },
  simayi: {
    id: 'simayi', name: '司马懿', faction: FACTION.WEI, hp: 3, title: '狼顾之鬼',
    skills: ['fankui', 'guicai'],
    bio: '反馈：受伤后获得伤害来源一张牌。鬼才：判定牌生效前可打出手牌替换。',
  },
  xiahoudun: {
    id: 'xiahoudun', name: '夏侯惇', faction: FACTION.WEI, hp: 4, title: '独目苍狼',
    skills: ['ganglie'],
    bio: '刚烈：受到伤害后判定，非红桃则令来源弃两张牌或受1点伤害。',
  },
  guojia: {
    id: 'guojia', name: '郭嘉', faction: FACTION.WEI, hp: 3, title: '鬼才',
    skills: ['tiandu', 'yiji'],
    bio: '天妒：判定牌生效后获得之。遗计：受到1点伤害后摸两张牌并分配。',
  },

  // ---------------- 蜀 ----------------
  liubei: {
    id: 'liubei', name: '刘备', faction: FACTION.SHU, hp: 4, title: '仁德之主',
    skills: ['rende'], lordSkills: ['jijiang'],
    bio: '仁德：出牌阶段将手牌交给其他角色，当累计交出≥2张时回复1点体力。',
  },
  guanyu: {
    id: 'guanyu', name: '关羽', faction: FACTION.SHU, hp: 4, title: '美髯公',
    skills: ['wusheng'],
    bio: '武圣：你可以将任意红色牌当【杀】使用或打出。',
  },
  zhangfei: {
    id: 'zhangfei', name: '张飞', faction: FACTION.SHU, hp: 4, title: '万夫不当',
    skills: ['paoxiao'],
    bio: '咆哮：你使用【杀】无次数限制。',
  },
  zhaoyun: {
    id: 'zhaoyun', name: '赵云', faction: FACTION.SHU, hp: 4, title: '虎威将军',
    skills: ['longdan'],
    bio: '龙胆：你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
  },
  zhugeliang: {
    id: 'zhugeliang', name: '诸葛亮', faction: FACTION.SHU, hp: 3, title: '卧龙',
    skills: ['guanxing', 'kongcheng'],
    bio: '观星：准备阶段观看牌堆顶数张牌并重新排列。空城：没有手牌时不能成为【杀】【决斗】的目标。',
  },

  // ---------------- 吴 ----------------
  sunquan: {
    id: 'sunquan', name: '孙权', faction: FACTION.WU, hp: 4, title: '制衡之主',
    skills: ['zhiheng'],
    bio: '制衡：出牌阶段弃置任意张牌，然后摸等量的牌（每回合一次）。',
  },
  ganning: {
    id: 'ganning', name: '甘宁', faction: FACTION.WU, hp: 4, title: '锦帆游侠',
    skills: ['qixi'],
    bio: '奇袭：你可以将任意黑色牌当【过河拆桥】使用。',
  },
  zhouyu: {
    id: 'zhouyu', name: '周瑜', faction: FACTION.WU, hp: 3, title: '美周郎',
    skills: ['yingzi', 'fanjian'],
    bio: '英姿：摸牌阶段多摸一张。反间：令一名角色选花色后获得你一张手牌，不符则受伤。',
  },
  huanggai: {
    id: 'huanggai', name: '黄盖', faction: FACTION.WU, hp: 4, title: '轻身为国',
    skills: ['kurou'],
    bio: '苦肉：出牌阶段你可以失去1点体力，然后摸两张牌。',
  },

  // ---------------- 群 ----------------
  huatuo: {
    id: 'huatuo', name: '华佗', faction: FACTION.QUN, hp: 3, title: '神医',
    skills: ['jijiu', 'qingnang'],
    bio: '急救：你可以在任何角色濒死时将红色牌当【桃】。青囊：弃一张手牌回复一名角色1点体力（每回合一次）。',
  },
  lvbu: {
    id: 'lvbu', name: '吕布', faction: FACTION.QUN, hp: 4, title: '战神',
    skills: ['wushuang'],
    bio: '无双：你的【杀】需两张【闪】抵消；你【决斗】时对方需两张【杀】。',
  },
  diaochan: {
    id: 'diaochan', name: '貂蝉', faction: FACTION.QUN, hp: 3, title: '绝色', gender: 'female',
    skills: ['lijian', 'biyue'],
    bio: '离间：弃一张牌令两名男性角色【决斗】。闭月：结束阶段你可以摸一张牌。',
  },
};
