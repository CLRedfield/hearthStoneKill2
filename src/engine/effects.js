// ====================== 卡牌结算 ======================
import { CARD_TYPE, REQ, EQUIP_SLOT, isBlack, isRed } from './constants.js';
import { CARD_DEFS, cardAs } from './cards.js';
import { hasSkill, triggerSkill } from './skills.js';
import { removeFrom } from '../util.js';

const defOf = (c) => CARD_DEFS[c.kind] || {};

// ---------- 装备访问（骨架：玛洛加尔可同时装备2件武器/防具，存于 equips2）----------
export const weaponsOf = (p) => [p?.equips?.[EQUIP_SLOT.WEAPON], p?.equips2?.weapon].filter(Boolean);
export const armorsOf = (p) => [p?.equips?.[EQUIP_SLOT.ARMOR], p?.equips2?.armor].filter(Boolean);
export const hasWeaponKind = (p, k) => weaponsOf(p).some((w) => w.kind === k);
export const hasArmorKind = (p, k) => armorsOf(p).some((a) => a.kind === k);

// ---------- 目标合法性 ----------
export function canUseSha(engine, user) {
  if (hasSkill(user, 'paoxiao')) return true;
  if (hasSkill(user, 'guhuo')) return true; // 蛊惑（哈加沙）：杀无次数限制
  if (hasWeaponKind(user, 'zhuge') || hasWeaponKind(user, 'susasi')) return true; // 诸葛连弩 / 苏萨斯
  let limit = 1 + (user.flags.extraSha || 0); // 月蚀：本回合可多出一张杀
  if (weaponsOf(user).some((w) => CARD_DEFS[w.kind]?.extraShaWeapon)) limit += 1; // 萨弗拉斯
  return (user.flags.shaUsed || 0) < limit;
}

export function shaTargets(engine, user) {
  return engine.alivePlayers.filter((t) => {
    if (t === user) return false;
    if (!engine.inAttackRange(user, t)) return false;
    // 空城：无手牌的诸葛亮不能被杀指定
    if (hasSkill(t, 'kongcheng') && t.hand.length === 0) return false;
    // 暗影斗篷：本回合内无法被【杀】指定
    if (t.flags?.noShaTarget) return false;
    return true;
  });
}

export function hasAnyCard(p) {
  return p.hand.length > 0 || Object.values(p.equips).some(Boolean) || p.judge.length > 0;
}

// 防护长袍：指向性锦囊无法指定（仅对单体指向的锦囊生效）
const robed = (t) => hasArmorKind(t, 'robe');

// 瓶装闪电「弃1牌指定他人」的合法目标：其他角色、非防护长袍、判定区无同名
export function bottledTargets(engine, user) {
  return engine.alivePlayers.filter((t) => t !== user && !robed(t) && !t.judge.some((j) => j.kind === 'pingzhuangshandian'));
}

// 伦鲁迪洛尔：装备时可弃3张不同花色的牌，然后将手牌摸至手牌上限
async function applyRunblade(engine, user) {
  const bySuit = {};
  for (const c of user.hand) {
    if (c.frozen) continue;
    if (!bySuit[c.suit] || c.number < bySuit[c.suit].number) bySuit[c.suit] = c;
  }
  const suits = Object.keys(bySuit);
  if (suits.length < 3) return; // 凑不齐3种花色则无法发动
  const baseLimit = engine._handLimitBase ? engine._handLimitBase(user) : user.hp;
  let limit = await triggerSkill(engine, 'handLimit', { player: user, base: baseLimit });
  if (typeof limit !== 'number') limit = baseLimit;
  const agent = engine.agentOf?.(user);
  let go;
  if (agent?.kind === 'ai') go = user.hand.length - 3 < limit; // 弃3后能净摸牌才划算
  else {
    const r = await engine.ask(user, {
      type: REQ.CHOOSE_OPTION, title: '伦鲁迪洛尔：弃掉3张不同花色的牌，将手牌摸至上限？',
      options: [{ value: 'no', label: '不发动' }, { value: 'yes', label: '弃3张异色 → 摸至上限' }],
    });
    go = r?.value === 'yes';
  }
  if (!go) return;
  const picks = suits.map((s) => bySuit[s]).sort((a, b) => a.number - b.number).slice(0, 3);
  engine.discardCards(user, picks);
  engine.log(`${user.name}（伦鲁迪洛尔）弃掉3张不同花色的牌。`, 'play');
  const need = Math.max(0, limit - user.hand.length);
  if (need > 0) engine.drawCards(user, need);
}

// 返回某张牌的合法目标列表（用于 AI / UI 高亮）
export function validTargets(engine, user, card) {
  const def = CARD_DEFS[card.kind];
  const others = engine.alivePlayers.filter((p) => p !== user);
  if (def.healAlly) return others.slice(); // 联结治疗：另一名角色
  switch (def.target) {
    case 'self': return [user];
    case 'one_other': {
      if (card.kind === 'juedou') {
        return others.filter((t) => !robed(t) && !(hasSkill(t, 'kongcheng') && t.hand.length === 0));
      }
      // 延时锦囊（乐不思蜀/腐蚀术/古尔丹之手）：防护长袍排除 + 不可重复同名
      if (def.type === CARD_TYPE.DELAYED) {
        return others.filter((t) => !robed(t) && !t.judge.some((j) => j.kind === card.kind));
      }
      return others.filter((t) => !robed(t));
    }
    case 'one_has_card': return others.filter((t) => hasAnyCard(t) && !robed(t));
    case 'one_in_1_has_card':
      return others.filter((t) => hasAnyCard(t) && !robed(t) && engine.distance(user, t) <= 1);
    case 'all': return engine.alivePlayers.slice();
    case 'all_other': return others.slice();
    case 'jiedao':
      return others.filter((t) => weaponsOf(t).length);
    case 'self_only': return [user];
    default: return [];
  }
}

// ---------- 主结算分发 ----------
export async function resolveCard(engine, ctx) {
  const { user, card, targets } = ctx;
  const def = CARD_DEFS[card.kind];

  // 装备牌
  if (def.type === CARD_TYPE.EQUIP) {
    engine.equip(user, card);
    if (def.discardSuitsRefill) await applyRunblade(engine, user); // 伦鲁迪洛尔
    if (def.equipBackstab) { // 弑君：凭空背刺一名角色
      const tgts = engine.alivePlayers.filter((p) => p !== user);
      if (tgts.length) {
        const t = tgts[Math.floor(Math.random() * tgts.length)];
        const dmg = t.hp >= t.maxHp ? 2 : 1;
        engine.log(`${user.name} 装备【弑君】，凭空背刺 ${t.name}！`, 'play');
        await engine.dealDamage({ source: user, target: t, amount: dmg, card });
      }
    }
    return;
  }

  // 奥秘（盖放，不公开名称）
  if (def.type === CARD_TYPE.SECRET) {
    if (user.secrets.some((s) => s.kind === card.kind)) { user.hand.push(card); engine.log(`${user.name} 已有相同奥秘。`, 'system'); return; }
    user.secrets.push(card);
    engine.log(`${user.name} 设置了一个奥秘。`, 'play');
    engine.fx('use', { userId: user.id, card: { name: '奥秘', kind: 'secret', type: 'secret' }, targetIds: [user.id] });
    engine.changed();
    return;
  }

  // 延时锦囊
  if (def.type === CARD_TYPE.DELAYED) {
    let tgt;
    if (card.kind === 'pingzhuangshandian') {
      // 瓶装闪电：指定自己；或额外弃1张牌后指定一名角色
      tgt = user;
      if (ctx.options?.bottledOther && targets[0] && targets[0] !== user) {
        const r = await engine.ask(user, { type: REQ.DISCARD_CARDS, count: 1, from: 'hand', title: '瓶装闪电：额外弃置一张牌' });
        let cs = (r?.cards || []).map((x) => resolveCardRef(user, x)).filter(Boolean);
        if (!cs.length) { const spare = user.hand.find((c) => c !== card && !c.frozen); if (spare) cs = [spare]; }
        if (cs.length) { engine.discardCards(user, cs); tgt = targets[0]; }
      }
    } else {
      const selfTarget = def.behaves === 'shandian' || card.kind === 'shandian';
      tgt = selfTarget ? user : targets[0];
    }
    if (!tgt) { engine.toDiscard([card]); return; }
    if (tgt.judge.some((j) => j.kind === card.kind)) { engine.toDiscard([card]); return; } // 防重复同名
    tgt.judge.push(stripVirtual(card));
    engine.log(`${user.name} 对 ${tgt.name} 使用【${card.name}】。`);
    engine.changed();
    return;
  }

  engine.log(`${user.name} 使用【${card.name}】${targets.length ? '，目标：' + targets.map((t) => t.name).join('、') : ''}。`, 'play');
  engine.fx('use', { userId: user.id, card: { name: card.name, red: card.red, kind: card.kind, type: def.type }, targetIds: targets.map((t) => t.id) });
  // 凯尔萨斯·奥：被明置的牌被其拥有者使用时，标记者视为对其使用一张【火球术】
  if (card.aoMark) {
    const k = engine.playerById(card.aoMark); card.aoMark = null;
    if (k && k.alive && k !== user) {
      const dmg = Object.values(user.equips).some(Boolean) ? 2 : 1;
      engine.log(`${k.name} 的【奥】触发，视为对 ${user.name} 使用【火球术】！`, 'play');
      await engine.dealDamage({ source: k, target: user, amount: dmg, nature: 'fire' });
      if (!user.alive || engine.over) return;
    }
  }
  // 暗影步：记录回合归属者本回合使用、将进入弃牌堆的牌（基本/即时锦囊）
  if (user === engine.turnOwner && engine.turnRecallable) {
    const reals = card.virtual ? (card.sourceCards || []) : [card];
    engine.turnRecallable.push(...reals);
  }
  await engine.pause(360);

  // 全局计数（米达·重组 / 刺骨“此前用过其他牌”）
  const role = cardAs(card);
  if (def.type === CARD_TYPE.BASIC) engine.usedBasic = (engine.usedBasic || 0) + 1;
  if (def.type === CARD_TYPE.TRICK) engine.usedTrick = (engine.usedTrick || 0) + 1;
  // 过载
  if (def.overload) user.overload = (user.overload || 0) + def.overload;

  // 按“角色”分发（兼容炉石变体牌）；锦囊用 behaves 别名复用既有结算
  const behaves = def.behaves || card.kind;
  if (role === 'sha') {
    // 蛊惑（哈加沙）：你的【杀】改为放置到目标领域，回合结束生效（多造成1点）
    if (hasSkill(user, 'guhuo') && targets[0]) {
      user.flags.shaUsed = (user.flags.shaUsed || 0) + 1;
      engine.toDiscard([card]);
      const t = targets[0];
      t.guhuo = { by: user.id, dmg: (def.dmg || 1) + 1, nature: card.nature || 'normal' };
      engine.log(`${user.name} 发动【蛊惑】，将【${card.name}】置于 ${t.name} 的领域，其回合结束时生效。`, 'play');
      user.flags.cardsUsed = (user.flags.cardsUsed || 0) + 1;
      await triggerSkill(engine, 'usedSha', { player: user, card });
      await triggerSkill(engine, 'usedCard', { player: user, card });
      return;
    }
    await playSha(engine, user, targets, card, ctx); user.flags.cardsUsed = (user.flags.cardsUsed || 0) + 1;
    await triggerSkill(engine, 'usedSha', { player: user, card });
    await triggerSkill(engine, 'usedCard', { player: user, card }); // 牌已入弃牌堆后触发（沉落等）
    return;
  }
  if (role === 'tao') {
    await engine.recover(user, def.heal || 1); if (def.drawOnUse) engine.drawCards(user, def.drawOnUse);
    if (def.healAlly && targets[0] && targets[0] !== user && targets[0].alive) await engine.recover(targets[0], 1); // 联结治疗
    engine.toDiscard([card]); user.flags.cardsUsed = (user.flags.cardsUsed || 0) + 1;
    await triggerSkill(engine, 'usedCard', { player: user, card });
    return;
  }
  if (role === 'jiu') {
    if (def.turnShaBonus) { user.flags.turnShaBonus = (user.flags.turnShaBonus || 0) + 1; engine.log(`${user.name} 使用【${card.name}】，本回合所有【杀】伤害+1。`); }
    else if (def.replayNext) { user.flags.rishiPending = true; engine.log(`${user.name} 使用【${card.name}】，下一张牌将使用两次！`, 'good'); }
    else { user.flags.jiuUsed = true; engine.log(`${user.name} 使用【${card.name}】，本回合下一张【杀】伤害+1。`); }
    if (def.extraSha) user.flags.extraSha = (user.flags.extraSha || 0) + 1;
    engine.toDiscard([card]); user.flags.cardsUsed = (user.flags.cardsUsed || 0) + 1;
    await triggerSkill(engine, 'usedCard', { player: user, card });
    return;
  }
  user.flags.cardsUsed = (user.flags.cardsUsed || 0) + 1;
  switch (behaves) {
    case 'wuzhong':
      engine.toDiscard([card]);
      if (!(await nullified(engine, card, user, user))) engine.drawCards(user, 2);
      break;
    case 'drawthree': // 古卷
      engine.toDiscard([card]);
      if (!(await nullified(engine, card, user, user))) engine.drawCards(user, 3);
      break;
    case 'guohe': await playGuohe(engine, user, targets[0], card); break;
    case 'shunshou': await playShunshou(engine, user, targets[0], card); break;
    case 'juedou': await playJuedou(engine, user, targets[0], card); break;
    case 'taoyuan': await playGroupRecover(engine, user, targets, card); break;
    case 'wugu': await playWugu(engine, user, targets, card); break;
    case 'nanman': await playAoe(engine, user, targets, card, 'sha'); break;
    case 'wanjian': await playAoe(engine, user, targets, card, 'shan'); break;
    case 'jiedao': await playJiedao(engine, user, targets, card, ctx); break;
    case 'daoshan': await playDaoshan(engine, user, card); break;
    case 'oddhp': await playOddHp(engine, user, card); break;
    case 'ksenmask': await playKsenMask(engine, user, card); break;
    case 'kangkai': await playKangkai(engine, user, targets[0], card); break;
    case 'hsjuedou': await playHsJuedou(engine, user, targets[0], card); break;
    case 'hengchong': {
      const victim = engine.playerById(ctx.options?.victim) || targets[1];
      await playHengchong(engine, user, targets[0], victim, card);
      break;
    }
    case 'anyingbu': await playAnyingbu(engine, user, card); break;
    case 'fengkuang': await playFengkuang(engine, user, card); break;
    default:
      engine.toDiscard([card]);
      engine.log(`（${card.name} 暂未实现完整效果）`, 'system');
  }
  // 锦囊结算完毕（已入弃牌堆）后触发 usedCard（沉落等需要牌在弃牌堆）
  await triggerSkill(engine, 'usedCard', { player: user, card });
}

// ---------- 刀扇：对所有其他角色造成1点伤害，然后摸1张 ----------
async function playDaoshan(engine, user, card) {
  engine.toDiscard([card]);
  const order = engine._orderFrom(user).filter((p) => p.alive && p !== user);
  for (const t of order) {
    if (await nullified(engine, card, user, t)) continue;
    await engine.dealDamage({ source: user, target: t, amount: 1, card });
    if (engine.over) return;
  }
  if (user.alive) engine.drawCards(user, 1);
}

// ---------- 除奇制胜：对所有体力为奇数的其他角色造成1点强制伤害 ----------
async function playOddHp(engine, user, card) {
  engine.toDiscard([card]);
  const order = engine._orderFrom(user).filter((p) => p.alive && p !== user);
  for (const t of order) {
    if (t.hp % 2 !== 1) continue;
    if (await nullified(engine, card, user, t)) continue;
    await engine.dealDamage({ source: user, target: t, amount: 1, card });
    if (engine.over) return;
  }
}

// ---------- 克苏恩面具：其他角色弃一张锦囊牌，否则受1点伤害 ----------
async function playKsenMask(engine, user, card) {
  engine.toDiscard([card]);
  const order = engine._orderFrom(user).filter((p) => p.alive && p !== user);
  for (const t of order) {
    if (await nullified(engine, card, user, t)) continue;
    const tricks = t.hand.filter((c) => CARD_DEFS[c.kind]?.type === CARD_TYPE.TRICK);
    if (!tricks.length) { await engine.dealDamage({ source: user, target: t, amount: 1, card }); if (engine.over) return; continue; }
    const resp = await engine.ask(t, {
      type: REQ.CHOOSE_OPTION, title: `克苏恩面具：弃置一张锦囊牌，或受到1点伤害`,
      options: [...tricks.map((c) => ({ value: c.id, label: `弃【${c.name}】` })), { value: 'hurt', label: '受到1点伤害' }],
    });
    const chosen = tricks.find((c) => c.id === resp?.value);
    if (chosen) engine.discardCards(t, [chosen]);
    else { await engine.dealDamage({ source: user, target: t, amount: 1, card }); if (engine.over) return; }
  }
}

// ---------- 慷慨大方：交给目标一张手牌，然后你摸3张 ----------
async function playKangkai(engine, user, target, card) {
  engine.toDiscard([card]);
  if (!target) { engine.drawCards(user, 3); return; }
  if (await nullified(engine, card, user, target)) { engine.drawCards(user, 3); return; }
  if (user.hand.length) {
    const give = randomHand(user);
    removeFrom(user.hand, give);
    target.hand.push(give);
    engine.log(`${user.name} 慷慨地将一张牌交给 ${target.name}。`, 'good');
  }
  engine.drawCards(user, 3);
  engine.changed();
}

// ---------- 炉石杀·决斗：比较手牌【杀】数（你视为多1张），少者受1点 ----------
async function playHsJuedou(engine, user, target, card) {
  engine.toDiscard([card]);
  if (!target) return;
  if (await nullified(engine, card, user, target)) return;
  const countSha = (p) => p.hand.filter((c) => cardAs(c) === 'sha').length;
  const mine = countSha(user) + 1; // 你视为多一张【杀】
  const theirs = countSha(target);
  engine.log(`${user.name} 对 ${target.name} 发起【决斗】：杀数 ${mine}(含+1) vs ${theirs}。`, 'play');
  await engine.pause(300);
  if (mine > theirs) await engine.dealDamage({ source: user, target, amount: 1, card });
  else if (mine < theirs) await engine.dealDamage({ source: target, target: user, amount: 1, card });
  else engine.log('平局，无人受伤。', 'good');
}

// ---------- 横冲直撞：令被驱使者对你指定的受害者使用【杀】，否则其受1点 ----------
async function playHengchong(engine, user, compelled, victim, card) {
  engine.toDiscard([card]);
  if (!compelled) return;
  if (await nullified(engine, card, user, compelled)) return;
  if (!victim || !victim.alive) { engine.log('没有合法受害者，横冲直撞无效。', 'system'); return; }
  engine.log(`${user.name}【横冲直撞】令 ${compelled.name} 对 ${victim.name} 使用【杀】！`, 'play');
  const ok = await askSha(engine, compelled, { hengchong: true, against: victim, mustTarget: victim });
  if (ok) {
    await resolveShaOn(engine, compelled, victim, { kind: 'chongfeng', suit: 'spade', name: '冲锋', as: 'sha' });
  } else {
    engine.log(`${compelled.name} 未使用【杀】，受到1点强制伤害。`, 'bad');
    await engine.dealDamage({ source: user, target: compelled, amount: 1, card });
  }
}

// ---------- 暗影步：收回你本回合进入弃牌堆的一张牌 ----------
async function playAnyingbu(engine, user, card) {
  const ownReals = card.virtual ? (card.sourceCards || []) : [card];
  engine.toDiscard([card]);
  if (await nullified(engine, card, user, user)) return;
  const recall = [...new Set((engine.turnRecallable || []).filter((c) => engine.discard.includes(c) && !ownReals.includes(c)))];
  if (!recall.length) { engine.log(`${user.name} 没有可收回的牌。`, 'system'); return; }
  const resp = await engine.ask(user, {
    type: REQ.CHOOSE_OPTION, title: '暗影步：收回一张本回合进入弃牌堆的牌',
    options: recall.map((c) => ({ value: c.id, label: c.name, card: c })),
  });
  const chosen = recall.find((c) => c.id === resp?.value) || recall[recall.length - 1];
  removeFrom(engine.discard, chosen);
  removeFrom(engine.turnRecallable, chosen);
  user.hand.push(chosen);
  engine.log(`${user.name} 发动【暗影步】，收回【${chosen.name}】。`, 'good');
  engine.changed();
}

// ---------- 疯狂之灾祸：其他角色弃【杀】（视为对下家用冲锋），否则展示手牌 ----------
async function playFengkuang(engine, user, card) {
  engine.toDiscard([card]);
  const order = engine._orderFrom(user).filter((p) => p.alive && p !== user);
  for (const t of order) {
    if (await nullified(engine, card, user, t)) continue;
    const shas = t.hand.filter((c) => cardAs(c) === 'sha');
    if (shas.length) {
      const resp = await engine.ask(t, {
        type: REQ.CHOOSE_OPTION, title: '疯狂之灾祸：弃一张【杀】（视为对下一名角色使用【冲锋】），或展示手牌',
        options: [...shas.map((c) => ({ value: c.id, label: `弃【${c.name}】`, card: c })), { value: 'reveal', label: '展示手牌' }],
      });
      const chosen = shas.find((c) => c.id === resp?.value);
      if (chosen) {
        engine.discardCards(t, [chosen]);
        const next = engine._nextAlive(t);
        if (next && next !== t) {
          engine.log(`${t.name} 弃【杀】，视为对 ${next.name} 使用【冲锋】！`, 'play');
          await resolveShaOn(engine, t, next, { kind: 'chongfeng', suit: 'spade', name: '冲锋', as: 'sha' });
          if (engine.over) return;
        }
        continue;
      }
    }
    engine.log(`${t.name} 展示手牌：${t.hand.map((c) => c.name).join('、') || '（空）'}。`, 'system');
    await engine.pause(300);
  }
}

function stripVirtual(card) {
  // 延时锦囊保留原实体牌进入判定区
  if (card.virtual && card.sourceCards?.length === 1) return card.sourceCards[0];
  return card;
}

// ---------- 杀 ----------
async function playSha(engine, user, targets, card, ctx) {
  user.flags.shaUsed = (user.flags.shaUsed || 0) + 1;
  engine.toDiscard([card]);
  for (const target of targets) {
    if (!target.alive) continue;
    await resolveShaOn(engine, user, target, card);
    if (engine.over) return;
  }
  // 符文之矛：杀结算后摸2张，使用 durability 次后损坏（骨架时两件武器各自结算）
  for (const w of weaponsOf(user)) {
    if (!user.alive) break;
    const wd = CARD_DEFS[w.kind] || {};
    if (!wd.drawAfterSha) continue;
    engine.drawCards(user, wd.drawAfterSha);
    w.uses = (w.uses || 0) + 1;
    if (w.uses >= (wd.durability || 3)) {
      if (user.equips[EQUIP_SLOT.WEAPON] === w) user.equips[EQUIP_SLOT.WEAPON] = null;
      else if (user.equips2 && user.equips2.weapon === w) user.equips2.weapon = null;
      engine.discard.push(w); engine.log(`${user.name} 的【${w.name}】损坏。`); engine.changed();
    }
  }
}

async function fireShaSecrets(engine, target, attacker, card) {
  let canceled = false;
  for (const s of [...(target.secrets || [])]) {
    if (engine.over) break;
    if (s.kind === 'bingdongxianjing') {
      removeFrom(target.secrets, s); engine.discard.push(s);
      engine.log(`${target.name} 触发奥秘【冰冻陷阱】！`, 'good');
      engine.fx('secret', { playerId: target.id, label: '冰冻陷阱' });
      engine.freezeHand(attacker, 2);
      canceled = true;
    } else if (s.kind === 'baozhaxianjing') {
      removeFrom(target.secrets, s); engine.discard.push(s);
      engine.log(`${target.name} 触发奥秘【爆炸陷阱】！`, 'good');
      engine.fx('secret', { playerId: target.id, label: '爆炸陷阱' });
      await engine.dealDamage({ source: target, target: attacker, amount: 2 });
    } else if (s.kind === 'minjie') {
      removeFrom(target.secrets, s); engine.discard.push(s);
      engine.log(`${target.name} 触发奥秘【闪避领域】，避开【杀】！`, 'good');
      engine.fx('secret', { playerId: target.id, label: '闪避领域' });
      canceled = true;
    } else if (s.kind === 'duoshanmijing') {
      removeFrom(target.secrets, s); engine.discard.push(s);
      engine.log(`${target.name} 触发奥秘【躲闪】！`, 'good');
      engine.fx('secret', { playerId: target.id, label: '躲闪' });
      canceled = true;
      const others = engine.alivePlayers.filter((p) => p !== target && p !== attacker);
      const pool = others.length ? others : engine.alivePlayers.filter((p) => p !== target);
      const nt = pool[Math.floor(Math.random() * pool.length)];
      if (nt) { engine.log(`【杀】被转移到 ${nt.name}！`, 'play'); await resolveShaOn(engine, attacker, nt, card); }
    }
    engine.changed();
    await engine.pause(300);
  }
  return { canceled };
}

async function resolveShaOn(engine, user, target, card) {
  // 仁王盾
  if (hasArmorKind(target, 'renwang') && isBlack(card.suit)) {
    engine.log(`${target.name} 的【仁王盾】令黑色【杀】无效。`, 'good');
    await engine.pause(300);
    return;
  }
  // 凝冰护盾：免疫黑桃/梅花【杀】；对红桃【杀】的免疫在你的下回合开始时失去
  if (hasArmorKind(target, 'iceshield')) {
    const s = card.suit;
    if (s === 'spade' || s === 'club' || (s === 'heart' && target.iceHeartImmune)) {
      engine.log(`${target.name} 的【凝冰护盾】令该【杀】无效。`, 'good');
      await engine.pause(300);
      return;
    }
  }
  // 成为【杀】目标（献祭等）
  await triggerSkill(engine, 'shaTargeted', { target, user, card });
  // 万千箴言剑：你的【杀】指定一名角色时，弃掉其所有牌
  if (weaponsOf(user).some((w) => CARD_DEFS[w.kind]?.discardAllOnTarget) && target.alive && hasAnyCard(target)) {
    const all = [...target.hand, ...Object.values(target.equips).filter(Boolean), ...(target.equips2 ? Object.values(target.equips2).filter(Boolean) : []), ...target.judge];
    if (all.length) { engine.log(`${user.name} 的【万千箴言剑】弃掉 ${target.name} 的所有牌！`, 'play'); engine.discardCards(target, all); }
  }
  // 奥秘：成为【杀】目标时触发（冰冻陷阱可取消该杀）
  if (target.secrets?.length) {
    const sec = await fireShaSecrets(engine, target, user, card);
    if (sec.canceled || !target.alive || !user.alive || engine.over) return;
  }
  // 雌雄双股剑：异性目标
  if (hasWeaponKind(user, 'cixiong') && target.gender !== user.gender && hasAnyCard(target)) {
    const resp = await engine.ask(user, {
      type: REQ.CHOOSE_OPTION, title: '雌雄双股剑',
      options: [{ value: 'discard', label: `令 ${target.name} 弃一张牌` }, { value: 'draw', label: '你摸一张牌' }],
    });
    if (resp?.value === 'draw') engine.drawCards(user, 1);
    else {
      const c = await engine.ask(target, { type: REQ.DISCARD_CARDS, count: 1, from: 'all', title: '雌雄双股剑：弃一张牌' });
      const cards = (c?.cards || []).map((x) => resolveCardRef(target, x)).filter(Boolean);
      if (cards.length) engine.discardCards(target, cards);
      else if (hasAnyCard(target)) engine.discardCards(target, [randomCardOf(target)]);
    }
  }

  // 无坚不摧（洛卡拉）：目标需打出一张【杀】，否则受到1点强制伤害
  if (hasSkill(user, 'wujian')) {
    const provided = await askSha(engine, target, { wujian: true });
    if (!provided) { engine.log(`${target.name} 未应对【无坚不摧】，受到1点强制伤害。`, 'bad'); await engine.dealDamage({ source: user, target, amount: 1 }); }
    if (!target.alive) return;
  }

  const def = defOf(card);
  // 刺骨：本回合此前用过其他牌 → 强制伤害（无法被闪避）；激化：本回合已使用≥3张牌 → 杀强制伤害
  const unblockable = (def.unblockableIfUsed && (user.flags.cardsUsed || 0) >= 1)
    || (hasSkill(user, 'jihua') && (user.flags.cardsUsed || 0) >= 3);
  let dodged = false;
  let lastShan = null; // 白银之枪：记录用于响应的实体【闪】（八卦/技能闪为 null）
  if (!unblockable) {
    const need = hasSkill(user, 'wushuang') ? 2 : 1;
    dodged = true;
    for (let i = 0; i < need; i++) {
      const d = await getOneDodge(engine, target, { source: user, card });
      if (!d) { dodged = false; break; }
      if (d.shan) lastShan = d.shan;
    }
  }

  // 白银之枪：杀被闪响应后判定，若判定牌点数大于该【闪】，则此【闪】无效
  if (dodged && hasWeaponKind(user, 'silverspear')) {
    engine.log(`${user.name} 的【白银之枪】判定...`, 'play');
    const jr = await engine.doJudge(user, '白银之枪');
    if (lastShan && jr.number > lastShan.number) { dodged = false; engine.log(`判定点数 ${jr.number} 大于【闪】点数 ${lastShan.number}，此【闪】无效！`, 'bad'); }
    else engine.log(`判定点数 ${jr.number}${lastShan ? '不大于【闪】点数 ' + lastShan.number : ''}，【闪】生效。`);
  }

  if (dodged) {
    engine.log(`${target.name} 打出【闪】，抵消【杀】。`, 'good');
    await engine.pause(300);
    // 杀未造成伤害（八爪巨怪·抑制 等）
    await triggerSkill(engine, 'shaMissed', { user, target, card });
    // 青龙偃月刀：被闪后可再使用一张杀
    if (hasWeaponKind(user, 'qinglong')) {
      const again = await engine.ask(user, {
        type: REQ.ASK_SHA, title: `青龙偃月刀：是否对 ${target.name} 再使用一张【杀】？`,
        forSkill: 'qinglong', target,
      });
      if (again?.card) {
        const sources = again.card.virtual ? again.card.sourceCards : [again.card];
        sources.forEach((c) => removeFrom(user.hand, c));
        engine.toDiscard([again.card]);
        engine.log(`${user.name}（青龙偃月刀）再次出【杀】！`);
        await resolveShaOn(engine, user, target, again.card);
      }
    }
    return;
  }

  // 命中：伤害前 寒冰剑
  if (hasWeaponKind(user, 'hanbing') && hasAnyCard(target)) {
    const resp = await engine.ask(user, {
      type: REQ.CHOOSE_OPTION, title: '寒冰剑',
      options: [{ value: 'no', label: '正常造成伤害' }, { value: 'yes', label: `改为弃置 ${target.name} 两张牌` }],
    });
    if (resp?.value === 'yes') {
      for (let i = 0; i < 2; i++) {
        if (!hasAnyCard(target)) break;
        engine.discardCards(target, [randomCardOf(target)]);
      }
      return;
    }
  }

  let dmg = def.dmg || 1;
  if (def.vsFull && target.hp >= target.maxHp) dmg = Math.max(dmg, def.vsFull);
  if (def.vsEquip && Object.values(target.equips).some(Boolean)) dmg = Math.max(dmg, def.vsEquip);
  // 萨弗拉斯：你的【冲锋】视为【火球术】（对有装备者造2点）
  if (hasWeaponKind(user, 'sulfuras') && card.kind === 'chongfeng' && Object.values(target.equips).some(Boolean)) dmg = Math.max(dmg, 2);
  if (user.flags.jiuUsed) { dmg += 1; user.flags.jiuUsed = false; engine.log('（酒：伤害+1）'); }
  // 月蚀：本回合所有【杀】伤害+1（不消耗）
  if (user.flags.turnShaBonus) dmg += user.flags.turnShaBonus;
  // 孢子：下一张【杀】伤害+1（全局，消耗）
  if (engine.sporeBonus) { dmg += engine.sporeBonus; engine.sporeBonus = 0; }
  // 技能加成（火矢/复生等）
  const bonus = await triggerSkill(engine, 'shaDamage', { user, target, base: dmg, card });
  if (typeof bonus === 'number') dmg = bonus;
  if (unblockable) engine.log(`【${card.name}】无法被闪避！`, 'bad');
  await engine.dealDamage({ source: user, target, amount: dmg, nature: card.nature || 'normal', card });
  // 寒冰箭等：命中后冻结
  if (def.freeze && target.alive) engine.freezeHand(target, def.freeze);
  // 灵魂之火：命中后你弃置一张牌（法力代价）
  if (def.selfDiscardOnHit) { const own = [...user.hand, ...Object.values(user.equips).filter(Boolean)]; if (own.length) { engine.discardCards(user, [own[Math.floor(Math.random() * own.length)]]); engine.log(`${user.name} 因【灵魂之火】弃置一张牌。`); } }
  // 世界树嫩枝（任意伤害后回血）在 game.dealDamage 中统一处理

  // 麒麟弓：造成伤害后弃置目标坐骑
  if (!engine.over && target.alive && hasWeaponKind(user, 'qilin')) {
    const horses = [target.equips[EQUIP_SLOT.OFFENSE_HORSE], target.equips[EQUIP_SLOT.DEFENSE_HORSE]].filter(Boolean);
    if (horses.length) {
      const resp = await engine.ask(user, {
        type: REQ.CHOOSE_OPTION, title: '麒麟弓：是否弃置目标一匹坐骑？',
        options: [{ value: 'no', label: '否' }, ...horses.map((h) => ({ value: h.id, label: `弃置 ${h.name}` }))],
      });
      const h = horses.find((x) => x.id === resp?.value);
      if (h) engine.discardCards(target, [h]);
    }
  }

  // 超级对撞器：杀结算后，令目标使用一张【杀】并由你（武器拥有者）指定其目标，否则其受到1点强制伤害
  if (!engine.over && target.alive && hasWeaponKind(user, 'collider')) {
    const resp = await engine.ask(target, { type: REQ.ASK_SHA, collider: true, title: `超级对撞器：是否使用一张【杀】？（目标由 ${user.name} 指定）` });
    if (resp?.card) {
      const srcs = resp.card.virtual ? resp.card.sourceCards : [resp.card];
      srcs.forEach((c) => removeFrom(target.hand, c));
      engine.toDiscard([resp.card]);
      const cands = engine.alivePlayers.filter((p) => p !== target);
      let victim = null;
      if (cands.length) {
        const ar = await engine.ask(user, { type: REQ.CHOOSE_OPTION, title: '超级对撞器：指定这张【杀】的目标', options: cands.map((c) => ({ value: c.id, label: c.name })) });
        victim = engine.playerById(ar?.value) || cands[Math.floor(Math.random() * cands.length)];
      }
      if (victim) { engine.log(`${target.name}（超级对撞器）对 ${victim.name} 使用【杀】！`, 'play'); await resolveShaOn(engine, target, victim, resp.card); }
    } else {
      engine.log(`${target.name} 未响应【超级对撞器】，受到1点强制伤害。`, 'bad');
      await engine.dealDamage({ source: user, target, amount: 1 });
    }
  }
}

// 获取一张“闪”（含八卦阵 / 护驾）。成功返回 { shan: 实体闪牌或null }，失败返回 null。
export async function getOneDodge(engine, target, ctx) {
  // 护心（尤格萨隆）：回合外每轮可凭空使用1次（觉醒后2次）【闪避】
  if (hasSkill(target, 'huxin') && engine.turnOwner !== target) {
    const cap = target.skillState.yoggAwake ? 2 : 1;
    if ((target.skillState.huxinDodge || 0) < cap) {
      target.skillState.huxinDodge = (target.skillState.huxinDodge || 0) + 1;
      engine.log(`${target.name} 发动【护心】，凭空使用一张【闪避】。`, 'good');
      return { shan: null };
    }
  }
  // 防爆护盾：在你回合外的一轮中，可凭空使用1次【闪避】
  if (hasArmorKind(target, 'bombshield') && engine.turnOwner !== target && !target.bombDodgeUsed) {
    target.bombDodgeUsed = true;
    engine.log(`${target.name} 的【防爆护盾】凭空使用一张【闪避】。`, 'good');
    return { shan: null };
  }
  // 塔盾：无法使用【闪】
  if (hasArmorKind(target, 'tadun')) { engine.log(`${target.name} 装备【塔盾】，无法使用【闪】。`); return null; }
  // 埃辛诺斯刃：在攻击者回合，手牌数小于其攻击范围的角色无法用【闪】响应其【杀】
  if (!ctx.wanjian && ctx.source && engine.turnOwner === ctx.source && hasWeaponKind(ctx.source, 'esinosblade') && target.hand.length < engine.attackRange(ctx.source)) {
    engine.log(`${target.name} 手牌不足，被【埃辛诺斯刃】压制，无法用【闪】。`); return null;
  }
  // 八卦阵自动尝试
  if (hasArmorKind(target, 'bagua')) {
    const jr = await engine.doJudge(target, '八卦阵');
    if (isRed(jr.suit)) {
      engine.log(`${target.name} 的【八卦阵】判定为红色，视为【闪】。`, 'good');
      return { shan: null };
    }
  }
  // 护驾：魏势力角色替主公出闪
  if (hasSkill(target, 'hujia')) {
    for (const ally of engine.alivePlayers) {
      if (ally === target || ally.faction !== 'wei') continue;
      const r = await engine.ask(ally, { type: REQ.ASK_DODGE, forSkill: 'hujia', source: ctx.source, lord: target, title: `护驾：是否替 ${target.name} 打出【闪】？` });
      if (r?.card) {
        const srcs = r.card.virtual ? r.card.sourceCards : [r.card];
        srcs.forEach((c) => removeFrom(ally.hand, c));
        engine.toDiscard([r.card]);
        engine.log(`${ally.name} 发动【护驾】替 ${target.name} 打出【闪】。`, 'good');
        return { shan: r.card.virtual ? null : r.card };
      }
    }
  }
  const resp = await engine.ask(target, { type: REQ.ASK_DODGE, ...ctx, title: `${target.name}：是否打出【闪】？` });
  if (resp?.card) {
    const sources = resp.card.virtual ? resp.card.sourceCards : [resp.card];
    sources.forEach((c) => removeFrom(target.hand, c));
    engine.toDiscard([resp.card]);
    applyShanEffect(engine, target, resp.card, ctx);
    return { shan: resp.card.virtual ? null : resp.card };
  }
  return null;
}

// 闪类变体的附加效果（寒冰护体/暂避锋芒/暗影斗篷）
function applyShanEffect(engine, target, card, ctx) {
  const def = defOf(card);
  if (def.freezeSource && ctx.source) engine.freezeHand(ctx.source, def.freezeSource);
  if (def.immuneNext) { target.flags.immuneNext = true; engine.log(`${target.name} 获得一次伤害免疫。`, 'good'); }
  if (def.noShaTarget) { target.flags.noShaTarget = true; engine.log(`${target.name} 本回合不可被【杀】指定。`, 'good'); }
}

// 请求一张杀（决斗 / 南蛮 / 借刀）
async function askSha(engine, player, ctx) {
  // 激将：蜀势力角色替主公出杀
  if (hasSkill(player, 'jijiang')) {
    for (const ally of engine.alivePlayers) {
      if (ally === player || ally.faction !== 'shu') continue;
      const r = await engine.ask(ally, { type: REQ.ASK_SHA, forSkill: 'jijiang', lord: player, title: `激将：是否替 ${player.name} 打出【杀】？` });
      if (r?.card) {
        const srcs = r.card.virtual ? r.card.sourceCards : [r.card];
        srcs.forEach((c) => removeFrom(ally.hand, c));
        engine.toDiscard([r.card]);
        engine.log(`${ally.name} 发动【激将】替 ${player.name} 打出【杀】。`, 'good');
        return true;
      }
    }
  }
  const resp = await engine.ask(player, { type: REQ.ASK_SHA, ...ctx, title: `${player.name}：是否打出【杀】？` });
  if (resp?.card) {
    const sources = resp.card.virtual ? resp.card.sourceCards : [resp.card];
    sources.forEach((c) => removeFrom(player.hand, c));
    engine.toDiscard([resp.card]);
    return true;
  }
  return false;
}

// ---------- 过河拆桥 / 邪恶低语 ----------
async function playGuohe(engine, user, target, card) {
  engine.toDiscard([card]);
  if (await nullified(engine, card, user, target)) return;
  if (!hasAnyCard(target)) return;
  const picked = await chooseTargetCard(engine, user, target, `${card.name}：弃置一张牌`, true);
  if (!picked) return;
  const wasTrick = CARD_DEFS[picked.kind]?.type === CARD_TYPE.TRICK;
  engine.discardCards(target, [picked]);
  // 邪恶低语：若弃掉的是锦囊牌，再弃掉其一张牌
  if (defOf(card).discardTrickBonus && wasTrick && hasAnyCard(target)) {
    engine.log(`${card.name}：弃掉的是锦囊牌，再弃置 ${target.name} 一张牌！`, 'play');
    const extra = await chooseTargetCard(engine, user, target, `${card.name}：再弃置一张牌`, true);
    if (extra) engine.discardCards(target, [extra]);
  }
}

// ---------- 顺手牵羊 ----------
async function playShunshou(engine, user, target, card) {
  engine.toDiscard([card]);
  if (await nullified(engine, card, user, target)) return;
  if (!hasAnyCard(target)) return;
  const picked = await chooseTargetCard(engine, user, target, '顺手牵羊：获得一张牌', true);
  if (picked) { engine.gainCard(user, picked); engine.log(`${user.name} 获得了 ${target.name} 的一张牌。`); }
}

// 选择目标的一张牌（手牌不可见时随机一张）
async function chooseTargetCard(engine, user, target, title, hideHand) {
  const visible = [];
  Object.values(target.equips).filter(Boolean).forEach((c) => visible.push({ card: c, zone: '装备' }));
  target.judge.forEach((c) => visible.push({ card: c, zone: '判定' }));
  const handChoice = target.hand.length ? { handCount: target.hand.length } : null;
  const resp = await engine.ask(user, {
    type: REQ.CHOOSE_CARD, title, target,
    visibleCards: visible, handChoice, fromPlayer: target.id,
  });
  if (resp?.card) {
    if (resp.card === 'hand') return randomHand(target);
    const found = findCardOnPlayer(target, resp.card);
    return found || randomCardOf(target);
  }
  // 兜底
  return randomCardOf(target);
}

// ---------- 决斗 ----------
async function playJuedou(engine, user, target, card) {
  engine.toDiscard([card]);
  if (await nullified(engine, card, user, target)) return;
  engine.log(`${user.name} 向 ${target.name} 发起【决斗】！`, 'play');
  await runDuel(engine, user, target);
}

// 通用决斗：target 先出杀，轮流，先不出者受到对方 1 点伤害（供决斗牌与离间复用）
export async function runDuel(engine, source, target) {
  let attacker = target, defender = source; // 决斗目标先出杀
  let loser = null;
  let guard = 0;
  while (guard++ < 30) {
    const needTwo = hasSkill(defender, 'wushuang'); // 面对无双角色需出两张
    let provided = true;
    for (let i = 0; i < (needTwo ? 2 : 1); i++) {
      if (!(await askSha(engine, attacker, { juedou: true, against: defender }))) { provided = false; break; }
    }
    if (!provided) { loser = attacker; break; }
    [attacker, defender] = [defender, attacker];
  }
  if (loser) {
    const winner = loser === source ? target : source;
    await engine.dealDamage({ source: winner, target: loser, amount: 1 });
  }
}

// ---------- 桃园结义 / 生命之树 ----------
async function playGroupRecover(engine, user, targets, card) {
  engine.toDiscard([card]);
  const full = !!defOf(card).fullHeal; // 生命之树：回复至上限
  for (const t of engine.alivePlayers) {
    if (await nullified(engine, card, user, t)) continue;
    await engine.recover(t, full ? Math.max(1, t.maxHp - t.hp) : 1);
  }
}

// ---------- 五谷丰登 ----------
async function playWugu(engine, user, targets, card) {
  engine.toDiscard([card]);
  const n = engine.alivePlayers.length;
  const reveal = [];
  for (let i = 0; i < n; i++) { engine._refillDeck(); if (engine.deck.length) reveal.push(engine.deck.shift()); }
  engine.changed();
  engine.log(`五谷丰登亮出 ${reveal.length} 张牌。`);
  const order = engine._orderFrom(user).filter((p) => p.alive);
  for (const p of order) {
    if (!reveal.length) break;
    if (await nullified(engine, card, user, p)) continue;
    const resp = await engine.ask(p, {
      type: REQ.CHOOSE_OPTION, title: '五谷丰登：选取一张牌',
      options: reveal.map((c) => ({ value: c.id, card: c, label: c.name })),
    });
    let chosen = reveal.find((c) => c.id === resp?.value) || reveal[0];
    removeFrom(reveal, chosen);
    p.hand.push(chosen);
    engine.log(`${p.name} 选取了【${chosen.name}】。`);
    engine.changed();
    await engine.pause(280);
  }
  if (reveal.length) engine.discard.push(...reveal);
  engine.changed();
}

// ---------- 南蛮入侵 / 万箭齐发 ----------
async function playAoe(engine, user, targets, card, respondKind) {
  engine.toDiscard([card]);
  const order = engine._orderFrom(user).filter((p) => p.alive && p !== user);
  for (const t of order) {
    if (await nullified(engine, card, user, t)) continue;
    const ok = respondKind === 'sha'
      ? await askSha(engine, t, { nanman: true })
      : await getOneDodge(engine, t, { source: user, card, wanjian: true });
    if (!ok) {
      await engine.dealDamage({ source: user, target: t, amount: 1, card });
      if (engine.over) return;
    } else {
      engine.log(`${t.name} 打出【${respondKind === 'sha' ? '杀' : '闪'}】。`, 'good');
    }
  }
}

// ---------- 借刀杀人 ----------
async function playJiedao(engine, user, targets, card, ctx) {
  engine.toDiscard([card]);
  const weaponHolder = targets[0];
  const victim = ctx.options?.victim ? engine.playerById(ctx.options.victim) : targets[1];
  if (await nullified(engine, card, user, weaponHolder)) return;
  if (!weaponHolder || !victim) return;
  engine.log(`${user.name} 借 ${weaponHolder.name} 之刀杀 ${victim.name}。`, 'play');
  const ok = await askSha(engine, weaponHolder, { jiedao: true, against: victim, mustTarget: victim });
  if (ok) {
    await resolveShaOn(engine, weaponHolder, victim, { kind: 'sha', suit: 'spade', name: '杀' });
  } else {
    // 不出杀，则将武器交给使用者
    const w = weaponHolder.equips[EQUIP_SLOT.WEAPON];
    if (w) { weaponHolder.equips[EQUIP_SLOT.WEAPON] = null; user.hand.push(w); engine.log(`${weaponHolder.name} 不出杀，武器【${w.name}】交给 ${user.name}。`); engine.changed(); }
  }
}

// ====================== 无懈可击链 ======================
// 返回 true 表示原效果被抵消
export async function nullified(engine, card, byUser, targetPlayer) {
  // 护心（尤格萨隆）：回合外每轮可凭空使用1次（觉醒后2次）【法术反制】保护自己
  if (targetPlayer && byUser && byUser !== targetPlayer && hasSkill(targetPlayer, 'huxin') && engine.turnOwner !== targetPlayer) {
    const cap = targetPlayer.skillState.yoggAwake ? 2 : 1;
    if ((targetPlayer.skillState.huxinWuxie || 0) < cap) {
      targetPlayer.skillState.huxinWuxie = (targetPlayer.skillState.huxinWuxie || 0) + 1;
      engine.log(`${targetPlayer.name} 发动【护心】，凭空使用【法术反制】！`, 'good');
      return true;
    }
  }
  // 奥术屏障（奥秘）：其他角色的锦囊对你无效
  if (targetPlayer && byUser && byUser !== targetPlayer) {
    const sec = targetPlayer.secrets?.find((s) => s.kind === 'aoshupingzhang');
    if (sec) {
      removeFrom(targetPlayer.secrets, sec); engine.discard.push(sec);
      engine.log(`${targetPlayer.name} 触发奥秘【奥术屏障】，锦囊无效！`, 'good');
      engine.fx('secret', { playerId: targetPlayer.id, label: '奥术屏障' });
      await engine.pause(320);
      return true;
    }
  }
  return await nullifyChain(engine, { card, byUser, targetPlayer });
}

async function nullifyChain(engine, { card, byUser, targetPlayer }) {
  let isNullified = false;
  let guard = 0;
  while (guard++ < 12) {
    const responder = await askAnyWuxie(engine, { card, targetPlayer, isNullified });
    if (!responder) break;
    isNullified = !isNullified;
    engine.log(`${responder.name} 打出【无懈可击】，${isNullified ? '抵消' : '反抵消'}【${card.name}】。`, 'good');
    await engine.pause(350);
  }
  return isNullified;
}

async function askAnyWuxie(engine, { card, targetPlayer, isNullified }) {
  for (const p of engine.alivePlayers) {
    const hasWuxie = p.hand.some((c) => c.kind === 'wuxie');
    if (!hasWuxie) continue;
    const resp = await engine.ask(p, {
      type: REQ.ASK_NULLIFY, card, targetPlayer, isNullified,
      title: `是否对【${card.name}】${targetPlayer ? '（' + targetPlayer.name + '）' : ''}使用【无懈可击】？`,
    });
    if (resp?.card) {
      removeFrom(p.hand, resp.card);
      engine.toDiscard([resp.card]);
      return p;
    }
  }
  return null;
}

// ---------- 牌引用工具 ----------
export function findCardOnPlayer(player, id) {
  let c = player.hand.find((x) => x.id === id);
  if (c) return c;
  c = Object.values(player.equips).find((x) => x && x.id === id);
  if (c) return c;
  c = player.judge.find((x) => x.id === id);
  return c || null;
}
function resolveCardRef(player, ref) {
  return typeof ref === 'string' ? findCardOnPlayer(player, ref) : ref;
}
function randomHand(player) {
  return player.hand[Math.floor(Math.random() * player.hand.length)] || randomCardOf(player);
}
export function randomCardOf(player) {
  const all = [...player.hand, ...Object.values(player.equips).filter(Boolean), ...player.judge];
  return all[Math.floor(Math.random() * all.length)] || null;
}
