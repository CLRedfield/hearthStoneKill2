// ====================== 炉石杀 技能实现 ======================
// 注册表条目：{ name, desc, active?, perTurn?, triggers?:{drawCount,handLimit,dealDamage,usedSha,beforeDeath,...}, action? }
// triggers 由 skills.js 的泛化分发在各时机调用；action 为出牌阶段主动技。
import { removeFrom, removeFromHand, clearCardFreeze, uid } from '../util.js';
import { virtualCard, isSha, cardAs, CARD_DEFS } from './cards.js';

// 生成一张“实体”延时/普通牌（非虚拟，能正常进出各区，避免虚拟牌空 sourceCards 导致的复制）
function makeRealCard(kind, suit = 'spade', number = 1) {
  const def = CARD_DEFS[kind] || {};
  return { id: uid('card'), kind, name: def.name, type: def.type, suit, number, red: suit === 'heart' || suit === 'diamond' };
}
import { REQ, SUIT_NAME, isBlack, isRed, CARD_TYPE } from './constants.js';

function findOnPlayer(player, ref) {
  if (typeof ref !== 'string') return ref;
  return player.hand.find((c) => c.id === ref)
    || Object.values(player.equips).find((c) => c && c.id === ref)
    || player.judge.find((c) => c.id === ref);
}
const anyCards = (p) => [...p.hand, ...Object.values(p.equips).filter(Boolean)];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function selectCards(engine, player, cards, config = {}) {
  const r = await engine.ask(player, {
    type: REQ.GUANXING,
    mode: 'select_cards',
    cards,
    ...config,
  });
  const ids = Array.isArray(r?.selected) ? [...new Set(r.selected)] : [];
  return ids.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
}

async function resolveWhisper(engine, source, target, need, damage, title = '低语') {
  const tricks = target.hand.filter((c) => !c.frozen && CARD_DEFS[c.kind]?.type === CARD_TYPE.TRICK);
  let chosen = [];
  if (tricks.length >= need) {
    if (engine.agentOf(target)?.kind === 'ai') chosen = tricks.slice(0, need);
    else if (need === 1) {
      const r = await engine.ask(target, {
        type: REQ.CHOOSE_OPTION,
        title: `${title}：弃置一张锦囊牌，或受到${damage}点伤害`,
        options: [...tricks.map((c) => ({ value: c.id, label: `弃【${c.name}】`, card: c })), { value: 'hurt', label: `受到${damage}点伤害` }],
      });
      const picked = tricks.find((c) => c.id === r?.value);
      if (picked) chosen = [picked];
    } else {
      chosen = await selectCards(engine, target, tricks, {
        minCount: need,
        maxCount: need,
        title: `${title}：选择弃置的${need}张锦囊牌`,
        selectedLabel: '将弃置的锦囊',
        availableLabel: '可选锦囊',
        confirmLabel: `弃置${need}张`,
        cancelLabel: `受到${damage}点伤害`,
      });
    }
  }
  if (chosen.length === need) engine.discardCards(target, chosen);
  else await engine.dealDamage({ source, target, amount: damage });
}

// 重新使用一张牌（看吧!/双生魔法）：用牌面信息凭空再使用一次，自动选目标
async function autoReplay(engine, player, info) {
  if (!info || !player.alive) return;
  const { resolveCard, validTargets, shaTargets } = await import('./effects.js');
  const def = CARD_DEFS[info.kind]; if (!def) return;
  const v = virtualCard(info.kind, [], { suit: info.suit, number: info.number, red: info.red });
  const role = cardAs(v);
  const others = engine.alivePlayers.filter((p) => p !== player);
  let targets = [];
  if (role === 'sha') {
    const t = shaTargets(engine, player).filter((x) => !engine.isAlly(player, x));
    if (!t.length) return; targets = [t.sort((a, b) => a.hp - b.hp)[0]];
  } else if (role === 'tao') { if (player.hp >= player.maxHp) return; }
  else if (role === 'jiu') { /* self */ }
  else if (def.type === CARD_TYPE.TRICK && def.as !== 'wuxie') {
    if (def.target === 'self') targets = [player];
    else if (def.target === 'all') targets = engine.alivePlayers.slice();
    else if (def.target === 'all_other') targets = others;
    else {
      const vt = validTargets(engine, player, v).filter((x) => !engine.isAlly(player, x));
      if (!vt.length) return; targets = [vt.sort((a, b) => b.hand.length - a.hand.length)[0]];
    }
  } else return; // 装备/延时/无懈不重演
  engine.log(`${player.name} 重新使用【${v.name}】！`, 'good');
  await resolveCard(engine, { user: player, card: v, targets, options: {} });
}
const cardInfo = (c) => ({ kind: c.kind, suit: c.suit, number: c.number, red: c.red });
// 神圣之触：判断一张牌是否“可造成伤害”
const DAMAGE_BEHAVES = ['juedou', 'hsjuedou', 'nanman', 'wanjian', 'daoshan', 'oddhp', 'ksenmask', 'hengchong', 'fengkuang'];
function isDamageCard(card) {
  if (cardAs(card) === 'sha') return true;
  const beh = CARD_DEFS[card.kind]?.behaves || card.kind;
  return DAMAGE_BEHAVES.includes(beh);
}

// 立即使用一张“实体牌”（暗影箭雨夺取后使用）：自动选目标，由 user 结算
// 立即使用一张牌；interactive 时由 user 本人（人类）选择目标，AI 用启发式
async function useRealCard(engine, user, card, interactive = false, allowDead = false) {
  if (!card || (!user.alive && !allowDead)) return; // allowDead：亡语等让已死亡角色也能结算用牌
  const { resolveCard, validTargets, shaTargets } = await import('./effects.js');
  const def = CARD_DEFS[card.kind] || {};
  const role = cardAs(card);
  const others = engine.alivePlayers.filter((p) => p !== user);
  const human = interactive && engine.agentOf?.(user)?.kind !== 'ai';
  // 候选目标排序：非友优先（AI 取首个）；byHp=true 残血优先，否则手牌多优先
  const prefer = (list, byHp) => list.slice().sort((a, b) => {
    const aa = engine.isAlly(user, a) ? 1 : 0, bb = engine.isAlly(user, b) ? 1 : 0;
    if (aa !== bb) return aa - bb;
    return byHp ? a.hp - b.hp : b.hand.length - a.hand.length;
  });
  const pick = async (cands) => {
    if (!cands.length) return null;
    if (!human) return cands[0];
    const r = await engine.ask(user, { type: REQ.CHOOSE_OPTION, title: `立即释放【${card.name}】：选择目标`, options: cands.map((c) => ({ value: c.id, label: c.name })) });
    return engine.playerById(r?.value) || cands[0];
  };
  let targets = [];
  if (role === 'sha') {
    const cands = prefer(shaTargets(engine, user), true);
    if (!cands.length) { engine.discard.push(card); return; }
    const t = await pick(cands); if (!t) { engine.discard.push(card); return; } targets = [t];
  } else if (role === 'tao') { if (user.hp >= user.maxHp || !user.alive) { engine.discard.push(card); return; } }
  else if (role === 'jiu') { /* self */ }
  else if (def.type === CARD_TYPE.EQUIP) { /* 装备给自己，targets 空 */ }
  else if (def.type === CARD_TYPE.DELAYED) {
    const cands = prefer(validTargets(engine, user, card), false);
    if (!cands.length) { engine.discard.push(card); return; }
    const t = await pick(cands); if (!t) { engine.discard.push(card); return; } targets = [t];
  } else if (def.type === CARD_TYPE.TRICK && def.as !== 'wuxie') {
    if (def.target === 'self') targets = [user];
    else if (def.target === 'all') targets = engine.alivePlayers.slice();
    else if (def.target === 'all_other') targets = others;
    else {
      const cands = prefer(validTargets(engine, user, card), false);
      if (!cands.length) { engine.discard.push(card); return; }
      const t = await pick(cands); if (!t) { engine.discard.push(card); return; } targets = [t];
    }
  } else { engine.discard.push(card); return; }
  engine.log(`${user.name} 立即使用【${card.name}】！`, 'play');
  await resolveCard(engine, { user, card, targets, options: {} });
}

export const HS_SKILLS = {
  // 灌魔（锁定技）：摸牌阶段多摸2；手牌上限12
  guanmo: {
    name: '灌魔', desc: '摸牌阶段多摸两张牌；手牌上限为12。',
    triggers: {
      drawCount: (engine, { base }) => base + 2,
      handLimit: (engine, { base }) => Math.max(base, 12),
    },
  },

  // 迟钝（锁定技）：手牌上限为4
  chidun: {
    name: '迟钝', desc: '你的手牌上限为4。',
    triggers: { handLimit: () => 4 },
  },

  // 猛击（锁定技）：一回合内累计造成2点伤害后，摸2回1
  mengji: {
    name: '猛击', desc: '一回合内累计造成2点伤害后，摸两张牌并回复1点体力。',
    triggers: {
      async dealDamage(engine, { source, amount }) {
        if (!source) return;
        source.flags.mengjiDmg = (source.flags.mengjiDmg || 0) + amount;
        if (source.flags.mengjiDmg >= 2 && !source.flags.mengjiDone) {
          source.flags.mengjiDone = true;
          engine.log(`${source.name} 发动【猛击】，摸两张牌并回复体力。`, 'good');
          engine.drawCards(source, 2);
          await engine.recover(source, 1);
        }
      },
    },
  },

  // 狂暴（主动·每回合一次）：你与一名角色各受1点强制伤害
  kuangbao: {
    name: '狂暴', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色，你们各受到1点强制伤害（每回合一次）。',
    async action(engine, { player, move }) {
      const target = engine.playerById(move.targetId);
      if (!target) return;
      player.flags.kuangbaoUsed = true;
      engine.log(`${player.name} 发动【狂暴】，与 ${target.name} 各受1点伤害！`, 'play');
      // 同时各受1点：先结算自己（不会因目标死亡的连锁反应而被豁免），再结算目标
      await engine.dealDamage({ source: player, target: player, amount: 1 });
      if (!engine.over && target.alive) await engine.dealDamage({ source: player, target, amount: 1 });
    },
  },

  // 饮血（主动·每回合一次）：弃n摸n回⌊n/2⌋
  yinxue: {
    name: '饮血', active: true, perTurn: true,
    desc: '出牌阶段弃 n 张牌，摸 n 张牌，并回复 ⌊n/2⌋ 点体力（每回合一次）。',
    async action(engine, { player, move }) {
      const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
      if (!cards.length) return;
      player.flags.yinxueUsed = true;
      engine.discardCards(player, cards);
      engine.drawCards(player, cards.length);
      const heal = Math.floor(cards.length / 2);
      engine.log(`${player.name} 发动【饮血】，换 ${cards.length} 张牌。`, 'good');
      if (heal > 0) await engine.recover(player, heal);
    },
  },

  // 光明能量（主动·每回合一次）：弃1，一名角色回血、另一名摸牌
  guangming: {
    name: '光明能量', active: true, perTurn: true,
    desc: '出牌阶段弃一张牌并指定两名角色，使其一回复1点体力、另一摸一张牌（每回合一次）。',
    async action(engine, { player, move }) {
      const card = findOnPlayer(player, move.cardId);
      const healT = engine.playerById(move.healId);
      const drawT = engine.playerById(move.drawId);
      if (!card || !healT || !drawT) return;
      player.flags.guangmingUsed = true;
      engine.discardCards(player, [card]);
      engine.log(`${player.name} 发动【光明能量】。`, 'good');
      await engine.recover(healT, 1);
      engine.drawCards(drawT, 1);
    },
  },

  // 灵魂分流（主动·每回合一次）：一名角色受1点强制伤害后摸4
  linghun: {
    name: '灵魂分流', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色（可指定自己），使其受到1点强制伤害，并在你的回合结束时摸四张牌（每回合一次）。',
    async action(engine, { player, move }) {
      const target = engine.playerById(move.targetId);
      if (!target) return;
      player.flags.linghunUsed = true;
      engine.log(`${player.name} 对 ${target.name} 发动【灵魂分流】，将于回合结束摸四张牌。`, 'play');
      await engine.dealDamage({ source: player, target, amount: 1 });
      player.skillState.linghunTarget = target.id; // 回合结束时摸4
    },
    triggers: {
      async endPhase(engine, { player }) {
        const tid = player.skillState.linghunTarget; player.skillState.linghunTarget = null;
        if (!tid) return;
        const t = engine.playerById(tid);
        if (t && t.alive) { engine.log(`${t.name} 因【灵魂分流】摸四张牌。`, 'good'); engine.drawCards(t, 4); }
      },
    },
  },

  // 虚空能量（锁定技）：你的【杀】造成伤害后，为最虚弱的角色回复等量体力（体力≤2时禁用光明能量，逻辑在 UI 处理）
  xukong: {
    name: '虚空能量', desc: '你体力≤2时无法使用【光明能量】；你的【杀】造成伤害后，可为一名角色回复等量体力。',
    triggers: {
      async dealDamage(engine, { source, amount, card }) {
        if (!card || !isSha(card)) return;
        const cands = engine.alivePlayers.filter((p) => p.hp < p.maxHp);
        if (!cands.length) return;
        let cand;
        if (engine.agentOf(source)?.kind === 'ai') cand = [...cands].sort((a, b) => a.hp - b.hp)[0];
        else { const resp = await engine.ask(source, { type: REQ.CHOOSE_OPTION, title: `虚空能量：为哪名角色回复${amount}点体力？`, options: cands.map((p) => ({ value: p.id, label: `${p.name}（${p.hp}/${p.maxHp}）` })) }); cand = engine.playerById(resp?.value) || cands[0]; }
        if (cand) { engine.log(`${source.name} 发动【虚空能量】，为 ${cand.name} 回复体力。`, 'good'); await engine.recover(cand, amount); }
      },
    },
  },

  // 重组（锁定技）：死亡时若已有10基本+10锦囊被使用，则满血复活并摸4（整局一次）
  chongzu: {
    name: '重组', desc: '锁定技：当你死亡，若已有10张基本牌与10张锦囊牌被使用，则满体力复活并摸四张牌（整局一次）。',
    triggers: {
      async beforeDeath(engine, { player }) {
        if (player.skillState.chongzuUsed) return false; // 整局一次，避免达标后反复复活
        if ((engine.usedBasic || 0) >= 10 && (engine.usedTrick || 0) >= 10) {
          player.skillState.chongzuUsed = true;
          player.hp = player.maxHp;
          engine.log(`✨ ${player.name} 发动【重组】，满体力复活并摸四张牌！`, 'win');
          engine.drawCards(player, 4); engine.changed();
          return true;
        }
        return false;
      },
    },
  },

  // 吸血（主动·每回合一次）：上限最多者-1上限，最少者+1上限并回血
  xixue: {
    name: '吸血', active: true, perTurn: true,
    desc: '出牌阶段指定体力上限最多与体力最少的两名角色：前者体力上限-1，后者体力上限+1并回复1点体力（每回合一次）。',
    async action(engine, { player, move }) {
      const a = engine.playerById(move.maxId), b = engine.playerById(move.minId);
      if (!a || !b) return;
      player.flags.xixueUsed = true;
      a.maxHp = Math.max(1, a.maxHp - 1); if (a.hp > a.maxHp) a.hp = a.maxHp;
      b.maxHp += 1; engine.changed();
      engine.log(`${player.name} 发动【吸血】：${a.name} 上限-1，${b.name} 上限+1。`, 'good');
      await engine.recover(b, 1);
    },
  },

  // 邪火（主动·每回合一次）：弃2张牌，横置一名角色的装备，置为“古尔丹之手”
  xiehuo: {
    name: '邪火', active: true, perTurn: true,
    desc: '出牌阶段弃两张牌，弃置一名角色的一张装备并令其判定区置入【古尔丹之手】（每回合一次）。',
    async action(engine, { player, move }) {
      const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
      const target = engine.playerById(move.targetId);
      if (cards.length < 2 || !target) return;
      player.flags.xiehuoUsed = true;
      engine.discardCards(player, cards.slice(0, 2));
      const slot = target.equips.weapon ? 'weapon' : (target.equips.armor ? 'armor' : null);
      if (slot) { const eq = target.equips[slot]; target.equips[slot] = null; engine.discard.push(eq); engine.log(`${player.name}【邪火】横置 ${target.name} 的【${eq.name}】。`, 'play'); }
      if (!target.judge.some((j) => j.kind === 'guldanhand')) {
        target.judge.push(makeRealCard('guldanhand')); // 用实体牌，避免虚拟牌(空sourceCards)在重洗后被无限复制
        engine.log(`${target.name} 的判定区置入【古尔丹之手】。`, 'play');
      }
      engine.changed();
    },
  },

  // 屠杀（锁定技）：你使用的【杀】作为冻结手牌回到手里
  tusha: {
    name: '屠杀', desc: '你使用的【杀】结算后作为冻结的手牌回到你的手里。',
    triggers: {
      async usedSha(engine, { player, card }) {
        const reals = card.virtual ? (card.sourceCards || []) : [card];
        const moved = reals.filter((c) => engine.discard.includes(c));
        if (!moved.length) return;
        moved.forEach((c) => { removeFrom(engine.discard, c); c.frozen = true; player.hand.push(c); });
        engine.log(`${player.name} 发动【屠杀】，【杀】冻结回到手牌。`, 'good');
        engine.changed();
      },
    },
  },

  // 无坚不摧：实现见 effects.js 的 resolveShaOn（需在杀结算流程内）
  wujian: {
    name: '无坚不摧', desc: '你对一名角色使用【杀】时，其需对自己使用一张【杀】，否则受到1点源于你的强制伤害。',
  },

  // ===== 穆坦努斯（中立）=====
  tunshi: {
    name: '吞噬', active: true, perTurn: true,
    desc: '出牌阶段拿走一名角色的一张手牌，将其置于另一名角色的武将牌上成为“盾”（每枚盾抵挡1点伤害，破盾时其拥有者摸1张）（每回合一次）。',
    async action(engine, { player, move }) {
      const from = engine.playerById(move.fromId); const to = engine.playerById(move.toId);
      if (!from || !to || !from.hand.length) return;
      player.flags.tunshiUsed = true;
      // 拿走 from 的一张手牌，置于 to 的武将牌上作为“盾”（穆坦努斯不保留该牌）
      const c = from.hand[Math.floor(Math.random() * from.hand.length)];
      removeFromHand(from.hand, c);
      (to.shieldCards = to.shieldCards || []).push(c);
      to.shields = (to.shields || 0) + 1;
      engine.log(`${player.name} 发动【吞噬】，拿走 ${from.name} 一张手牌置于 ${to.name} 武将牌上成为“盾”。`, 'play');
      engine.changed();
    },
  },

  // ===== 拉格纳罗斯（古神）=====
  yanqu: { name: '炎躯', desc: '锁定技：你免疫红色牌造成的伤害。' }, // 逻辑在 game.js dealDamage
  shenpan: {
    name: '审判烈焰', active: true, perTurn: true,
    desc: '出牌阶段指定至多三名角色各进行判定；你可使其中一名的判定点数+3或-3；然后对判定点数最低的一名角色造成2点火焰伤害（每回合一次）。',
    async action(engine, { player, move }) {
      const ids = move.targetIds || (move.targetId ? [move.targetId] : []);
      const tgts = ids.map((id) => engine.playerById(id)).filter((p) => p && p.alive);
      if (!tgts.length) return;
      player.flags.shenpanUsed = true;
      engine.log(`${player.name} 发动【审判烈焰】，对 ${tgts.length} 名角色判定...`, 'play');
      const results = [];
      for (const t of tgts) { const jr = await engine.doJudge(player, `审判烈焰·${t.name}`); results.push({ t, num: jr.number }); }
      // 调整一名角色的点数 ±3
      const agent = engine.agentOf(player);
      if (agent?.kind === 'ai') {
        const enemyRes = results.filter((r) => !engine.isAlly(player, r.t));
        if (enemyRes.length) enemyRes.sort((a, b) => a.num - b.num)[0].num -= 3; // 把敌方最低者压得更低，确保烧敌
      } else {
        const opts = [];
        results.forEach((r) => { opts.push({ value: `${r.t.id}:+`, label: `${r.t.name}(${r.num}) +3` }); opts.push({ value: `${r.t.id}:-`, label: `${r.t.name}(${r.num}) -3` }); });
        opts.push({ value: 'none', label: '不调整' });
        const resp = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: '审判烈焰：是否调整一名角色的判定点数？', options: opts });
        if (resp && resp.value !== 'none') { const [id, sign] = resp.value.split(':'); const r = results.find((x) => x.t.id === id); if (r) r.num += (sign === '+' ? 3 : -3); }
      }
      const lowest = results.sort((a, b) => a.num - b.num)[0];
      engine.log(`${player.name}【审判烈焰】点数最低者为 ${lowest.t.name}（${lowest.num}）。`, 'play');
      await engine.dealDamage({ source: player, target: lowest.t, amount: 2, nature: 'fire' });
    },
  },

  // ===== 洛克霍拉（部落）=====
  bingfeng: {
    name: '冰封', active: true, perTurn: true,
    desc: '出牌阶段指定至多三名角色，各冻结等同于你手牌数-1 的手牌（每回合一次）。',
    async action(engine, { player, move }) {
      const ids = move.targetIds || (move.targetId ? [move.targetId] : []);
      const targets = ids.map((id) => engine.playerById(id)).filter(Boolean).slice(0, 3);
      if (!targets.length) return;
      player.flags.bingfengUsed = true;
      const n = Math.max(0, player.hand.length - 1);
      for (const t of targets) { engine.log(`${player.name} 对 ${t.name} 发动【冰封】，冻结 ${n} 张。`, 'play'); engine.freezeHand(t, n); }
    },
  },
  fusheng: {
    name: '复生', desc: '锁定技：你体力≤2时，摸牌阶段多摸1张，且【杀】多造成1点伤害。',
    triggers: {
      drawCount: (engine, { player, base }) => (player.hp <= 2 ? base + 1 : base),
      shaDamage: (engine, { user, base }) => (user.hp <= 2 ? base + 1 : base),
    },
  },

  // ===== 布鲁坎（部落）=====
  yuansu: {
    name: '元素之力', desc: '锁定技：你回合开始时判定：♥你和一名角色各回复2点；♣摸3张；♠对至多两名角色各造成2点普通伤害；♦弃置至多三名角色各2张牌。',
    triggers: {
      async startPhase(engine, { player }) {
        engine.log(`${player.name} 发动【元素之力】，判定...`, 'good');
        const jr = await engine.doJudge(player, '元素之力');
        const others = engine.alivePlayers.filter((p) => p !== player);
        const isAI = engine.agentOf(player)?.kind === 'ai';
        const pickOne = async (cands, title, aiSort) => {
          if (!cands.length) return null;
          if (isAI) return [...cands].sort(aiSort)[0];
          const r = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title, options: cands.map((c) => ({ value: c.id, label: c.name })) });
          return engine.playerById(r?.value) || cands[0];
        };
        const pickMulti = async (cands, max, title, aiSort) => {
          if (isAI) return [...cands].sort(aiSort).slice(0, max);
          const r = await engine.ask(player, {
            type: REQ.SELECT_PLAYERS,
            title,
            minCount: 0,
            maxCount: max,
            players: cands.map((p) => ({
              id: p.id, name: p.name, general: p.general?.name || p.general || '',
              hp: p.hp, maxHp: p.maxHp, faction: p.faction,
            })),
          });
          const ids = Array.isArray(r?.ids) ? [...new Set(r.ids)] : [];
          return ids.map((id) => cands.find((p) => p.id === id)).filter(Boolean).slice(0, max);
        };
        const allyWeak = (a, b) => (engine.isAlly(player, b) ? 1 : 0) - (engine.isAlly(player, a) ? 1 : 0) || a.hp - b.hp;
        const enemyWeak = (a, b) => (engine.isAlly(player, a) ? 1 : 0) - (engine.isAlly(player, b) ? 1 : 0) || a.hp - b.hp;
        const enemyRich = (a, b) => (engine.isAlly(player, a) ? 1 : 0) - (engine.isAlly(player, b) ? 1 : 0) || b.hand.length - a.hand.length;
        if (jr.suit === 'heart') {
          await engine.recover(player, 2);
          const ally = await pickOne(others, '元素之力（♥）：选择一名角色与你一起回复2点', allyWeak);
          if (ally) await engine.recover(ally, 2);
        } else if (jr.suit === 'club') {
          engine.drawCards(player, 3);
        } else if (jr.suit === 'spade') {
          const list = await pickMulti(others, 2, '元素之力（♠）：选择至多两名角色各受2点伤害', enemyWeak);
          for (const t of list) { if (!player.alive || engine.over) break; await engine.dealDamage({ source: player, target: t, amount: 2, dodgeable: true }); } // 普通伤害：可闪
        } else {
          const cands = others.filter((p) => anyCards(p).length);
          const list = await pickMulti(cands, 3, '元素之力（♦）：选择至多三名角色各弃2张牌', enemyRich);
          for (const t of list) {
            const drop = [];
            for (let i = 0; i < 2 && anyCards(t).filter((c) => !drop.includes(c)).length; i++) drop.push(rand(anyCards(t).filter((c) => !drop.includes(c))));
            if (drop.length) engine.discardCards(t, drop);
          }
        }
      },
    },
  },

  // ===== 娜塔莉塞林（联盟）=====
  xuwu: {
    name: '虚无', active: true, perTurn: true,
    desc: '出牌阶段弃一张牌并指定一名角色，使其弃置所有与你弃牌颜色相同的牌（每回合一次）。',
    async action(engine, { player, move }) {
      const card = findOnPlayer(player, move.cardId); const t = engine.playerById(move.targetId);
      if (!card || !t) return;
      player.flags.xuwuUsed = true;
      const red = !isBlack(card.suit); // 颜色：红 / 黑
      engine.discardCards(player, [card]);
      engine.log(`${player.name} 发动【虚无】（${red ? '红色' : '黑色'}）。`, 'play');
      const drop = anyCards(t).filter((c) => (!isBlack(c.suit)) === red);
      if (drop.length) engine.discardCards(t, drop);
    },
  },
  xishou: {
    name: '吸收', desc: '锁定技：当你消灭一名角色，你获得其所有牌，并使你的体力上限增加其上限值且回复所有体力。',
    triggers: {
      async kill(engine, { killer, victim }) {
        const cards = [...victim.hand, ...Object.values(victim.equips).filter(Boolean), ...victim.judge];
        victim.hand.forEach(clearCardFreeze);
        victim.hand = []; victim.equips = { weapon: null, armor: null, plus: null, minus: null }; victim.judge = [];
        killer.hand.push(...cards);
        killer.maxHp = killer.maxHp + victim.maxHp; killer.hp = killer.maxHp; // 体力上限增加“被消灭者上限”，并回满
        engine.log(`${killer.name} 发动【吸收】，吞噬 ${victim.name}：体力上限+${victim.maxHp} 并回满！`, 'win');
        engine.changed();
      },
    },
  },

  // ===== 泰兰德（联盟）=====
  huoshi: {
    name: '火矢', desc: '锁定技：你的【杀】对手牌数大于5的角色多造成1点伤害。',
    triggers: { shaDamage: (engine, { target, base }) => (target.hand.length > 5 ? base + 1 : base) },
  },
  liuxing: {
    name: '流星雨', desc: '你的回合内每使用一张牌，可指定一名角色交给你一张与该牌同花色的手牌，否则其受到1点强制伤害（每回合对同一角色至多3次）。',
    triggers: {
      startPhase(engine, { player }) { player.skillState.liuxingCounts = {}; },
      async usedCard(engine, { player, card }) {
        if (engine.turnOwner !== player) return;
        if (!SUIT_NAME[card.suit]) return; // 无花色的虚拟牌不触发
        const counts = player.skillState.liuxingCounts || (player.skillState.liuxingCounts = {});
        const cand = engine.alivePlayers.filter((p) => p !== player && (counts[p.id] || 0) < 3);
        if (!cand.length) return;
        let t;
        const agent = engine.agentOf(player);
        if (agent?.kind === 'ai') {
          const enemies = cand.filter((p) => !engine.isAlly(player, p)).sort((a, b) => a.hp - b.hp);
          if (!enemies.length || Math.random() < 0.45) return; // AI 不必每张牌都触发
          t = enemies[0];
        } else {
          const resp = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: `流星雨：指定一名角色交${SUIT_NAME[card.suit]}牌或受1点（可放弃）`, options: [...cand.map((p) => ({ value: p.id, label: p.name })), { value: 'skip', label: '放弃' }] });
          if (!resp || resp.value === 'skip') return;
          t = engine.playerById(resp.value);
        }
        if (!t) return;
        counts[t.id] = (counts[t.id] || 0) + 1;
        const matches = t.hand.filter((c) => c.suit === card.suit);
        let give = null;
        if (matches.length) {
          const ta = engine.agentOf(t);
          if (ta?.kind === 'ai') { if (t.hp <= 2) give = matches[0]; } // AI：残血宁可交牌
          else {
            const r = await engine.ask(t, {
              type: REQ.CHOOSE_OPTION, title: `流星雨：交给 ${player.name} 一张${SUIT_NAME[card.suit]}手牌，或受到1点伤害`,
              options: [...matches.map((c) => ({ value: c.id, label: `交出 ${c.name}(${c.number})`, card: c })), { value: 'hurt', label: '受到1点伤害' }],
            });
            if (r?.value && r.value !== 'hurt') give = matches.find((c) => c.id === r.value) || null;
          }
        }
        if (give) { removeFromHand(t.hand, give); player.hand.push(give); engine.log(`${t.name} 交给 ${player.name} 一张${SUIT_NAME[card.suit]}牌（流星雨）。`); engine.changed(); return; }
        await engine.dealDamage({ source: player, target: t, amount: 1 });
      },
    },
  },

  // ===== 玛瑟里顿（军团）=====
  xiumian: {
    name: '休眠', desc: '锁定技：你跳过出牌阶段和弃牌阶段；摸牌阶段只摸1张；每轮受到1次伤害后，直到你下回合开始前免疫伤害。',
    triggers: {
      drawCount: (engine, { player, base }) => (player.skillState.awake ? base : 1),
      startPhase(engine, { player }) {
        player.sleepImmune = false;
        if (!player.skillState.awake) { player.flags.skipPlay = true; player.flags.skipDiscard = true; }
      },
      async damaged(engine, { player }) {
        if (!player.skillState.awake) { player.sleepImmune = true; engine.log(`${player.name}【休眠】进入免疫状态。`, 'good'); }
      },
    },
  },
  huanxing: {
    name: '唤醒', desc: '觉醒技：你的回合开始时，可弃置点数之和为24（或更多）的牌，使【休眠】失效并对所有其他角色造成1点强制伤害。',
    triggers: {
      async startPhase(engine, { player }) {
        if (player.skillState.awake) return;
        const pool = player.hand.filter((c) => !c.frozen);
        const sorted = [...pool].sort((a, b) => b.number - a.number);
        let sum = 0; const autoUse = [];
        for (const c of sorted) { if (sum >= 24) break; autoUse.push(c); sum += c.number; }
        if (sum < 24) return;
        let use = autoUse;
        if (engine.agentOf(player)?.kind !== 'ai') {
          use = await selectCards(engine, player, pool, {
            minCount: 1,
            maxCount: pool.length,
            minSum: 24,
            title: '唤醒：选择点数和至少为24的牌',
            selectedLabel: '将弃置的牌',
            availableLabel: '可选手牌',
            confirmLabel: '觉醒',
            cancelLabel: '保持休眠',
          });
          if (!use.length || use.reduce((n, c) => n + (c.number || 0), 0) < 24) return;
        }
        player.skillState.awake = true; player.flags.skipPlay = false; player.flags.skipDiscard = false; player.sleepImmune = false;
        engine.discardCards(player, use);
        engine.log(`✨ ${player.name} 弃 ${use.length} 张牌觉醒【唤醒】，休眠解除！`, 'win');
        for (const t of engine.alivePlayers.filter((p) => p !== player)) { if (!player.alive || engine.over) break; await engine.dealDamage({ source: player, target: t, amount: 1 }); }
      },
    },
  },
  shenyuanhao: {
    name: '深渊之号', active: true, limited: true,
    desc: '限定技：所有其他角色抉择①将体力变为1②摸等同自己体力的牌；随后你抉择①减2点体力上限，使选①者回满、选②者弃光手牌②弃光你自己所有手牌。',
    async action(engine, { player }) {
      player.skillState.shenyuanUsed = true;
      engine.log(`${player.name} 发动限定技【深渊之号】！`, 'play');
      const others = engine.alivePlayers.filter((p) => p !== player);
      const picks = []; // {p, choice}
      for (const t of others) {
        let choice;
        const agent = engine.agentOf(t);
        if (agent?.kind === 'ai') choice = t.hp >= 3 ? 'one' : 'draw'; // 高血变1亏，倾向变1；低血摸牌
        else { const resp = await engine.ask(t, { type: REQ.CHOOSE_OPTION, title: `深渊之号：①体力变为1 / ②摸 ${t.hp} 张牌`, options: [{ value: 'one', label: '体力变为1' }, { value: 'draw', label: `摸 ${t.hp} 张牌` }] }); choice = resp?.value || 'one'; }
        picks.push({ p: t, choice });
        if (choice === 'one') { if (t.hp > 1) { t.hp = 1; engine.changed(); } }
        else { engine.drawCards(t, t.hp); }
      }
      // 你抉择
      let myChoice;
      const myAgent = engine.agentOf(player);
      if (myAgent?.kind === 'ai') myChoice = 'a';
      else { const resp = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: '深渊之号：①-2上限，选①者回满、选②者弃光手牌 / ②你弃光自己手牌', options: [{ value: 'a', label: '①减2上限并奖惩他人' }, { value: 'b', label: '②弃光自己手牌' }] }); myChoice = resp?.value || 'a'; }
      if (myChoice === 'a') {
        player.maxHp = Math.max(1, player.maxHp - 2); if (player.hp > player.maxHp) player.hp = player.maxHp; engine.changed();
        for (const { p, choice } of picks) {
          if (choice === 'one') { await engine.recover(p, p.maxHp - p.hp); }
          else if (p.hand.length) { engine.discardCards(p, [...p.hand]); }
        }
      } else {
        if (player.hand.length) engine.discardCards(player, [...player.hand]);
      }
    },
  },

  // ===== 玛克扎尔（军团）=====
  yuanyuhuo: {
    name: '渊狱火', active: true, perTurn: true,
    desc: '出牌阶段抽取一张武将牌（称“渊”），本回合获得其一个技能（可触发一次），随后弃掉“渊”并弃掉一张牌（每回合一次）。',
    async action(engine, { player, move }) {
      player.flags.yuanyuhuoUsed = true;
      const { generalPool, getGeneral } = await import('./generals.js');
      const { SKILLS } = await import('./skills.js');
      // 抽一张随机武将作“渊”（排除玛克扎尔已有技能）
      const pool = generalPool('hs').map(getGeneral).filter((g) => g && (g.skills || []).length);
      const gen = pool[Math.floor(Math.random() * pool.length)];
      if (!gen) return;
      const cands = (gen.skills || []).filter((s) => !(player.skills || []).includes(s) && SKILLS[s]);
      if (!cands.length) { engine.drawCards(player, 1); return; }
      let key;
      if (engine.agentOf(player)?.kind === 'ai') key = cands.find((s) => SKILLS[s]?.active) || cands[0];
      else { const r = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: `渊狱火：“渊”=${gen.name}，获得其一个技能`, options: cands.map((s) => ({ value: s, label: `${SKILLS[s].name}${SKILLS[s].active ? '（主动）' : '（锁定）'}` })) }); key = r?.value || cands[0]; }
      // 临时授予该技能（回合结束移除）
      player.skills.push(key);
      player.skillState.yuanyuBorrow = key;
      engine.log(`${player.name} 发动【渊狱火】，从“渊·${gen.name}”获得技能【${SKILLS[key].name}】！`, 'win');
      // 弃掉1张牌作为代价
      const cost = (move.cardId && findOnPlayer(player, move.cardId)) || player.hand.filter((c) => !c.frozen)[0];
      if (cost) engine.discardCards(player, [cost]);
      engine.changed();
    },
    triggers: {
      endPhase(engine, { player }) {
        const k = player.skillState.yuanyuBorrow;
        if (k) { removeFrom(player.skills, k); player.skillState.yuanyuBorrow = null; engine.log(`${player.name} 失去借得的技能【${k}】。`); }
      },
    },
  },
  anyingjian: {
    name: '暗影箭雨', active: true, perTurn: true,
    desc: '出牌阶段明置至多三名角色共四张手牌，然后选择其中一张牌立即使用（每回合一次）。',
    async action(engine, { player, move }) {
      player.flags.anyingjianUsed = true;
      const ids = move.targetIds || [];
      let tgts = ids.map((id) => engine.playerById(id)).filter((t) => t && t.alive && t !== player);
      if (!tgts.length) tgts = engine.alivePlayers.filter((p) => p !== player && p.hand.length).sort((a, b) => b.hand.length - a.hand.length).slice(0, 3);
      // 从这些角色明置共4张手牌
      const revealed = [];
      const pools = tgts.map((t) => ({ t, cards: [...t.hand] }));
      let guard = 0;
      while (revealed.length < 4 && guard++ < 30) {
        const avail = pools.filter((x) => x.cards.length);
        if (!avail.length) break;
        const pick = avail[guard % avail.length];
        const c = pick.cards.splice(Math.floor(Math.random() * pick.cards.length), 1)[0];
        revealed.push({ owner: pick.t, card: c });
      }
      if (!revealed.length) { engine.log(`${player.name}【暗影箭雨】无牌可明置。`); return; }
      engine.log(`${player.name} 发动【暗影箭雨】，明置：${revealed.map((r) => `${r.owner.name}的${r.card.name}`).join('、')}。`, 'play');
      // 选一张立即使用
      let chosen;
      if (engine.agentOf(player)?.kind === 'ai') {
        chosen = revealed.find((r) => isSha(r.card)) || revealed.find((r) => CARD_DEFS[r.card.kind]?.type === CARD_TYPE.TRICK) || revealed[0];
      } else {
        const r = await engine.ask(player, {
          type: REQ.CHOOSE_CARD,
          title: '暗影箭雨：选择一张立即使用',
          fromPlayer: player.id,
          visibleCards: revealed.map((x) => ({ card: x.card, zone: x.owner.name })),
        });
        chosen = revealed.find((x) => x.card.id === r?.card) || revealed[0];
      }
      removeFromHand(chosen.owner.hand, chosen.card); engine.changed();
      await useRealCard(engine, player, chosen.card);
    },
  },
  xuehou: {
    name: '血吼', active: true, limited: true,
    desc: '限定技：弃置你装备区的武器与两张手牌，对一名角色造成2点强制伤害。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      const w = player.equips.weapon;
      const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
      if (!w || cards.length < 2) return;
      player.skillState.xuehouUsed = true;
      player.equips.weapon = null; engine.discard.push(w);
      engine.discardCards(player, cards.slice(0, 2));
      engine.log(`${player.name} 发动限定技【血吼】，对 ${t.name} 造成2点强制伤害！`, 'play');
      await engine.dealDamage({ source: player, target: t, amount: 2 });
    },
  },

  // ===== 凯尔萨斯（军团）=====
  xiehuo2: {
    name: '邪火', desc: '锁定技：你每回合使用的第3、6、9…张牌会再使用一次，且你随后摸两张牌。',
    triggers: {
      async usedCard(engine, { player, card }) {
        if (player.skillState.xiehuoReplaying) return;
        player.skillState.xiehuoCount = (player.skillState.xiehuoCount || 0) + 1;
        if (player.skillState.xiehuoCount % 3 !== 0) return;
        const ty = CARD_DEFS[card.kind]?.type;
        engine.log(`${player.name} 发动【邪火】，再次使用并摸两张牌。`, 'good');
        if (ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK) {
          player.skillState.xiehuoReplaying = true;
          try { await autoReplay(engine, player, cardInfo(card)); } finally { player.skillState.xiehuoReplaying = false; }
        }
        engine.drawCards(player, 2);
        // 该牌效果触发了两次 → 触发【奥】
        const { triggerSkill } = await import('./skills.js');
        await triggerSkill(engine, 'cardTwice', { player, card });
      },
      startPhase(engine, { player }) { player.skillState.xiehuoCount = 0; },
    },
  },
  ao: {
    name: '奥', desc: '锁定技：当一张牌在你的回合触发两次时，你抉择：①明置一名角色的一张手牌，当其使用该牌时视为你对其使用一张【火球术】；②你恢复1点体力。',
    triggers: {
      async cardTwice(engine, { player }) {
        const enemies = engine.alivePlayers.filter((p) => p !== player && !engine.isAlly(player, p) && p.hand.length);
        let pick;
        if (engine.agentOf(player)?.kind === 'ai') pick = (player.hp < player.maxHp || !enemies.length) ? 'heal' : 'mark';
        else { const opts = []; if (enemies.length) opts.push({ value: 'mark', label: '明置一名角色手牌（其使用时你火球之）' }); opts.push({ value: 'heal', label: '恢复1点体力' }); const r = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: '奥：选择', options: opts }); pick = r?.value || 'heal'; }
        if (pick === 'mark' && enemies.length) {
          const t = enemies.sort((a, b) => a.hp - b.hp)[0];
          const c = t.hand[Math.floor(Math.random() * t.hand.length)];
          c.aoMark = player.id;
          engine.log(`${player.name} 发动【奥】，明置 ${t.name} 的一张手牌。`, 'play'); engine.changed();
        } else { engine.log(`${player.name} 发动【奥】，恢复1点体力。`, 'good'); await engine.recover(player, 1); }
      },
    },
  },

  // ===== 卡扎克（军团）=====
  longwang: {
    name: '龙王战刃', desc: '锁定技：一名角色的回合结束时，若其本回合未使用过【杀】，你获得一枚“刃”。',
    triggers: {
      async anyEndPhase(engine, { owner, turnPlayer }) {
        // owner 即拥有【龙王战刃】的卡扎克；turnPlayer 为回合结束者
        if (turnPlayer && turnPlayer !== owner && (turnPlayer.flags?.shaUsed || 0) === 0) {
          owner.blades = (owner.blades || 0) + 1;
          engine.log(`${owner.name} 发动【龙王战刃】，获得1枚“刃”（共 ${owner.blades}）。`, 'good');
        }
      },
    },
  },
  shunpi: {
    name: '顺劈斩', desc: '锁定技：你的回合开始时若有“刃”，弃1枚摸两张牌；你的【杀】造成伤害后，可弃 n 枚“刃”追加 n 点强制伤害。',
    triggers: {
      startPhase(engine, { player }) {
        if (player.blades > 0) { player.blades -= 1; engine.log(`${player.name} 发动【顺劈斩】，弃1枚“刃”摸两张牌。`, 'good'); engine.drawCards(player, 2); }
      },
      async dealDamage(engine, { source, target, card }) {
        if (!card || !isSha(card) || !target?.alive || !(source.blades > 0)) return;
        const max = source.blades;
        let n = 0;
        if (engine.agentOf(source)?.kind === 'ai') {
          n = target.hp <= max ? target.hp : 0; // AI：能斩杀则全弃，否则保留
        } else {
          const resp = await engine.ask(source, { type: REQ.CHOOSE_OPTION, title: `顺劈斩：弃几枚“刃”追加强制伤害？（共${max}枚）`, options: Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: `${i} 枚` })) });
          n = Math.min(max, Math.max(0, resp?.value | 0));
        }
        if (n <= 0) return;
        source.blades -= n;
        engine.log(`${source.name} 发动【顺劈斩】，弃 ${n} 枚“刃”追加 ${n} 点强制伤害。`, 'play');
        await engine.dealDamage({ source, target, amount: n });
      },
    },
  },
  qtanying: {
    name: '群体暗影', active: true, limited: true,
    desc: '限定技：所有其他角色弃置两张牌；无法弃置者则使你获得一枚“刃”。',
    async action(engine, { player }) {
      player.skillState.qtanyingUsed = true;
      engine.log(`${player.name} 发动限定技【群体暗影】！`, 'play');
      for (const t of engine.alivePlayers.filter((p) => p !== player)) {
        const pool = [...t.hand, ...Object.values(t.equips).filter(Boolean)];
        if (pool.length >= 2) {
          const agent = engine.agentOf(t);
          let cs;
          if (agent?.kind === 'ai') cs = pool.slice(0, 2);
          else { const r = await engine.ask(t, { type: REQ.DISCARD_CARDS, count: 2, from: 'all', title: '群体暗影：弃置两张牌' }); cs = (r?.cards || []).map((x) => findOnPlayer(t, x)).filter(Boolean); if (cs.length < 2) cs = [...cs, ...pool.filter((c) => !cs.includes(c)).slice(0, 2 - cs.length)]; }
          engine.discardCards(t, cs.slice(0, 2));
        }
        else { player.blades = (player.blades || 0) + 1; engine.log(`${t.name} 无法弃牌，${player.name} 获得1枚“刃”。`); }
      }
      engine.changed();
    },
  },
  bhlinghun: {
    name: '捕获灵魂', active: true, limited: true,
    desc: '限定技：减少1点体力上限并弃6枚“刃”；所有其他角色依次抉择：①受到2点强制伤害；②弃置 4+n 张牌（n 为此前选择②弃牌的人数）。',
    async action(engine, { player }) {
      if ((player.blades || 0) < 6) return;
      player.skillState.bhlinghunUsed = true;
      player.blades -= 6;
      player.maxHp = Math.max(1, player.maxHp - 1); if (player.hp > player.maxHp) player.hp = player.maxHp;
      engine.log(`${player.name} 发动限定技【捕获灵魂】！`, 'play'); engine.changed();
      let nDiscard = 0; // n = 此前选择“弃牌”（②）的人数
      for (const t of engine.alivePlayers.filter((p) => p !== player)) {
        if (engine.over) break;
        const need = 4 + nDiscard;
        const pool = [...t.hand, ...Object.values(t.equips).filter(Boolean)];
        let choice = 'dmg';
        if (pool.length >= need) {
          const agent = engine.agentOf(t);
          if (agent?.kind === 'ai') choice = (t.hp <= 2 || pool.length >= need + 2) ? 'discard' : 'dmg';
          else { const resp = await engine.ask(t, { type: REQ.CHOOSE_OPTION, title: `捕获灵魂：①受2点强制伤害 / ②弃置${need}张牌`, options: [{ value: 'dmg', label: '受到2点强制伤害' }, { value: 'discard', label: `弃置${need}张牌` }] }); choice = resp?.value || 'dmg'; }
        } // 牌不够则只能受伤
        if (choice === 'discard') {
          const agent = engine.agentOf(t);
          let cs;
          if (agent?.kind === 'ai') cs = pool.slice(0, need);
          else { const r = await engine.ask(t, { type: REQ.DISCARD_CARDS, count: need, from: 'all', title: `捕获灵魂：弃置${need}张牌` }); cs = (r?.cards || []).map((x) => findOnPlayer(t, x)).filter(Boolean); if (cs.length < need) cs = [...cs, ...pool.filter((c) => !cs.includes(c)).slice(0, need - cs.length)]; }
          engine.discardCards(t, cs.slice(0, need)); nDiscard++;
        }
        else { await engine.dealDamage({ source: player, target: t, amount: 2 }); }
      }
    },
  },

  // ===== 加拉克苏斯（军团）=====
  lianyu: {
    name: '炼狱', active: true, limited: true,
    desc: '限定技：使所有其他角色体力变为2，因此失去体力的角色摸（2×失去量）张牌。',
    async action(engine, { player }) {
      player.skillState.lianyuUsed = true;
      engine.log(`${player.name} 发动限定技【炼狱】！`, 'play');
      for (const t of engine.alivePlayers) {
        if (t === player) continue;
        const old = t.hp; t.hp = Math.min(2, t.maxHp); engine.changed();
        const lost = old - t.hp;
        if (lost > 0) engine.drawCards(t, lost * 2);
      }
      await engine.pause(400);
    },
  },
  xuerou: {
    name: '血肉成灰', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色，使其下个回合摸牌-1（每回合一次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      player.flags.xuerouUsed = true;
      t.drawPenalty = (t.drawPenalty || 0) + 1;
      engine.log(`${player.name} 对 ${t.name} 发动【血肉成灰】，其下回合少摸1张。`, 'play');
    },
  },

  // ===== 伊露西亚（天灾）=====
  liexin: {
    name: '裂心', active: true, perTurn: true,
    desc: '出牌阶段与一名角色交换手牌，在你回合结束时换回（每回合一次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      player.flags.liexinUsed = true;
      [...player.hand, ...t.hand].forEach(clearCardFreeze);
      const tmp = player.hand; player.hand = t.hand; t.hand = tmp;
      player.skillState.liexinPartner = t.id;
      engine.log(`${player.name} 与 ${t.name} 交换手牌（裂心）。`, 'play'); engine.changed();
    },
    triggers: {
      async endPhase(engine, { player }) {
        const pid = player.skillState.liexinPartner; if (!pid) return;
        player.skillState.liexinPartner = null;
        const t = engine.playerById(pid);
        if (t && t.alive) { [...player.hand, ...t.hand].forEach(clearCardFreeze); const tmp = player.hand; player.hand = t.hand; t.hand = tmp; engine.log(`${player.name} 与 ${t.name} 换回手牌。`); engine.changed(); }
      },
    },
  },

  // ===== 苔丝（联盟）=====
  fanzhao: {
    name: '翻找', active: true, perTurn: true,
    desc: '出牌阶段从弃牌堆获得一张不是你使用过的牌（你使用的牌会被单独标记）（每回合一次）。',
    triggers: {
      // 你使用的牌标记为“己用”，翻找不可获得
      usedCard(engine, { player, card }) {
        const reals = card.virtual ? (card.sourceCards || []) : [card];
        reals.forEach((c) => { c.tessUsed = true; });
      },
    },
    async action(engine, { player, move }) {
      const usable = engine.discard.filter((x) => !x.tessUsed);
      const c = usable.find((x) => x.id === move.cardId) || usable[usable.length - 1];
      if (!c) { engine.log(`${player.name}【翻找】没有可获得的牌。`); return; }
      player.flags.fanzhaoUsed = true;
      removeFrom(engine.discard, c); player.hand.push(c);
      engine.log(`${player.name} 发动【翻找】，从弃牌堆获得【${c.name}】。`, 'good'); engine.changed();
    },
  },

  // ===== 希拉斯暗月（古神）=====
  xuanzhuan: {
    name: '旋转', active: true,
    desc: '出牌阶段观看一名角色手牌，获得其一张牌并给其一张牌（每回合至多3次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t || t === player) return;
      player.flags.xuanzhuanCount = (player.flags.xuanzhuanCount || 0) + 1;
      const isAI = engine.agentOf?.(player)?.kind === 'ai';
      // 价值估算（AI 取最有价值，给最无价值）
      const val = (c) => {
        const d = CARD_DEFS[c.kind] || {};
        if (cardAs(c) === 'tao') return 9;
        if (d.type === CARD_TYPE.EQUIP) return 8;
        if (cardAs(c) === 'jiu') return 7;
        if (d.type === CARD_TYPE.TRICK) return 6;
        if (cardAs(c) === 'sha' || cardAs(c) === 'shan') return 5;
        return 4;
      };
      if (!isAI && t.hand.length) {
        const leftPool = [...t.hand];
        const rightPool = [...player.hand];
        const r = await engine.ask(player, {
          type: REQ.SWAP_CARDS,
          title: `旋转：与 ${t.name} 交换一张手牌`,
          leftCards: leftPool,
          rightCards: rightPool,
          leftLabel: `${t.name}的手牌 · 选择获得`,
          rightLabel: '你的手牌 · 选择交出',
        });
        const taken = leftPool.find((c) => c.id === r?.left) || leftPool[0];
        if (!taken) return;
        removeFromHand(t.hand, taken); player.hand.push(taken);
        const given = player.hand.find((c) => c.id === r?.right) || player.hand[0];
        if (given) { removeFromHand(player.hand, given); t.hand.push(given); }
        engine.log(`${player.name} 发动【旋转】，获得 ${t.name} 的一张手牌并交还一张牌。`, 'play');
        engine.changed();
        return;
      }
      // 1) 观看对方手牌并选择获得一张
      if (t.hand.length) {
        let taken;
        if (isAI) taken = [...t.hand].sort((a, b) => val(b) - val(a))[0];
        else {
          const r = await engine.ask(player, {
            type: REQ.CHOOSE_CARD, title: `旋转：观看 ${t.name} 的手牌，选择获得一张`,
            fromPlayer: t.id, visibleCards: t.hand.map((c) => ({ card: c, zone: '手牌' })),
          });
          taken = t.hand.find((c) => c.id === r?.card) || t.hand[0];
        }
        removeFromHand(t.hand, taken); player.hand.push(taken);
        engine.log(`${player.name} 发动【旋转】，获得 ${t.name} 的一张手牌。`, 'play');
      }
      // 2) 选择给其一张牌
      if (player.hand.length) {
        let given;
        if (isAI) given = [...player.hand].sort((a, b) => val(a) - val(b))[0];
        else {
          const r = await engine.ask(player, {
            type: REQ.CHOOSE_CARD, title: `旋转：选择给 ${t.name} 一张牌`,
            fromPlayer: player.id, visibleCards: player.hand.map((c) => ({ card: c, zone: '手牌' })),
          });
          given = player.hand.find((c) => c.id === r?.card) || player.hand[0];
        }
        removeFromHand(player.hand, given); t.hand.push(given);
        engine.log(`${player.name}【旋转】交给 ${t.name} 一张牌。`);
      }
      engine.changed();
    },
  },

  // ===== 克尔苏加德（天灾）=====
  hanshuang: {
    name: '寒霜', active: true, perTurn: true,
    desc: '出牌阶段令一名角色下个回合手牌上限-2（每回合一次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      player.flags.hanshuangUsed = true;
      t.frostHandLimit = (t.frostHandLimit || 0) + 2;
      engine.log(`${player.name} 对 ${t.name} 发动【寒霜】，其下回合手牌上限-2。`, 'play');
    },
  },

  // ===== 洛欧塞布（天灾）=====
  baozi: {
    name: '孢子', desc: '锁定技：当你受到一次伤害后，使下一张被使用的【杀】伤害+1。',
    triggers: {
      async damaged(engine, { player }) {
        engine.sporeBonus = (engine.sporeBonus || 0) + 1;
        engine.log(`${player.name} 发动【孢子】，下一张【杀】伤害+1。`, 'good');
      },
    },
  },

  // ===== 机械克苏恩（古神）=====
  zhongjie: {
    name: '终结', desc: '锁定技：当你没有手牌、装备、奥秘且判定区无牌时，你每受到一次伤害便消灭一名角色。',
    triggers: {
      async damaged(engine, { player }) {
        const empty = !player.hand.length && !Object.values(player.equips).some(Boolean) && !(player.secrets || []).length && !player.judge.length;
        if (!empty) return;
        const others = engine.alivePlayers.filter((p) => p !== player);
        const victim = others.filter((p) => !engine.isAlly(player, p)).sort((a, b) => a.hp - b.hp)[0] || others.sort((a, b) => a.hp - b.hp)[0];
        if (victim) { engine.log(`${player.name} 发动【终结】，消灭 ${victim.name}！`, 'death'); victim.hp = 0; await engine._dying(victim, player); }
      },
    },
  },

  // ===== 希拉斯暗月·月影（古神）=====
  yueying: {
    name: '月影', desc: '锁定技：你的回合外首次受到伤害时抉择：①下回合首张牌视为使用两次；②下回合【杀】伤害+1且使用次数+1；③濒死时回复1点体力。',
    triggers: {
      async damaged(engine, { player }) {
        if (engine.turnOwner === player || player.skillState.yueyingArmed) return;
        player.skillState.yueyingArmed = true;
        const resp = await engine.ask(player, {
          type: REQ.CHOOSE_OPTION, title: '月影：选择一个效果',
          options: [{ value: '1', label: '下回合首张牌使用两次' }, { value: '2', label: '下回合【杀】+1伤害且+1次数' }, { value: '3', label: '濒死时回复1点体力' }],
        });
        const c = resp?.value || '3';
        if (c === '1') player.skillState.yueyingDouble = true;
        else if (c === '2') player.skillState.yueyingShaBuff = true;
        else player.skillState.yueyingHeal = true;
        engine.log(`${player.name} 发动【月影】。`, 'good');
      },
      startPhase(engine, { player }) {
        player.skillState.yueyingArmed = false;
        player.skillState.yueyingFirstDone = false;
        if (player.skillState.yueyingShaBuff) { player.skillState.yueyingShaBuff = false; player.flags.extraSha = (player.flags.extraSha || 0) + 1; player.flags.yueyingShaDmg = true; }
      },
      async usedCard(engine, { player, card }) {
        if (!player.skillState.yueyingDouble || player.skillState.yueyingFirstDone || player.skillState.yueyingReplaying) return;
        player.skillState.yueyingFirstDone = true; player.skillState.yueyingDouble = false;
        const ty = CARD_DEFS[card.kind]?.type;
        if (ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK) {
          player.skillState.yueyingReplaying = true;
          engine.log(`${player.name}【月影】令此牌再使用一次。`, 'good');
          try { await autoReplay(engine, player, cardInfo(card)); } finally { player.skillState.yueyingReplaying = false; }
        }
      },
      shaDamage: (engine, { user, base }) => (user.flags.yueyingShaDmg ? base + 1 : base),
      async beforeDeath(engine, { player }) {
        if (player.skillState.yueyingHeal) { player.skillState.yueyingHeal = false; player.hp = 1; engine.log(`${player.name} 发动【月影】，濒死回复至1点体力！`, 'win'); engine.changed(); return true; }
        return false;
      },
    },
  },

  // ===== 洛欧塞布·毒雾（天灾）=====
  duwu: {
    name: '毒雾', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色，直到你的下个回合开始，其每使用一张牌前须自行选择弃掉一张点数更大的牌，否则不能使用（每回合一次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t || t === player) return;
      player.flags.duwuUsed = true;
      player.skillState.duwuTarget = t.id;
      engine.log(`${player.name} 对 ${t.name} 发动【毒雾】。`, 'play');
    },
    triggers: { startPhase(engine, { player }) { player.skillState.duwuTarget = null; } },
  },

  // ===== 克尔苏加德·回收/重生（天灾）=====
  huishou: {
    name: '回收', desc: '锁定技：一名角色的回合结束时若其弃了牌，由其选择交给你等同弃牌数量的牌。',
    triggers: {
      async anyEndPhase(engine, { owner, turnPlayer }) {
        if (!turnPlayer || turnPlayer === owner) return;
        const n = turnPlayer.flags?.lastDiscardCount || 0;
        if (n <= 0 || !turnPlayer.hand.length) return;
        const count = Math.min(n, turnPlayer.hand.length);
        let give = await selectCards(engine, turnPlayer, turnPlayer.hand, {
          minCount: count,
          maxCount: count,
          title: `回收：选择交给 ${owner.name} 的 ${count} 张牌`,
          selectedLabel: `交给 ${owner.name} 的牌`,
          availableLabel: '你的手牌',
          confirmLabel: `交出 ${count} 张牌`,
        });
        if (give.length !== count) give = turnPlayer.hand.slice(0, count);
        give.forEach((c) => { removeFromHand(turnPlayer.hand, c); owner.hand.push(c); });
        engine.log(`${turnPlayer.name} 因【回收】交给 ${owner.name} ${give.length} 张牌。`, 'play'); engine.changed();
      },
    },
  },
  chongsheng: { name: '重生', desc: '锁定技：一名角色在其自己回合或你的回合死亡时，你可使其以1点体力复活并摸四张牌。' }, // 复活逻辑见 game._die

  // ===== 苔丝·发现（联盟）=====
  faxian: {
    name: '发现', desc: '锁定技：你摸牌后，可观看牌库顶（摸牌数+1）张牌，并以任意顺序置于牌堆顶或牌堆底。',
    triggers: {
      async afterDraw(engine, { player, count }) {
        engine._refillDeck();
        const n = Math.min((count || 0) + 1, engine.deck.length);
        const top = engine.deck.slice(0, n);
        if (!top.length) return;
        const resp = await engine.ask(player, { type: REQ.GUANXING, cards: top, title: `发现：重新排列牌堆顶 ${top.length} 张牌` });
        if (resp && (resp.top || resp.bottom)) {
          const topIds = resp.top || top.map((c) => c.id);
          const newTop = topIds.map((id) => top.find((c) => c.id === id)).filter(Boolean);
          const bottom = (resp.bottom || []).map((id) => top.find((c) => c.id === id)).filter(Boolean);
          engine.deck.splice(0, top.length);
          engine.deck.unshift(...newTop);
          engine.deck.push(...bottom);
          engine.log(`${player.name} 发动【发现】。`, 'good');
        }
      },
    },
  },

  // ===== 加拉克苏斯·魔能闪电（军团）=====
  monengshandian: {
    name: '魔能闪电', active: true, perTurn: true,
    desc: '出牌阶段指定两名角色，由你开始，你与两名角色依次弃一张点数大于前一张的牌；无法弃出更大点数者，需额外多弃一张牌（每回合一次）。',
    async action(engine, { player, move }) {
      const t1 = engine.playerById(move.firstId), t2 = engine.playerById(move.secondId);
      if (!t1 || !t2) return;
      player.flags.monengUsed = true;
      engine.log(`${player.name} 发动【魔能闪电】！`, 'play');
      let prev = 0;
      for (const p of [player, t1, t2]) {
        if (!p.alive || !p.hand.length) continue;
        const higher = p.hand.filter((c) => c.number > prev).sort((a, b) => a.number - b.number)[0];
        if (higher) { engine.discardCards(p, [higher]); prev = higher.number; }
        else {
          // 无法弃出更大点数：弃出手牌最大的一张并额外多弃一张，用弃出的较大牌延续链条
          const sorted = [...p.hand].sort((a, b) => b.number - a.number);
          const drop = sorted.slice(0, 2);
          engine.discardCards(p, drop);
          engine.log(`${p.name} 无法弃出更大点数，额外多弃一张。`, 'bad');
          prev = drop[0]?.number || prev;
        }
      }
      engine.changed();
    },
  },

  // ===== 塞瑞娜（中立）=====
  daidu: {
    name: '歹毒', active: true, perTurn: true,
    desc: '出牌阶段弃3张牌并与一名角色交换体力上限、装备与奥秘，然后双方回复所有体力；你以此增加的体力上限每点摸一张牌（每回合一次）。',
    async action(engine, { player, move }) {
      const cards = (move.cards || []).map((x) => findOnPlayer(player, x)).filter(Boolean);
      const t = engine.playerById(move.targetId);
      if (cards.length < 3 || !t || t === player) return;
      player.flags.daiduUsed = true;
      engine.discardCards(player, cards.slice(0, 3));
      const oldMax = player.maxHp;
      [player.maxHp, t.maxHp] = [t.maxHp, player.maxHp];
      [player.equips, t.equips] = [t.equips, player.equips];
      [player.secrets, t.secrets] = [t.secrets, player.secrets];
      engine.log(`${player.name} 发动【歹毒】，与 ${t.name} 交换体力上限/装备/奥秘并回满！`, 'play');
      player.hp = player.maxHp; t.hp = t.maxHp; engine.changed();
      const gain = player.maxHp - oldMax;
      if (gain > 0) engine.drawCards(player, gain);
    },
  },

  // ===== 奈法利安（中立）=====
  dihou: {
    name: '低吼', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色，直到你的下个回合开始前，其所有置入弃牌堆的牌（使用、打出、被弃等）都改为由你获得（每回合一次）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t || t === player) return;
      player.flags.dihouUsed = true;
      player.skillState.dihouTarget = t.id;
      engine.log(`${player.name} 对 ${t.name} 发动【低吼】，将获取其失去的牌。`, 'play');
    },
    triggers: {
      startPhase(engine, { player }) { player.skillState.dihouTarget = null; },
    },
  },

  // ===== 八爪巨怪（中立）=====
  yizhi: {
    name: '抑制', desc: '锁定技：你使用的【杀】未造成伤害后，其目标下个回合至多使用2张牌。',
    triggers: {
      async shaMissed(engine, { user, target }) {
        if (!target) return;
        target.nextUseCap = Math.min(target.nextUseCap ?? 99, 2);
        engine.log(`${user.name} 发动【抑制】：${target.name} 下个回合至多使用2张牌。`, 'play');
      },
    },
  },
  yawu: {
    name: '亡语', desc: '锁定技：你死亡时摸十二张牌，可将其中一部分交给一名其他角色，然后强制使用完剩下的手牌再离开。',
    triggers: {
      async death(engine, { player }) {
        const drawn = engine.drawCards(player, 12);
        if (!drawn.length) return;
        const isAI = engine.agentOf(player)?.kind === 'ai';
        const others = engine.alivePlayers.filter((p) => p !== player);
        // 1) 自己选择一部分交给一名其他角色（AI 自动给一半，保留【杀】强攻）
        if (others.length && player.hand.length) {
          if (isAI) {
            const lucky = others.filter((p) => engine.isAlly(player, p)).sort((a, b) => a.hp - b.hp)[0] || null;
            if (lucky) {
              const sorted = [...player.hand].sort((a, b) => (cardAs(a) === 'sha' ? 1 : 0) - (cardAs(b) === 'sha' ? 1 : 0));
              const give = sorted.slice(0, Math.ceil(player.hand.length / 2));
              give.forEach((c) => { removeFromHand(player.hand, c); lucky.hand.push(c); });
              if (give.length) { engine.log(`${player.name} 发动【亡语】，将 ${give.length} 张牌交给 ${lucky.name}。`, 'good'); engine.changed(); }
            }
          } else {
            const r = await engine.ask(player, {
              type: REQ.CHOOSE_OPTION, title: '亡语：将一部分手牌交给谁？（剩余的将被你强制使用）',
              options: [{ value: 'none', label: '不交给任何人（全部强制使用）' }, ...others.map((p) => ({ value: p.id, label: p.name }))],
            });
            const lucky = (r?.value && r.value !== 'none') ? engine.playerById(r.value) : null;
            if (lucky) {
              const pool = [...player.hand];
              const give = await selectCards(engine, player, pool, {
                minCount: 0,
                maxCount: pool.length,
                title: `亡语：选择交给 ${lucky.name} 的牌`,
                hint: '将任意张牌移入左侧后一次确认；未选择的牌会被你强制使用。',
                selectedLabel: `交给${lucky.name}`,
                availableLabel: '将强制使用',
                confirmLabel: '完成分配',
              });
              give.forEach((c) => { removeFromHand(player.hand, c); lucky.hand.push(c); });
              if (give.length) {
                engine.log(`${player.name} 发动【亡语】，将 ${give.length} 张牌交给 ${lucky.name}。`, 'good');
                engine.changed();
              }
            }
          }
        }
        // 2) 强制使用完剩下的手牌（已死亡也可结算，用不出效果的牌弃置）后再离开
        const remaining = [...player.hand];
        for (const c of remaining) {
          if (engine.over) break;
          if (!player.hand.includes(c)) continue;
          removeFromHand(player.hand, c);
          await useRealCard(engine, player, c, !isAI, true);
        }
      },
    },
  },

  // ===== 艾德温（中立）=====
  edwinqj: {
    name: '奇迹', desc: '锁定技：你每使用两张牌，便摸一张牌。',
    triggers: {
      async usedCard(engine, { player }) {
        player.skillState.miracleCount = (player.skillState.miracleCount || 0) + 1;
        if (player.skillState.miracleCount >= 2) {
          player.skillState.miracleCount -= 2;
          engine.log(`${player.name} 发动【奇迹】，摸一张牌。`, 'good');
          engine.drawCards(player, 1);
        }
      },
    },
  },
  jihua: {
    name: '激化', desc: '锁定技：一回合内你使用3张牌后，你的【杀】改为造成等量强制伤害；使用7张牌后，你的【杀】伤害+3。',
    triggers: {
      shaDamage: (engine, { user, base }) => ((user.flags.cardsUsed || 0) >= 7 ? base + 3 : base),
    },
  },

  // ===== 莫德雷斯（天灾）=====
  huoyan: {
    name: '火眼', active: true,
    desc: '锁定技：你使用和弃掉的【杀】都置于武将牌上，且你的【杀】可当【闪避】使用；出牌阶段你可弃掉武将牌上的5张【杀】，对一名角色造成10点强制伤害。',
    triggers: {
      async usedSha(engine, { player, card }) {
        const reals = card.virtual ? (card.sourceCards || []) : [card];
        const moved = reals.filter((c) => engine.discard.includes(c) && cardAs(c) === 'sha');
        if (!moved.length) return;
        moved.forEach((c) => { removeFrom(engine.discard, c); player.pile.push(c); });
        engine.log(`${player.name} 发动【火眼】，收集 ${moved.length} 张【杀】（武将牌共 ${player.pile.filter((c) => cardAs(c) === 'sha').length} 张）。`, 'good');
        engine.changed();
      },
    },
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      const shas = player.pile.filter((c) => cardAs(c) === 'sha').slice(0, 5);
      if (shas.length < 5) return;
      shas.forEach((c) => { removeFrom(player.pile, c); engine.discard.push(c); });
      engine.log(`${player.name} 发动【火眼】，对 ${t.name} 造成10点强制伤害！`, 'death');
      await engine.dealDamage({ source: player, target: t, amount: 10 });
    },
  },

  // ===== 玛洛加尔（天灾）=====
  haigu: {
    name: '骸骨重铸', desc: '锁定技：任意角色的回合结束时你回复所有体力；你的【桃】仅能在濒死时使用，且当你回复到1点体力时跳过当前回合。',
    triggers: {
      async anyEndPhase(engine, { owner }) {
        if (owner.hp < owner.maxHp) { engine.log(`${owner.name} 发动【骸骨重铸】，回复所有体力。`, 'good'); await engine.recover(owner, owner.maxHp - owner.hp); }
      },
    },
  },
  gujia: {
    name: '骨架', desc: '锁定技：你的武器栏和防具栏都可以装备两件，效果同时生效（攻击范围取较大者）。',
    // 双装备逻辑见 game.equip（填入 equips2）与 effects.js 的 weaponsOf/armorsOf
  },

  // ===== 泽瑞拉（联盟）=====
  // 神圣之触 / 虚空之刺：在你的回合开始前选择其一，本回合只有所选生效（zerilaActive 记录）
  shengchu: {
    name: '神圣之触', desc: '锁定技：你回合内使用可造成伤害的牌未造成伤害后，你回复1点体力。（回合开始时与【虚空之刺】二选一生效）',
    triggers: {
      async startPhase(engine, { player }) {
        // 仅在同时拥有两个锁定技时需要二选一
        const hasBoth = (player.skills || []).includes('xukongci');
        if (!hasBoth) { player.skillState.zerilaActive = 'shengchu'; return; }
        let pick = 'shengchu';
        const agent = engine.agentOf(player);
        if (agent?.kind === 'ai') pick = player.hp <= player.maxHp - 1 ? 'shengchu' : 'xukongci';
        else { const r = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: '本回合生效哪个锁定技？', options: [{ value: 'shengchu', label: '神圣之触（未命中回血）' }, { value: 'xukongci', label: '虚空之刺（回血即群伤）' }] }); pick = r?.value || 'shengchu'; }
        player.skillState.zerilaActive = pick;
        engine.log(`${player.name} 本回合启用【${pick === 'shengchu' ? '神圣之触' : '虚空之刺'}】。`, 'good');
      },
      async usedCard(engine, { player, card }) {
        if (engine.turnOwner !== player || player.skillState.zerilaActive !== 'shengchu') return;
        if (!isDamageCard(card)) return;                 // 仅“可造成伤害的牌”
        if (player.skillState._dmgThisCard) return;       // 这张牌已造成伤害 → 不回血
        engine.log(`${player.name} 发动【神圣之触】，回复1点体力。`, 'good');
        await engine.recover(player, 1);
      },
    },
  },
  xukongci: {
    name: '虚空之刺', desc: '锁定技：你的回合内，你每回复1点体力，便对所有其他角色各造成1点普通伤害。（回合开始时与【神圣之触】二选一生效）',
    triggers: {
      async recovered(engine, { player, amount }) {
        if (engine.turnOwner !== player || player.skillState.zerilaActive !== 'xukongci') return;
        engine.log(`${player.name} 发动【虚空之刺】！`, 'play');
        for (let i = 0; i < amount; i++) {
          for (const t of engine.alivePlayers.filter((p) => p !== player)) {
            if (!player.alive || engine.over) return;
            await engine.dealDamage({ source: player, target: t, amount: 1, dodgeable: true }); // 普通伤害：可闪
          }
        }
      },
    },
  },
  xintu: {
    name: '信徒', active: true, limited: true,
    desc: '限定技：（平时）你使用的黑色基本/锦囊牌都置于武将牌上；发动时将这些牌收回手牌（本回合可打出），然后你失去所有技能。',
    async action(engine, { player }) {
      player.skillState.xintuUsed = true;
      const banked = (player.pile || []).filter((c) => isBlack(c.suit));
      banked.forEach((c) => removeFrom(player.pile, c));
      player.hand.push(...banked);
      engine.log(`${player.name} 发动限定技【信徒】，收回 ${banked.length} 张黑色牌，并失去所有技能！`, 'play');
      player.skills = []; player.lordSkills = [];
      engine.changed();
    },
    triggers: {
      // 平时：使用的黑色基本/锦囊牌置于武将牌上（而非进入弃牌堆）
      usedCard(engine, { player, card }) {
        const ty = CARD_DEFS[card.kind]?.type;
        if ((ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK) && isBlack(card.suit)) {
          const reals = card.virtual ? (card.sourceCards || []) : [card];
          let moved = 0;
          reals.forEach((c) => { if (removeFrom(engine.discard, c)) { player.pile.push(c); moved++; } });
          if (moved) { engine.log(`${player.name}【信徒】将黑色牌置于武将牌（共 ${player.pile.length}）。`); engine.changed(); }
        }
      },
    },
  },

  // ===== 瓦格斯（联盟）=====
  kanba: {
    name: '看吧！', desc: '锁定技：你的回合结束时，你可以重新使用本回合最后使用的一张基本/锦囊牌，并摸一张牌。',
    triggers: {
      async usedCard(engine, { player, card }) {
        if (player.skillState.kanbaReplaying) return;
        const ty = CARD_DEFS[card.kind]?.type;
        if (ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK) player.skillState.kanbaLast = cardInfo(card);
      },
      async endPhase(engine, { player }) {
        const last = player.skillState.kanbaLast; player.skillState.kanbaLast = null;
        engine.drawCards(player, 1);
        if (!last) return;
        let go = true;
        if (engine.agentOf(player)?.kind !== 'ai') {
          const resp = await engine.ask(player, { type: REQ.CHOOSE_OPTION, title: `看吧！：是否重新使用【${CARD_DEFS[last.kind]?.name || ''}】？`, options: [{ value: true, label: '重新使用' }, { value: false, label: '放弃' }] });
          go = resp?.value !== false;
        }
        if (go) {
          engine.log(`${player.name} 发动【看吧！】重演最后一张牌。`, 'good');
          player.skillState.kanbaReplaying = true;
          try { await autoReplay(engine, player, last); } finally { player.skillState.kanbaReplaying = false; }
        }
      },
    },
  },

  // ===== 卡德加（联盟）=====
  shuangsheng: {
    name: '双生魔法', desc: '锁定技：你每回合使用的基本/锦囊牌都置于武将牌上，将在你的下个回合开始时各再使用一次。',
    triggers: {
      async usedCard(engine, { player, card }) {
        const ty = CARD_DEFS[card.kind]?.type;
        if ((ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK) && !player.skillState.twinReplaying) {
          (player.skillState.twinList = player.skillState.twinList || []).push(cardInfo(card));
        }
      },
      async startPhase(engine, { player }) {
        const pending = player.skillState.twinPending || []; player.skillState.twinPending = null;
        player.skillState.twinList = [];
        if (pending.length) {
          player.skillState.twinReplaying = true;
          engine.log(`${player.name} 发动【双生魔法】，再次使用上回合的 ${pending.length} 张牌。`, 'good');
          try { for (const info of pending) { if (!player.alive || engine.over) break; await autoReplay(engine, player, info); } }
          finally { player.skillState.twinReplaying = false; }
        }
      },
      async endPhase(engine, { player }) {
        player.skillState.twinPending = (player.skillState.twinList || []).slice(0, 8); // 防过长
        player.skillState.twinList = [];
      },
    },
  },

  // ===== 奥蕾莉亚（联盟）=====
  lijian2: {
    name: '利箭', active: true, perTurn: true,
    desc: '出牌阶段指定一名角色，其弃置一张牌（称“标”，点数记为 m）；你弃置点数之和为 m 的倍数的若干张牌（共 n 张），该角色抉择：①受到 n 点强制伤害；②你摸 n+3 张牌（可被【箭语】重置）。',
    async action(engine, { player, move }) {
      const t = engine.playerById(move.targetId); if (!t) return;
      player.flags.lijian2Used = true;
      const tpool = [...t.hand, ...Object.values(t.equips).filter(Boolean)];
      if (!tpool.length) { engine.log(`${t.name} 没有牌，【利箭】无效。`, 'system'); return; }
      // 标：目标弃1张（自选），取其点数 m
      let mark = null;
      if (engine.agentOf(t)?.kind !== 'ai') {
        const r = await engine.ask(t, { type: REQ.DISCARD_CARDS, count: 1, from: 'all', title: `利箭：弃置一张牌作为“标”` });
        mark = (r?.cards || []).map((x) => findOnPlayer(t, x)).filter(Boolean)[0] || null;
      }
      if (!mark) mark = rand(tpool);
      engine.discardCards(t, [mark]);
      const m = mark.number || 1;
      engine.log(`${player.name}【利箭】：${t.name} 弃置“标”【${mark.name}】（点数 ${m}）。`, 'play');
      // 你弃若干张，点数之和需为 m 的倍数
      const chosen = [];
      const sumOf = () => chosen.reduce((s, c) => s + (c.number || 0), 0);
      const isAI = engine.agentOf(player)?.kind === 'ai';
      if (isAI) {
        const pool = player.hand.filter((c) => !c.frozen).sort((a, b) => (a.number || 0) - (b.number || 0));
        for (const c of pool) { chosen.push(c); if (sumOf() % m === 0) break; }
        if (sumOf() % m !== 0) chosen.length = 0; // 凑不成倍数则放弃
      } else {
        const pool = player.hand.filter((c) => !c.frozen);
        const r = await engine.ask(player, {
          type: REQ.GUANXING,
          mode: 'select_cards',
          cards: pool,
          minCount: 1,
          maxCount: pool.length,
          multipleOf: m,
          title: `利箭：选择点数和为 ${m} 的倍数的手牌`,
          selectedLabel: '将弃置的牌',
          availableLabel: '可选手牌',
          confirmLabel: '发动【利箭】',
          cancelLabel: '放弃【利箭】',
        });
        const ids = Array.isArray(r?.selected) ? [...new Set(r.selected)] : [];
        chosen.push(...ids.map((id) => pool.find((c) => c.id === id)).filter(Boolean));
        if (!chosen.length || sumOf() % m !== 0) { engine.log(`${player.name} 未凑成“标”的倍数，【利箭】无效。`, 'system'); return; }
      }
      const n = chosen.length;
      if (!n) { engine.log(`${player.name} 未弃牌，【利箭】无效。`, 'system'); return; }
      const total = sumOf();
      engine.discardCards(player, chosen);
      engine.log(`${player.name} 对 ${t.name} 发动【利箭】（n=${n}，点数和 ${total}）。`, 'play');
      let choice;
      const ta = engine.agentOf(t);
      if (ta?.kind === 'ai') choice = (t.hp <= n) ? 'draw' : 'dmg';
      else { const r = await engine.ask(t, { type: REQ.CHOOSE_OPTION, title: `利箭：①受${n}点强制伤害 ②${player.name}摸${n + 3}张牌`, options: [{ value: 'dmg', label: `受${n}点伤害` }, { value: 'draw', label: `${player.name}摸${n + 3}张` }] }); choice = r?.value || 'dmg'; }
      if (choice === 'dmg') await engine.dealDamage({ source: player, target: t, amount: n });
      else engine.drawCards(player, n + 3);
    },
  },
  jianyu: {
    name: '箭语', desc: '锁定技，你的回合内限一次：当你造成伤害后，抉择：①复原【利箭】；②回复1点体力并摸一张牌。',
    triggers: {
      async dealDamage(engine, { source }) {
        if (!source || engine.turnOwner !== source || source.skillState.jianyuRound === engine.round) return;
        source.skillState.jianyuRound = engine.round;
        let choice;
        if (engine.agentOf(source)?.kind === 'ai') {
          const canReuse = engine.turnOwner === source && source.flags.lijian2Used && source.hand.some((c) => !c.frozen);
          choice = canReuse && source.hp >= source.maxHp ? 'reset' : 'recover';
        } else {
          const r = await engine.ask(source, {
            type: REQ.CHOOSE_OPTION,
            title: '箭语：选择一项',
            options: [
              { value: 'reset', label: '复原【利箭】' },
              { value: 'recover', label: '回复1点体力并摸一张牌' },
            ],
          });
          choice = r?.value || 'recover';
        }
        if (choice === 'reset') {
          source.flags.lijian2Used = false;
          engine.log(`${source.name} 发动【箭语】，复原【利箭】。`, 'good');
          engine.changed();
        } else {
          engine.log(`${source.name} 发动【箭语】，回复1点体力并摸一张牌。`, 'good');
          await engine.recover(source, 1);
          if (source.alive && !engine.over) engine.drawCards(source, 1);
        }
      },
    },
  },

  // ===== 尤格萨隆（古神）=====
  mingyun: {
    name: '命运之轮', active: true, perTurn: true,
    desc: '出牌阶段：由你开始，每名角色摸一张牌并立即释放（自行选择目标）；觉醒后改为你自己摸“场上人数”张并立即释放。此过程中你免疫所有伤害（每回合一次）。',
    async action(engine, { player }) {
      player.flags.mingyunUsed = true;
      // 释放助手：抽到的牌移出手牌后由其拥有者立即释放（人类自选目标，AI 启发式）
      const release = async (p, n) => {
        const got = engine.drawCards(p, n);
        for (const c of got) {
          if (engine.over || !p.alive) break;
          if (!p.hand.includes(c)) continue; // 可能被古尔丹之手等即时弃置
          removeFromHand(p.hand, c);
          await useRealCard(engine, p, c, true);
        }
      };
      player.flags.immuneAllTurn = true; // 此过程中免疫所有伤害
      try {
        if (player.skillState.yoggAwake) {
          const n = engine.alivePlayers.length;
          engine.log(`${player.name} 发动觉醒·【命运之轮】！自己摸 ${n} 张并逐张立即释放。`, 'play');
          await release(player, n);
        } else {
          engine.log(`${player.name} 发动【命运之轮】！由其开始，每人摸1张并立即释放。`, 'play');
          for (const p of engine._orderFrom(player)) { // 由你开始的座位顺序
            if (engine.over) break;
            if (!p.alive) continue;
            await release(p, 1);
          }
        }
      } finally {
        player.flags.immuneAllTurn = false; // 过程结束，免疫解除
      }
      engine.changed();
    },
  },
  huxin: {
    name: '护心', desc: '锁定技：你的回合外，每轮可凭空使用1次【闪避】与1次【法术反制】（觉醒后各2次）。',
    triggers: {
      startPhase(engine, { player }) { player.skillState.huxinDodge = 0; player.skillState.huxinWuxie = 0; },
    },
  },
  mingyunzhishou: {
    name: '命运之手', desc: '觉醒技：回合开始时若你体力≤3，你可以选择失去1点体力上限并强化【命运之轮】【护心】。',
    triggers: {
      async startPhase(engine, { player }) {
        if (player.skillState.yoggAwake || player.hp > 3) return;
        let go = true;
        if (engine.agentOf?.(player)?.kind !== 'ai') {
          const r = await engine.ask(player, {
            type: REQ.CHOOSE_OPTION, title: '命运之手：是否觉醒？（失去1点体力上限，强化【命运之轮】与【护心】）',
            options: [{ value: 'yes', label: '觉醒（-1 体力上限）' }, { value: 'no', label: '暂不觉醒' }],
          });
          go = r?.value === 'yes';
        }
        if (!go) return;
        player.skillState.yoggAwake = true;
        player.maxHp = Math.max(1, player.maxHp - 1); if (player.hp > player.maxHp) player.hp = player.maxHp;
        engine.log(`✨ ${player.name} 觉醒【命运之手】！`, 'win'); engine.changed();
      },
    },
  },

  // ===== 亚煞极（古神）=====
  fushi2: {
    name: '腐蚀', active: true, perTurn: true,
    desc: '出牌阶段弃一张牌称“腐”；本回合你使用点数≥“腐”的牌摸1张，使用点数<“腐”的牌使【杀】可用次数+1（每回合一次）。',
    async action(engine, { player, move }) {
      const card = findOnPlayer(player, move.cardId); if (!card) return;
      player.flags.fushi2Used = true;
      player.flags.fuValue = card.number;
      engine.discardCards(player, [card]);
      engine.log(`${player.name} 发动【腐蚀】，“腐”=${card.number}。`, 'play');
    },
    triggers: {
      async usedCard(engine, { player, card }) {
        if (player.flags.fuValue == null) return;
        if ((card.number || 0) >= player.flags.fuValue) { engine.drawCards(player, 1); }
        else { player.flags.extraSha = (player.flags.extraSha || 0) + 1; }
      },
    },
  },

  // ===== 克苏恩（古神）=====
  posui: { name: '破碎', desc: '锁定技：开局将12张【破碎】部件洗入牌堆，抽到/判定到立即触发使你受益。' }, // 逻辑见 game.js
  diyu: {
    name: '低语', active: true, perTurn: true,
    desc: '出牌阶段：所有其他角色弃置一张锦囊牌，否则受到1点伤害（觉醒【组合】后改为弃3张、否则受2点）（每回合一次）。',
    async action(engine, { player }) {
      player.flags.diyuUsed = true;
      const awake = player.skillState.zuheAwake;
      const need = awake ? 3 : 1; const dmg = awake ? 2 : 1;
      engine.log(`${player.name} 发动【低语】${awake ? '（组合）' : ''}！`, 'play');
      const order = engine.alivePlayers.filter((p) => p !== player);
      for (const t of order) {
        await resolveWhisper(engine, player, t, need, dmg, awake ? '低语（组合）' : '低语');
        if (engine.over) return;
      }
    },
  },
  zuhe: {
    name: '组合', desc: '觉醒技：当4张【破碎】被抽取后，【低语】强化为弃3张锦囊、否则受2点伤害，并立即追加使用一次【低语】。',
    triggers: {
      async anyEndPhase(engine, { owner }) {
        if (!owner.skillState.zuhePending) return; // 觉醒标记见 game.js（_resolveShards / doJudge）
        owner.skillState.zuhePending = false;
        engine.log(`${owner.name}【组合】追加一次强化【低语】！`, 'play');
        for (const t of engine.alivePlayers.filter((p) => p !== owner)) {
          await resolveWhisper(engine, owner, t, 3, 2, '低语（组合）');
          if (engine.over) return;
        }
      },
    },
  },

  // ===== 艾萨拉女王（古神）=====
  tandi: {
    name: '探底', desc: '锁定技：你的回合开始时，观看牌堆底3张牌：可将任意张按顺序置于牌堆顶，其余置入弃牌堆。',
    triggers: {
      async startPhase(engine, { player }) {
        engine._refillDeck();
        if (!engine.deck.length) return;
        const take = Math.min(3, engine.deck.length);
        const bottom = engine.deck.splice(-take, take);
        const isAI = engine.agentOf(player)?.kind === 'ai';
        let topIds = bottom.map((c) => c.id);
        let discardIds = [];
        if (!isAI) {
          const r = await engine.ask(player, {
            type: REQ.GUANXING,
            mode: 'bottom_discard',
            cards: bottom,
            title: `探底：分配牌库底 ${take} 张牌`,
          });
          if (r) {
            topIds = Array.isArray(r.top) ? r.top : topIds;
            discardIds = Array.isArray(r.discard) ? r.discard : bottom.filter((c) => !topIds.includes(c.id)).map((c) => c.id);
          }
        }
        const seen = new Set();
        const byIds = (ids) => ids.map((id) => bottom.find((c) => c.id === id)).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
        const toTop = byIds(topIds);
        const toDisc = byIds(discardIds);
        bottom.filter((c) => !seen.has(c.id)).forEach((c) => toDisc.push(c));
        if (toTop.length) engine.deck.unshift(...toTop);
        if (toDisc.length) engine.discard.push(...toDisc);
        engine.log(`${player.name} 发动【探底】：${toTop.length}张置顶${toDisc.length ? `，${toDisc.length}张入弃牌堆` : ''}。`, 'good');
        engine.changed();
      },
    },
  },
  yuangu: {
    name: '远古圣物', desc: '锁定技：你一回合内每使用3张锦囊牌，便获得一张未获得过的【沉落宝藏】。',
    triggers: {
      async usedCard(engine, { player, card }) {
        if (CARD_DEFS[card.kind]?.type !== CARD_TYPE.TRICK) return;
        player.skillState.relicCount = (player.skillState.relicCount || 0) + 1;
        if (player.skillState.relicCount % 3 !== 0) return;
        const owned = player.skillState.treasures || (player.skillState.treasures = []);
        const all = [
          { k: 'shangguhaojiao', suit: 'spade', number: 3 },
          { k: 'salatasi', suit: 'club', number: 2 },
          { k: 'chaoxizhishi', suit: 'diamond', number: 1 },
          { k: 'chaoxizhijie', suit: 'heart', number: 1 },
        ];
        const avail = all.filter((x) => !owned.includes(x.k));
        if (!avail.length) return;
        let t = avail[0];
        if (engine.agentOf(player)?.kind === 'ai') {
          // AI：手牌紧缺时优先潮汐之石，有可复刻牌时偏好潮汐之戒。
          t = avail.find((x) => x.k === 'chaoxizhishi' && player.hand.length <= 3)
            || avail.find((x) => x.k === 'chaoxizhijie' && player.lastSpell)
            || avail[0];
        } else {
          const r = await engine.ask(player, {
            type: REQ.CHOOSE_OPTION,
            title: '远古圣物：选择一张沉落宝藏',
            options: avail.map((x) => {
              const d = CARD_DEFS[x.k];
              return {
                value: x.k,
                label: d.name,
                card: { kind: x.k, name: d.name, type: d.type, suit: x.suit, number: x.number, red: isRed(x.suit) },
              };
            }),
          });
          t = avail.find((x) => x.k === r?.value) || avail[0];
        }
        owned.push(t.k);
        const d = CARD_DEFS[t.k];
        player.hand.push({ id: `treasure_${t.k}_${player.skillState.relicCount}`, kind: t.k, name: d.name, type: d.type, suit: t.suit, number: t.number, red: isRed(t.suit), slot: d.slot, range: d.range });
        engine.log(`${player.name} 发动【远古圣物】，获得【${d.name}】！`, 'good'); engine.changed();
      },
    },
  },

  // ===== 哈加沙（部落）=====
  guhuo: {
    name: '蛊惑', desc: '锁定技：你使用的【杀】改为作为实体牌置入目标的奥秘区（每人仅1张，旧的被顶替），在其回合结束时生效并多造成1点伤害；你使用【杀】无次数限制。',
    // 杀放入目标奥秘区的逻辑见 effects.resolveCard；下面在目标回合结束时结算
    triggers: {
      async anyEndPhase(engine, { owner, turnPlayer }) {
        if (!turnPlayer || !turnPlayer.secrets?.length) return;
        const g = turnPlayer.secrets.find((s) => s.guhuoBy === owner.id);
        if (!g) return;
        removeFrom(turnPlayer.secrets, g);
        const dmg = g.guhuoDmg || 2, nature = g.guhuoNature || 'normal';
        g.guhuoBy = null; g.guhuoDmg = null; g.guhuoNature = null;
        engine.discard.push(g); engine.changed();
        if (!owner.alive) return;
        engine.log(`${turnPlayer.name} 奥秘区的【蛊惑·杀】生效！`, 'play');
        await engine.dealDamage({ source: owner, target: turnPlayer, amount: dmg, nature });
      },
    },
  },
  xianji: {
    name: '献祭', desc: '锁定技：当你成为【杀】的目标、你使用【杀】、或你的【杀】造成伤害时，你各摸一张牌。',
    triggers: {
      async shaTargeted(engine, { target }) { engine.log(`${target.name} 发动【献祭】，摸一张牌。`, 'good'); engine.drawCards(target, 1); },
      async usedSha(engine, { player }) { engine.log(`${player.name} 发动【献祭】，摸一张牌。`, 'good'); engine.drawCards(player, 1); },
      async dealDamage(engine, { source, card }) { if (card && isSha(card)) { engine.log(`${source.name} 发动【献祭】（【杀】生效），摸一张牌。`, 'good'); engine.drawCards(source, 1); } },
    },
  },

  // ===== 晨拥（部落）=====
  binhuo: {
    name: '冰火', desc: '锁定技：你对有装备的角色造成的伤害+1；你的伤害性牌造成伤害后冻结其一张手牌；你的手牌无法被冻结。',
    triggers: {
      // 加伤改在 game.dealDamage 统一处理（对“任何伤害”生效，而不仅【杀】）
      async dealDamage(engine, { source, target, card }) {
        if (!card || !target?.alive || !target.hand.length) return; // 任何卡牌造成伤害后都冻结
        engine.log(`${source.name} 发动【冰火】，冻结 ${target.name} 一张手牌。`, 'play');
        engine.freezeHand(target, 1, source); // 传 freezer 以触发奥数
      },
    },
  },
  aoshu: {
    name: '奥数', desc: '锁定技：你冻结的每张牌解冻时，其拥有者抉择：①使你摸两张牌；②弃掉该牌并交给你一张牌。',
    // 解冻抉择逻辑见 game._thawPlayer（依据 card.frozenBy）
  },

  // ===== 恩佐斯（古神）=====
  chenluo: {
    name: '沉落', desc: '锁定技：你使用或弃掉的基本/锦囊牌都置于你的武将牌上，称为“沉”。',
    triggers: {
      async usedCard(engine, { player, card }) {
        const ty = CARD_DEFS[card.kind]?.type;
        if (ty !== CARD_TYPE.BASIC && ty !== CARD_TYPE.TRICK) return;
        const reals = card.virtual ? (card.sourceCards || []) : [card];
        let moved = 0;
        reals.forEach((c) => { if (removeFrom(engine.discard, c)) { player.pile.push(c); moved++; } });
        if (moved) { engine.log(`${player.name}【沉落】收集“沉”（共 ${player.pile.length}）。`); engine.changed(); }
      },
    },
  },
  shenyuan2: {
    name: '深渊', active: true,
    desc: '出牌阶段：弃4张花色各不相同的“沉”，摸2张、回复2点并对一名角色造成2点普通伤害；或弃2张同花色的“沉”，摸一张牌。',
    async action(engine, { player, move }) {
      const pile = player.pile;
      const bySuit = {}; pile.forEach((c) => { if (!bySuit[c.suit]) bySuit[c.suit] = c; });
      const diff = Object.values(bySuit);
      if (move.mode === 'big' && diff.length >= 4) {
        const use = diff.slice(0, 4); use.forEach((c) => removeFrom(pile, c)); engine.discard.push(...use);
        engine.log(`${player.name} 发动【深渊】（大）！`, 'play');
        engine.drawCards(player, 2); await engine.recover(player, 2);
        const t = engine.playerById(move.targetId);
        if (t && t.alive) await engine.dealDamage({ source: player, target: t, amount: 2, dodgeable: true }); // 普通伤害：可闪
      } else {
        const groups = {}; pile.forEach((c) => { (groups[c.suit] = groups[c.suit] || []).push(c); });
        const pair = Object.values(groups).find((g) => g.length >= 2);
        if (!pair) return;
        const use = pair.slice(0, 2); use.forEach((c) => removeFrom(pile, c)); engine.discard.push(...use);
        engine.log(`${player.name} 发动【深渊】（小），摸一张牌。`, 'good');
        engine.drawCards(player, 1);
      }
      engine.changed();
    },
  },
  suxing: {
    name: '苏醒', active: true, limited: true,
    desc: '限定技：减少1点体力上限并回复1点；直到你下个回合开始，【生命之树】等所有治疗都改为对相应角色造成等量强制伤害。',
    async action(engine, { player }) {
      player.skillState.suxingUsed = true;
      player.maxHp = Math.max(1, player.maxHp - 1); if (player.hp > player.maxHp) player.hp = player.maxHp;
      engine.changed();
      await engine.recover(player, 1); // 此时尚未开启转化，正常回1
      engine.healToHarm = true; engine.healToHarmBy = player;
      engine.log(`${player.name} 发动限定技【苏醒】！本轮所有治疗将转化为等量伤害。`, 'play');
    },
    triggers: {
      startPhase(engine) { engine.healToHarm = false; engine.healToHarmBy = null; }, // 恩佐斯回合开始解除
    },
  },
};
