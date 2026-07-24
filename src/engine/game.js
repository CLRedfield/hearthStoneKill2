// ====================== 游戏引擎（回合状态机） ======================
import {
  PHASE, PHASE_NAME, MODE, IDENTITY, IDENTITY_NAME, TEAM, FACTION_NAME, REQ, EQUIP_SLOT, CARD_TYPE, isBlack, isRed,
} from './constants.js';
import { buildDeck, CARD_DEFS, isSha, isShan, isTao, cardAs, virtualCard } from './cards.js';
import { GENERAL_LIST, getGeneral, generalPool } from './generals.js';
import {
  Emitter, shuffle, sleep, clamp, removeFrom, removeFromHand, clearCardFreeze, sample, uid,
} from '../util.js';
import { resolveCard, validTargets, canUseSha, weaponsOf, armorsOf, hasArmorKind, hasWeaponKind, getOneDodge } from './effects.js';
import { SKILLS, triggerSkill, hasSkill } from './skills.js';

export class GameEngine {
  constructor(config) {
    this.mode = config.mode;
    this.config = config;
    this.emitter = new Emitter();
    this.players = [];      // 按座位排序
    this.deck = [];
    this.discard = [];
    this.turnIndex = 0;     // 当前回合玩家在 players 中的下标
    this.extraTurnQueue = [];
    this._extraTurnResumeIndex = null;
    this.phase = null;
    this.round = 0;
    this.over = false;
    this.winners = null;
    this.logs = [];
    this.agents = config.agents || {}; // id -> Agent
    this.pace = config.pace ?? 650;    // 动画停顿(ms)
    this.turnOwner = null;             // 当前回合归属（暗影步用）
    this.turnRecallable = [];          // 当前回合该角色进入弃牌堆、可被暗影步收回的牌
  }

  // ---------- 事件 ----------
  on(ev, fn) { return this.emitter.on(ev, fn); }
  changed() { this.emitter.emit('change'); }
  log(text, kind = 'info') {
    const entry = { text, kind, t: this.logs.length };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emitter.emit('log', entry);
    this.emitter.emit('change');
  }
  async pause(ms = this.pace) { this.changed(); if (ms) await sleep(ms); }
  fx(name, data) { this.emitter.emit('fx', { name, ...data }); }

  agentOf(player) { return this.agents[player.id]; }
  async ask(player, req) {
    const agent = this.agentOf(player);
    if (!agent) return null;
    // 选项值为玩家 id 时，附带武将/体力信息（纯数据，联机可序列化；UI 据此渲染选人卡片）
    if (req.type === REQ.CHOOSE_OPTION && req.kind !== 'general' && Array.isArray(req.options)) {
      req = {
        ...req,
        options: req.options.map((o) => {
          if (!o || o.player || typeof o.value !== 'string') return o;
          const pl = this.playerById(o.value);
          return pl ? { ...o, player: { name: pl.name, general: pl.general?.name || '', hp: pl.hp, maxHp: pl.maxHp, faction: pl.faction } } : o;
        }),
      };
    }
    return await agent.respond({ ...req, player, engine: this });
  }

  // ---------- 玩家 / 座位 ----------
  get alivePlayers() { return this.players.filter((p) => p.alive); }
  get current() { return this.players[this.turnIndex]; }
  playerById(id) { return this.players.find((p) => p.id === id); }

  seatRingDistance(a, b) {
    const alive = this.players.filter((p) => p.alive || p === a || p === b);
    const ia = alive.indexOf(a), ib = alive.indexOf(b);
    const n = alive.length;
    const d = Math.abs(ia - ib);
    return Math.min(d, n - d);
  }

  // 计算 from 到 to 的距离（含马）
  distance(from, to) {
    if (from === to) return 0;
    let d = this.seatRingDistance(from, to);
    if (to.equips[EQUIP_SLOT.DEFENSE_HORSE]) d += 1;  // 目标 +1 马
    if (from.equips[EQUIP_SLOT.OFFENSE_HORSE]) d -= 1; // 自己 -1 马
    return Math.max(1, d);
  }

  attackRange(player) {
    // 骨架：取两件武器中较大的攻击范围
    const ranges = weaponsOf(player).map((w) => {
      const d = CARD_DEFS[w.kind] || {};
      // 埃辛诺斯刃：攻击范围X=本回合摸牌数（动态）
      if (d.dynamicRange === 'drawnThisTurn') return player.flags?.drawnThisTurn || 0;
      return d.range || 1;
    });
    return ranges.length ? Math.max(...ranges) : 1;
  }

  inAttackRange(from, to) {
    return this.distance(from, to) <= this.attackRange(from);
  }

  // ---------- 初始化 ----------
  async setup() {
    this.deck = buildDeck(this.config.pack || 'sgs');
    this._buildPlayers();
    await this._chooseGenerals();
    // 克苏恩·破碎：洗入12张破碎部件
    if (this.players.some((p) => hasSkill(p, 'posui'))) {
      const shardKinds = ['cthunheart', 'cthuneye', 'cthunbody', 'cthunmouth'];
      const shards = [];
      for (let i = 0; i < 12; i++) { const k = shardKinds[i % 4]; const d = CARD_DEFS[k]; shards.push({ id: uid('card'), kind: k, name: d.name, type: d.type, suit: 'spade', number: 1, red: false }); }
      this.deck.push(...shards);
      this.deck = shuffle(this.deck);
      this.log('💠 克苏恩的12张【破碎】部件已洗入牌堆。', 'system');
    }
    // 起始手牌
    for (const p of this.players) this.drawCards(p, 4, true);
    // 军争：主公先手；其余模式按座位 0 先手
    this.turnIndex = 0;
    if (this.mode === MODE.ZHANGZHENG) {
      this.turnIndex = this.players.findIndex((p) => p.identity === IDENTITY.LORD);
    }
    this.log('—— 游戏开始 ——', 'system');
    this.changed();
  }

  _buildPlayers() {
    const seats = this.config.seats; // [{id,name,isHuman,identity?,team?}]
    const n = seats.length;
    let setups = [];
    // 若座位已显式指定身份/阵营（如本地“指定身份”），直接采用
    if (seats.some((s) => s.identity || s.team)) {
      setups = seats.map((s) => ({ identity: s.identity, team: s.team }));
    } else if (this.mode === MODE.ZHANGZHENG) {
      setups = identityDistribution(n);
    } else if (this.mode === MODE.DUEL2V2) {
      setups = duel2v2Teams().map((team) => ({ team }));
    } else { // SOLO
      setups = [{ team: TEAM.A }, { team: TEAM.B }];
    }
    this.players = seats.map((s, i) => {
      const setup = setups[i] || {};
      return {
        id: s.id,
        seat: i,
        name: s.name,
        isHuman: !!s.isHuman,
        generalId: null,
        general: null,
        faction: null,
        maxHp: 4,
        hp: 4,
        hand: [],
        equips: { weapon: null, armor: null, plus: null, minus: null },
        equips2: { weapon: null, armor: null }, // 骨架（玛洛加尔）：第二件武器/防具
        judge: [],            // 判定区（延时锦囊）
        secrets: [],          // 奥秘区（炉石杀）
        shields: 0,           // 盾计数（每枚抵挡1点伤害）
        shieldCards: [],      // 作为“盾”的实体牌（吞噬：他人手牌置于此）
        pile: [],             // 武将牌上的牌（火眼/沉落/双生魔法/邪火 等）
        blades: 0,            // “刃”计数（卡扎克）
        identity: setup.identity || null,
        team: setup.team || null,
        gender: 'male',
        alive: true,
        skills: [],
        lordSkills: [],
        flags: {},            // 每回合临时标记
        skillState: {},       // 技能持久状态（每回合一次等）
      };
    });
  }

  async _chooseGenerals() {
    // 默认主公先选且每人三选一；本地自由选将时，真人先从完整武将池中挑选。
    const pool = shuffle(generalPool(this.config.pack || 'sgs'));
    let order = [...this.players];
    if (this.mode === MODE.ZHANGZHENG) {
      order.sort((a, b) => (a.identity === IDENTITY.LORD ? -1 : 0) - (b.identity === IDENTITY.LORD ? -1 : 0));
    }
    const fullPool = generalPool(this.config.pack || 'sgs');
    if (this.config.freeGeneralChoice) {
      order = [...order.filter((p) => p.isHuman), ...order.filter((p) => !p.isHuman)];
    }
    for (const p of order) {
      const freeChoice = !!this.config.freeGeneralChoice && p.isHuman;
      let candidates = [];
      if (freeChoice) {
        candidates = [...new Set(pool.length ? pool : fullPool)];
      } else {
        while (candidates.length < 3) {
          if (!pool.length) pool.push(...shuffle(fullPool)); // 武将不够时允许重复
          const id = pool.shift();
          if (!candidates.includes(id)) candidates.push(id);
          else if (fullPool.length <= 3) { candidates.push(id); } // 池子极小，允许同候选重复
        }
      }
      if (!candidates.length) candidates.push(fullPool[0]);
      const resp = await this.ask(p, {
        type: REQ.CHOOSE_OPTION,
        title: freeChoice ? '自由选择你的武将' : '选择你的武将',
        options: candidates.map((id) => ({ value: id, general: getGeneral(id) })),
        kind: 'general',
      });
      const chosen = candidates.includes(resp?.value) ? resp.value : candidates[0];
      if (freeChoice) {
        const chosenIndex = pool.indexOf(chosen);
        if (chosenIndex >= 0) pool.splice(chosenIndex, 1);
      } else {
        // 三选一候选已从池中取出，未选中的放回。
        candidates.filter((c) => c !== chosen).forEach((c) => pool.push(c));
      }
      this._assignGeneral(p, chosen);
    }
  }

  _assignGeneral(p, gid) {
    const g = getGeneral(gid);
    p.generalId = gid;
    p.general = g;
    p.faction = g.faction;
    p.maxHp = g.hp;
    // 军争主公 +1 体力上限
    if (this.mode === MODE.ZHANGZHENG && p.identity === IDENTITY.LORD && this.players.length >= 3) {
      p.maxHp += 1;
    }
    p.hp = p.maxHp;
    p.skills = [...(g.skills || [])];
    p.lordSkills = p.identity === IDENTITY.LORD ? [...(g.lordSkills || [])] : [];
    p.gender = g.gender || 'male';
    // 貂蝉为女性
    if (gid === 'diaochan') p.gender = 'female';
  }

  // ---------- 抽牌 / 弃牌 / 移动 ----------
  _refillDeck() {
    if (this.deck.length === 0 && this.discard.length) {
      this.deck = shuffle(this.discard.splice(0));
      this.log('牌堆已用尽，弃牌堆重洗。', 'system');
    }
  }

  drawCards(player, n, silent = false) {
    const got = [];
    for (let i = 0; i < n; i++) {
      this._refillDeck();
      if (!this.deck.length) break;
      const c = this.deck.shift();
      player.hand.push(c);
      got.push(c);
    }
    if (player.flags) player.flags.drawnThisTurn = (player.flags.drawnThisTurn || 0) + got.length; // 埃辛诺斯刃动态范围
    if (!silent && got.length) this.log(`${player.name} 摸了 ${got.length} 张牌。`);
    this.changed();
    if (got.some((c) => CARD_DEFS[c.kind]?.shard)) this._resolveShards(player, got);
    // 古尔丹之手（判定为梅花）：本回合加入手牌的牌都会被弃置
    if (player.flags?.guldanCurse && got.length) {
      const inHand = got.filter((c) => player.hand.includes(c));
      if (inHand.length) { this.log(`${player.name} 受【古尔丹之手】影响，新获得的 ${inHand.length} 张牌被弃置。`, 'bad'); this.discardCards(player, inHand); }
    }
    return got;
  }

  // 克苏恩·破碎：抽到/判定到破碎部件立即触发，使克苏恩受益
  _resolveShards(holder, cards) {
    const cthun = this.players.find((p) => hasSkill(p, 'posui') && p.alive);
    for (const c of cards) {
      const sh = CARD_DEFS[c.kind]?.shard;
      if (!sh) continue;
      removeFromHand(holder.hand, c); // 破碎部件触发后移出游戏（不进弃牌堆，避免重洗循环）
      this.log(`💠 ${holder.name} 触发【${c.name}】（破碎）。`, 'play');
      if (cthun) {
        if (sh === 'heart') { cthun.maxHp += 1; cthun.hp = Math.min(cthun.maxHp, cthun.hp + 1); }
        else if (sh === 'body') { cthun.hp = Math.min(cthun.maxHp, cthun.hp + 2); }
        else if (sh === 'mouth') { this.drawCards(cthun, 3); }
        else if (sh === 'eye') { for (let i = 0; i < 3; i++) cthun.hand.push({ id: uid('card'), kind: 'chongfeng', name: '冲锋', type: CARD_TYPE.BASIC, suit: 'spade', number: 1, red: false, noDist: true }); }
        cthun.skillState.shardCount = (cthun.skillState.shardCount || 0) + 1;
        // 组合（觉醒）：抽到4张破碎后升级低语
        if (cthun.skillState.shardCount >= 4 && hasSkill(cthun, 'zuhe') && !cthun.skillState.zuheAwake) {
          cthun.skillState.zuheAwake = true; cthun.skillState.zuhePending = true;
          this.log(`✨ ${cthun.name} 觉醒【组合】，【低语】强化，并将追加一次【低语】！`, 'win');
        }
      }
    }
    this.changed();
  }

  // 将一组牌弃入弃牌堆。fromPlayer（或当前结算者 _actingUser）若被【低吼】指定，则改由低吼者获得
  toDiscard(cards, fromPlayer = null) {
    const reals = [];
    cards.forEach((c) => {
      if (c.virtual && c.sourceCards) reals.push(...c.sourceCards);
      else reals.push(c);
    });
    const actor = fromPlayer || this._actingUser;
    const hunter = actor && this.players.find((p) => p.alive && p !== actor && p.skillState?.dihouTarget === actor.id);
    if (hunter && reals.length) {
      hunter.hand.push(...reals);
      this.log(`${hunter.name} 发动【低吼】，获得 ${actor.name} 置入弃牌堆的 ${reals.length} 张牌。`, 'good');
      this.changed();
      return;
    }
    this.discard.push(...reals);
    this.fx('discard', { cards: reals.map(fxCard) });
    this.changed();
  }

  // 弑君 / 瓦兰奈尔 离场特殊路由：返回 true 表示已特殊处理（调用方不要再 push 到弃牌堆）
  _routeLeavePlay(card, owner) {
    if (!card) return false;
    const d = CARD_DEFS[card.kind] || {};
    if (d.toDeckTop) { // 弑君：进入弃牌堆时改为置于牌堆顶
      this.deck.unshift(card);
      this.log(`【${card.name}】进入弃牌堆，改为置于牌堆顶。`, 'system');
      return true;
    }
    if (d.recycleFreeze) { // 瓦兰奈尔：进入弃牌堆时拥有者摸1，并标记其回合末收回
      this.discard.push(card);
      if (owner) card.valanyrOwner = owner.id;
      if (owner && owner.alive) { this.log(`${owner.name} 的【${card.name}】进入弃牌堆，摸一张牌。`, 'good'); this.drawCards(owner, 1); }
      return true;
    }
    return false;
  }

  // 从玩家手牌/装备/判定区移除指定实体牌
  removeCardFromAnywhere(card) {
    for (const p of this.players) {
      if (removeFromHand(p.hand, card)) return { player: p, zone: 'hand' };
      for (const slot of Object.keys(p.equips)) {
        if (p.equips[slot] === card) { p.equips[slot] = null; return { player: p, zone: 'equip', slot }; }
      }
      if (p.equips2) { // 骨架：第二装备栏
        for (const slot of Object.keys(p.equips2)) {
          if (p.equips2[slot] === card) { p.equips2[slot] = null; return { player: p, zone: 'equip2', slot }; }
        }
      }
      const ji = p.judge.indexOf(card);
      if (ji >= 0) { p.judge.splice(ji, 1); return { player: p, zone: 'judge' }; }
    }
    return null;
  }

  // 玩家失去（弃置）若干手牌/区域牌
  discardCards(player, cards) {
    if (!cards.length) return;
    this.fx('discard', { cards: cards.map(fxCard) });
    // 火眼（莫德雷斯）：弃掉的【杀】改为收入武将牌（“沉”式收集）
    if (hasSkill(player, 'huoyan')) {
      const shas = cards.filter((c) => isSha(c));
      if (shas.length) {
        shas.forEach((c) => this.removeCardFromAnywhere(c));
        player.pile.push(...shas);
        this.log(`${player.name} 发动【火眼】，收集 ${shas.length} 张弃置的【杀】（共 ${player.pile.filter((c) => isSha(c)).length} 张）。`, 'good');
        cards = cards.filter((c) => !shas.includes(c));
        if (!cards.length) { this.changed(); return; }
      }
    }
    // 低吼（奈法利安）：该角色失去并将进入弃牌堆的牌改为由低吼者获得
    const hunter = this.players.find((p) => p.alive && p !== player && p.skillState?.dihouTarget === player.id);
    cards.forEach((c) => this.removeCardFromAnywhere(c));
    if (hunter) {
      hunter.hand.push(...cards);
      this.log(`${hunter.name} 发动【低吼】，获得 ${player.name} 失去的 ${cards.length} 张牌。`, 'good');
    } else {
      const toPile = [];
      for (const c of cards) { if (!this._routeLeavePlay(c, player)) toPile.push(c); }
      this.discard.push(...toPile);
      this._collectSink(toPile, player, true); // 恩佐斯·沉落：弃掉的基本/锦囊牌收为“沉”
      // 暗影步：记录回合归属者本回合主动失去/弃置的牌
      if (player === this.turnOwner) this.turnRecallable.push(...toPile);
      this.log(`${player.name} 失去 ${cards.length} 张牌。`);
    }
    this.changed();
  }

  // 一名角色获得另一名角色的牌
  gainCard(gainer, card, fromInfo = '') {
    const loc = this.removeCardFromAnywhere(card);
    gainer.hand.push(card);
    this.changed();
    // 古尔丹之手（判定为梅花）：本回合加入手牌的牌都会被弃置
    if (gainer.flags?.guldanCurse) {
      this.log(`${gainer.name} 受【古尔丹之手】影响，新获得的牌被弃置。`, 'bad');
      this.discardCards(gainer, [card]);
    }
  }

  // 装备牌
  equip(player, card) {
    const slot = card.slot;
    // 初始化护甲耐久（塔盾吸收池 / 埃辛诺斯盾免疫次数 / 防护长袍受伤累计）
    const d = CARD_DEFS[card.kind] || {};
    if (d.absorb) card.absorbLeft = d.absorb;
    if (d.immuneInstances) card.immuneCharges = d.immuneInstances;
    if (d.breakAfterDamage) card.damageTaken = 0;
    if (d.immuneNonDiamondSha) player.iceHeartImmune = true; // 凝冰护盾：装备即获得对红桃【杀】的免疫（持续到你下回合开始）
    // 骨架（玛洛加尔）：武器/防具可装2件，先填主栏再填副栏，满则替换主栏
    const dual = hasSkill(player, 'gujia') && (slot === EQUIP_SLOT.WEAPON || slot === EQUIP_SLOT.ARMOR);
    if (dual && player.equips[slot] && !player.equips2[slot]) {
      player.equips2[slot] = card;
      this.log(`${player.name} 发动【骨架】，额外装备了【${card.name}】。`, 'good');
      this.changed();
      return;
    }
    const old = player.equips[slot];
    if (old && !this._routeLeavePlay(old, player)) this.discard.push(old);
    player.equips[slot] = card;
    this.log(`${player.name} 装备了【${card.name}】。`);
    this.changed();
  }

  // ---------- 主流程 ----------
  async run() {
    await this.setup();
    await this.pause(400);
    while (!this.over) {
      const p = this.current;
      if (p.alive) {
        await this.runTurn(p);
      }
      await this._fireChaoxi(p); // 抄袭：回合结束后收缴其本回合使用过的牌
      this._reviveFeigned();     // 诈死：当前回合结束后复活
      if (this.over) break;
      this._advanceTurn();
    }
    this.emitter.emit('gameover', this.winners);
  }

  grantExtraTurn(player) {
    if (!player?.alive) return false;
    this.extraTurnQueue.push(player.id);
    this.log(`${player.name} 获得了一个额外回合。`, 'good');
    return true;
  }

  _advanceTurn() {
    const n = this.players.length;
    if (!n) return;
    let extra = null;
    while (this.extraTurnQueue.length && !extra) {
      const candidate = this.playerById(this.extraTurnQueue.shift());
      if (candidate?.alive) extra = candidate;
    }
    if (extra) {
      // 第一个额外回合开始前保存正常座次；连续额外回合共用同一个恢复点
      if (this._extraTurnResumeIndex == null) {
        for (let k = 1; k <= n; k++) {
          const i = (this.turnIndex + k) % n;
          if (this.players[i].alive) {
            this._extraTurnResumeIndex = i;
            break;
          }
        }
      }
      this.turnIndex = this.players.indexOf(extra);
      return;
    }
    // 所有额外回合结束后，回到原本应行动的角色；若其已死亡则顺延
    if (this._extraTurnResumeIndex != null) {
      const resume = this._extraTurnResumeIndex;
      this._extraTurnResumeIndex = null;
      for (let k = 0; k < n; k++) {
        const i = (resume + k) % n;
        if (this.players[i].alive) {
          this.turnIndex = i;
          return;
        }
      }
      return;
    }
    let i = this.turnIndex;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (this.players[i].alive) { this.turnIndex = i; return; }
    }
  }

  async runTurn(player) {
    player.flags = { shaUsed: 0, jiuUsed: false, rendeGiven: 0, drawnThisTurn: 0 };
    // 出牌次数上限（八爪巨怪·抑制 等设置的下回合限制）
    if (player.nextUseCap != null) { player.flags.useCap = player.nextUseCap; player.nextUseCap = null; }
    this.turnOwner = player;       // 暗影步：记录本回合进入弃牌堆的牌
    this.turnRecallable = [];
    this.skipToEnd = false;        // 清算（奥秘）：置为 true 后本回合直接进入结束阶段
    this.turnUsedCards = [];       // 抄袭（奥秘）：记录回合拥有者本回合使用过的实体牌
    this.xueseArmed = false;       // 血色（酒）：仅本回合内有效
    // 每回合一次的技能状态清空
    player.skillState.zhihengUsed = false;
    player.skillState.qingnangUsed = false;
    player.skillState.fanjianUsed = false;
    player.skillState.lijianUsed = false;
    player.skillState.rendeHealed = false;
    player.skillState.chongshengUsed = false; // 重生：每轮一次
    // 清除所有角色的临时战斗标记（免疫/不可被杀指定，作用域为“本回合”）
    this.players.forEach((p) => { if (p.flags) { delete p.flags.immuneNext; delete p.flags.noShaTarget; } });
    this.round++;
    this.log(`【回合】轮到 ${player.name}（${player.general?.name}）。`, 'turn');
    await this.pause(500);

    await this._phaseStart(player);
    if (this.over) return;
    if (!player.alive) return;
    await this._phaseJudge(player);
    if (this.over || !player.alive) return;
    if (!player.flags.skipDraw && !this.skipToEnd) {
      await this._phaseDraw(player);
      if (this.over || !player.alive) return;
    }
    if (!player.flags.skipPlay && !this.skipToEnd) {
      await this._phasePlay(player);
      if (this.over || !player.alive) return;
    }
    // 回合末统一先解冻全部手牌，再进入弃牌阶段。
    await this._thawPlayer(player);
    if (!player.flags.skipDiscard && !this.skipToEnd) await this._phaseDiscard(player);
    if (this.over || !player.alive) return;
    await this._phaseEnd(player);
    player.iceBlockImmune = false; // 寒冰屏障：免疫持续到自己的回合结束
  }

  _setPhase(ph) { this.phase = ph; this.changed(); }

  // 冻结一名角色的 n 张手牌（随机未冻结的）；freezer 用于【奥数】解冻抉择
  freezeHand(target, n = 1, freezer = null) {
    if (hasSkill(target, 'binhuo')) { this.log(`${target.name} 的手牌无法被冻结（冰火）。`, 'good'); return; } // 晨拥
    const pool = target.hand.filter((c) => !c.frozen);
    let frozen = 0;
    for (let i = 0; i < n && pool.length; i++) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      c.frozen = true; frozen++;
      if (freezer && hasSkill(freezer, 'aoshu')) c.frozenBy = freezer.id; // 奥数：记录冻结者
    }
    if (frozen) { this.log(`${target.name} 被冻结 ${frozen} 张手牌。`, 'bad'); this.changed(); }
  }

  // 解冻一名角色的全部冻结手牌（含奥数抉择），仅在其回合末弃牌前调用。
  async _thawPlayer(player) {
    // 奥数（晨拥）：被其冻结的牌解冻时，拥有者抉择 ①晨拥摸2 ②弃该牌给晨拥1张
    for (const c of player.hand.filter((x) => x.frozen && x.frozenBy)) {
      const freezer = this.playerById(c.frozenBy); c.frozenBy = null;
      if (!freezer || !freezer.alive || freezer === player) continue;
      const agent = this.agentOf(player);
      let pick = 'draw2';
      if (agent?.kind === 'ai') pick = player.hand.length <= 2 ? 'draw2' : 'give';
      else { const r = await this.ask(player, { type: REQ.CHOOSE_OPTION, title: `奥数（${freezer.name}的冻结牌解冻）：①使其摸2张 ②弃此牌并给其1张`, options: [{ value: 'draw2', label: `${freezer.name} 摸2张` }, { value: 'give', label: '弃此牌并给其1张' }] }); pick = r?.value || 'draw2'; }
      if (pick === 'draw2') { this.drawCards(freezer, 2); this.log(`${freezer.name} 发动【奥数】摸两张牌。`, 'good'); }
      else { removeFromHand(player.hand, c); freezer.hand.push(c); this.log(`${player.name} 弃置该牌交给 ${freezer.name}（奥数）。`); this.changed(); }
    }
    let thawed = 0;
    player.hand.forEach((c) => { if (c.frozen) { clearCardFreeze(c); thawed++; } });
    if (thawed) this.changed();
  }

  // 恩佐斯·沉落：其主动弃掉的基本/锦囊牌收为“沉”（移出弃牌堆，置于武将牌 pile）
  _collectSink(cards, fromPlayer, allowChenluo) {
    let any = false;
    for (const c of [...cards]) {
      if (!this.discard.includes(c)) continue;
      if (!allowChenluo || !fromPlayer || !hasSkill(fromPlayer, 'chenluo')) continue;
      const ty = CARD_DEFS[c.kind]?.type;
      if (ty !== CARD_TYPE.BASIC && ty !== CARD_TYPE.TRICK) continue;
      removeFrom(this.discard, c); fromPlayer.pile.push(c); any = true;
    }
    if (any) this.changed();
  }

  async _phaseStart(player) {
    this._setPhase(PHASE.START);
    player.cloudReady = false; // 淡云圆盾免疫到自己回合开始结束
    player.offTurnDamage = 0;      // 复活之甲：回合外受伤计数（你的回合开始重置）
    player.bombDodgeUsed = false;  // 防爆护盾：回合外免费闪避（你的回合开始重置）
    player.iceHeartImmune = false; // 凝冰护盾：你的下回合开始时失去对红桃【杀】的免疫
    // 艾露尼斯：准备阶段额外摸牌
    const w = player.equips[EQUIP_SLOT.WEAPON];
    if (w && CARD_DEFS[w.kind]?.startDraw) this.drawCards(player, CARD_DEFS[w.kind].startDraw);
    // 非公平游戏（奥秘）：一轮中没有受到伤害 → 抽4张；受过伤则重开观察窗口
    for (const s of [...(player.secrets || [])]) {
      if (s.kind !== 'feigongping') continue;
      if (s.dmgDirty) { s.dmgDirty = false; continue; }
      removeFrom(player.secrets, s); this.discard.push(s);
      this.fx('secret', { playerId: player.id, label: '非公平游戏' });
      this.log(`${player.name} 触发奥秘【非公平游戏】，抽四张牌！`, 'good');
      this.drawCards(player, 4);
      this.changed();
    }
    await triggerSkill(this, 'startPhase', { player });
    await this.pause(250);
  }

  async _phaseJudge(player) {
    if (!player.judge.length) return;
    this._setPhase(PHASE.JUDGE);
    // 判定区从上到下结算（最后置入的先判定 -> 用栈顶）
    const zone = [...player.judge].reverse();
    for (const dcard of zone) {
      if (!player.judge.includes(dcard)) continue;
      removeFrom(player.judge, dcard);
      await this._resolveDelayed(player, dcard);
      if (this.over || !player.alive || this.skipToEnd) return;
    }
  }

  async _resolveDelayed(player, dcard) {
    this.log(`${player.name} 判定【${dcard.name}】...`);
    const jr = await this.doJudge(player, `${dcard.name}判定`);
    const beh = CARD_DEFS[dcard.kind]?.behaves || dcard.kind;
    if (dcard.kind === 'lebu') {
      this.discard.push(dcard);
      if (jr.suit !== 'heart') {
        player.flags.skipPlay = true;
        this.log(`${player.name} 判定非红桃，跳过出牌阶段。`, 'bad');
      } else {
        this.log(`${player.name} 判定为红桃，乐不思蜀失效。`, 'good');
      }
    } else if (dcard.kind === 'fushishu') {
      // 腐蚀术：非红桃跳过出牌阶段；红桃则至下回合前无法回复体力
      this.discard.push(dcard);
      if (jr.suit !== 'heart') {
        player.flags.skipPlay = true;
        this.log(`${player.name} 判定非红桃，跳过出牌阶段（腐蚀术）。`, 'bad');
      } else {
        player.flags.noHeal = true;
        this.log(`${player.name} 判定为红桃，本回合内无法回复体力（腐蚀术）。`, 'bad');
      }
    } else if (dcard.kind === 'guldanhand') {
      this.discard.push(dcard);
      if (jr.suit !== 'club') {
        player.flags.skipDraw = true;
        this.log(`${player.name} 判定非梅花，跳过摸牌阶段（古尔丹之手）。`, 'bad');
      } else {
        player.flags.guldanCurse = true;
        this.log(`${player.name} 判定为梅花，本回合加入手牌的牌都会被弃置（古尔丹之手）。`, 'bad');
      }
    } else if (dcard.kind === 'zhuanzhuyizhi') {
      // 专注意志：红3~13→到下回合开始只能用杀/闪；黑3~13→到下回合开始无法使用技能（flags 在其下回合开始被重置，天然到期）
      this.discard.push(dcard);
      if (isRed(jr.suit) && jr.number >= 3) {
        player.flags.onlyShaShan = true;
        this.log(`${player.name} 判定为红色 ${jr.number}：到下回合开始只能使用【杀】【闪】！`, 'bad');
      } else if (isBlack(jr.suit) && jr.number >= 3) {
        player.flags.noSkills = true;
        this.log(`${player.name} 判定为黑色 ${jr.number}：到下回合开始无法使用所有技能！`, 'bad');
      } else {
        this.log(`${player.name} 判定点数不足3，【专注意志】失效。`, 'good');
      }
    } else if (dcard.kind === 'pingzhuangshandian') {
      // 瓶装闪电：黑色则受3点强制伤害，红色则转移到下一名角色
      if (isBlack(jr.suit)) {
        this.discard.push(dcard);
        this.log(`${player.name} 被【瓶装闪电】击中，受到3点强制伤害！`, 'bad');
        await this.dealDamage({ source: null, target: player, amount: 3, nature: 'thunder' });
      } else {
        const next = this._nextAlive(player);
        next.judge.push(dcard);
        this.log(`【瓶装闪电】判定为红色，移动到 ${next.name} 的判定区。`);
      }
    } else if (beh === 'shandian') {
      const hit = jr.suit === 'spade' && jr.number >= 2 && jr.number <= 9;
      if (hit) {
        this.discard.push(dcard);
        this.log(`${player.name} 被【${dcard.name}】击中！`, 'bad');
        await this.dealDamage({ source: null, target: player, amount: 3, nature: 'thunder' });
      } else {
        // 移动到下家判定区
        const next = this._nextAlive(player);
        next.judge.push(dcard);
        this.log(`【${dcard.name}】移动到 ${next.name} 的判定区。`);
      }
    }
    await this.pause();
  }

  _nextAlive(player) {
    const n = this.players.length;
    let i = this.players.indexOf(player);
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (this.players[i].alive) return this.players[i];
    }
    return player;
  }

  // 判定：翻开牌堆顶。返回该判定牌。可被 鬼才/天妒 等改写。
  async doJudge(player, reason = '') {
    this._refillDeck();
    let card = this.deck.shift();
    this.changed();
    this.log(`判定牌为 ${card.name}（${suitText(card)}）。`);
    this.fx('judge', { playerId: player.id, card: { name: card.name, suit: card.suit, number: card.number, red: card.red } });
    await this.pause(700);
    // 改判类技能（鬼才）
    const newCard = await triggerSkill(this, 'judge', { player, card, reason });
    if (newCard && newCard !== card) {
      this.discard.push(card);
      card = newCard;
      this.log(`判定被改写为 ${card.name}（${suitText(card)}）。`, 'good');
      this.fx('judge', { playerId: player.id, card: { name: card.name, suit: card.suit, number: card.number, red: card.red } });
      await this.pause(700);
    }
    // 判定结束后处置：天妒等可获得判定牌；否则进弃牌堆
    const taken = await triggerSkill(this, 'afterJudge', { player, card, reason });
    if (!taken) this.discard.push(card);
    // 破碎部件被判定到也触发（移出游戏，避免重洗循环）
    if (CARD_DEFS[card.kind]?.shard) {
      removeFrom(this.discard, card);
      const cthun = this.players.find((p) => hasSkill(p, 'posui') && p.alive);
      this.log(`💠 判定到【${card.name}】（破碎）。`, 'play');
      if (cthun) {
        const sh = CARD_DEFS[card.kind].shard;
        if (sh === 'heart') { cthun.maxHp += 1; cthun.hp = Math.min(cthun.maxHp, cthun.hp + 1); }
        else if (sh === 'body') { cthun.hp = Math.min(cthun.maxHp, cthun.hp + 2); }
        else if (sh === 'mouth') { this.drawCards(cthun, 3); }
        else if (sh === 'eye') { for (let i = 0; i < 3; i++) cthun.hand.push({ id: uid('card'), kind: 'chongfeng', name: '冲锋', type: CARD_TYPE.BASIC, suit: 'spade', number: 1, red: false, noDist: true }); }
        cthun.skillState.shardCount = (cthun.skillState.shardCount || 0) + 1;
        if (cthun.skillState.shardCount >= 4 && hasSkill(cthun, 'zuhe') && !cthun.skillState.zuheAwake) { cthun.skillState.zuheAwake = true; cthun.skillState.zuhePending = true; this.log(`✨ ${cthun.name} 觉醒【组合】，追加一次【低语】！`, 'win'); }
      }
      this.changed();
    }
    return card;
  }

  async _phaseDraw(player) {
    this._setPhase(PHASE.DRAW);
    let n = 2;
    // 英姿 / 灌魔 等
    const extra = await triggerSkill(this, 'drawCount', { player, base: n });
    if (typeof extra === 'number') n = extra;
    // 过载：上一回合累计的过载减少本回合摸牌
    if (player.overload) {
      const ov = player.overload; player.overload = 0;
      n = Math.max(0, n - ov);
      this.log(`${player.name} 过载，少摸 ${ov} 张。`, 'bad');
    }
    // 血肉成灰：摸牌惩罚
    if (player.drawPenalty) {
      const dp = player.drawPenalty; player.drawPenalty = 0;
      n = Math.max(0, n - dp);
      this.log(`${player.name} 受【血肉成灰】影响，少摸 ${dp} 张。`, 'bad');
    }
    // 苔丝·发现等技能必须先根据最终摸牌数整理牌堆，再实际摸牌。
    await triggerSkill(this, 'beforeDraw', { player, count: n });
    this.drawCards(player, n);
    await this.pause();
  }

  async _phasePlay(player) {
    this._setPhase(PHASE.PLAY);
    let guard = 0;
    while (player.alive && !this.over && guard++ < 60) {
      if (this.skipToEnd) break; // 清算：立即进入结束阶段
      // 出牌次数上限（抑制等）：达到上限即结束出牌阶段
      if (player.flags.useCap != null && (player.flags.cardsUsed || 0) >= player.flags.useCap) {
        this.log(`${player.name} 本回合可用牌数已达上限。`, 'bad');
        break;
      }
      const move = await this.ask(player, { type: REQ.PLAY_TURN });
      if (!move || move.type === 'end') break;
      try {
        if (move.type === 'play') {
          await this._handlePlay(player, move);
        } else if (move.type === 'skill') {
          await this._handleActiveSkill(player, move);
        }
      } catch (e) {
        console.error('[play move]', e);
      }
      await this.pause(120);
    }
  }

  // 处理“使用一张牌（含技能转化）”
  async _handlePlay(player, move) {
    const card = move.card; // 可能是实体牌或虚拟牌
    if (!card) return;
    const targets = (move.targets || []).map((t) => (typeof t === 'string' ? this.playerById(t) : t)).filter(Boolean);
    const sources = card.virtual ? card.sourceCards : [card];
    const fromXintu = move.sourcePile === 'xintu';
    const fromTwin = move.sourcePile === 'twin';
    const fromPile = fromXintu || fromTwin;
    if (fromPile) {
      const ty = CARD_DEFS[card.kind]?.type;
      const common = this.turnOwner === player
        && this.phase === PHASE.PLAY
        && !card.virtual
        && sources.length === 1
        && player.pile.includes(card);
      const allowed = fromXintu
        ? common
          && player.flags?.xintuReplay
          && player.skillState?.xintuUsed
          && isBlack(card.suit)
          && (ty === CARD_TYPE.BASIC || ty === CARD_TYPE.TRICK)
        : common
          && card.twinStoredBy === player.id
          && card.twinReady === true;
      if (!allowed) {
        this.log(`${player.name} 当前不能从【${fromXintu ? '信徒' : '双生魔法'}】牌框中使用这张牌。`, 'system');
        return;
      }
      removeFrom(player.pile, card);
    } else {
      // 从手牌移除来源牌（虚拟牌移除其 sourceCards）
      sources.forEach((c) => removeFromHand(player.hand, c));
    }
    this.changed();
    // 毒雾（洛欧塞布）：使用任何牌前须弃一张点数更大的牌，否则无法使用
    const poisoned = this.players.some((p) => p.alive && p.skillState?.duwuTarget === player.id);
    if (poisoned) {
      const eligible = player.hand.filter((c) => c.number > (card.number || 0));
      if (!eligible.length) {
        // 取消使用时退回原区域；武将牌上的牌不能因此混入手牌。
        sources.forEach((c) => (fromPile ? player.pile : player.hand).push(c));
        this.log(`${player.name} 受【毒雾】影响，无更大点数的牌可弃，无法使用【${card.name}】。`, 'bad');
        this.changed();
        return;
      }
      const resp = await this.ask(player, {
        type: REQ.CHOOSE_OPTION,
        title: `毒雾：选择一张点数大于【${card.name}】的牌弃置`,
        options: eligible.map((c) => ({ value: c.id, label: `弃【${c.name}】`, card: c })),
      });
      const cost = eligible.find((c) => c.id === resp?.value)
        || eligible.sort((a, b) => a.number - b.number)[0];
      this.discardCards(player, [cost]);
      this.log(`${player.name} 因【毒雾】弃置【${cost.name}】方可使用【${card.name}】。`, 'play');
    }
    // 日蚀：本回合下一张牌视为使用两次（基本/锦囊，排除酒本身）
    const cdef = CARD_DEFS[card.kind] || {};
    const replayable = (cdef.type === CARD_TYPE.BASIC || cdef.type === CARD_TYPE.TRICK) && cardAs(card) !== 'jiu' && card.kind !== 'wuxie';
    const doRishi = player.flags.rishiPending && replayable;
    if (doRishi) player.flags.rishiPending = false;
    await resolveCard(this, { user: player, card, targets, options: move.options || {} });
    if (doRishi && player.alive && !this.over) {
      this.log(`${player.name}【日蚀】令【${card.name}】再使用一次！`, 'good');
      const v = virtualCard(card.kind, [], { suit: card.suit, number: card.number, red: card.red });
      await resolveCard(this, { user: player, card: v, targets, options: move.options || {} });
    }
  }

  async _handleActiveSkill(player, move) {
    await triggerSkill(this, 'active:' + move.skill, { player, move });
    // 毒镖陷阱（奥秘）：一名角色发动技能后，对其造成1点普通伤害2次
    const holder = this.players.find((p) => p.alive && p !== player && p.secrets?.some((s) => s.kind === 'dubiaoxianjing'));
    if (holder && player.alive && !this.over) {
      const s = holder.secrets.find((x) => x.kind === 'dubiaoxianjing');
      removeFrom(holder.secrets, s); this.discard.push(s);
      this.fx('secret', { playerId: holder.id, label: '毒镖陷阱' });
      this.log(`${holder.name} 触发奥秘【毒镖陷阱】，${player.name} 依次受到2次1点普通伤害！`, 'good');
      for (let i = 0; i < 2 && player.alive && !this.over; i++) {
        await this.dealDamage({ source: holder, target: player, amount: 1, dodgeable: true }); // 普通伤害：可闪
      }
    }
  }

  // 手牌上限基数：三国杀=体力；炉石杀=体力+1
  _handLimitBase(player) { return player.hp + (this.config.pack === 'hs' ? 1 : 0); }

  async _phaseDiscard(player) {
    this._setPhase(PHASE.DISCARD);
    player.flags.lastDiscardCount = 0; // 回收（克尔苏加德）：记录本回合结束弃牌数
    // 手牌上限 = 当前体力（炉石杀为体力+1；可被技能改写，如迟钝/灌魔）
    const baseLimit = this._handLimitBase(player);
    let limit = await triggerSkill(this, 'handLimit', { player, base: baseLimit });
    if (typeof limit !== 'number') limit = baseLimit;
    // 寒霜：本回合手牌上限惩罚（用后清除）
    if (player.frostHandLimit) { limit = Math.max(0, limit - player.frostHandLimit); player.frostHandLimit = 0; }
    const over = player.hand.length - Math.max(0, limit);
    if (over > 0) {
      const resp = await this.ask(player, {
        type: REQ.DISCARD_CARDS, count: over, from: 'hand',
        title: `弃牌阶段：弃置 ${over} 张手牌`,
      });
      let cards = (resp && resp.cards) || [];
      cards = cards.map((c) => (typeof c === 'string' ? player.hand.find((x) => x.id === c) : c)).filter(Boolean);
      if (cards.length < over) {
        // 兜底：自动弃多余
        const extra = sample(player.hand.filter((c) => !cards.includes(c)), over - cards.length);
        cards = [...cards, ...extra];
      }
      this.discardCards(player, cards);
      player.flags.lastDiscardCount = cards.length;
    }
    await this.pause(200);
  }

  async _phaseEnd(player) {
    this._setPhase(PHASE.END);
    // 瓦兰奈尔：若你回合结束时此牌仍在弃牌堆，则收回手牌并冻结
    const recycle = this.discard.filter((c) => c.valanyrOwner === player.id && CARD_DEFS[c.kind]?.recycleFreeze);
    for (const v of recycle) {
      removeFrom(this.discard, v);
      v.frozen = true; v.valanyrOwner = null;
      player.hand.push(v);
      this.log(`${player.name} 的【${v.name}】回到手牌（已冻结）。`, 'good');
    }
    if (recycle.length) this.changed();
    // 淡云圆盾：回合结束起获得一次免疫
    if (hasArmorKind(player, 'cloudshield')) player.cloudReady = true;
    delete player.flags.immuneAllTurn; // 命运之轮：免疫只持续到本回合结束
    await triggerSkill(this, 'endPhase', { player });
    await triggerSkill(this, 'anyEndPhase', { turnPlayer: player });
    await this.pause(200);
  }

  // ====================== 伤害 / 体力 / 濒死 / 死亡 ======================
  async changeHp(player, delta, reason = '') {
    player.hp = clamp(player.hp + delta, -99, player.maxHp);
    this.changed();
  }

  async recover(player, amount = 1, source = null) {
    // 恩佐斯·苏醒：本轮所有治疗改为对相应角色造成等量强制伤害
    if (this.healToHarm) {
      if (this._inHealToHarm) return; // 防止伤害链中触发的二次治疗无限递归
      this._inHealToHarm = true;
      try { this.log(`${player.name} 的治疗被【苏醒】转化为 ${amount} 点伤害！`, 'bad'); await this.dealDamage({ source: this.healToHarmBy || null, target: player, amount }); }
      finally { this._inHealToHarm = false; }
      return;
    }
    if (this.healDisabled) { this.log(`${player.name} 无法回复体力。`, 'bad'); return; }
    if (player.flags?.noHeal) { this.log(`${player.name} 无法回复体力（腐蚀术）。`, 'bad'); return; }
    if (player.hp >= player.maxHp) return;
    const before = player.hp;
    player.hp = clamp(player.hp + amount, -99, player.maxHp);
    const gained = player.hp - before;
    this.log(`${player.name} 回复 ${gained} 点体力。`, 'good');
    this.fx('heal', { targetId: player.id, amount: gained });
    // 骸骨重铸（玛洛加尔）：恢复到1点生命时跳过当前回合
    if (gained > 0 && player.hp === 1 && hasSkill(player, 'haigu')) {
      player.flags.skipPlay = true; player.flags.skipDiscard = true;
      this.log(`${player.name}【骸骨重铸】恢复至1点，跳过当前回合。`, 'bad');
    }
    await this.pause(300);
    if (gained > 0 && !this._inRecoverTrigger) {
      this._inRecoverTrigger = true; // 防止回血触发链中再次回血导致递归
      try { await triggerSkill(this, 'recovered', { player, amount: gained, source }); } finally { this._inRecoverTrigger = false; }
    }
  }

  // 造成伤害的核心流程
  async dealDamage({ source, target, amount = 1, nature = 'normal', card = null, dodgeable = false }) {
    if (!target.alive || amount <= 0) return;
    // 冰火（晨拥）：你对有装备的角色造成的伤害+1（对任意伤害生效）
    if (source && source !== target && hasSkill(source, 'binhuo') && Object.values(target.equips).some(Boolean)) amount += 1;
    // 炎躯（拉格纳罗斯）：免疫红色牌造成的伤害
    if (card && card.red && hasSkill(target, 'yanqu')) {
      this.log(`${target.name} 发动【炎躯】，免疫红色牌伤害。`, 'good');
      await this.pause(280);
      return;
    }
    // 命运之轮：本回合内尤格萨隆免疫所有伤害
    if (target.flags?.immuneAllTurn) {
      this.log(`${target.name}【命运之轮】免疫了这次伤害。`, 'good');
      await this.pause(200);
      return;
    }
    // 休眠（玛瑟里顿）：本轮已受过1次伤害后免疫
    if (target.sleepImmune) {
      this.log(`${target.name}【休眠】免疫了这次伤害。`, 'good');
      await this.pause(200);
      return;
    }
    // 寒冰屏障（奥秘）已触发：到其回合结束前免疫伤害
    if (target.iceBlockImmune) {
      this.log(`${target.name}【寒冰屏障】免疫了这次伤害。`, 'good');
      await this.pause(200);
      return;
    }
    // 暂避锋芒：免疫下一次伤害
    if (target.flags?.immuneNext) {
      delete target.flags.immuneNext;
      this.log(`${target.name} 免疫了这次伤害。`, 'good');
      await this.pause(280);
      return;
    }
    // 淡云圆盾：回合外一次免疫
    if (target.cloudReady && hasArmorKind(target, 'cloudshield')) {
      target.cloudReady = false;
      this.log(`${target.name} 的【淡云圆盾】免疫了这次伤害。`, 'good');
      await this.pause(280);
      return;
    }
    // 普通伤害：目标可打出【闪】抵消（强制伤害不设 dodgeable，直接命中；【杀】的闪已在杀流程处理，不重复）
    if (dodgeable && target.alive && amount > 0) {
      const dodge = await getOneDodge(this, target, { source, card });
      if (dodge) {
        this.log(`${target.name} 打出【闪】，抵消了这次普通伤害。`, 'good');
        await this.pause(300);
        return;
      }
    }
    // 防爆护盾：源于卡牌的伤害 → 改为视为该牌使用者对你使用1张【冲锋】（可被闪避，至多1点）
    if (card && !card._fromBomb && source && source !== target && hasArmorKind(target, 'bombshield')) {
      this.log(`${target.name} 的【防爆护盾】将这次卡牌伤害视为 ${source.name} 的【冲锋】。`, 'good');
      const dodge = await getOneDodge(this, target, { source, card: { kind: 'chongfeng', name: '冲锋', as: 'sha', suit: card.suit, number: card.number, red: card.red } });
      if (dodge) { this.log(`${target.name} 闪避了【冲锋】。`, 'good'); await this.pause(280); return; }
      amount = 1;
      card = { ...card, _fromBomb: true };
    }
    // 复活之甲：每次最多受1点；回合外一轮中最多受3点（骨架时两件防具都生效，取最严格）
    for (const a of armorsOf(target)) {
      const ad = CARD_DEFS[a.kind] || {};
      if (ad.capDamage) amount = Math.min(amount, ad.capDamage);
      if (ad.offTurnCap != null && this.turnOwner !== target) amount = Math.min(amount, Math.max(0, ad.offTurnCap - (target.offTurnDamage || 0)));
    }
    if (amount <= 0) { this.log(`${target.name} 免疫了这次伤害。`, 'good'); await this.pause(200); return; }
    const _removeArmor = (a) => { if (target.equips[EQUIP_SLOT.ARMOR] === a) target.equips[EQUIP_SLOT.ARMOR] = null; else if (target.equips2 && target.equips2.armor === a) target.equips2.armor = null; this.discard.push(a); this.log(`【${a.name}】损坏。`); };
    // 埃辛诺斯盾：免疫整次伤害，用尽后损坏
    const esino = armorsOf(target).find((a) => (CARD_DEFS[a.kind] || {}).immuneInstances && a.immuneCharges > 0);
    if (esino) {
      esino.immuneCharges -= 1;
      this.log(`${target.name} 的【${esino.name}】免疫此次伤害（剩余 ${esino.immuneCharges} 次）。`, 'good');
      if (esino.immuneCharges <= 0) _removeArmor(esino);
      await this.pause(300); return;
    }
    // 盾：逐点抵挡，破盾则拥有者摸1（实体盾牌进入弃牌堆）
    while (target.shields > 0 && amount > 0) {
      target.shields -= 1; amount -= 1;
      const sc = target.shieldCards && target.shieldCards.pop();
      if (sc) this.discard.push(sc);
      this.drawCards(target, 1);
      this.log(`${target.name} 的【盾】抵挡1点伤害（破盾摸1）。`, 'good');
    }
    // 塔盾：吸收池抵挡，耗尽后损坏
    const tadunA = armorsOf(target).find((a) => (CARD_DEFS[a.kind] || {}).absorb && a.absorbLeft > 0);
    if (tadunA && amount > 0) {
      const take = Math.min(tadunA.absorbLeft, amount);
      tadunA.absorbLeft -= take; amount -= take;
      this.log(`${target.name} 的【塔盾】抵挡 ${take} 点伤害（剩余 ${tadunA.absorbLeft}）。`, 'good');
      if (tadunA.absorbLeft <= 0) _removeArmor(tadunA);
    }
    if (amount <= 0) { this.changed(); await this.pause(280); return; }
    // 无可撼动盾：伤害减半（向下取整）
    if (armorsOf(target).some((a) => (CARD_DEFS[a.kind] || {}).halve)) {
      const reduced = Math.floor(amount / 2);
      if (reduced < amount) this.log(`${target.name} 的【无可撼动盾】将伤害减为 ${reduced}。`, 'good');
      amount = reduced;
      if (amount <= 0) { await this.pause(280); return; }
    }
    // 血色（酒）：本回合下一名受到伤害的角色所受伤害翻倍
    if (this.xueseArmed && amount > 0) {
      this.xueseArmed = false;
      amount *= 2;
      this.log(`【血色】生效：${target.name} 所受伤害翻倍为 ${amount} 点！`, 'bad');
    }
    // 清算（奥秘·任何角色可持有）：一名角色造成3点或以上伤害 → 伤害无效，当前回合立即进入结束阶段
    if (source && amount >= 3) {
      const holder = this.players.find((p) => p.alive && p !== source && p.secrets?.some((s) => s.kind === 'qingsuan'));
      if (holder) {
        const s = holder.secrets.find((x) => x.kind === 'qingsuan');
        removeFrom(holder.secrets, s); this.discard.push(s);
        this.fx('secret', { playerId: holder.id, label: '清算' });
        this.skipToEnd = true;
        this.log(`${holder.name} 触发奥秘【清算】，${source.name} 的 ${amount} 点伤害无效，本回合立即进入结束阶段！`, 'good');
        this.changed();
        await this.pause(360);
        return;
      }
    }
    // 防御矩阵（奥秘·任何角色可持有）：普通伤害 → 免疫此次伤害并令其恢复1点体力
    if (source && nature === 'normal') {
      const holder = this.players.find((p) => p.alive && p !== source && p.secrets?.some((s) => s.kind === 'fangyujuzhen'));
      if (holder) {
        const s = holder.secrets.find((x) => x.kind === 'fangyujuzhen');
        removeFrom(holder.secrets, s); this.discard.push(s);
        this.fx('secret', { playerId: holder.id, label: '防御矩阵' });
        this.log(`${holder.name} 触发奥秘【防御矩阵】，${target.name} 免疫此次伤害并恢复1点体力！`, 'good');
        this.changed();
        await this.recover(target, 1);
        await this.pause(360);
        return;
      }
    }
    // 寒冰屏障（奥秘）：致命伤害 → 免疫，并获得免疫直到你的回合结束
    if (amount >= target.hp) {
      const ib = target.secrets?.find((x) => x.kind === 'binkuai');
      if (ib) {
        removeFrom(target.secrets, ib); this.discard.push(ib);
        this.fx('secret', { playerId: target.id, label: '寒冰屏障' });
        target.iceBlockImmune = true;
        this.log(`${target.name} 触发奥秘【寒冰屏障】，免疫致命伤害，并在其回合结束前保持免疫！`, 'good');
        this.changed();
        await this.pause(360);
        return;
      }
    }
    this.log(
      `${source ? source.name + ' 对 ' : ''}${target.name} 造成 ${amount} 点${natureText(nature)}伤害。`,
      'damage'
    );
    target.hp -= amount;
    if (source) {
      // 神圣之触：记录本回合是否造成过伤害，并标记当前结算的伤害牌已命中
      if (this.turnOwner === source && source.skillState) {
        source.skillState.shengchuDealtDamage = true;
      }
      const frames = this._cardDamageStack || [];
      for (let i = frames.length - 1; i >= 0; i--) {
        if (frames[i].user === source) {
          frames[i].dealtDamage = true;
          break;
        }
      }
    }
    // 防护长袍：按最终实际受到的伤害累计，达到上限后自动进入弃牌堆
    for (const armor of armorsOf(target).filter((a) => (CARD_DEFS[a.kind] || {}).breakAfterDamage)) {
      const limit = CARD_DEFS[armor.kind].breakAfterDamage;
      armor.damageTaken = (armor.damageTaken || 0) + amount;
      this.log(`${target.name} 的【${armor.name}】累计受到伤害 ${armor.damageTaken}/${limit}。`);
      if (armor.damageTaken >= limit) {
        _removeArmor(armor);
      }
    }
    // 非公平游戏（奥秘）：本轮受过伤 → 观察窗口作废，下轮重新累计
    target.secrets?.forEach((s) => { if (s.kind === 'feigongping') s.dmgDirty = true; });
    // 复活之甲：累计回合外受到的伤害（用于“一轮最多3点”上限）
    if (this.turnOwner !== target && armorsOf(target).some((a) => (CARD_DEFS[a.kind] || {}).offTurnCap != null)) {
      target.offTurnDamage = (target.offTurnDamage || 0) + amount;
    }
    this.emitter.emit('damage', { source, target, amount, nature, card });
    this.changed();
    await this.pause(420);
    // 受伤后技能（奸雄/反馈/刚烈/遗计）
    await triggerSkill(this, 'damaged', { player: target, source, amount, nature, card });
    // 造成伤害后技能（猛击等，来源触发）
    if (source) await triggerSkill(this, 'dealDamage', { source, target, amount, nature, card });
    // 蒸发（奥秘）：一名角色对你造成伤害后，弃掉其所有装备和奥秘
    const zf = target.secrets?.find((s) => s.kind === 'zhengfa');
    if (zf && source && source !== target && source.alive) {
      removeFrom(target.secrets, zf); this.discard.push(zf);
      this.log(`${target.name} 触发奥秘【蒸发】，${source.name} 的所有装备和奥秘被弃掉！`, 'good');
      this.fx('secret', { playerId: target.id, label: '蒸发' });
      const eq = [...Object.values(source.equips).filter(Boolean), ...(source.equips2 ? Object.values(source.equips2).filter(Boolean) : [])];
      const secs = (source.secrets || []).splice(0);
      secs.forEach((s) => { if (s.guhuoBy != null) s.guhuoBy = null; }); // 蛊惑置入的杀一并弃掉
      const strip = [...eq, ...secs];
      if (strip.length) this.discardCards(source, strip);
      this.changed();
      await this.pause(360);
    }
    // 以眼还眼（奥秘）：受到伤害后对来源造成等量强制伤害
    const eye = target.secrets?.find((s) => s.kind === 'yiyanhuanyan');
    if (eye && source && source !== target && source.alive) {
      removeFrom(target.secrets, eye); this.discard.push(eye);
      this.log(`${target.name} 触发奥秘【以眼还眼】，反弹 ${amount} 点强制伤害！`, 'good');
      this.fx('secret', { playerId: target.id, label: '以眼还眼' });
      await this.dealDamage({ source: target, target: source, amount, nature: 'reflect' });
    }
    // 世界树嫩枝：你对一名角色造成伤害后，令其回复3点体力
    if (!this.over && source && source.alive && target.alive) {
      const wt = weaponsOf(source).map((w) => (CARD_DEFS[w.kind] || {}).worldtreeHeal || 0).reduce((a, b) => Math.max(a, b), 0);
      if (wt > 0) await this.recover(target, wt, source);
    }
    if (this.over) return;
    // 注意：受伤后技能链中目标可能已死亡，需再校验 alive，避免对已死角色重复进入濒死
    if (target.alive && target.hp <= 0) {
      await this._dying(target, source);
    }
  }

  async _dying(player, source) {
    if (!player.alive || player.hp > 0) return;
    this.log(`${player.name} 濒死！（体力 ${player.hp}）`, 'bad');
    this.changed();
    await this.pause(300);
    // 求桃顺序：从濒死者开始，按座位顺序
    const order = this._orderFrom(player);
    for (const responder of order) {
      while (player.hp <= 0) {
        const need = 1 - player.hp;
        const resp = await this.ask(responder, {
          type: REQ.ASK_PEACH, dying: player, need,
          title: responder === player
            ? `你濒死了！是否使用【桃】或【酒】？（还需 ${need} 点）`
            : `${player.name} 濒死，是否使用【桃】救援？`,
        });
        const card = resp && resp.card;
        if (!card) break;
        // 桃可救任意濒死角色；酒只能由濒死者本人自救（主机权威校验）。
        const role = cardAs(card);
        if (role !== 'tao' && !(role === 'jiu' && responder === player)) {
          this.log(`${responder.name} 的【${card.name}】不能用于救援 ${player.name}。`, 'system');
          break;
        }
        const sources = card.virtual ? card.sourceCards : [card];
        sources.forEach((c) => removeFromHand(responder.hand, c));
        this.toDiscard([card], responder);
        this.log(`${responder.name} 使用【${card.name}】救 ${player.name}。`, 'good');
        player.hp += 1;
        this.changed();
        await this.pause(350);
      }
      if (player.hp > 0) break;
    }
    if (player.hp <= 0) {
      await this._die(player, source);
    }
  }

  _orderFrom(player) {
    const alive = this.alivePlayers;
    const start = alive.indexOf(player);
    const order = [];
    if (start >= 0) {
      for (let k = 0; k < alive.length; k++) order.push(alive[(start + k) % alive.length]);
    } else {
      order.push(...alive); // 起点不在存活列表（如已死）：按现存顺序，避免负索引取到 undefined
    }
    // 濒死者本人也可救，加在最前
    if (!order.includes(player)) order.unshift(player);
    return order;
  }

  async _die(player, source) {
    // 死亡替代技（如米达·重组、希拉斯月影）：返回 true 则免于死亡
    const prevented = await triggerSkill(this, 'beforeDeath', { player, source });
    if (prevented) { this.changed(); return; }
    // 重生（克尔苏加德）：一名角色在其自己/克尔苏加德的回合死亡时，可使其1点体力复活并摸4（每轮一次，仅救友方含自己）
    const reviver = this.players.find((p) => p.alive && hasSkill(p, 'chongsheng')
      && (this.turnOwner === player || this.turnOwner === p) && (p === player || this.isAlly(p, player))
      && !p.skillState.chongshengUsed);
    if (reviver) {
      const rAgent = this.agentOf(reviver);
      let go = true; // “你可以使其复活”：人类询问，AI 默认发动（reviver 条件已限定仅救自己或友方）
      if (rAgent && rAgent.kind !== 'ai') {
        const r = await this.ask(reviver, {
          type: REQ.CHOOSE_OPTION,
          title: `重生：是否使 ${player === reviver ? '你自己' : player.name} 以1点体力复活并摸四张牌？`,
          options: [{ value: 'yes', label: '发动' }, { value: 'no', label: '不发动' }],
        });
        go = r?.value !== 'no';
      }
      if (go) {
        reviver.skillState.chongshengUsed = true;
        player.hp = 1;
        this.log(`✨ ${reviver.name} 发动【重生】，使 ${player.name} 以1点体力复活并摸四张牌！`, 'win');
        this.drawCards(player, 4); this.changed();
        return;
      }
    }
    // 诈死（奥秘）：免于死亡结算，当前回合结束后以1点体力复活（保留所有牌，不触发击杀/死亡技与奖惩）
    const feign = player.secrets?.find((s) => s.kind === 'zhasi');
    if (feign) {
      removeFrom(player.secrets, feign); this.discard.push(feign);
      this.fx('secret', { playerId: player.id, label: '诈死' });
      player.alive = false;
      player.feignDeath = true;
      this.log(`💀 ${player.name}（${player.general?.name}） 倒下了……`, 'death');
      this.changed();
      await this.pause(600);
      return;
    }
    // 救赎（奥秘·任何角色可持有）：一名角色死亡时，使其以1点体力复活并抽1张牌（击杀者不触发自己的救赎）
    for (const p of this.players) {
      if (!p.alive || !p.secrets?.length) continue;
      if (source && source === p) continue;
      const rd = p.secrets.find((s) => s.kind === 'jiushu');
      if (!rd) continue;
      removeFrom(p.secrets, rd); this.discard.push(rd);
      this.fx('secret', { playerId: p.id, label: '救赎' });
      player.hp = 1;
      this.log(`✨ ${p.name} 触发奥秘【救赎】，${player.name} 以1点体力复活并抽一张牌！`, 'win');
      this.drawCards(player, 1);
      this.changed();
      return;
    }
    player.alive = false;
    this.log(`💀 ${player.name}（${player.general?.name}） 阵亡。身份：${this._identityText(player)}`, 'death');
    this.changed();
    this.emitter.emit('death', { player, source });
    await this.pause(600);
    // 击杀技（吸收等）：在弃牌前让击杀者处理
    if (source && source !== player && source.alive) await triggerSkill(this, 'kill', { killer: source, victim: player });
    // 死亡技（亡语等）：在弃牌前由死者触发
    await triggerSkill(this, 'death', { player, source });
    // 弃置所有牌
    const all = [...player.hand, ...Object.values(player.equips).filter(Boolean), ...(player.equips2 ? Object.values(player.equips2).filter(Boolean) : []), ...player.judge, ...(player.secrets || []), ...(player.shieldCards || [])];
    player.hand.forEach(clearCardFreeze);
    player.hand = [];
    player.equips = { weapon: null, armor: null, plus: null, minus: null };
    player.equips2 = { weapon: null, armor: null }; // 骨架（玛洛加尔）副装备栏也要清算，否则死亡时凭空消失
    player.judge = [];
    player.secrets = [];
    player.shieldCards = []; player.shields = 0;
    const toPile = [];
    for (const c of all) { if (!this._routeLeavePlay(c, player)) toPile.push(c); }
    this.discard.push(...toPile);
    this.changed();

    // 奖惩（军争模式）
    if (this.mode === MODE.ZHANGZHENG && source) {
      if (player.identity === IDENTITY.REBEL) {
        this.drawCards(source, 3);
        this.log(`${source.name} 击杀反贼，摸三张牌。`, 'good');
      } else if (player.identity === IDENTITY.LOYALIST && source.identity === IDENTITY.LORD) {
        const lost = [...source.hand, ...Object.values(source.equips).filter(Boolean)];
        source.hand.forEach(clearCardFreeze);
        source.hand = [];
        source.equips = { weapon: null, armor: null, plus: null, minus: null };
        this.discard.push(...lost);
        this.log(`主公错杀忠臣，弃置所有手牌及装备！`, 'bad');
        this.changed();
      }
    }
    // 若被杀者正在其回合中，需要让其回合提前结束（由 runTurn 的 alive 检查处理）
    this._checkWin();
  }

  _identityText(p) {
    if (this.mode === MODE.ZHANGZHENG) return IDENTITY_NAME[p.identity];
    if (this.mode === MODE.DUEL2V2) return `${p.team} 队`;
    return '';
  }

  // ====================== 胜负判定 ======================
  // 诈死复活（当前回合结束后调用）；复活后补一次胜负判定（期间被挂起）
  _reviveFeigned() {
    let any = false;
    for (const p of this.players) {
      if (!p.feignDeath) continue;
      p.feignDeath = false; p.alive = true; p.hp = 1; any = true;
      this.log(`✨ ${p.name} 竟是【诈死】！以1点体力复活。`, 'win');
    }
    if (any) { this.changed(); this._checkWin(); }
  }

  // 抄袭（奥秘）：一名角色回合结束后，持有者获得其本回合使用过的牌（从弃牌堆/装备区/奥秘区/判定区收缴）
  async _fireChaoxi(turnPlayer) {
    if (this.over || !turnPlayer || !this.turnUsedCards?.length) return;
    const holder = this.players.find((p) => p.alive && p !== turnPlayer && p.secrets?.some((s) => s.kind === 'chaoxi'));
    if (!holder) return;
    const s = holder.secrets.find((x) => x.kind === 'chaoxi');
    removeFrom(holder.secrets, s); this.discard.push(s);
    this.fx('secret', { playerId: holder.id, label: '抄袭' });
    const seen = new Set(); const got = [];
    for (const c of this.turnUsedCards) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      if (removeFrom(this.discard, c)) { got.push(c); continue; }
      let found = false;
      for (const p of this.players) {
        if (removeFrom(p.secrets || [], c)) { if (c.guhuoBy != null) c.guhuoBy = null; found = true; break; }
        let hit = false;
        for (const slot of Object.keys(p.equips)) { if (p.equips[slot] === c) { p.equips[slot] = null; hit = true; break; } }
        if (!hit && p.equips2) { for (const slot of Object.keys(p.equips2)) { if (p.equips2[slot] === c) { p.equips2[slot] = null; hit = true; break; } } }
        if (!hit) { const ji = p.judge.indexOf(c); if (ji >= 0) { p.judge.splice(ji, 1); hit = true; } }
        if (hit) { found = true; break; }
      }
      if (found) got.push(c);
    }
    this.turnUsedCards = [];
    if (got.length) {
      got.forEach(clearCardFreeze);
      holder.hand.push(...got);
      this.log(`${holder.name} 触发奥秘【抄袭】，获得 ${turnPlayer.name} 本回合使用的 ${got.length} 张牌！`, 'good');
    } else {
      this.log(`${holder.name} 触发奥秘【抄袭】，但没有可获得的牌。`, 'system');
    }
    this.changed();
    await this.pause(360);
  }

  // 邪恶计谋（奥秘）：累计每名角色使用锦囊/奥秘牌数；自奥秘放置起某角色使用满2张时触发
  async noteSpellUse(user) {
    this._spellUses = this._spellUses || {};
    this._spellUses[user.id] = (this._spellUses[user.id] || 0) + 1;
    for (const p of this.players) {
      if (!p.alive || !p.secrets?.length) continue;
      for (const s of [...p.secrets]) {
        if (s.kind !== 'xieejimou') continue;
        if (this._spellUses[user.id] - ((s.xiejiBase || {})[user.id] || 0) < 2) continue;
        removeFrom(p.secrets, s); this.discard.push(s);
        this.fx('secret', { playerId: p.id, label: '邪恶计谋' });
        this.log(`${p.name} 触发奥秘【邪恶计谋】，抽三张牌！`, 'good');
        this.drawCards(p, 3);
        this.changed();
        await this.pause(320);
      }
    }
  }

  _checkWin() {
    if (this.over) return;
    // 有角色诈死待复活时挂起胜负判定，复活后（_reviveFeigned）补判
    if (this.players.some((p) => p.feignDeath)) return;
    const alive = this.alivePlayers;
    if (this.mode === MODE.ZHANGZHENG) {
      const lord = this.players.find((p) => p.identity === IDENTITY.LORD);
      const rebelsAlive = this.players.some((p) => p.alive && p.identity === IDENTITY.REBEL);
      const traitorsAlive = this.players.some((p) => p.alive && p.identity === IDENTITY.TRAITOR);
      if (!lord.alive) {
        // 主公死。若仅内奸存活则内奸胜，否则反贼胜
        if (alive.length === 1 && alive[0].identity === IDENTITY.TRAITOR) {
          this._endGame([IDENTITY.TRAITOR], '内奸获胜！');
        } else {
          this._endGame([IDENTITY.REBEL], '反贼获胜！');
        }
      } else if (!rebelsAlive && !traitorsAlive) {
        this._endGame([IDENTITY.LORD, IDENTITY.LOYALIST], '主公 / 忠臣 获胜！');
      }
    } else if (this.mode === MODE.DUEL2V2) {
      const aAlive = this.players.some((p) => p.alive && p.team === TEAM.A);
      const bAlive = this.players.some((p) => p.alive && p.team === TEAM.B);
      if (!aAlive) this._endGame([TEAM.B], 'B 队获胜！');
      else if (!bAlive) this._endGame([TEAM.A], 'A 队获胜！');
    } else { // SOLO
      if (alive.length === 1) this._endGame([alive[0].id], `${alive[0].name} 获胜！`);
    }
  }

  _endGame(winnerKeys, text) {
    this.over = true;
    this.winners = { keys: winnerKeys, text };
    this.log(`🏆 ${text}`, 'win');
    this.changed();
  }

  // 阵营关系（AI/借刀用）：是否同阵营
  isAlly(a, b) {
    if (a === b) return true;
    if (this.mode === MODE.ZHANGZHENG) {
      const team = (p) => {
        if (p.identity === IDENTITY.LORD || p.identity === IDENTITY.LOYALIST) return 'gov';
        if (p.identity === IDENTITY.REBEL) return 'rebel';
        return 'traitor';
      };
      return team(a) === team(b);
    }
    if (this.mode === MODE.DUEL2V2) return a.team === b.team;
    return false;
  }

  // ---------- 快照（渲染 / 联机广播） ----------
  snapshot(viewerId = null) {
    return {
      mode: this.mode,
      phase: this.phase,
      over: this.over,
      winners: this.winners,
      turnId: this.current?.id,
      deckCount: this.deck.length,
      discardTop: this.discard.slice(-1)[0] || null,
      discard: this.discard,
      discardCount: this.discard.length,
      logs: this.logs.slice(-30),
      players: this.players.map((p) => ({
        id: p.id, seat: p.seat, name: p.name, isHuman: p.isHuman,
        generalId: p.generalId, general: p.general ? { name: p.general.name, title: p.general.title, faction: p.general.faction, bio: p.general.bio } : null,
        faction: p.faction, maxHp: p.maxHp, hp: p.hp, alive: p.alive,
        gender: p.gender,
        identity: p.identity, team: p.team,
        // 身份只对自己/已死/主公公开
        identityVisible: this.mode !== MODE.ZHANGZHENG || !p.alive || p.identity === IDENTITY.LORD || p.id === viewerId,
        handCount: p.hand.length,
        hand: p.id === viewerId ? p.hand : null,
        equips: p.equips,
        equips2: p.equips2 && (p.equips2.weapon || p.equips2.armor) ? p.equips2 : null, // 骨架第二装备
        judge: p.judge,
        pile: p.pile || [],
        blades: p.blades || 0,
        resourceState: {
          shardCount: p.skillState.shardCount || 0,
          relicCount: p.skillState.relicCount || 0,
          treasures: [...(p.skillState.treasures || [])],
          miracleCount: p.skillState.miracleCount || 0,
          xiehuoCount: p.skillState.xiehuoCount || 0,
          liuxingCounts: { ...(p.skillState.liuxingCounts || {}) },
          huxinDodge: p.skillState.huxinDodge || 0,
          huxinWuxie: p.skillState.huxinWuxie || 0,
          yoggAwake: !!p.skillState.yoggAwake,
        },
        shields: p.shields || 0,
        secretCount: (p.secrets || []).length,
        secrets: p.id === viewerId ? p.secrets : null, // 奥秘对他人隐藏
        skills: [...p.skills, ...p.lordSkills],
        flags: p.flags,
        skillState: p.id === viewerId ? p.skillState : undefined,
      })),
    };
  }
}

// 文本助手
function suitText(c) {
  const m = { spade: '黑桃', heart: '红桃', club: '梅花', diamond: '方块' };
  return `${m[c.suit]}${c.number}`;
}
function natureText(n) { return n === 'fire' ? '火焰' : n === 'thunder' ? '雷电' : ''; }
function fxCard(c) { return { name: c.name, red: c.red, suit: c.suit, number: c.number, kind: c.kind, type: c.type }; }

// 身份分配表（标准三国杀）
export function identityDistribution(n) {
  const L = IDENTITY.LORD, Z = IDENTITY.LOYALIST, F = IDENTITY.REBEL, N = IDENTITY.TRAITOR;
  const table = {
    2: [L, F],
    3: [L, F, N],
    4: [L, Z, F, N],
    5: [L, Z, F, F, N],
    6: [L, Z, F, F, F, N],
    7: [L, Z, Z, F, F, F, N],
    8: [L, Z, Z, F, F, F, F, N],
  };
  const ids = table[n] || table[8];
  // 所有身份一起洗牌，主公不再与房主或 1 号位绑定。
  return shuffle(ids).map((identity) => ({ identity }));
}

// 2v2 标准对位：1、4 号位同队，2、3 号位同队。
export function duel2v2Teams(outerTeam = TEAM.A) {
  const innerTeam = outerTeam === TEAM.A ? TEAM.B : TEAM.A;
  return [outerTeam, innerTeam, innerTeam, outerTeam];
}
