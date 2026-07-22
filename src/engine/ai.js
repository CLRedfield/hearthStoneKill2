// ====================== AI 决策 ======================
import { REQ, EQUIP_SLOT, SUIT, isRed } from './constants.js';
import { isSha, isShan, isTao, CARD_DEFS } from './cards.js';
import { hasSkill } from './skills.js';
import {
  shanOptions, shaOptions, peachOptions, wuxieOptions,
  cardPlayOptions, activeSkillOptions, validTargets, canUseSha, shaTargets, bottledTargets,
} from './responses.js';
import { sleep, pickRandom } from '../util.js';

// AI 难度 → 行动随机性（chaos 越高越随机、越弱）
export const AI_CHAOS = { easy: 0.62, normal: 0.30, hard: 0.05 };
export const AI_DIFFICULTY_NAME = { easy: '简单', normal: '普通', hard: '困难' };

// 牌价值评估（用于弃牌 / 观星 / 制衡）
export function cardValue(c) {
  if (!c) return 0; // 容错：无 card 的选项（如“受到X点伤害”）
  const base = {
    tao: 9, jiu: 5, wuxie: 8, sha: 6, shan: 6,
    wuzhong: 7, taoyuan: 6, wugu: 5, guohe: 5, shunshou: 5, juedou: 5,
    nanman: 4, wanjian: 4, jiedao: 4, lebu: 4, shandian: 2,
    zhuge: 8, qinglong: 7, zhangba: 6, qilin: 6, cixiong: 6, guanshi: 6, fangtian: 6, hanbing: 6,
    bagua: 7, renwang: 7, chitu: 6, dawan: 5, zhuahuang: 6, chilu: 5, jueying: 5, zixing: 5,
    jinguang: 8, huanxiang: 5, xuese: 5,
    shangguhaojiao: 8, salatasi: 7, chaoxizhishi: 8, chaoxizhijie: 7,
  };
  return base[c.kind] ?? 4;
}

export class AIAgent {
  constructor(opts = {}) {
    this.kind = 'ai';
    this.chaos = opts.chaos ?? AI_CHAOS.normal; // 0=最强(纯启发式) 1=纯随机
  }
  roll() { return Math.random() < this.chaos; } // 是否“犯随机”

  async respond(req) {
    await sleep(140 + Math.random() * 160);
    switch (req.type) {
      case REQ.CHOOSE_OPTION: return this.chooseOption(req);
      case REQ.ASK_DODGE: return this.askDodge(req);
      case REQ.ASK_PEACH: return this.askPeach(req);
      case REQ.ASK_SHA: return this.askSha(req);
      case REQ.ASK_NULLIFY: return this.askNullify(req);
      case REQ.CHOOSE_CARD: return this.chooseCard(req);
      case REQ.DISCARD_CARDS: return this.discard(req);
      case REQ.GUANXING: return this.guanxing(req);
      case REQ.ASK_SKILL: return this.askSkill(req);
      case REQ.PLAY_TURN: return this.roll() ? this._randomMove(req) : this.playTurn(req);
      default: return null;
    }
  }

  // ---------- 选项类 ----------
  chooseOption(req) {
    const { options, engine, player } = req;
    if (!options?.length) return null;
    // 选将：随机但偏向高血量/强将
    if (req.kind === 'general') {
      const pick = options[Math.floor(Math.random() * options.length)];
      return { value: pick.value };
    }
    // 反间：选花色——猜测，偏向黑桃（杀多为黑）
    if (req.title?.includes('选择一种花色')) {
      return { value: SUIT.SPADE };
    }
    // 带 card 的选项（五谷丰登）：取价值最高
    if (options[0]?.card) {
      const best = [...options].sort((a, b) => cardValue(b.card) - cardValue(a.card))[0];
      return { value: best.value };
    }
    // 刚烈 等“弃两张 vs 受伤”
    if (req.title?.includes('受到') || req.title?.includes('伤害')) {
      const cardCount = player.hand.length + Object.values(player.equips).filter(Boolean).length;
      // 体力高且牌少则受伤；否则弃牌
      if (player.hp > 2 && cardCount <= 2) return { value: pickByLabel(options, ['damage', '伤害']) };
      return { value: pickByLabel(options, ['discard', '弃']) };
    }
    // 雌雄/寒冰/麒麟/青龙 等使用者抉择 —— 默认更激进
    if (req.title?.includes('雌雄')) return { value: pickByLabel(options, ['draw', '摸']) };
    if (req.title?.includes('寒冰')) return { value: options.find((o) => o.value === 'no')?.value || options[0].value };
    if (req.title?.includes('麒麟')) return { value: options.find((o) => o.value !== 'no')?.value || options[0].value };
    if (req.title?.includes('贯石斧')) return { value: player.hand.length >= 4 ? 'yes' : 'no' };
    if (req.title?.includes('青龙')) {
      const opt = shaOptions(engine, player)[0];
      if (opt) return { card: opt.card };
      return null;
    }
    return { value: options[0].value };
  }

  // ---------- 闪 ----------
  askDodge(req) {
    const { engine, player } = req;
    // 替主公出闪（护驾）
    if (req.forSkill === 'hujia') {
      if (!engine.isAlly(player, req.lord)) return null;
    }
    const opts = shanOptions(engine, player);
    if (!opts.length) return null;
    const dangerous = player.hp <= 2;
    let useIt = dangerous || opts.length >= 2 || Math.random() < 0.65;
    if (this.roll()) useIt = Math.random() < 0.5; // 弱 AI 可能白白挨打
    if (!useIt) return null;
    // 优先用真闪
    const real = opts.find((o) => isShan(o.card)) || opts[0];
    return { card: real.card };
  }

  // ---------- 桃 ----------
  askPeach(req) {
    const { engine, player, dying } = req;
    const opts = peachOptions(engine, player, true, dying);
    if (!opts.length) return null;
    if (dying === player) return { card: opts[0].card };
    // 救人：盟友且自身不危
    if (engine.isAlly(player, dying) && (player.hp > 1 || hasSkill(player, 'jijiu'))) {
      return { card: opts[0].card };
    }
    if (hasSkill(player, 'jijiu') && engine.isAlly(player, dying)) return { card: opts[0].card };
    return null;
  }

  // ---------- 杀（响应：决斗/南蛮/借刀/激将） ----------
  askSha(req) {
    const { engine, player } = req;
    if (req.forSkill === 'jijiang' && !engine.isAlly(player, req.lord)) return null;
    if (req.forSkill === 'qinglong') {
      // 青龙再杀：若仍有杀且目标残血则继续
      const opts = shaOptions(engine, player);
      if (opts.length && req.target && req.target.hp <= 2) return { card: opts[0].card };
      return null;
    }
    const opts = shaOptions(engine, player);
    if (!opts.length) return null;
    // 决斗：尽量出；南蛮：体力低或有富余出
    if (req.juedou && !this.roll()) return { card: opts[0].card };
    let give = player.hp <= 2 || opts.length >= 2 || Math.random() < 0.7;
    if (this.roll()) give = Math.random() < 0.5;
    return give ? { card: opts[0].card } : null;
  }

  // ---------- 无懈可击 ----------
  askNullify(req) {
    const { engine, player, card, targetPlayer } = req;
    const opts = wuxieOptions(player);
    if (!opts.length) return null;
    const harmful = ['guohe', 'shunshou', 'juedou', 'nanman', 'wanjian', 'lebu', 'shandian', 'fushishu', 'guldanhand', 'pingzhuangshandian', 'anzhongpohuai', 'zhuanzhuyizhi'].includes(card.kind);
    const helpful = ['wuzhong', 'taoyuan', 'wugu'].includes(card.kind);
    // 抵消针对己方的有害锦囊
    if (harmful && targetPlayer && engine.isAlly(player, targetPlayer) && Math.random() < 0.7) {
      return { card: opts[0].card };
    }
    // 抵消敌人的有利锦囊
    if (helpful && targetPlayer && !engine.isAlly(player, targetPlayer) && Math.random() < 0.3) {
      return { card: opts[0].card };
    }
    return null;
  }

  // ---------- 选择对方一张牌（过拆/顺手/反馈） ----------
  chooseCard(req) {
    const { visibleCards, handChoice, target } = req;
    // 优先装备：武器 > 防具 > 马
    const order = ['weapon', 'armor', 'minus', 'plus'];
    const equips = (visibleCards || []).filter((v) => v.zone === '装备');
    equips.sort((a, b) => order.indexOf(a.card.slot) - order.indexOf(b.card.slot));
    // 反馈/顺手是“获得”，过拆是“弃置”——都优先拿走装备
    if (equips.length) return { card: equips[0].card.id };
    if (handChoice && handChoice.handCount > 0) return { card: 'hand' };
    if (visibleCards?.length) return { card: visibleCards[0].card.id };
    return null;
  }

  // ---------- 弃牌 ----------
  discard(req) {
    const { player, count, from } = req;
    let pool = [...player.hand];
    if (from === 'all') pool = [...player.hand, ...Object.values(player.equips).filter(Boolean)];
    if (this.roll()) pool.sort(() => Math.random() - 0.5); // 弱 AI 随机弃
    else pool.sort((a, b) => cardValue(a) - cardValue(b));
    return { cards: pool.slice(0, count).map((c) => c.id) };
  }

  // ---------- 观星 ----------
  guanxing(req) {
    const { cards } = req;
    const sorted = [...cards].sort((a, b) => cardValue(b) - cardValue(a));
    const keep = Math.ceil(sorted.length / 2);
    return {
      top: sorted.slice(0, keep).map((c) => c.id),
      bottom: sorted.slice(keep).map((c) => c.id),
    };
  }

  // ---------- 是否发动技能 ----------
  askSkill(req) {
    if (req.auto) return { ok: true };       // 天妒/奸雄 自动收牌
    if (req.skill === 'guicai') return {};    // 鬼才：AI 暂不改判
    return { ok: true };
  }

  // 出牌阶段：随机行动（弱 AI）
  _randomMove(req) {
    const { engine, player } = req;
    const moves = [];
    for (const c of player.hand) {
      let opts;
      try { opts = cardPlayOptions(engine, player, c); } catch (e) { opts = []; }
      for (const o of opts) {
        if (o.kind === 'jiedao' || o.kind === 'hengchong') continue; // 借刀/横冲需两段目标，随机时跳过
        if (o.bottledOther) continue; // 瓶装闪电·指定他人由强 AI 处理，随机时只走自己分支
        if (o.needTarget) {
          const tgts = o.kind === 'sha' ? shaTargets(engine, player, o.card) : validTargets(engine, player, o.card);
          if (tgts.length) moves.push({ type: 'play', card: o.card, targets: [pickRandom(tgts)] });
        } else {
          let targets = [];
          if (['tao', 'jiu', 'wuzhong', 'shandian'].includes(o.kind)) targets = [player];
          else if (o.kind === 'taoyuan') targets = engine.alivePlayers.slice();
          else if (['wugu', 'nanman', 'wanjian'].includes(o.kind)) targets = engine.alivePlayers.filter((p) => p !== player);
          moves.push({ type: 'play', card: o.card, targets });
        }
      }
    }
    if (!moves.length || Math.random() < 0.4) return { type: 'end' };
    return pickRandom(moves);
  }

  // ====================== 出牌阶段 ======================
  playTurn(req) {
    const { engine, player } = req;
    const enemies = engine.alivePlayers.filter((p) => p !== player && !engine.isAlly(player, p));
    const allies = engine.alivePlayers.filter((p) => p !== player && engine.isAlly(player, p));
    const hand = player.hand;
    const handOf = (k) => hand.find((c) => c.kind === k && !c.frozen);
    // 按“行为别名”匹配（兼容炉石变体锦囊：behaves 别名或同 kind）
    const handOfBeh = (beh) => hand.find((c) => !c.frozen && (CARD_DEFS[c.kind]?.behaves === beh || c.kind === beh));

    // 1) 装备空位（骨架：武器/防具栏满了仍可装第二件）
    const gujia = hasSkill(player, 'gujia');
    for (const c of hand) {
      if (!c.slot || c.frozen) continue;
      // 万千箴言剑等：仅能作为本回合打出的第7张牌使用（恰好用过6张时才可装备）
      if (CARD_DEFS[c.kind]?.seventhOnly && (player.flags?.cardsUsed || 0) !== 6) continue;
      const slotFree = !player.equips[c.slot];
      const dualFree = gujia && (c.slot === EQUIP_SLOT.WEAPON || c.slot === EQUIP_SLOT.ARMOR) && player.equips[c.slot] && !(player.equips2 && player.equips2[c.slot]);
      if (slotFree || dualFree) return { type: 'play', card: c, targets: [] };
    }

    // 1.5) 设置奥秘（炉石杀）：威胁越大越倾向铺防御性奥秘，且每名角色已有的奥秘不重复
    const secretCards = hand.filter((c) => CARD_DEFS[c.kind]?.type === 'secret' && !c.frozen && !(player.secrets || []).some((s) => s.kind === c.kind));
    if (secretCards.length) {
      const defensive = ['binkuai', 'zhasi', 'jiushu', 'fangyujuzhen', 'qingsuan', 'yiyanhuanyan', 'zhengfa']; // 防御/反制类
      secretCards.sort((a, b) => (defensive.includes(b.kind) ? 1 : 0) - (defensive.includes(a.kind) ? 1 : 0));
      // 残血时一定铺；否则有较多手牌或被多敌包夹时铺
      const threatened = player.hp <= 2 || enemies.length >= 2;
      if (threatened || hand.length >= 4 || Math.random() < 0.5) {
        return { type: 'play', card: secretCards[0], targets: [player] };
      }
    }

    // 2) 无中生有 / 奥术智慧
    const wz = handOfBeh('wuzhong');
    if (wz) return { type: 'play', card: wz, targets: [player] };
    // 2.1) 沉落宝藏：号角/之石直接用；之戒在有可复刻的牌时用
    for (const beh of ['haojiao', 'chaoshi']) {
      const c = handOfBeh(beh);
      if (c) return { type: 'play', card: c, targets: [player] };
    }
    const cj = handOfBeh('chaojie');
    if (cj && player.lastSpell) return { type: 'play', card: cj, targets: [player] };

    // 3) 机会型主动技能
    const acts = activeSkillOptions(engine, player);
    // 苦肉（黄盖）：手牌少且体力>1
    if (acts.some((a) => a.skill === 'kurou') && player.hp > 1 && hand.length <= 2 && Math.random() < 0.7) {
      return { type: 'skill', skill: 'kurou' };
    }
    // 制衡（孙权）：低价值手牌≥2 张
    if (acts.some((a) => a.skill === 'zhiheng')) {
      const junk = hand.filter((c) => cardValue(c) <= 4);
      if (junk.length >= 2) return { type: 'skill', skill: 'zhiheng', cards: junk.map((c) => c.id) };
    }
    // 青囊（华佗）：治疗受伤盟友/自己
    if (acts.some((a) => a.skill === 'qingnang')) {
      const hurt = [player, ...allies].filter((p) => p.hp < p.maxHp).sort((a, b) => a.hp - b.hp)[0];
      const junk = [...hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
      if (hurt && junk && hand.length > 1) {
        return { type: 'skill', skill: 'qingnang', cardId: junk.id, targetId: hurt.id };
      }
    }
    // 反间（周瑜）：对低手牌敌人
    if (acts.some((a) => a.skill === 'fanjian') && enemies.length) {
      const tgt = enemies.sort((a, b) => a.hand.length - b.hand.length)[0];
      const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
      if (tgt && give && Math.random() < 0.6) {
        return { type: 'skill', skill: 'fanjian', targetId: tgt.id, cardId: give.id };
      }
    }
    // 离间（貂蝉）：令两名男性敌人决斗
    if (acts.some((a) => a.skill === 'lijian')) {
      const males = engine.alivePlayers.filter((p) => p !== player && p.gender === 'male');
      const enemyMales = males.filter((p) => !engine.isAlly(player, p));
      if (enemyMales.length >= 1 && males.length >= 2) {
        const first = enemyMales[0];
        const second = males.find((p) => p !== first);
        const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
        if (first && second && give) {
          return { type: 'skill', skill: 'lijian', cardId: give.id, firstId: first.id, secondId: second.id };
        }
      }
    }
    // 仁德（刘备）：把多余牌给受伤盟友以触发回血
    if (acts.some((a) => a.skill === 'rende') && hand.length >= 3) {
      const ally = allies.sort((a, b) => a.hp - b.hp)[0] || allies[0];
      if (ally) {
        const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b)).slice(0, 2).map((c) => c.id);
        if (give.length >= 2 && player.hp < player.maxHp) {
          return { type: 'skill', skill: 'rende', targetId: ally.id, cards: give };
        }
      }
    }
    // ---- 炉石杀主动技 ----
    // 饮血（兰娜瑟尔）：手牌≥2 时换牌+回血
    if (acts.some((a) => a.skill === 'yinxue') && hand.length >= 2) {
      const n = player.hp < player.maxHp ? hand.length : Math.min(2, hand.length);
      const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b)).slice(0, n).map((c) => c.id);
      return { type: 'skill', skill: 'yinxue', cards: give };
    }
    // 灵魂分流（古尔丹）：体力>2 时自己受1摸4
    if (acts.some((a) => a.skill === 'linghun') && player.hp > 2) {
      return { type: 'skill', skill: 'linghun', targetId: player.id };
    }
    // 光明能量（米达）：弃1，治疗受伤己方 + 给己方摸牌
    if (acts.some((a) => a.skill === 'guangming') && hand.length) {
      const injured = engine.alivePlayers.filter((p) => p.hp < p.maxHp).sort((a, b) => a.hp - b.hp);
      const heal = injured.find((p) => engine.isAlly(player, p) || p === player) || player;
      const draw = heal === player ? (allies[0] || enemies[0]) : player;
      const junk = [...hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
      if (junk && draw && draw !== heal && (injured.length || allies.length)) {
        return { type: 'skill', skill: 'guangming', cardId: junk.id, healId: heal.id, drawId: draw.id };
      }
    }
    // 狂暴（帕奇维克）：血厚且有残血敌人时对拼
    if (acts.some((a) => a.skill === 'kuangbao') && player.hp >= 4) {
      const tgt = [...enemies].sort((a, b) => a.hp - b.hp)[0];
      if (tgt && tgt.hp <= 2) return { type: 'skill', skill: 'kuangbao', targetId: tgt.id };
    }
    // 吸血（兰娜瑟尔）：体力上限最多者-1，体力最少者+1（按规则取全场极值）
    if (acts.some((a) => a.skill === 'xixue')) {
      const maxHp = Math.max(...engine.alivePlayers.map((p) => p.maxHp));
      const minHpV = Math.min(...engine.alivePlayers.map((p) => p.hp));
      // 上限-1 优先选敌人；上限+1并回血 优先选己方
      const maxT = engine.alivePlayers.filter((p) => p.maxHp === maxHp).sort((a, b) => (engine.isAlly(player, a) ? 1 : 0) - (engine.isAlly(player, b) ? 1 : 0))[0];
      const minT = engine.alivePlayers.filter((p) => p.hp === minHpV).sort((a, b) => (engine.isAlly(player, b) || b === player ? 1 : 0) - (engine.isAlly(player, a) || a === player ? 1 : 0))[0];
      if (maxT && minT) return { type: 'skill', skill: 'xixue', maxId: maxT.id, minId: minT.id };
    }
    // 邪火（古尔丹）：拆有装备的敌人 + 控其摸牌
    if (acts.some((a) => a.skill === 'xiehuo') && hand.length >= 2 && enemies.length) {
      const tgt = enemies.find((e) => e.equips.weapon || e.equips.armor) || enemies.sort((a, b) => b.hand.length - a.hand.length)[0];
      const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b)).slice(0, 2).map((c) => c.id);
      if (tgt && give.length >= 2) return { type: 'skill', skill: 'xiehuo', cards: give, targetId: tgt.id };
    }
    // 炼狱（加拉克苏斯·限定）：≥2 名敌人体力>2 时一锤定音
    if (acts.some((a) => a.skill === 'lianyu') && enemies.filter((e) => e.hp > 2).length >= 2) {
      return { type: 'skill', skill: 'lianyu' };
    }
    // 审判烈焰（拉格纳罗斯）：指定至多3名敌人判定
    if (acts.some((a) => a.skill === 'shenpan') && enemies.length) {
      const ids = [...enemies].sort((a, b) => a.hp - b.hp).slice(0, 3).map((e) => e.id);
      if (ids.length) return { type: 'skill', skill: 'shenpan', targetIds: ids };
    }
    // 冰封（洛克霍拉）：冻结手牌多的敌人
    if (acts.some((a) => a.skill === 'bingfeng') && hand.length >= 2 && enemies.length) {
      const tgts = [...enemies].sort((a, b) => b.hand.length - a.hand.length).slice(0, 3);
      if (tgts.length) return { type: 'skill', skill: 'bingfeng', targetIds: tgts.map((t) => t.id) };
    }
    // 虚无（娜塔莉塞林）：弃低值牌，逼敌人弃同花色
    if (acts.some((a) => a.skill === 'xuwu') && hand.length && enemies.length) {
      const give = [...hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
      const tgt = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (give && tgt) return { type: 'skill', skill: 'xuwu', cardId: give.id, targetId: tgt.id };
    }
    // 血肉成灰（加拉克苏斯）：压制手牌多的敌人
    if (acts.some((a) => a.skill === 'xuerou') && enemies.length) {
      const tgt = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (tgt && Math.random() < 0.6) return { type: 'skill', skill: 'xuerou', targetId: tgt.id };
    }
    // 吞噬（穆坦努斯）：夺手牌最多的敌人一张牌，给最虚弱的己方加盾
    if (acts.some((a) => a.skill === 'tunshi')) {
      const from = [...enemies].filter((p) => p.hand.length).sort((a, b) => b.hand.length - a.hand.length)[0]
        || [...allies, player].filter((p) => p.hand.length).sort((a, b) => b.hand.length - a.hand.length)[0];
      const to = [player, ...allies].sort((a, b) => a.hp - b.hp)[0] || player;
      if (from) return { type: 'skill', skill: 'tunshi', fromId: from.id, toId: to.id };
    }
    // 裂心（伊露西亚）：与手牌更多的敌人交换以借用其牌
    if (acts.some((a) => a.skill === 'liexin')) {
      const t = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t && t.hand.length > hand.length + 1) return { type: 'skill', skill: 'liexin', targetId: t.id };
    }
    // 翻找（苔丝）：从弃牌堆捡价值最高的牌
    if (acts.some((a) => a.skill === 'fanzhao') && engine.discard?.length) {
      const best = [...engine.discard].sort((a, b) => cardValue(b) - cardValue(a))[0];
      if (best) return { type: 'skill', skill: 'fanzhao', cardId: best.id };
    }
    // 旋转（希拉斯暗月）：与手牌最多的敌人换牌
    if (acts.some((a) => a.skill === 'xuanzhuan')) {
      const t = [...enemies].filter((p) => p.hand.length).sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t) return { type: 'skill', skill: 'xuanzhuan', targetId: t.id };
    }
    // 寒霜（克尔苏加德）：压制手牌最多的敌人
    if (acts.some((a) => a.skill === 'hanshuang') && enemies.length) {
      const t = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t && Math.random() < 0.7) return { type: 'skill', skill: 'hanshuang', targetId: t.id };
    }
    // 洛欧塞布·毒雾：压制手牌最多的敌人
    if (acts.some((a) => a.skill === 'duwu') && enemies.length) {
      const t = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t && Math.random() < 0.7) return { type: 'skill', skill: 'duwu', targetId: t.id };
    }
    // 加拉克苏斯·魔能闪电：指定两名敌人
    if (acts.some((a) => a.skill === 'monengshandian') && enemies.length >= 2) {
      const [f, s] = [...enemies].sort((a, b) => b.hand.length - a.hand.length);
      if (f && s) return { type: 'skill', skill: 'monengshandian', firstId: f.id, secondId: s.id };
    }
    // 莫德雷斯·火眼：武将牌5张杀齐备即对残血敌人放10点
    if (acts.some((a) => a.skill === 'huoyan') && enemies.length) {
      const t = [...enemies].sort((a, b) => a.hp - b.hp)[0];
      if (t) return { type: 'skill', skill: 'huoyan', targetId: t.id };
    }
    // 塞瑞娜·歹毒：自己上限低于某敌且手牌≥3时换之（夺取高上限+满状态）
    if (acts.some((a) => a.skill === 'daidu')) {
      const rich = [...enemies].sort((a, b) => b.maxHp - a.maxHp)[0];
      if (rich && rich.maxHp > player.maxHp && hand.length >= 3) {
        const give = hand.filter((c) => !c.frozen).sort((a, b) => cardValue(a) - cardValue(b)).slice(0, 3).map((c) => c.id);
        if (give.length === 3) return { type: 'skill', skill: 'daidu', cards: give, targetId: rich.id };
      }
    }
    // 奈法利安·低吼：盯住手牌最多的敌人
    if (acts.some((a) => a.skill === 'dihou') && enemies.length) {
      const t = [...enemies].sort((a, b) => b.hand.length - a.hand.length)[0];
      if (t && Math.random() < 0.7) return { type: 'skill', skill: 'dihou', targetId: t.id };
    }
    // 奥蕾莉亚·利箭：对残血敌人发动（弃牌凑“标”点数倍数由技能内部处理）
    if (acts.some((a) => a.skill === 'lijian2') && enemies.length && hand.filter((c) => !c.frozen).length) {
      const t = [...enemies].sort((a, b) => a.hp - b.hp)[0];
      if (t) return { type: 'skill', skill: 'lijian2', targetId: t.id };
    }
    // 泽瑞拉·信徒：武将牌上攒了≥3张黑色牌时收回（限定，之后失去技能）
    if (acts.some((a) => a.skill === 'xintu') && (player.pile || []).filter((c) => c.suit === 'spade' || c.suit === 'club').length >= 3) {
      return { type: 'skill', skill: 'xintu' };
    }
    // 尤格萨隆·命运之轮：受威胁或想摸牌时发动（自身免伤）
    if (acts.some((a) => a.skill === 'mingyun')) {
      if (player.hp <= 3 || hand.length <= 3 || Math.random() < 0.5) return { type: 'skill', skill: 'mingyun' };
    }
    // 亚煞极·腐蚀：弃一张点数适中的牌作“腐”（偏向能多摸/多杀）
    if (acts.some((a) => a.skill === 'fushi2') && hand.length >= 2) {
      const junk = [...hand].filter((c) => !c.frozen).sort((a, b) => cardValue(a) - cardValue(b))[0];
      if (junk) return { type: 'skill', skill: 'fushi2', cardId: junk.id };
    }
    // 克苏恩·低语：敌人手里锦囊多或己方安全时发动
    if (acts.some((a) => a.skill === 'diyu') && enemies.length && Math.random() < 0.7) {
      return { type: 'skill', skill: 'diyu' };
    }
    // 玛克扎尔·渊狱火：手牌不多时补充
    if (acts.some((a) => a.skill === 'yuanyuhuo') && hand.length <= 4) {
      return { type: 'skill', skill: 'yuanyuhuo' };
    }
    // 玛克扎尔·暗影箭雨：敌人多于盟友时群伤
    if (acts.some((a) => a.skill === 'anyingjian') && enemies.length >= 1 && enemies.length >= allies.length) {
      return { type: 'skill', skill: 'anyingjian' };
    }
    // 卡扎克·捕获灵魂：刃≥6时群体2点
    if (acts.some((a) => a.skill === 'bhlinghun') && enemies.length >= 2) {
      return { type: 'skill', skill: 'bhlinghun' };
    }
    // 玛克扎尔·血吼（限定）：有武器富余时对残血敌人
    if (acts.some((a) => a.skill === 'xuehou') && enemies.length) {
      const t = [...enemies].sort((a, b) => a.hp - b.hp)[0];
      if (t && t.hp <= 2) { const give = hand.filter((c) => !c.frozen && !isSha(c)).slice(0, 2); if (give.length === 2) return { type: 'skill', skill: 'xuehou', cards: give.map((c) => c.id), targetId: t.id }; }
    }
    // 玛瑟里顿·深渊之号（限定）：自己残血且敌众
    if (acts.some((a) => a.skill === 'shenyuanhao') && player.hp <= 3 && enemies.length >= 2) {
      return { type: 'skill', skill: 'shenyuanhao' };
    }
    // 卡扎克·群体暗影（限定）：敌众时
    if (acts.some((a) => a.skill === 'qtanying') && enemies.length >= 3) {
      return { type: 'skill', skill: 'qtanying' };
    }
    // 恩佐斯·深渊：能放大招(4异色沉)就对残血敌人放，否则小招摸牌
    if (acts.some((a) => a.skill === 'shenyuan2')) {
      const pile = player.pile || [];
      const suits = new Set(pile.map((c) => c.suit));
      if (suits.size >= 4 && enemies.length) {
        const t = [...enemies].sort((a, b) => a.hp - b.hp)[0];
        return { type: 'skill', skill: 'shenyuan2', mode: 'big', targetId: t.id };
      }
      const hasPair = Object.values(pile.reduce((m, c) => { m[c.suit] = (m[c.suit] || 0) + 1; return m; }, {})).some((n) => n >= 2);
      if (hasPair && hand.length <= 3) return { type: 'skill', skill: 'shenyuan2', mode: 'small' };
    }
    // 恩佐斯·精华：弃牌堆某花色多时收集
    if (acts.some((a) => a.skill === 'jinghua') && (engine.discard || []).length >= 4) {
      const cnt = {}; engine.discard.forEach((c) => { cnt[c.suit] = (cnt[c.suit] || 0) + 1; });
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 2) return { type: 'skill', skill: 'jinghua', suit: best[0] };
    }
    // AI 设置奥秘 / 装备由通用出牌逻辑处理

    // 4) 致命杀（范围内可击杀）
    if (canUseSha(engine, player)) {
      const shaTgts = shaTargets(engine, player).filter((t) => enemies.includes(t));
      const opts = shaOptions(engine, player);
      if (opts.length && shaTgts.length) {
        const killable = shaTgts.filter((t) => t.hp === 1);
        if (killable.length) {
          return { type: 'play', card: opts[0].card, targets: [killable[0]] };
        }
        // 残血 + 酒 → 先喝酒
        const lowest = [...shaTgts].sort((a, b) => a.hp - b.hp)[0];
        const jiu = handOf('jiu');
        if (jiu && !player.flags.jiuUsed && lowest.hp === 2) {
          return { type: 'play', card: jiu, targets: [] };
        }
      }
    }

    // 5) 紧急回血（含炉石桃：治疗术/联结治疗）
    if (player.hp < player.maxHp) {
      const tao = hand.find((c) => isTao(c) && !c.frozen);
      if (tao && (player.hp <= 1 || CARD_DEFS[tao.kind]?.healAlly)) {
        if (CARD_DEFS[tao.kind]?.healAlly) {
          // 联结治疗：另选一名最需要的队友/自己以外角色
          const ally = [player, ...allies].filter((p) => p.hp < p.maxHp).sort((a, b) => a.hp - b.hp).find((p) => p !== player)
            || allies[0] || enemies[0];
          if (ally) return { type: 'play', card: tao, targets: [ally] };
        }
        return { type: 'play', card: tao, targets: [] };
      }
    }

    // 6) 乐不思蜀 / 腐蚀术 / 古尔丹之手：控制威胁最大的敌人
    const lebu = hand.find((c) => !c.frozen && (c.kind === 'lebu' || c.kind === 'fushishu' || c.kind === 'guldanhand'));
    if (lebu && enemies.length) {
      const tgt = validTargets(engine, player, lebu).filter((t) => enemies.includes(t))
        .sort((a, b) => b.hand.length - a.hand.length)[0];
      if (tgt && Math.random() < 0.7) return { type: 'play', card: lebu, targets: [tgt] };
    }

    // 7) 拆敌方关键牌（过河拆桥/邪恶低语、顺手牵羊/心灵视界）
    for (const beh of ['guohe', 'shunshou']) {
      const c = handOfBeh(beh);
      if (!c) continue;
      const tgts = validTargets(engine, player, c).filter((t) => enemies.includes(t));
      const withEquip = tgts.filter((t) => Object.values(t.equips).some(Boolean));
      const tgt = withEquip[0] || tgts.sort((a, b) => b.hand.length - a.hand.length)[0];
      if (tgt) return { type: 'play', card: c, targets: [tgt] };
    }
    // 7.5) 暗中破坏：拆有装备的敌人
    const az = handOfBeh('anzhong');
    if (az) {
      const tgts = validTargets(engine, player, az).filter((t) => enemies.includes(t));
      if (tgts.length) return { type: 'play', card: az, targets: [tgts[0]] };
    }
    // 7.55) 真言术盾：给自己或最残血的友方叠盾
    const zy = handOfBeh('zhenyan');
    if (zy) {
      const t = [player, ...allies].sort((a, b) => a.hp - b.hp)[0] || player;
      return { type: 'play', card: zy, targets: [t] };
    }
    // 7.56) 专注意志：贴给手牌多的敌人
    const zz = hand.find((c) => c.kind === 'zhuanzhuyizhi' && !c.frozen);
    if (zz) {
      const tgt = validTargets(engine, player, zz).filter((t) => enemies.includes(t))
        .sort((a, b) => b.hand.length - a.hand.length)[0];
      if (tgt && Math.random() < 0.75) return { type: 'play', card: zz, targets: [tgt] };
    }
    // 7.6) 照明弹：敌方有奥秘（或自己有奥秘垫背）时使用
    const zm = handOfBeh('zhaomingdan');
    if (zm) {
      const enemySecret = enemies.some((t) => (t.secrets || []).some((s) => s.guhuoBy == null));
      const mine = (player.secrets || []).some((s) => s.guhuoBy == null);
      if (enemySecret || mine) return { type: 'play', card: zm, targets: [player] };
    }

    // 8) 普通杀
    if (canUseSha(engine, player)) {
      const shaTgts = shaTargets(engine, player).filter((t) => enemies.includes(t));
      const opts = shaOptions(engine, player);
      if (opts.length && shaTgts.length) {
        const shaCard = opts[0].card;
        // 方天画戟：若这是最后一张手牌的【杀】，可指定至多3名敌人
        const srcCount = shaCard.virtual ? (shaCard.sourceCards?.length || 1) : 1;
        const isLast = player.hand.length - srcCount <= 0;
        if (player.equips[EQUIP_SLOT.WEAPON]?.kind === 'fangtian' && isLast && shaTgts.length >= 2) {
          return { type: 'play', card: shaCard, targets: [...shaTgts].sort((a, b) => a.hp - b.hp).slice(0, 3) };
        }
        // 关羽/赵云 用转化杀也可；优先真杀
        const tgt = [...shaTgts].sort((a, b) => a.hp - b.hp)[0];
        return { type: 'play', card: shaCard, targets: [tgt] };
      }
    }

    // 9) 决斗（SGS轮流出杀 / 炉石比杀数）
    const jd = handOfBeh('juedou') || handOf('hsjuedou');
    if (jd && enemies.length) {
      const tgt = validTargets(engine, player, jd).filter((t) => enemies.includes(t))
        .sort((a, b) => a.hp - b.hp)[0];
      const mySha = shaOptions(engine, player).length;
      // 炉石决斗：你视为多1张杀，手牌不太少时基本稳赢
      if (jd.kind === 'hsjuedou') { if (tgt && player.hand.length >= 2) return { type: 'play', card: jd, targets: [tgt] }; }
      else if (tgt && (mySha >= 1 || player.hp >= 3)) return { type: 'play', card: jd, targets: [tgt] };
    }

    // 10) AOE 应答型（万箭/刀扇-需闪、南蛮/暗言术-需杀）：命中敌人多于盟友
    for (const beh of ['wanjian', 'nanman']) {
      const c = handOfBeh(beh);
      if (!c) continue;
      if (enemies.length > allies.length && player.hp >= 2) {
        return { type: 'play', card: c, targets: engine.alivePlayers.filter((p) => p !== player) };
      }
    }

    // 10.5) AOE 直伤型（刀扇/除奇制胜/克苏恩面具）：命中敌人多于盟友且自己安全
    for (const k of ['daoshan', 'chuqizhisheng', 'ksenmianju']) {
      const c = handOf(k);
      if (!c) continue;
      let hitEnemies = enemies.length, hitAllies = allies.length;
      if (k === 'chuqizhisheng') { // 仅伤奇数血
        hitEnemies = enemies.filter((p) => p.hp % 2 === 1).length;
        hitAllies = allies.filter((p) => p.hp % 2 === 1).length;
      }
      if (hitEnemies >= 1 && hitEnemies > hitAllies) {
        return { type: 'play', card: c, targets: engine.alivePlayers.filter((p) => p !== player) };
      }
    }

    // 10.6) 疯狂之灾祸：敌众于友时打出（混乱效果，敌人互相残杀）
    const fk = handOf('fengkuangzhizaihuo');
    if (fk && enemies.length >= 2 && enemies.length > allies.length && Math.random() < 0.55) {
      return { type: 'play', card: fk, targets: engine.alivePlayers.filter((p) => p !== player) };
    }

    // 11) 桃园结义 / 生命之树（自己或盟友受伤多时）
    const ty = handOfBeh('taoyuan');
    if (ty) {
      const hurtAllies = [player, ...allies].filter((p) => p.hp < p.maxHp).length;
      const hurtEnemies = enemies.filter((p) => p.hp < p.maxHp).length;
      if (hurtAllies > hurtEnemies && player.hp < player.maxHp) {
        return { type: 'play', card: ty, targets: engine.alivePlayers.slice() };
      }
    }

    // 11.5) 慷慨大方：给盟友1张、自己摸3（无盟友则不便宜敌人）
    const kk = handOf('kangkaidaifang');
    if (kk && allies.length && hand.length >= 2) {
      const ally = [...allies].sort((a, b) => a.hand.length - b.hand.length)[0];
      if (ally) return { type: 'play', card: kk, targets: [ally] };
    }

    // 12) 借刀杀人
    const jiedao = handOf('jiedao');
    if (jiedao) {
      const holders = engine.alivePlayers.filter((p) => p !== player && p.equips[EQUIP_SLOT.WEAPON]);
      for (const h of holders) {
        const victim = enemies.find((e) => e !== h && engine.inAttackRange(h, e));
        if (victim) return { type: 'play', card: jiedao, targets: [h, victim], options: { victim: victim.id } };
      }
    }

    // 12.3) 横冲直撞：驱使一名敌人对其射程内的角色（优先敌人）开火，拒绝则其自伤
    const hc = handOf('hengchong');
    if (hc && enemies.length) {
      const pickVictim = (compelled, onlyEnemy) => engine.alivePlayers
        .filter((t) => t !== compelled && engine.inAttackRange(compelled, t) && (!onlyEnemy || enemies.includes(t)))
        .sort((a, b) => a.hp - b.hp)[0];
      for (const compelled of enemies) { const v = pickVictim(compelled, true); if (v) return { type: 'play', card: hc, targets: [compelled, v], options: { victim: v.id } }; }
      for (const compelled of enemies) { const v = pickVictim(compelled, false); if (v) return { type: 'play', card: hc, targets: [compelled, v], options: { victim: v.id } }; }
    }

    // 12.6) 暗影步：收回本回合弃掉的有价值牌
    const ab = handOf('anyingbu');
    if (ab) {
      const recall = (engine.turnRecallable || []).filter((c) => engine.discard.includes(c) && c.id !== ab.id);
      if (recall.length) return { type: 'play', card: ab, targets: [] };
    }

    // 13) 闪电：下家为敌则放置在自己判定区（赌移动到下家）
    const sd = hand.find((c) => !c.frozen && c.kind === 'shandian');
    if (sd && !player.judge.some((j) => j.kind === 'shandian')) {
      const next = engine._nextAlive(player);
      if (next && !engine.isAlly(player, next) && Math.random() < 0.5) {
        return { type: 'play', card: sd, targets: [player] };
      }
    }

    // 13.5) 瓶装闪电：弃1张牌直接对最弱的敌人放置（黑色受3点强制伤害，红色转移）
    const pz = hand.find((c) => !c.frozen && c.kind === 'pingzhuangshandian');
    if (pz && player.hand.length >= 2) {
      const tgts = bottledTargets(engine, player).filter((t) => enemies.includes(t)).sort((a, b) => a.hp - b.hp);
      if (tgts.length) return { type: 'play', card: pz, targets: [tgts[0]], options: { bottledOther: true } };
    }

    // 否则结束回合
    return { type: 'end' };
  }
}

function pickByLabel(options, keys) {
  const o = options.find((opt) => keys.some((k) => opt.value === k || (opt.label || '').includes(k)));
  return (o || options[0]).value;
}
