// ====================== 出牌 / 响应 选项（人机共用） ======================
import { CARD_DEFS, virtualCard, isSha, isShan, isTao, isJiu } from './cards.js';
import { CARD_TYPE, EQUIP_SLOT, isRed, isBlack } from './constants.js';
import { hasSkill } from './skills.js';
import { canUseSha, shaTargets, validTargets, hasAnyCard, hasArmorKind, hasWeaponKind, bottledTargets } from './effects.js';
import { discardableCards } from './zones.js';

const usable = (c) => !c.frozen; // 冻结的牌不能使用/打出

// 可作为【闪】打出的选项
export function shanOptions(engine, p) {
  const out = [];
  if (hasArmorKind(p, 'tadun')) return out; // 塔盾：无法使用闪
  p.hand.forEach((c) => { if (isShan(c) && usable(c)) out.push({ label: c.name, card: c }); });
  if (hasSkill(p, 'longdan')) {
    p.hand.forEach((c) => { if (isSha(c) && usable(c)) out.push({ label: '杀→闪(龙胆)', card: virtualCard('shan', [c], { suit: c.suit, number: c.number, red: c.red }) }); });
  }
  if (hasSkill(p, 'huoyan')) { // 火眼：杀可当闪避
    p.hand.forEach((c) => { if (isSha(c) && usable(c)) out.push({ label: '杀→闪避(火眼)', card: virtualCard('shan', [c], { suit: c.suit, number: c.number, red: c.red }) }); });
  }
  return out;
}

// 可作为【杀】打出/使用的选项
export function shaOptions(engine, p) {
  const out = [];
  p.hand.forEach((c) => { if (isSha(c) && usable(c)) out.push({ label: c.name, card: c }); });
  if (hasSkill(p, 'wusheng')) {
    p.hand.forEach((c) => { if (c.red && !isSha(c) && usable(c)) out.push({ label: '红牌→杀(武圣)', card: virtualCard('sha', [c], { suit: c.suit, number: c.number, red: true }) }); });
  }
  if (hasSkill(p, 'longdan')) {
    p.hand.forEach((c) => { if (isShan(c) && usable(c)) out.push({ label: '闪→杀(龙胆)', card: virtualCard('sha', [c], { suit: c.suit, number: c.number, red: c.red }) }); });
  }
  if (hasWeaponKind(p, 'zhangba') && p.hand.filter(usable).length >= 2 && !out.length) {
    const two = p.hand.filter(usable).slice(0, 2);
    out.push({ label: '两张手牌→杀(丈八)', card: virtualCard('sha', two, { suit: two[0].suit }) });
  }
  return out;
}

// 可作为【桃】使用的选项（含濒死救援）
export function peachOptions(engine, p, forDying = false, dying = null) {
  const out = [];
  if (p.flags?.onlyShaShan) return out; // 专注意志（红判定）：只能使用杀/闪
  if (hasSkill(p, 'haigu') && !forDying) return out; // 骸骨重铸：桃仅濒死可用
  p.hand.forEach((c) => { if (isTao(c) && usable(c)) out.push({ label: c.name, card: c }); });
  // 【酒】只能在响应者本人濒死时自救，不能用于救援其他角色。
  p.hand.forEach((c) => { if (isJiu(c) && forDying && dying === p && usable(c)) out.push({ label: c.name, card: c }); });
  if (hasSkill(p, 'jijiu')) {
    p.hand.forEach((c) => { if (c.red && !isTao(c) && usable(c)) out.push({ label: '红牌→桃(急救)', card: virtualCard('tao', [c], { suit: c.suit, red: true }) }); });
  }
  return out;
}

export function wuxieOptions(p) {
  if (p.flags?.onlyShaShan) return []; // 专注意志（红判定）：只能使用杀/闪
  return p.hand.filter((c) => (c.kind === 'wuxie' || CARD_DEFS[c.kind]?.as === 'wuxie') && !c.frozen).map((c) => ({ label: c.name, card: c }));
}

const NEED_TARGET = ['one_other', 'one_any', 'one_has_card', 'one_has_equip', 'one_in_1_has_card', 'jiedao'];

// 出牌阶段：某张手牌可以被“当作什么”使用（含技能转化），返回可选动作
export function cardPlayOptions(engine, p, card) {
  const opts = [];
  const def = CARD_DEFS[card.kind];
  if (card.frozen) return opts; // 冻结牌不可用

  // 自然用法
  if (def.type === CARD_TYPE.EQUIP) {
    // 万千箴言剑：仅能作为本回合打出的第7张牌使用（已用恰好6张时才可用，更多则错过时机）
    if (def.seventhOnly && (p.flags?.cardsUsed || 0) !== 6) return opts;
    opts.push({ kind: card.kind, asName: card.name, card, needTarget: false });
  } else if (def.type === CARD_TYPE.DELAYED) {
    if (card.kind === 'pingzhuangshandian') {
      // 瓶装闪电：①指定自己 ②额外弃1张牌指定一名其他角色
      if (!p.judge.some((j) => j.kind === card.kind)) opts.push({ kind: card.kind, asName: '瓶装闪电·指定自己', card, needTarget: false });
      if (p.hand.length >= 2 && bottledTargets(engine, p).length) opts.push({ kind: card.kind, asName: '瓶装闪电·弃1牌指定他人', card, needTarget: true, bottledOther: true });
    } else if (def.behaves === 'shandian' || card.kind === 'shandian') {
      // 闪电：指向自己，无需选目标，且不可重复放置
      if (!p.judge.some((j) => j.kind === card.kind)) opts.push({ kind: card.kind, asName: card.name, card, needTarget: false });
    } else {
      opts.push({ kind: card.kind, asName: card.name, card, needTarget: true });
    }
  } else if (isSha(card)) {
    if (canUseSha(engine, p) && shaTargets(engine, p, card).length) opts.push({ kind: 'sha', asName: def.name, card, needTarget: true });
  } else if (isTao(card)) {
    if (def.healAlly) {
      // 联结治疗：使一名角色与你各回1，需选一名其他角色（你或他受伤即可用）
      const others = engine.alivePlayers.filter((x) => x.id !== p.id);
      if (others.length && (p.hp < p.maxHp || others.some((x) => x.hp < x.maxHp))) opts.push({ kind: 'lianjie', asName: def.name, card, needTarget: true });
    } else if (p.hp < p.maxHp) opts.push({ kind: 'tao', asName: def.name, card, needTarget: false });
  } else if (isJiu(card)) {
    if (!p.flags.jiuUsed) opts.push({ kind: 'jiu', asName: def.name, card, needTarget: false });
  } else if (isShan(card)) {
    // 闪类不能主动使用
  } else if (def.type === CARD_TYPE.SECRET) {
    if (!(p.secrets || []).some((s) => s.kind === card.kind)) opts.push({ kind: card.kind, asName: '设置奥秘', card, needTarget: false });
  } else if (card.kind === 'anyingbu') {
    // 暗影步：仅当本回合有可收回的牌时可用
    const recall = (engine.turnRecallable || []).filter((c) => engine.discard.includes(c) && c.id !== card.id);
    if (recall.length) opts.push({ kind: card.kind, asName: card.name, card, needTarget: false });
  } else if (def.type === CARD_TYPE.TRICK && def.as !== 'wuxie' && card.kind !== 'wuxie') {
    const needT = NEED_TARGET.includes(def.target);
    const tgts = validTargets(engine, p, card);
    if (!needT || tgts.length) opts.push({ kind: card.kind, asName: card.name, card, needTarget: needT });
  }

  // 技能转化
  if (hasSkill(p, 'wusheng') && card.red && !isSha(card) && canUseSha(engine, p)) {
    const v = virtualCard('sha', [card], { suit: card.suit, number: card.number, red: true });
    if (shaTargets(engine, p).length) opts.push({ kind: 'sha', asName: '武圣·杀', card: v, needTarget: true });
  }
  if (hasSkill(p, 'longdan') && isShan(card) && canUseSha(engine, p)) {
    const v = virtualCard('sha', [card], { suit: card.suit, number: card.number, red: card.red });
    if (shaTargets(engine, p).length) opts.push({ kind: 'sha', asName: '龙胆·杀', card: v, needTarget: true });
  }
  if (hasSkill(p, 'qixi') && isBlack(card.suit) && !card.kind.startsWith('v')) {
    const v = virtualCard('guohe', [card], { suit: card.suit, number: card.number });
    if (validTargets(engine, p, v).length) opts.push({ kind: 'guohe', asName: '奇袭·过河拆桥', card: v, needTarget: true });
  }
  // 专注意志（红判定）：到下回合开始只能使用【杀】【闪】
  if (p.flags?.onlyShaShan) return opts.filter((o) => o.card && (isSha(o.card) || isShan(o.card)));
  return opts;
}

// 出牌阶段：当前可发动的主动技能
export function activeSkillOptions(engine, p) {
  const out = [];
  const can = (k) => hasSkill(p, k);
  const discardable = discardableCards(p);
  const unfrozenDiscardable = discardable.filter((c) => !p.hand.includes(c) || usable(c));
  if (can('zhiheng') && !p.skillState.zhihengUsed && discardable.length) out.push({ skill: 'zhiheng', name: '制衡' });
  if (can('rende') && p.hand.length && engine.alivePlayers.length > 1) out.push({ skill: 'rende', name: '仁德' });
  if (can('kurou')) out.push({ skill: 'kurou', name: '苦肉' });
  if (can('qingnang') && !p.skillState.qingnangUsed && p.hand.length) out.push({ skill: 'qingnang', name: '青囊' });
  if (can('fanjian') && !p.skillState.fanjianUsed && p.hand.length && engine.alivePlayers.length > 1) out.push({ skill: 'fanjian', name: '反间' });
  if (can('lijian') && !p.skillState.lijianUsed && discardable.length) {
    const males = engine.alivePlayers.filter((x) => x.gender === 'male');
    if (males.length >= 2) out.push({ skill: 'lijian', name: '离间' });
  }
  // ---- 炉石杀主动技（每回合一次，状态记在 flags） ----
  const others = engine.alivePlayers.length > 1;
  if (can('kuangbao') && !p.flags.kuangbaoUsed && others) out.push({ skill: 'kuangbao', name: '狂暴' });
  if (can('yinxue') && !p.flags.yinxueUsed && discardable.length) out.push({ skill: 'yinxue', name: '饮血' });
  // 虚空能量：体力≤2时禁用光明能量
  if (can('guangming') && !p.flags.guangmingUsed && discardable.length && engine.alivePlayers.length >= 2 && !(hasSkill(p, 'xukong') && p.hp <= 2)) out.push({ skill: 'guangming', name: '光明能量' });
  if (can('linghun') && !p.flags.linghunUsed && others) out.push({ skill: 'linghun', name: '灵魂分流' });
  if (can('xixue') && !p.flags.xixueUsed && engine.alivePlayers.length >= 2) out.push({ skill: 'xixue', name: '吸血' });
  if (can('xiehuo') && !p.flags.xiehuoUsed && discardable.length >= 2 && others) out.push({ skill: 'xiehuo', name: '邪火' });
  if (can('shenpan') && !p.flags.shenpanUsed && others) out.push({ skill: 'shenpan', name: '审判烈焰' });
  if (can('bingfeng') && !p.flags.bingfengUsed && others) out.push({ skill: 'bingfeng', name: '冰封' });
  if (can('xuwu') && !p.flags.xuwuUsed && discardable.length && others) out.push({ skill: 'xuwu', name: '虚无' });
  if (can('xuerou') && !p.flags.xuerouUsed && others) out.push({ skill: 'xuerou', name: '血肉成灰' });
  if (can('lianyu') && !p.skillState.lianyuUsed && others) out.push({ skill: 'lianyu', name: '炼狱(限)' });
  if (can('tunshi') && !p.flags.tunshiUsed && others) out.push({ skill: 'tunshi', name: '吞噬' });
  if (can('liexin') && !p.flags.liexinUsed && others) out.push({ skill: 'liexin', name: '裂心' });
  if (can('fanzhao') && !p.flags.fanzhaoUsed && engine.discard.length) out.push({ skill: 'fanzhao', name: '翻找' });
  if (can('xuanzhuan') && (p.flags.xuanzhuanCount || 0) < 3 && others) out.push({ skill: 'xuanzhuan', name: '旋转' });
  if (can('hanshuang') && !p.flags.hanshuangUsed && others) out.push({ skill: 'hanshuang', name: '寒霜' });
  if (can('duwu') && !p.flags.duwuUsed && others) out.push({ skill: 'duwu', name: '毒雾' });
  if (can('monengshandian') && !p.flags.monengUsed && engine.alivePlayers.length >= 3 && discardable.length) out.push({ skill: 'monengshandian', name: '魔能闪电' });
  if (can('daidu') && !p.flags.daiduUsed && unfrozenDiscardable.length >= 3 && others) out.push({ skill: 'daidu', name: '歹毒' });
  if (can('dihou') && !p.flags.dihouUsed && others) out.push({ skill: 'dihou', name: '低吼' });
  if (can('huoyan') && (p.pile || []).filter((c) => isSha(c)).length >= 5 && others) out.push({ skill: 'huoyan', name: '火眼' });
  if (can('lijian2') && !p.flags.lijian2Used && others) out.push({ skill: 'lijian2', name: '利箭' });
  const xintuCards = (p.pile || []).filter((c) => {
    const ty = CARD_DEFS[c.kind]?.type;
    return isBlack(c.suit) && (ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK);
  });
  if (can('xintu') && !p.skillState.xintuUsed && xintuCards.length) out.push({ skill: 'xintu', name: '信徒(限)' });
  const twinCards = (p.pile || []).filter((c) => c.twinStoredBy === p.id);
  if (can('shikongmen') && !p.flags.shikongmenUsed && twinCards.length >= 4) {
    out.push({ skill: 'shikongmen', name: '时空之门' });
  }
  if (can('mingyun') && !p.flags.mingyunUsed) out.push({ skill: 'mingyun', name: '命运之轮' });
  if (can('fushi2') && !p.flags.fushi2Used && unfrozenDiscardable.length) out.push({ skill: 'fushi2', name: '腐蚀' });
  if (can('diyu') && !p.flags.diyuUsed && others) out.push({ skill: 'diyu', name: '低语' });
  if (can('yuanyuhuo') && !p.flags.yuanyuhuoUsed) out.push({ skill: 'yuanyuhuo', name: '渊狱火' });
  if (can('anyingjian') && !p.flags.anyingjianUsed && others) out.push({ skill: 'anyingjian', name: '暗影箭雨' });
  if (can('xuehou') && !p.skillState.xuehouUsed && p.equips[EQUIP_SLOT.WEAPON] && p.hand.filter(usable).length >= 2 && others) out.push({ skill: 'xuehou', name: '血吼(限)' });
  if (can('shenyuanhao') && !p.skillState.shenyuanUsed && others) out.push({ skill: 'shenyuanhao', name: '深渊之号(限)' });
  if (can('qtanying') && !p.skillState.qtanyingUsed && others) out.push({ skill: 'qtanying', name: '群体暗影(限)' });
  if (can('bhlinghun') && !p.skillState.bhlinghunUsed && (p.blades || 0) >= 6 && others) out.push({ skill: 'bhlinghun', name: '捕获灵魂(限)' });
  // 恩佐斯
  if (can('shenyuan2')) {
    const pile = p.pile || [];
    const suits = new Set(pile.map((c) => c.suit));
    const hasPair = Object.values(pile.reduce((m, c) => { (m[c.suit] = m[c.suit] || 0); m[c.suit]++; return m; }, {})).some((n) => n >= 2);
    if (suits.size >= 4 || hasPair) out.push({ skill: 'shenyuan2', name: '深渊' });
  }
  if (can('suxing') && !p.skillState.suxingUsed) out.push({ skill: 'suxing', name: '苏醒(限)' });
  return out;
}

// 目标合法性（暴露给 UI）
export { validTargets, canUseSha, shaTargets, hasAnyCard, bottledTargets } from './effects.js';
