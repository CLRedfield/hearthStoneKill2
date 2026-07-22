// ====================== 卡牌定义与牌堆 ======================
import { SUIT, CARD_TYPE, EQUIP_SLOT, isRed } from './constants.js';
import { uid, shuffle } from '../util.js';

// 卡牌“种类”定义表。每种牌有展示名、类别、以及行为元数据。
// 行为由 effects.js 根据 kind 解析。
export const CARD_DEFS = {
  // ---------- 基本牌 ----------
  sha: { name: '杀', type: CARD_TYPE.BASIC, desc: '出牌阶段对攻击范围内一名角色造成1点伤害；目标可用【闪】抵消。' },
  shan: { name: '闪', type: CARD_TYPE.BASIC, desc: '抵消一张【杀】。' },
  tao: { name: '桃', type: CARD_TYPE.BASIC, desc: '回复1点体力；或在濒死时救援。' },
  jiu: { name: '酒', type: CARD_TYPE.BASIC, desc: '使本回合下一张【杀】伤害+1；或仅在自己濒死时回复1点体力。' },

  // ---------- 即时锦囊 ----------
  wuzhong: { name: '无中生有', type: CARD_TYPE.TRICK, target: 'self', desc: '摸两张牌。' },
  guohe: { name: '过河拆桥', type: CARD_TYPE.TRICK, target: 'one_has_card', desc: '弃置一名其他角色的一张牌。' },
  shunshou: { name: '顺手牵羊', type: CARD_TYPE.TRICK, target: 'one_in_1_has_card', desc: '获得距离1以内一名角色的一张牌。' },
  juedou: { name: '决斗', type: CARD_TYPE.TRICK, target: 'one_other', desc: '与一名角色轮流出【杀】，先不出者受到1点伤害。' },
  taoyuan: { name: '桃园结义', type: CARD_TYPE.TRICK, target: 'all', desc: '所有角色回复1点体力。' },
  wugu: { name: '五谷丰登', type: CARD_TYPE.TRICK, target: 'all', desc: '亮出等量牌，每名角色依次选取一张。' },
  nanman: { name: '南蛮入侵', type: CARD_TYPE.TRICK, target: 'all_other', desc: '其他角色需打出【杀】，否则受到1点伤害。' },
  wanjian: { name: '万箭齐发', type: CARD_TYPE.TRICK, target: 'all_other', desc: '其他角色需打出【闪】，否则受到1点伤害。' },
  jiedao: { name: '借刀杀人', type: CARD_TYPE.TRICK, target: 'jiedao', desc: '令一名装备武器的角色对其攻击范围内你指定的角色出【杀】。' },
  wuxie: { name: '无懈可击', type: CARD_TYPE.TRICK, target: 'nullify', desc: '抵消一张锦囊牌的效果。' },

  // ---------- 延时锦囊 ----------
  lebu: { name: '乐不思蜀', type: CARD_TYPE.DELAYED, target: 'one_other', desc: '判定非红桃则跳过其出牌阶段。' },
  shandian: { name: '闪电', type: CARD_TYPE.DELAYED, target: 'self', desc: '判定为黑桃2~9则受到3点雷电伤害，否则移至下家。' },

  // ---------- 武器 ----------
  zhuge: { name: '诸葛连弩', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 1, desc: '出牌阶段你可以使用任意数量的【杀】。' },
  qinglong: { name: '青龙偃月刀', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, desc: '当你的【杀】被【闪】抵消时，你可以再使用一张【杀】。' },
  cixiong: { name: '雌雄双股剑', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, desc: '【杀】指定异性目标后，可令其弃一张牌或你摸一张牌。' },
  zhangba: { name: '丈八蛇矛', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, desc: '你可以将两张手牌当【杀】使用或打出。' },
  guanshi: { name: '贯石斧', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, desc: '【杀】被抵消时，可弃两张牌强制造成伤害。' },
  fangtian: { name: '方天画戟', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 4, desc: '你的最后一张手牌【杀】可指定至多三名目标。' },
  qilin: { name: '麒麟弓', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 5, desc: '【杀】造成伤害时，可弃置目标一匹坐骑。' },
  hanbing: { name: '寒冰剑', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, desc: '【杀】造成伤害前，可改为弃置目标两张牌。' },

  // ---------- 防具 ----------
  bagua: { name: '八卦阵', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, desc: '需要使用或打出【闪】时，可判定，红色视为打出【闪】。' },
  renwang: { name: '仁王盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, desc: '黑色【杀】对你无效。' },

  // ---------- 坐骑 ----------
  chilu: { name: '的卢', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.DEFENSE_HORSE, desc: '+1马：其他角色与你的距离+1。' },
  jueying: { name: '绝影', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.DEFENSE_HORSE, desc: '+1马：其他角色与你的距离+1。' },
  zixing: { name: '紫骍', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.DEFENSE_HORSE, desc: '+1马：其他角色与你的距离+1。' },
  chitu: { name: '赤兔', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.OFFENSE_HORSE, desc: '-1马：你与其他角色的距离-1。' },
  dawan: { name: '大宛', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.OFFENSE_HORSE, desc: '-1马：你与其他角色的距离-1。' },
  zhuahuang: { name: '爪黄飞电', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.OFFENSE_HORSE, desc: '-1马：你与其他角色的距离-1。' },

  // ========== 炉石杀 · 基本牌（杀类，as:'sha'） ==========
  chongfeng: { name: '冲锋', type: CARD_TYPE.BASIC, as: 'sha', desc: '造成1点普通伤害。' },
  beici: { name: '背刺', type: CARD_TYPE.BASIC, as: 'sha', vsFull: 2, desc: '造成1点伤害；若目标满体力则改为2点。' },
  huoqiu: { name: '火球术', type: CARD_TYPE.BASIC, as: 'sha', vsEquip: 2, desc: '造成1点伤害；若目标有装备则改为2点。' },
  hanbingjian: { name: '寒冰箭', type: CARD_TYPE.BASIC, as: 'sha', freeze: 1, desc: '造成1点伤害，并冻结目标1张手牌。' },
  shandianjian: { name: '闪电箭', type: CARD_TYPE.BASIC, as: 'sha', dmg: 2, overload: 1, desc: '造成2点伤害；过载1（下回合少摸1张）。' },
  linghunzhihuo: { name: '灵魂之火', type: CARD_TYPE.BASIC, as: 'sha', dmg: 2, selfDiscardOnHit: true, desc: '造成2点普通伤害；命中后由目标为你指定弃置一张牌（你没有牌则不弃）。' },
  cigu: { name: '刺骨', type: CARD_TYPE.BASIC, as: 'sha', unblockableIfUsed: true, desc: '造成1点伤害；若本回合此前已用过其他牌，则改为强制伤害（无法被闪避）。' },
  // ========== 闪类（as:'shan'） ==========
  shanbi: { name: '闪避', type: CARD_TYPE.BASIC, as: 'shan', desc: '抵消一次普通伤害。' },
  zanbi: { name: '暂避锋芒', type: CARD_TYPE.BASIC, as: 'shan', immuneNext: true, desc: '抵消一次伤害，并在本回合免疫下一次伤害。' },
  hanbinghuti: { name: '寒冰护体', type: CARD_TYPE.BASIC, as: 'shan', freezeSource: 1, desc: '抵消一次伤害，并冻结伤害来源1张手牌。' },
  anyingdoupeng: { name: '暗影斗篷', type: CARD_TYPE.BASIC, as: 'shan', noShaTarget: true, desc: '抵消一次伤害，本回合内你无法被【杀】指定。' },
  // ========== 桃类（as:'tao'） ==========
  zhiliao: { name: '治疗术', type: CARD_TYPE.BASIC, as: 'tao', desc: '回复1点体力，或濒死救援。' },
  lianjie: { name: '联结治疗', type: CARD_TYPE.BASIC, as: 'tao', healAlly: true, desc: '使一名角色与你各回复1点体力；或濒死救援。' },
  // ========== 酒类（as:'jiu'） ==========
  yueshi: { name: '月蚀', type: CARD_TYPE.BASIC, as: 'jiu', extraSha: true, turnShaBonus: true, desc: '本回合你的所有【杀】伤害+1，且可额外使用一张【杀】；濒死可自救。' },
  rishi: { name: '日蚀', type: CARD_TYPE.BASIC, as: 'jiu', replayNext: true, desc: '本回合你使用的下一张牌视为使用两次；濒死可自救。' },
  huanxiang: { name: '幻象', type: CARD_TYPE.BASIC, as: 'jiu', noRespondNext: true, desc: '本回合你使用的下一张牌无法被其他卡牌或技能响应；濒死可自救（回复1点）。' },
  xuese: { name: '血色', type: CARD_TYPE.BASIC, as: 'jiu', doubleNextDamage: true, desc: '本回合下一名受到伤害的角色所受伤害翻倍；濒死可自救（回复1点）。' },
  jinguang: { name: '金光闪耀', type: CARD_TYPE.BASIC, as: 'tao', heal: 1, bottomPeek: 3, desc: '回复1点体力，然后查看牌库底3张牌：可将任意张按顺序置于牌库顶，其余置入弃牌堆；濒死时可当【桃】救援（回复1点）。' },
  // ========== 锦囊牌 ==========
  xinlingshijie: { name: '心灵视界', type: CARD_TYPE.TRICK, behaves: 'shunshou', noDist: true, target: 'one_has_card', desc: '获得一名角色的一张牌（无距离限制）。' },
  xieelangyu: { name: '邪恶低语', type: CARD_TYPE.TRICK, behaves: 'guohe', discardTrickBonus: true, target: 'one_has_card', desc: '弃置一名角色的一张牌；若弃掉的是锦囊牌，再弃掉其一张牌。' },
  aoshuzhihui: { name: '奥术智慧', type: CARD_TYPE.TRICK, behaves: 'wuzhong', target: 'self', desc: '摸两张牌。' },
  hsjuedou: { name: '决斗', type: CARD_TYPE.TRICK, behaves: 'hsjuedou', target: 'one_other', desc: '与一名角色比较手牌中【杀】的数量（你视为多一张）；较少者受到1点强制伤害，平局则都不受伤。' },
  shengmingzhishu: { name: '生命之树', type: CARD_TYPE.TRICK, behaves: 'taoyuan', fullHeal: true, target: 'all', desc: '所有角色回复至体力上限。' },
  fashufanzhi: { name: '法术反制', type: CARD_TYPE.TRICK, as: 'wuxie', target: 'nullify', desc: '抵消一张锦囊牌对你的效果。' },
  anyanshushi: { name: '暗言术：噬', type: CARD_TYPE.TRICK, behaves: 'nanman', target: 'all_other', desc: '其他角色需打出【杀】，否则受到1点伤害。' },
  daoshan: { name: '刀扇', type: CARD_TYPE.TRICK, behaves: 'daoshan', target: 'all_other', desc: '对所有其他角色造成1点伤害，然后你摸一张牌。' },
  chuqizhisheng: { name: '除奇制胜', type: CARD_TYPE.TRICK, behaves: 'oddhp', target: 'all_other', desc: '对所有体力值为奇数的其他角色造成1点强制伤害。' },
  ksenmianju: { name: '克苏恩面具', type: CARD_TYPE.TRICK, behaves: 'ksenmask', target: 'all_other', desc: '所有其他角色弃置一张锦囊牌，否则受到1点伤害。' },
  kangkaidaifang: { name: '慷慨大方', type: CARD_TYPE.TRICK, behaves: 'kangkai', target: 'one_other', desc: '交给一名角色一张手牌，然后你摸三张牌。' },
  hengchong: { name: '横冲直撞', type: CARD_TYPE.TRICK, behaves: 'hengchong', target: 'one_other', desc: '令一名角色对你指定的、其攻击范围内的角色使用一张【杀】；若其不使用，则其受到1点强制伤害。' },
  anyingbu: { name: '暗影步', type: CARD_TYPE.TRICK, behaves: 'anyingbu', target: 'self', desc: '将你本回合进入弃牌堆的一张牌收回手牌。' },
  zhaomingdan: { name: '照明弹', type: CARD_TYPE.TRICK, behaves: 'zhaomingdan', target: 'self', desc: '抉择：①弃掉场上所有的奥秘，若没有弃掉你的奥秘，则对你造成2点强制伤害；②抽1张牌，然后你可以弃掉场上1张奥秘。' },
  anzhongpohuai: { name: '暗中破坏', type: CARD_TYPE.TRICK, behaves: 'anzhong', target: 'one_has_equip', desc: '弃掉一名角色1张使用中的装备牌（若全场无人使用装备，则改为弃掉一名角色1张牌）。连击（本回合你使用过其他牌）：再弃掉其1张使用中的奥秘或装备牌。' },
  zhenyanshudun: { name: '真言术盾', type: CARD_TYPE.TRICK, behaves: 'zhenyan', target: 'one_any', desc: '将牌库顶1张牌置于一名角色的武将牌上，称为"盾"（1张"盾"抵挡1点伤害，被摧毁后其拥有者抽1张牌）。' },
  zhuanzhuyizhi: { name: '专注意志', type: CARD_TYPE.DELAYED, target: 'one_other', desc: '置入一名角色判定区。其回合开始时判定：红色且点数3~13，其到下回合开始只能使用【杀】【闪】；黑色且点数3~13，其到下回合开始无法使用所有技能。' },
  fengkuangzhizaihuo: { name: '疯狂之灾祸', type: CARD_TYPE.TRICK, behaves: 'fengkuang', target: 'all_other', desc: '所有其他角色需弃置一张【杀】，弃置者视为对其下一名角色使用【冲锋】，未弃置者展示手牌。' },
  // ========== 延时锦囊 ==========
  guldanhand: { name: '古尔丹之手', type: CARD_TYPE.DELAYED, target: 'one_other', desc: '目标回合开始时判定：非梅花则跳过其摸牌阶段；梅花则其本回合加入手牌的牌都会被弃置。' },
  fushishu: { name: '腐蚀术', type: CARD_TYPE.DELAYED, target: 'one_other', desc: '目标回合开始判定：非红桃则跳过其出牌阶段；红桃则其至下回合前无法回复体力。' },
  pingzhuangshandian: { name: '瓶装闪电', type: CARD_TYPE.DELAYED, bottled: true, target: 'self', desc: '指定自己；或额外弃置1张牌后指定一名角色。其回合开始时判定：黑色则受到3点强制伤害，红色则转移到下一名角色。' },
  // ========== 装备·武器 ==========
  susasi: { name: '苏萨斯', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 1, desc: '出牌阶段你使用【杀】无次数限制。' },
  ailunisi: { name: '艾露尼斯', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 1, startDraw: 2, desc: '准备阶段你额外摸两张牌。' },
  worldtree: { name: '世界树嫩枝', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, worldtreeHeal: 3, desc: '当你对一名角色造成伤害后，令其回复3点体力。' },
  sulfuras: { name: '萨弗拉斯', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 4, extraShaWeapon: true, chongfengAsHuoqiu: true, desc: '你的【冲锋】视为【火球术】；你每回合可额外使用一张【杀】。' },
  collider: { name: '超级对撞器', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, colliderEffect: true, desc: '你对一名角色使用【杀】结算后，令其使用一张【杀】并由你指定目标；若其不使用则受到1点强制伤害。' },
  silverspear: { name: '白银之枪', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, silverJudge: true, desc: '你的【杀】被【闪】响应后判定，若判定牌点数大于该【闪】，则此次【闪】无效。' },
  // ========== 装备·防具 ==========
  wukehandong: { name: '无可撼动盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, halve: true, desc: '你受到的伤害减半（向下取整）。' },
  tadun: { name: '塔盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, absorb: 4, noShan: true, desc: '可抵挡共4点伤害然后损坏；你无法使用【闪】。' },
  esinoshield: { name: '埃辛诺斯盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, immuneInstances: 2, desc: '免疫2次伤害，然后损坏。' },
  robe: { name: '防护长袍', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, blockDirectional: true, desc: '其他角色的指向性锦囊牌无法指定你。' },
  // ========== 奥秘（盖放，触发后弃置） ==========
  zhengfa: { name: '蒸发', type: CARD_TYPE.SECRET, on: 'damageAfter', desc: '奥秘：一名角色对你造成伤害后，弃掉其所有装备和奥秘。' },
  zhasi: { name: '诈死', type: CARD_TYPE.SECRET, on: 'death', desc: '奥秘：当你死亡时，你在当前回合结束后复活并具有1点生命。' },
  yiyanhuanyan: { name: '以眼还眼', type: CARD_TYPE.SECRET, on: 'damageAfter', desc: '奥秘：一名角色对你造成伤害后，对其造成等量强制伤害。' },
  xieejimou: { name: '邪恶计谋', type: CARD_TYPE.SECRET, on: 'spells', desc: '奥秘：一名角色使用了2张锦囊牌或奥秘牌后，你抽3张牌。' },
  wudao: { name: '误导', type: CARD_TYPE.SECRET, on: 'trickTarget', desc: '奥秘：1张非范围锦囊牌指定你时，改为指定另外一名角色。' },
  qingsuan: { name: '清算', type: CARD_TYPE.SECRET, on: 'damage', desc: '奥秘：当一名角色造成3点或以上伤害时，使此次伤害无效，然后当前回合立即进入结束阶段。' },
  jiushu: { name: '救赎', type: CARD_TYPE.SECRET, on: 'death', desc: '奥秘：一名角色死亡时，使其复活并具有1点生命，抽1张牌。' },
  binkuai: { name: '寒冰屏障', type: CARD_TYPE.SECRET, on: 'damage', desc: '奥秘：当你受到致命伤害时，免疫此伤害，并在你回合结束前获得免疫。' },
  feigongping: { name: '非公平游戏', type: CARD_TYPE.SECRET, on: 'round', desc: '奥秘：你在一轮中没有受到伤害，抽4张牌。' },
  fangyujuzhen: { name: '防御矩阵', type: CARD_TYPE.SECRET, on: 'damage', desc: '奥秘：一名角色被普通伤害攻击时，使其免疫此次伤害并恢复1点生命。' },
  fashugongming: { name: '法术共鸣', type: CARD_TYPE.SECRET, on: 'spells', desc: '奥秘：一名角色使用锦囊牌或奥秘牌时，使这张牌失效并获得这张牌。' },
  dubiaoxianjing: { name: '毒镖陷阱', type: CARD_TYPE.SECRET, on: 'skill', desc: '奥秘：一名角色发动技能后，对其造成1点普通伤害2次。' },
  chaoxi: { name: '抄袭', type: CARD_TYPE.SECRET, on: 'turnEnd', desc: '奥秘：一名角色回合结束后，获得其在此回合所有使用的牌（包括装备和奥秘）。' },
  bushuxianjing: { name: '捕鼠陷阱', type: CARD_TYPE.SECRET, on: 'cards', desc: '奥秘：当一名角色在自己的回合中累计使用3张牌时，你抽1张牌，并使其获得"过载2"。' },
  bingshuangxianjing: { name: '冰霜陷阱', type: CARD_TYPE.SECRET, on: 'spells', desc: '奥秘：一名角色使用锦囊或奥秘时，冻结此牌，并再冻结其2张牌，这些牌在其下回合结束后解冻。' },
  baozhafuwen: { name: '爆炸符文', type: CARD_TYPE.SECRET, on: 'equips', desc: '奥秘：当一名角色使用1张装备或奥秘时，弃掉这张牌，再弃掉其1张牌。' },

  // ========== 补全·武器 ==========
  wanqian: { name: '万千箴言剑', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 5, seventhOnly: true, discardAllOnTarget: true, desc: '仅能作为你本回合打出的第7张牌使用。当你的【杀】指定一名角色时，弃掉其所有牌。' },
  valanyr: { name: '瓦兰奈尔', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, recycleFreeze: true, desc: '进入弃牌堆时，你摸1张牌。若你回合结束时此牌仍在弃牌堆，则将其收回手牌并冻结。' },
  regicide: { name: '弑君', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, equipBackstab: true, toDeckTop: true, desc: '装备时视为凭空使用1张【背刺】。此牌进入弃牌堆时，改为置于牌堆顶。' },
  runblade: { name: '伦鲁迪洛尔', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 3, discardSuitsRefill: true, desc: '装备时，你可以弃掉3张不同花色的牌，然后将手牌摸至手牌上限。' },
  runespear: { name: '符文之矛', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, drawAfterSha: 2, durability: 3, desc: '你使用【杀】结算后摸2张牌并立即使用；触发3次后此武器损坏。' },
  esinosblade: { name: '埃辛诺斯刃', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 1, dynamicRange: 'drawnThisTurn', noShanIfFew: true, desc: '攻击范围X等于你本回合摸牌数。在你的回合，手牌数小于你攻击范围的角色无法使用【闪】。' },
  // ========== 克苏恩·破碎部件（抽到/判定到立即触发，使克苏恩受益）==========
  cthunheart: { name: '克苏恩之心', type: CARD_TYPE.BASIC, shard: 'heart', desc: '破碎：克苏恩体力上限+1并回复1点。' },
  cthuneye: { name: '克苏恩之眼', type: CARD_TYPE.BASIC, shard: 'eye', desc: '破碎：克苏恩获得3张【冲锋】。' },
  cthunbody: { name: '克苏恩之躯', type: CARD_TYPE.BASIC, shard: 'body', desc: '破碎：克苏恩回复2点体力。' },
  cthunmouth: { name: '克苏恩之口', type: CARD_TYPE.BASIC, shard: 'mouth', desc: '破碎：克苏恩摸3张牌。' },
  // ========== 艾萨拉·沉落宝藏（由“远古圣物”获得，不在基础牌堆）==========
  shangguhaojiao: { name: '上古号角', type: CARD_TYPE.TRICK, behaves: 'haojiao', target: 'self', desc: '从武将牌中抽取5张，获得其中1名角色的锁定技或回合技。（沉落宝藏）' },
  salatasi: { name: '萨拉塔斯', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.WEAPON, range: 2, desc: '当你使用本回合的第n张牌时，你可以对所有与你距离为n的角色造成n点普通伤害。（沉落宝藏）' },
  chaoxizhishi: { name: '潮汐之石', type: CARD_TYPE.TRICK, behaves: 'chaoshi', target: 'self', desc: '抽5张牌，并跳过本回合弃牌阶段。（沉落宝藏）' },
  chaoxizhijie: { name: '潮汐之戒', type: CARD_TYPE.TRICK, behaves: 'chaojie', target: 'self', noResponse: true, desc: '该牌视为你使用的上一张基本或锦囊牌，且不受使用限制（无视次数与距离）；当该牌被使用时，所有技能和卡牌都无法响应此牌。（沉落宝藏）' },

  // ========== 补全·防具 ==========
  rebirtharmor: { name: '复活之甲', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, capDamage: 1, offTurnCap: 3, desc: '你每次最多受到1点伤害。在你回合外的一轮中，你最多受到3点伤害。' },
  bombshield: { name: '防爆护盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, bombConvert: true, desc: '当你将受到源于卡牌的伤害时，改为视为该牌使用者对你使用1张【冲锋】。在你回合外的一轮中，你可凭空使用1次【闪避】。' },
  iceshield: { name: '凝冰护盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, immuneNonDiamondSha: true, desc: '免疫红桃、黑桃、梅花花色的【杀】。在你的下回合开始时，失去对红桃【杀】的免疫。' },
  cloudshield: { name: '淡云圆盾', type: CARD_TYPE.EQUIP, slot: EQUIP_SLOT.ARMOR, offTurnImmune: true, desc: '从你回合结束到下回合开始，你可免疫一次伤害。' },
};

// 卡牌“角色”：变体卡（炉石杀）通过 def.as 复用 杀/闪/桃/酒 的结算，无 as 时退化为 kind
export const cardAs = (c) => (c ? (CARD_DEFS[c.kind]?.as || c.kind) : '');
// 便捷判断（按角色，兼容变体卡）
export const isSha = (c) => cardAs(c) === 'sha';
export const isShan = (c) => cardAs(c) === 'shan';
export const isTao = (c) => cardAs(c) === 'tao';
export const isJiu = (c) => cardAs(c) === 'jiu';
export const cardType = (kind) => CARD_DEFS[kind]?.type;
export const cardName = (kind) => CARD_DEFS[kind]?.name || kind;

// ---------- 牌堆构成（贴近基础版，合计 108 张） ----------
// 每条 [kind, suit, number]
const DECK_LIST = [
  // 杀 (普通杀 不分火雷，30 张)
  ...gen('sha', [
    [SUIT.SPADE, 7], [SUIT.SPADE, 8], [SUIT.SPADE, 8], [SUIT.SPADE, 9], [SUIT.SPADE, 9],
    [SUIT.SPADE, 10], [SUIT.SPADE, 10], [SUIT.CLUB, 2], [SUIT.CLUB, 3], [SUIT.CLUB, 4],
    [SUIT.CLUB, 5], [SUIT.CLUB, 6], [SUIT.CLUB, 7], [SUIT.CLUB, 8], [SUIT.CLUB, 8],
    [SUIT.CLUB, 9], [SUIT.CLUB, 9], [SUIT.CLUB, 10], [SUIT.CLUB, 10], [SUIT.CLUB, 11],
    [SUIT.HEART, 10], [SUIT.HEART, 10], [SUIT.HEART, 11], [SUIT.DIAMOND, 6], [SUIT.DIAMOND, 7],
    [SUIT.DIAMOND, 8], [SUIT.DIAMOND, 9], [SUIT.DIAMOND, 10], [SUIT.DIAMOND, 11], [SUIT.DIAMOND, 13],
  ]),
  // 闪 (15 张，均为红色)
  ...gen('shan', [
    [SUIT.HEART, 2], [SUIT.HEART, 2], [SUIT.HEART, 13], [SUIT.DIAMOND, 2], [SUIT.DIAMOND, 2],
    [SUIT.DIAMOND, 3], [SUIT.DIAMOND, 4], [SUIT.DIAMOND, 5], [SUIT.DIAMOND, 6], [SUIT.DIAMOND, 7],
    [SUIT.DIAMOND, 8], [SUIT.DIAMOND, 9], [SUIT.DIAMOND, 10], [SUIT.DIAMOND, 11], [SUIT.DIAMOND, 11],
  ]),
  // 桃 (8 张，红色)
  ...gen('tao', [
    [SUIT.HEART, 3], [SUIT.HEART, 4], [SUIT.HEART, 6], [SUIT.HEART, 7],
    [SUIT.HEART, 8], [SUIT.HEART, 9], [SUIT.HEART, 12], [SUIT.DIAMOND, 12],
  ]),
  // 酒 (1 张)
  ...gen('jiu', [[SUIT.SPADE, 9]]),

  // 无中生有 (4)
  ...gen('wuzhong', [[SUIT.HEART, 7], [SUIT.HEART, 8], [SUIT.HEART, 9], [SUIT.HEART, 11]]),
  // 过河拆桥 (6)
  ...gen('guohe', [
    [SUIT.SPADE, 3], [SUIT.SPADE, 4], [SUIT.SPADE, 12], [SUIT.CLUB, 3], [SUIT.CLUB, 4], [SUIT.HEART, 12],
  ]),
  // 顺手牵羊 (5)
  ...gen('shunshou', [
    [SUIT.SPADE, 3], [SUIT.SPADE, 4], [SUIT.SPADE, 11], [SUIT.DIAMOND, 3], [SUIT.DIAMOND, 4],
  ]),
  // 决斗 (3)
  ...gen('juedou', [[SUIT.SPADE, 1], [SUIT.CLUB, 1], [SUIT.DIAMOND, 1]]),
  // 桃园结义 (1)
  ...gen('taoyuan', [[SUIT.HEART, 1]]),
  // 五谷丰登 (2)
  ...gen('wugu', [[SUIT.HEART, 3], [SUIT.HEART, 4]]),
  // 南蛮入侵 (3)
  ...gen('nanman', [[SUIT.SPADE, 7], [SUIT.SPADE, 13], [SUIT.CLUB, 7]]),
  // 万箭齐发 (1)
  ...gen('wanjian', [[SUIT.HEART, 1]]),
  // 借刀杀人 (2)
  ...gen('jiedao', [[SUIT.CLUB, 12], [SUIT.CLUB, 13]]),
  // 无懈可击 (4)
  ...gen('wuxie', [[SUIT.SPADE, 11], [SUIT.SPADE, 12], [SUIT.CLUB, 12], [SUIT.CLUB, 13]]),
  // 乐不思蜀 (3)
  ...gen('lebu', [[SUIT.SPADE, 6], [SUIT.HEART, 6], [SUIT.CLUB, 6]]),
  // 闪电 (2)
  ...gen('shandian', [[SUIT.SPADE, 1], [SUIT.HEART, 12]]),

  // ---------- 装备 ----------
  ...gen('zhuge', [[SUIT.CLUB, 1], [SUIT.DIAMOND, 1]]),
  ...gen('qinglong', [[SUIT.SPADE, 5]]),
  ...gen('cixiong', [[SUIT.SPADE, 2]]),
  ...gen('zhangba', [[SUIT.SPADE, 12]]),
  ...gen('guanshi', [[SUIT.DIAMOND, 5]]),
  ...gen('fangtian', [[SUIT.DIAMOND, 12]]),
  ...gen('qilin', [[SUIT.HEART, 5]]),
  ...gen('hanbing', [[SUIT.SPADE, 2]]),
  ...gen('bagua', [[SUIT.SPADE, 2], [SUIT.CLUB, 2]]),
  ...gen('renwang', [[SUIT.CLUB, 2]]),
  ...gen('chilu', [[SUIT.HEART, 5]]),
  ...gen('jueying', [[SUIT.SPADE, 5]]),
  ...gen('zixing', [[SUIT.HEART, 13]]),
  ...gen('chitu', [[SUIT.HEART, 5]]),
  ...gen('dawan', [[SUIT.SPADE, 13]]),
  ...gen('zhuahuang', [[SUIT.HEART, 13]]),
];

function gen(kind, list) {
  return list.map(([suit, number]) => ({ kind, suit, number }));
}

// 炉石杀牌堆：按张数自动循环分配花色/点数
const SUITS_CYCLE = [SUIT.SPADE, SUIT.HEART, SUIT.CLUB, SUIT.DIAMOND];
let _hsi = 0;
function genN(kind, count) {
  const arr = [];
  for (let i = 0; i < count; i++, _hsi++) arr.push({ kind, suit: SUITS_CYCLE[_hsi % 4], number: (_hsi % 13) + 1 });
  return arr;
}
const HS_DECK_LIST = [
  // 杀类
  ...genN('chongfeng', 10), ...genN('beici', 6), ...genN('huoqiu', 6), ...genN('hanbingjian', 6),
  ...genN('shandianjian', 5), ...genN('linghunzhihuo', 6), ...genN('cigu', 4),
  // 闪类
  ...genN('shanbi', 8), ...genN('zanbi', 6), ...genN('hanbinghuti', 4), ...genN('anyingdoupeng', 6),
  // 桃 / 酒
  ...genN('zhiliao', 9), ...genN('lianjie', 3), ...genN('yueshi', 3), ...genN('rishi', 3),
  // 锦囊（即时）
  ...genN('xinlingshijie', 6), ...genN('xieelangyu', 4), ...genN('aoshuzhihui', 4), ...genN('hsjuedou', 3),
  ...genN('shengmingzhishu', 2), ...genN('fashufanzhi', 5), ...genN('anyanshushi', 3), ...genN('daoshan', 2),
  ...genN('chuqizhisheng', 2), ...genN('ksenmianju', 3), ...genN('kangkaidaifang', 2),
  ...genN('hengchong', 3), ...genN('anyingbu', 2), ...genN('fengkuangzhizaihuo', 1),
  // 锦囊（延时）
  ...genN('fushishu', 3), ...genN('pingzhuangshandian', 1), ...genN('guldanhand', 2),
  // 装备·武器（全 12 件）
  ...genN('susasi', 1), ...genN('ailunisi', 1), ...genN('worldtree', 1), ...genN('sulfuras', 1),
  ...genN('collider', 1), ...genN('silverspear', 1), ...genN('wanqian', 1), ...genN('valanyr', 1),
  ...genN('regicide', 1), ...genN('runblade', 1), ...genN('runespear', 1), ...genN('esinosblade', 1),
  // 装备·防具（全 8 件）
  ...genN('wukehandong', 1), ...genN('tadun', 1), ...genN('esinoshield', 1), ...genN('robe', 1),
  ...genN('rebirtharmor', 1), ...genN('bombshield', 1), ...genN('iceshield', 1), ...genN('cloudshield', 1),
  // 奥秘（全 16 种，每种 1 张，花色点数与卡面一致）
  { kind: 'zhengfa', suit: 'heart', number: 8 },
  { kind: 'zhasi', suit: 'club', number: 11 },
  { kind: 'yiyanhuanyan', suit: 'diamond', number: 7 },
  { kind: 'xieejimou', suit: 'club', number: 9 },
  { kind: 'wudao', suit: 'spade', number: 9 },
  { kind: 'qingsuan', suit: 'diamond', number: 11 },
  { kind: 'jiushu', suit: 'diamond', number: 7 },
  { kind: 'binkuai', suit: 'heart', number: 6 },
  { kind: 'feigongping', suit: 'heart', number: 10 },
  { kind: 'fangyujuzhen', suit: 'diamond', number: 8 },
  { kind: 'fashugongming', suit: 'heart', number: 9 },
  { kind: 'dubiaoxianjing', suit: 'spade', number: 7 },
  { kind: 'chaoxi', suit: 'club', number: 7 },
  { kind: 'bushuxianjing', suit: 'spade', number: 11 },
  { kind: 'bingshuangxianjing', suit: 'spade', number: 5 },
  { kind: 'baozhafuwen', suit: 'heart', number: 2 },
  // 反奥秘/反装备锦囊（照明弹×4、暗中破坏×4，花色点数按卡面）
  { kind: 'zhaomingdan', suit: 'heart', number: 4 },
  { kind: 'zhaomingdan', suit: 'heart', number: 4 },
  { kind: 'zhaomingdan', suit: 'heart', number: 4 },
  { kind: 'zhaomingdan', suit: 'heart', number: 4 },
  { kind: 'anzhongpohuai', suit: 'spade', number: 4 },
  { kind: 'anzhongpohuai', suit: 'spade', number: 4 },
  { kind: 'anzhongpohuai', suit: 'spade', number: 4 },
  { kind: 'anzhongpohuai', suit: 'spade', number: 4 },
  // 幻象×2 / 血色×2（酒变体）、专注意志×2（延时）、真言术盾×3（花色点数按卡面）
  { kind: 'huanxiang', suit: 'club', number: 11 },
  { kind: 'huanxiang', suit: 'club', number: 11 },
  { kind: 'xuese', suit: 'club', number: 8 },
  { kind: 'xuese', suit: 'club', number: 8 },
  { kind: 'zhuanzhuyizhi', suit: 'heart', number: 12 },
  { kind: 'zhuanzhuyizhi', suit: 'heart', number: 12 },
  { kind: 'zhenyanshudun', suit: 'diamond', number: 2 },
  { kind: 'zhenyanshudun', suit: 'diamond', number: 2 },
  { kind: 'zhenyanshudun', suit: 'diamond', number: 2 },
  // 金光闪耀×3（溯源·桃，花色点数按卡面）
  { kind: 'jinguang', suit: 'heart', number: 2 },
  { kind: 'jinguang', suit: 'heart', number: 2 },
  { kind: 'jinguang', suit: 'heart', number: 2 },
];

// 图鉴用：各包包含的卡牌种类（HS 含不在常规牌堆中的破碎/沉落宝藏）
export const SGS_KINDS = [...new Set(DECK_LIST.map((c) => c.kind))];
export const HS_KINDS = [...new Set([
  ...HS_DECK_LIST.map((c) => c.kind),
  'cthunheart', 'cthuneye', 'cthunbody', 'cthunmouth', 'shangguhaojiao', 'salatasi', 'chaoxizhishi', 'chaoxizhijie',
])];

function makeCards(list) {
  return list.map((c) => {
    const def = CARD_DEFS[c.kind];
    return {
      id: uid('card'), kind: c.kind, name: def.name, type: def.type,
      suit: c.suit, number: c.number, red: isRed(c.suit), slot: def.slot, range: def.range,
    };
  });
}

// 构造一副新牌（每张带唯一 id），返回洗好的牌堆
export function buildDeck(pack = 'sgs') {
  return shuffle(makeCards(pack === 'hs' ? HS_DECK_LIST : DECK_LIST));
}

// 生成一张“虚拟牌”（技能转化用，如武圣把红牌当杀）
export function virtualCard(kind, sourceCards, extra = {}) {
  const def = CARD_DEFS[kind];
  return {
    id: uid('vcard'),
    virtual: true,
    kind,
    name: def.name,
    type: def.type,
    suit: extra.suit ?? (sourceCards[0]?.suit || SUIT.SPADE),
    number: extra.number ?? (sourceCards[0]?.number || 0),
    red: extra.red ?? (sourceCards[0]?.red || false),
    sourceCards: sourceCards.slice(),
    slot: def.slot,
    range: def.range,
    ...extra,
  };
}
