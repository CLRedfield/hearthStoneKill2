// ====================== 炉石杀 武将（第一批） ======================
// 按阵营存放，逐批扩充。技能实现见 ../skills-hs.js
import { FACTION } from '../constants.js';

export const HS_GENERALS = {
  // ---------------- 中立 ----------------
  mutanus: {
    id: 'mutanus', name: '穆坦努斯', faction: FACTION.NEUTRAL, hp: 5, title: '吞噬者',
    skills: ['tunshi'],
    bio: '吞噬：获得一名角色的一张手牌，并为另一名角色添加1枚“盾”（每枚盾抵挡1点伤害，破盾摸1张）。',
  },
  mida: {
    id: 'mida', name: '米达', faction: FACTION.NEUTRAL, hp: 4, title: '光暗交织',
    skills: ['guangming', 'xukong', 'chongzu'],
    bio: '光明能量：弃1牌指定两人，一人回血一人摸牌。虚空能量：体力≤2禁用光明能量，【杀】伤害后为一角色回等量体力。重组：10基本+10锦囊被使用后死亡时满血复活摸4。',
  },
  serena: {
    id: 'serena', name: '塞瑞娜', faction: FACTION.NEUTRAL, hp: 3, title: '恶毒鹰身人',
    skills: ['daidu'],
    bio: '歹毒：弃3张牌与一名角色交换体力上限、装备与奥秘，双方回满；以此增加的上限每点摸1张。',
  },
  nefarian: {
    id: 'nefarian', name: '奈法利安', faction: FACTION.NEUTRAL, hp: 3, title: '黑翼血环',
    skills: ['dihou'],
    bio: '低吼：指定一名角色，直到你下回合开始前，其所有置入弃牌堆的牌（使用/打出/被弃）都改由你获得。',
  },
  octopus: {
    id: 'octopus', name: '八爪巨怪', faction: FACTION.NEUTRAL, hp: 4, title: '纷纷扬沙',
    skills: ['yizhi', 'yawu'],
    bio: '抑制（锁定技）：你的【杀】未造成伤害后，其目标下回合至多用2张牌。亡语（锁定技）：死亡时摸12张，自选一部分交给一名角色，其余强制使用完再离开。',
  },
  edwin: {
    id: 'edwin', name: '艾德温', faction: FACTION.NEUTRAL, hp: 4, title: '迪菲亚首脑',
    skills: ['edwinqj', 'jihua'],
    bio: '奇迹（锁定技）：每使用2张牌摸1张。激化（锁定技）：本回合用3张牌后【杀】变强制伤害，用7张后【杀】+3。',
  },
  modres: {
    id: 'modres', name: '莫德雷斯', faction: FACTION.SCOURGE, hp: 5, title: '亡灵之音',
    skills: ['huoyan'],
    bio: '火眼（锁定技）：你使用的【杀】置于武将牌上，【杀】可当【闪避】；可弃武将牌上5张【杀】造10点强制伤害。',
  },
  maluojiaer: {
    id: 'maluojiaer', name: '玛洛加尔', faction: FACTION.SCOURGE, hp: 3, title: '骸骨融合怪',
    skills: ['haigu', 'gujia'],
    bio: '骸骨重铸（锁定技）：任意角色回合结束你回满；【桃】仅濒死可用。骨架（锁定技）：你的武器、防具都能各装备2件且同时生效。',
  },

  // ---------------- 天灾 ----------------
  patchwerk: {
    id: 'patchwerk', name: '帕奇维克', faction: FACTION.SCOURGE, hp: 12, title: '屠宰机器',
    skills: ['kuangbao', 'tusha', 'chidun'],
    bio: '狂暴：指定一名角色，你们各受1点伤害。屠杀：你使用的【杀】冻结回到手里。迟钝：手牌上限为4。',
  },
  lanathel: {
    id: 'lanathel', name: '兰娜瑟尔', faction: FACTION.SCOURGE, hp: 3, title: '鲜血女王',
    skills: ['yinxue', 'xixue'],
    bio: '饮血：弃n摸n回⌊n/2⌋。吸血：上限最多者-1上限，体力最少者+1上限并回血。',
  },
  ilucia: {
    id: 'ilucia', name: '伊露西亚', faction: FACTION.SCOURGE, hp: 3, title: '裂心者',
    skills: ['liexin'],
    bio: '裂心：与一名角色交换手牌，在你回合结束时换回。',
  },
  kelthuzad: {
    id: 'kelthuzad', name: '克尔苏加德', faction: FACTION.SCOURGE, hp: 4, title: '巫妖',
    skills: ['hanshuang', 'huishou', 'chongsheng'],
    bio: '寒霜：令一名角色下个回合手牌上限-2。回收（锁定技）：一名角色回合结束弃牌后，由其选择给你等量的牌。重生（锁定技）：一名角色在其自己或你的回合死亡时，你可使其以1点体力复活并摸4张。',
  },
  loatheb: {
    id: 'loatheb', name: '洛欧塞布', faction: FACTION.SCOURGE, hp: 5, title: '沼泽毒菌',
    skills: ['duwu', 'baozi'],
    bio: '毒雾：指定一名角色，直到你下回合开始，其每使用一张牌前须自行选择弃掉一张点数更大的牌，否则不能使用。孢子（锁定技）：当你受到一次伤害后，使下一张被使用的【杀】伤害+1。',
  },

  // ---------------- 部落 ----------------
  vadrius: {
    id: 'vadrius', name: '瓦迪瑞斯', faction: FACTION.HORDE, hp: 4, title: '邪能之噬',
    skills: ['guanmo'],
    bio: '灌魔（锁定技）：你摸牌阶段多摸两张牌；你的手牌上限为12。',
  },
  guldan: {
    id: 'guldan', name: '古尔丹', faction: FACTION.HORDE, hp: 3, title: '梦境毁灭者',
    skills: ['linghun', 'xiehuo'],
    bio: '灵魂分流：令一名角色（可含自己）受1点强制伤害，并在你回合结束时摸4张。邪火：弃2牌，弃置一名角色装备并置入【古尔丹之手】。',
  },
  rokara: {
    id: 'rokara', name: '洛卡拉', faction: FACTION.HORDE, hp: 4, title: '勇猛战将',
    skills: ['mengji', 'wujian'],
    bio: '猛击（锁定技）：一回合内累计造成2点伤害后摸2回1。无坚不摧：你对角色出【杀】时其需对自己使用【杀】否则受1点强制伤害。',
  },
  rokhara: {
    id: 'rokhara', name: '洛克霍拉', faction: FACTION.HORDE, hp: 5, title: '冰雪之王',
    skills: ['bingfeng', 'fusheng'],
    bio: '冰封：指定一名角色，冻结其（你手牌数-1，至多3）张手牌。复生（锁定技）：体力≤2时摸牌阶段多摸1张且【杀】多造成1点伤害。',
  },
  bru: {
    id: 'bru', name: '布鲁坎', faction: FACTION.HORDE, hp: 4, title: '元素使者',
    skills: ['yuansu'],
    bio: '元素之力（锁定技）：准备阶段判定——♥你与一名角色回2；♣摸3；♠对一名角色造2点伤害；♦弃置一名角色2张牌。',
  },
  hagatha: {
    id: 'hagatha', name: '哈加沙', faction: FACTION.HORDE, hp: 4, title: '沼泽女巫',
    skills: ['guhuo', 'xianji'],
    bio: '蛊惑（锁定技）：你使用【杀】无次数限制且伤害+1。献祭（锁定技）：你成为【杀】目标或使用【杀】时摸1张。',
  },
  chenyong: {
    id: 'chenyong', name: '晨拥', faction: FACTION.HORDE, hp: 3, title: '元素技师',
    skills: ['binhuo', 'aoshu'],
    bio: '冰火（锁定技）：你的【杀】对有装备者伤害+1并冻结其1张手牌；你的手牌无法被冻结。奥数（锁定技）：冰火冻结后你摸1张。',
  },

  // ---------------- 古神 ----------------
  ragnaros: {
    id: 'ragnaros', name: '拉格纳罗斯', faction: FACTION.OLDGOD, hp: 5, title: '炎魔之王',
    skills: ['yanqu', 'shenpan'],
    bio: '炎躯（锁定技）：你免疫红色牌造成的伤害。审判烈焰：指定一名角色判定，黑色则对其造成2点火焰伤害（每回合一次）。',
  },
  silas: {
    id: 'silas', name: '希拉斯暗月', faction: FACTION.OLDGOD, hp: 4, title: '暗月之主',
    skills: ['xuanzhuan', 'yueying'],
    bio: '旋转：观看一名角色手牌，获得其一张并给其一张（每回合3次）。月影（锁定技）：你回合外首次受伤时抉择：①下回合首张牌用两次；②下回合【杀】+1伤害且+1次数；③濒死时回复1点。',
  },
  mechcthun: {
    id: 'mechcthun', name: '机械克苏恩', faction: FACTION.OLDGOD, hp: 3, title: '机械之劫',
    skills: ['zhongjie'],
    bio: '终结（锁定技）：当你没有手牌、装备、奥秘且判定区无牌时，每受一次伤害便消灭一名角色。',
  },
  nzoth: {
    id: 'nzoth', name: '恩佐斯', faction: FACTION.OLDGOD, hp: 5, title: '深渊之神',
    skills: ['chenluo', 'shenyuan2', 'suxing'],
    bio: '沉落（锁定技）：你使用/弃掉的基本/锦囊牌成为“沉”。深渊：弃4张异色沉→摸2回2造2，或弃2张同色沉→摸1。苏醒（限定技）：-1上限+1回血，本轮治疗失效。',
  },
  yogg: {
    id: 'yogg', name: '尤格萨隆', faction: FACTION.OLDGOD, hp: 5, title: '命运主宰',
    skills: ['mingyun', 'huxin', 'mingyunzhishou'],
    bio: '命运之轮：每人摸1张，本回合你免疫所有伤害。护心（锁定技）：回合外每轮凭空1次闪避+1次法术反制。命运之手（觉醒技）：体力≤3时强化以上技能。',
  },
  yshaarj: {
    id: 'yshaarj', name: '亚煞极', faction: FACTION.OLDGOD, hp: 3, title: '污染之源',
    skills: ['fushi2'],
    bio: '腐蚀：弃1牌称“腐”，本回合用点数≥腐的牌摸1，用点数<腐的牌使【杀】次数+1。',
  },
  cthun: {
    id: 'cthun', name: '克苏恩', faction: FACTION.OLDGOD, hp: 4, title: '破碎之劫',
    skills: ['posui', 'diyu', 'zuhe'],
    bio: '破碎（锁定技）：开局12张破碎部件洗入牌堆，抽到/判定到使你受益。低语：他人弃1锦囊否则受1点。组合（觉醒技）：4破碎后低语强化。',
  },
  azshara: {
    id: 'azshara', name: '艾萨拉女王', faction: FACTION.OLDGOD, hp: 4, title: '娜迦领袖',
    skills: ['tandi', 'yuangu'],
    bio: '探底（锁定技）：回合开始调整牌堆底的牌到顶。远古圣物（锁定技）：每使用3张锦囊获得一张【沉落宝藏】。',
  },

  // ---------------- 联盟 ----------------
  nathaly: {
    id: 'nathaly', name: '娜塔莉塞林', faction: FACTION.ALLIANCE, hp: 4, title: '遗忘之影',
    skills: ['xuwu', 'xishou'],
    bio: '虚无：弃一张牌并指定一名角色，其弃置所有与你弃牌颜色相同的牌。吸收（锁定技）：你消灭一名角色时获得其所有牌，并使体力上限增加其上限值且回满。',
  },
  tess: {
    id: 'tess', name: '苔丝', faction: FACTION.ALLIANCE, hp: 4, title: '黑衣猎人',
    skills: ['fanzhao', 'faxian'],
    bio: '翻找：出牌阶段从弃牌堆获得一张牌。发现（锁定技）：摸牌前观看牌库顶“摸牌数+1”张并任意排列于牌堆顶/底，然后摸牌。',
  },
  zerila: {
    id: 'zerila', name: '泽瑞拉', faction: FACTION.ALLIANCE, hp: 4, title: '虔诚信徒',
    skills: ['shengchu', 'xukongci', 'xintu'],
    bio: '神圣之触（锁定技）：伤害牌未造成伤害后回1摸1；若本回合未造成伤害，结束时再触发一次。虚空之刺（锁定技）：你回合内每回1点对所有他人造1点。信徒（限定技）：本回合可打出武将牌上的黑色基本/锦囊牌，且两个锁定技同时生效。',
  },
  vargoth: {
    id: 'vargoth', name: '瓦格斯', faction: FACTION.ALLIANCE, hp: 4, title: '幻影法师',
    skills: ['kanba'],
    bio: '看吧！（锁定技）：你回合结束时重演本回合最后使用的一张基本/锦囊牌，并摸一张牌。',
  },
  kadgar: {
    id: 'kadgar', name: '卡德加', faction: FACTION.ALLIANCE, hp: 4, title: '守护者',
    skills: ['shuangsheng', 'shikongmen'],
    bio: '双生魔法（锁定技）：使用的基本/锦囊牌置于武将牌上，下个回合开始后可以使用。时空之门（回合技）：弃置武将牌上的4张牌，令一名角色获得一个额外回合。',
  },
  alleria: {
    id: 'alleria', name: '奥蕾莉亚', faction: FACTION.ALLIANCE, hp: 3, title: '光明游侠',
    skills: ['lijian2', 'jianyu'],
    bio: '利箭：指定一名角色弃1张牌，你对其造成1点强制伤害。箭语（锁定技，你的回合内限一次）：造成伤害后，选择复原【利箭】，或回复1点体力并摸一张牌。',
  },
  tyrande: {
    id: 'tyrande', name: '泰兰德', faction: FACTION.ALLIANCE, hp: 3, title: '月神之力',
    skills: ['huoshi', 'liuxing'],
    bio: '火矢（锁定技）：你的【杀】对手牌数>5的角色多造成1点伤害。流星雨：你的回合内每使用一张牌，可令一名角色交给你一张同花色手牌，否则其受1点强制伤害（每回合同一角色至多3次）。',
  },

  // ---------------- 军团 ----------------
  jaraxxus: {
    id: 'jaraxxus', name: '加拉克苏斯', faction: FACTION.LEGION, hp: 4, title: '艾瑞达之王',
    skills: ['monengshandian', 'xuerou', 'lianyu'],
    bio: '魔能闪电：指定你与两名角色，依次弃出点数递增的牌，弃出更小者需再弃1张。血肉成灰：指定一名角色，其下回合摸牌-1。炼狱（限定技）：使所有其他角色体力变为2，因此失去体力者摸（2×失去量）张牌。',
  },
  mathexar: {
    id: 'mathexar', name: '玛瑟里顿', faction: FACTION.LEGION, hp: 7, title: '深渊领主',
    skills: ['xiumian', 'huanxing', 'shenyuanhao'],
    bio: '休眠（锁定技）：跳过出牌/弃牌阶段，每回合只摸1，受1次伤害后免疫。唤醒（觉醒技）：弃点数和24的牌解除休眠并群伤1点。深渊之号（限定技）：他人减半体力，你回满。',
  },
  malchezaar: {
    id: 'malchezaar', name: '玛克扎尔', faction: FACTION.LEGION, hp: 4, title: '渊狱之主',
    skills: ['yuanyuhuo', 'anyingjian', 'xuehou'],
    bio: '渊狱火：摸2张并本回合多用一张【杀】。暗影箭雨：对至多3名角色各造1点。血吼（限定技）：弃武器+2手牌对一人造2点强制伤害。',
  },
  kaelthas: {
    id: 'kaelthas', name: '凯尔萨斯', faction: FACTION.LEGION, hp: 5, title: '逐日之血',
    skills: ['xiehuo2', 'ao'],
    bio: '邪火（锁定技）：每回合第3/6/9…张牌再使用一次并摸2。奥（锁定技）：每回合首张锦囊后摸1。',
  },
  kazakus: {
    id: 'kazakus', name: '卡扎克', faction: FACTION.LEGION, hp: 4, title: '末日领主',
    skills: ['longwang', 'shunpi', 'qtanying', 'bhlinghun'],
    bio: '龙王战刃（锁定技）：一角色回合结束未用【杀】则你得1“刃”。顺劈斩（锁定技）：回合开始弃1刃摸2；【杀】伤害后弃1刃追加1点。群体暗影/捕获灵魂（限定技）：消耗“刃”群体打击。',
  },
};
