// ====================== 武将技能 ======================
import { REQ, SUIT, SUIT_NAME, FACTION, isRed } from './constants.js';
import { removeFrom, removeFromHand } from '../util.js';
import { HS_SKILLS } from './skills-hs.js';

export function hasSkill(player, key) {
  if (!player) return false;
  if (player.flags?.noSkills) return false; // 专注意志（黑判定）：到下回合开始无法使用所有技能
  return player.skills?.includes(key) || player.lordSkills?.includes(key);
}

const playerSkillList = (p) => (p && !p.flags?.noSkills ? [...(p.skills || []), ...(p.lordSkills || [])] : []);

// 炉石杀（注册表）技能：在某事件时遍历该玩家拥有的技能并调用其 triggers[event]
async function hsRun(engine, event, data, owner) {
  for (const k of playerSkillList(owner)) {
    const t = HS_SKILLS[k]?.triggers?.[event];
    if (t) await t(engine, data);
  }
}
// 折叠型事件（drawCount/handLimit）：依次用 triggers 改写 base
async function hsFold(engine, event, data, base) {
  let n = base;
  for (const k of playerSkillList(data.player)) {
    const t = HS_SKILLS[k]?.triggers?.[event];
    if (t) n = await t(engine, { ...data, base: n });
  }
  return n;
}

// 技能元信息（UI 展示 / 主动技按钮）
export const SKILLS = {
  jianxiong: { name: '奸雄', active: false, desc: '受到伤害后可获得造成伤害的牌。' },
  hujia: { name: '护驾', active: false, lord: true, desc: '需要【闪】时，魏势力角色可替你打出。' },
  fankui: { name: '反馈', active: false, desc: '受伤后获得伤害来源的一张牌。' },
  guicai: { name: '鬼才', active: false, desc: '判定生效前可打出一张手牌替换之。' },
  ganglie: { name: '刚烈', active: false, desc: '受伤后判定，非红桃则令来源弃两张牌或受1点伤害。' },
  tiandu: { name: '天妒', active: false, desc: '判定牌生效后可获得之。' },
  yiji: { name: '遗计', active: false, desc: '每受到1点伤害后摸两张牌。' },
  rende: { name: '仁德', active: true, desc: '将手牌交给其他角色，累计≥2张时回复1点体力。' },
  jijiang: { name: '激将', active: false, lord: true, desc: '需要【杀】时，蜀势力角色可替你打出。' },
  wusheng: { name: '武圣', active: true, desc: '红色牌可当【杀】使用或打出。' },
  paoxiao: { name: '咆哮', active: false, desc: '使用【杀】无次数限制。' },
  longdan: { name: '龙胆', active: true, desc: '【杀】当【闪】、【闪】当【杀】。' },
  guanxing: { name: '观星', active: false, desc: '准备阶段观看并重排牌堆顶数张牌。' },
  kongcheng: { name: '空城', active: false, desc: '没有手牌时不能成为【杀】【决斗】的目标。' },
  zhiheng: { name: '制衡', active: true, perTurn: true, desc: '弃任意张牌，摸等量的牌（每回合一次）。' },
  qixi: { name: '奇袭', active: true, desc: '黑色牌可当【过河拆桥】使用。' },
  yingzi: { name: '英姿', active: false, desc: '摸牌阶段多摸一张。' },
  fanjian: { name: '反间', active: true, perTurn: true, desc: '令一名角色选花色并获得你一张手牌，不符则受伤。' },
  kurou: { name: '苦肉', active: true, desc: '失去1点体力，摸两张牌。' },
  jijiu: { name: '急救', active: false, desc: '濒死求桃时可将红色牌当【桃】。' },
  qingnang: { name: '青囊', active: true, perTurn: true, desc: '弃一张手牌回复一名角色1点体力（每回合一次）。' },
  wushuang: { name: '无双', active: false, desc: '你的【杀】需两张【闪】；【决斗】对方需两张【杀】。' },
  lijian: { name: '离间', active: true, perTurn: true, desc: '弃一张牌令两名男性角色【决斗】。' },
  biyue: { name: '闭月', active: false, desc: '结束阶段可摸一张牌。' },
};

// 合并炉石杀技能的元信息（供 UI / 主动技按钮使用）
for (const [k, v] of Object.entries(HS_SKILLS)) {
  SKILLS[k] = { name: v.name, desc: v.desc, active: !!v.active, perTurn: !!v.perTurn, lord: !!v.lord };
}

// ---------- 触发分发 ----------
export async function triggerSkill(engine, event, data) {
  if (event.startsWith('active:')) {
    const key = event.slice(7);
    if (ACTIVE[key]) return await ACTIVE[key](engine, data);
    if (HS_SKILLS[key]?.action) return await HS_SKILLS[key].action(engine, data);
    return;
  }
  switch (event) {
    case 'startPhase': await onStartPhase(engine, data); await hsRun(engine, 'startPhase', data, data.player); return;
    case 'judge': return await onJudge(engine, data);
    case 'afterJudge': return await onAfterJudge(engine, data);
    case 'drawCount': { const n = await onDrawCount(engine, data); return await hsFold(engine, 'drawCount', data, n); }
    case 'handLimit': return await hsFold(engine, 'handLimit', data, data.base);
    case 'endPhase': await onEndPhase(engine, data); await hsRun(engine, 'endPhase', data, data.player); return;
    case 'usedCard': await hsRun(engine, 'usedCard', data, data.player); return;
    case 'recovered': await hsRun(engine, 'recovered', data, data.player); return;
    case 'beforeDraw': await hsRun(engine, 'beforeDraw', data, data.player); return;
    case 'afterDraw': await hsRun(engine, 'afterDraw', data, data.player); return;
    case 'cardTwice': await hsRun(engine, 'cardTwice', data, data.player); return;
    case 'anyEndPhase': for (const p of engine.alivePlayers) await hsRun(engine, 'anyEndPhase', { ...data, owner: p }, p); return;
    case 'damaged': await onDamaged(engine, data); await hsRun(engine, 'damaged', data, data.player); return;
    case 'dealDamage': await hsRun(engine, 'dealDamage', data, data.source); return;
    case 'usedSha': await hsRun(engine, 'usedSha', data, data.player); return;
    case 'shaMissed': await hsRun(engine, 'shaMissed', data, data.user); return;
    case 'shaTargeted': await hsRun(engine, 'shaTargeted', data, data.target); return;
    case 'kill': await hsRun(engine, 'kill', data, data.killer); return;
    case 'death': await hsRun(engine, 'death', data, data.player); return;
    case 'shaDamage': {
      let n = data.base;
      for (const k of playerSkillList(data.user)) {
        const t = HS_SKILLS[k]?.triggers?.shaDamage;
        if (t) n = await t(engine, { ...data, base: n });
      }
      return n;
    }
    case 'beforeDeath': {
      for (const k of playerSkillList(data.player)) {
        const t = HS_SKILLS[k]?.triggers?.beforeDeath;
        if (t && await t(engine, data)) return true;
      }
      return false;
    }
  }
}

// ---------- 准备阶段：观星 ----------
async function onStartPhase(engine, { player }) {
  if (hasSkill(player, 'guanxing')) {
    const n = Math.min(5, Math.max(engine.alivePlayers.length, 3));
    engine._refillDeck();
    const top = engine.deck.slice(0, n);
    if (!top.length) return;
    const resp = await engine.ask(player, {
      type: REQ.GUANXING, cards: top, title: `观星：重新排列牌堆顶 ${top.length} 张牌`,
    });
    // resp.top = 放回牌堆顶的顺序(数组)，resp.bottom = 置于牌堆底
    if (resp && (resp.top || resp.bottom)) {
      const topIds = resp.top || top.map((c) => c.id);
      const newTop = topIds.map((id) => top.find((c) => c.id === id)).filter(Boolean);
      const bottom = (resp.bottom || []).map((id) => top.find((c) => c.id === id)).filter(Boolean);
      engine.deck.splice(0, top.length);
      engine.deck.unshift(...newTop);
      engine.deck.push(...bottom);
      engine.log(`${player.name} 发动【观星】。`, 'good');
    }
  }
}

// ---------- 判定：鬼才 ----------
async function onJudge(engine, { player, card, reason }) {
  let current = card;
  for (const p of engine.alivePlayers) {
    if (!hasSkill(p, 'guicai')) continue;
    if (!p.hand.length) continue;
    const resp = await engine.ask(p, {
      type: REQ.ASK_SKILL, skill: 'guicai',
      title: `鬼才：是否打出一张手牌替换 ${player.name} 的判定牌【${current.name}】？`,
      needCard: true, from: 'hand',
    });
    if (resp?.card) {
      removeFromHand(p.hand, resp.card);
      current = resp.card;
      engine.log(`${p.name} 发动【鬼才】。`, 'good');
    }
  }
  return current;
}

// ---------- 判定后：天妒 ----------
async function onAfterJudge(engine, { player, card }) {
  if (hasSkill(player, 'tiandu')) {
    const resp = await engine.ask(player, {
      type: REQ.ASK_SKILL, skill: 'tiandu', auto: true,
      title: `天妒：获得判定牌【${card.name}】？`,
    });
    if (resp?.ok !== false) {
      player.hand.push(card);
      engine.log(`${player.name} 发动【天妒】，获得判定牌。`, 'good');
      engine.changed();
      return true;
    }
  }
  return false;
}

// ---------- 摸牌数：英姿 ----------
async function onDrawCount(engine, { player, base }) {
  if (hasSkill(player, 'yingzi')) return base + 1;
  return base;
}

// ---------- 结束阶段：闭月 ----------
async function onEndPhase(engine, { player }) {
  if (hasSkill(player, 'biyue')) {
    engine.drawCards(player, 1);
    engine.log(`${player.name} 发动【闭月】摸一张牌。`, 'good');
  }
}

// ---------- 受伤后：奸雄 / 反馈 / 刚烈 / 遗计 ----------
async function onDamaged(engine, { player, source, amount, card }) {
  // 奸雄
  if (hasSkill(player, 'jianxiong') && card) {
    const realCards = card.virtual ? (card.sourceCards || []) : [card];
    const inDiscard = realCards.filter((c) => engine.discard.includes(c));
    if (inDiscard.length) {
      const resp = await engine.ask(player, { type: REQ.ASK_SKILL, skill: 'jianxiong', auto: true, title: `奸雄：获得造成伤害的牌？` });
      if (resp?.ok !== false) {
        inDiscard.forEach((c) => { removeFrom(engine.discard, c); player.hand.push(c); });
        engine.log(`${player.name} 发动【奸雄】，获得 ${inDiscard.length} 张牌。`, 'good');
        engine.changed();
      }
    }
  }
  // 反馈
  if (hasSkill(player, 'fankui') && source && source !== player) {
    const pool = [...source.hand, ...Object.values(source.equips).filter(Boolean)];
    if (pool.length) {
      const resp = await engine.ask(player, {
        type: REQ.CHOOSE_CARD, skill: 'fankui', target: source,
        visibleCards: Object.values(source.equips).filter(Boolean).map((c) => ({ card: c, zone: '装备' })),
        handChoice: source.hand.length ? { handCount: source.hand.length } : null,
        fromPlayer: source.id, title: `反馈：获得 ${source.name} 的一张牌`,
      });
      let chosen = null;
      if (resp?.card === 'hand') chosen = source.hand[Math.floor(Math.random() * source.hand.length)];
      else if (resp?.card) chosen = pool.find((c) => c.id === resp.card);
      if (!chosen) chosen = pool[Math.floor(Math.random() * pool.length)];
      engine.gainCard(player, chosen);
      engine.log(`${player.name} 发动【反馈】，获得 ${source.name} 一张牌。`, 'good');
    }
  }
  // 刚烈
  if (hasSkill(player, 'ganglie') && source) {
    engine.log(`${player.name} 发动【刚烈】，判定...`, 'good');
    const jr = await engine.doJudge(player, '刚烈');
    if (jr.suit !== SUIT.HEART) {
      const canDiscard = source.hand.length + Object.values(source.equips).filter(Boolean).length >= 2;
      let choice = 'damage';
      if (canDiscard) {
        const resp = await engine.ask(source, {
          type: REQ.CHOOSE_OPTION, title: `刚烈：弃两张牌，或受到 ${player.name} 造成的1点伤害`,
          options: [{ value: 'discard', label: '弃两张牌' }, { value: 'damage', label: '受到1点伤害' }],
        });
        choice = resp?.value || 'damage';
      }
      if (choice === 'discard') {
        const resp = await engine.ask(source, { type: REQ.DISCARD_CARDS, count: 2, from: 'all', title: '刚烈：弃两张牌' });
        let cards = (resp?.cards || []).map((x) => findOnPlayer(source, x)).filter(Boolean);
        while (cards.length < 2) {
          const pool = [...source.hand, ...Object.values(source.equips).filter(Boolean)].filter((c) => !cards.includes(c));
          if (!pool.length) break;
          cards.push(pool[0]);
        }
        engine.discardCards(source, cards);
      } else {
        await engine.dealDamage({ source: player, target: source, amount: 1 });
      }
    } else {
      engine.log('刚烈判定为红桃，无效。');
    }
  }
  // 遗计（简化：每受1点伤害摸两张牌）
  if (hasSkill(player, 'yiji')) {
    engine.drawCards(player, 2 * amount);
    engine.log(`${player.name} 发动【遗计】，摸 ${2 * amount} 张牌。`, 'good');
  }
}

function findOnPlayer(player, ref) {
  if (typeof ref !== 'string') return ref;
  return player.hand.find((c) => c.id === ref)
    || Object.values(player.equips).find((c) => c && c.id === ref)
    || player.judge.find((c) => c.id === ref);
}

// ====================== 主动技能 ======================
const ACTIVE = {
  // 制衡
  async zhiheng(engine, { player, move }) {
    const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
    if (!cards.length) return;
    engine.discardCards(player, cards);
    engine.drawCards(player, cards.length);
    player.skillState.zhihengUsed = true;
    engine.log(`${player.name} 发动【制衡】，换了 ${cards.length} 张牌。`, 'good');
  },
  // 苦肉
  async kurou(engine, { player }) {
    engine.log(`${player.name} 发动【苦肉】，失去1点体力。`, 'play');
    player.hp -= 1; engine.changed();
    engine.drawCards(player, 2);
    await engine.pause(300);
    if (player.hp <= 0) await engine._dying(player, null);
  },
  // 仁德
  async rende(engine, { player, move }) {
    const target = engine.playerById(move.targetId);
    const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
    if (!target || !cards.length) return;
    cards.forEach((c) => { removeFromHand(player.hand, c); target.hand.push(c); });
    player.flags.rendeGiven = (player.flags.rendeGiven || 0) + cards.length;
    engine.log(`${player.name} 发动【仁德】，将 ${cards.length} 张牌交给 ${target.name}。`, 'good');
    engine.changed();
    if (player.flags.rendeGiven >= 2 && !player.skillState.rendeHealed) {
      player.skillState.rendeHealed = true;
      await engine.recover(player, 1);
    }
  },
  // 青囊
  async qingnang(engine, { player, move }) {
    const target = engine.playerById(move.targetId) || player;
    const card = findOnPlayer(player, move.cardId);
    if (!card) return;
    engine.discardCards(player, [card]);
    player.skillState.qingnangUsed = true;
    await engine.recover(target, 1);
    engine.log(`${player.name} 发动【青囊】，回复 ${target.name} 1点体力。`, 'good');
  },
  // 反间
  async fanjian(engine, { player, move }) {
    const target = engine.playerById(move.targetId);
    const card = findOnPlayer(player, move.cardId);
    if (!target || !card) return;
    player.skillState.fanjianUsed = true;
    const resp = await engine.ask(target, {
      type: REQ.CHOOSE_OPTION, title: `反间：选择一种花色`,
      options: [SUIT.SPADE, SUIT.HEART, SUIT.CLUB, SUIT.DIAMOND].map((s) => ({ value: s, label: SUIT_NAME[s] })),
    });
    const chosen = resp?.value || SUIT.SPADE;
    removeFromHand(player.hand, card);
    target.hand.push(card);
    engine.changed();
    engine.log(`${player.name} 发动【反间】，${target.name} 选择了 ${SUIT_NAME[chosen]}，亮出【${card.name}·${SUIT_NAME[card.suit]}】。`, 'play');
    await engine.pause(500);
    if (card.suit !== chosen) {
      await engine.dealDamage({ source: player, target, amount: 1 });
    } else {
      engine.log('花色相符，无伤害。');
    }
  },
  // 离间
  async lijian(engine, { player, move }) {
    const card = findOnPlayer(player, move.cardId);
    const first = engine.playerById(move.firstId);
    const second = engine.playerById(move.secondId);
    if (!card || !first || !second) return;
    engine.discardCards(player, [card]);
    player.skillState.lijianUsed = true;
    engine.log(`${player.name} 发动【离间】，令 ${first.name} 与 ${second.name} 决斗！`, 'play');
    const { runDuel } = await import('./effects.js');
    await runDuel(engine, first, second);
  },
};
