// ====================== 牌桌 UI + 人类玩家 Agent ======================
import { el, clear, mount } from './dom.js';
import { openOverlay, chooseDialog, chooseGeneralDialog, miniCardNode, toast } from './prompts.js';
import {
  PHASE_NAME, IDENTITY_NAME, FACTION_NAME, FACTION_COLOR, SUIT_SYMBOL,
  EQUIP_SLOT, EQUIP_SLOT_NAME, MODE, REQ, rankLabel,
} from '../engine/constants.js';
import { CARD_DEFS, virtualCard } from '../engine/cards.js';
import { SKILLS } from '../engine/skills.js';
import {
  cardPlayOptions, activeSkillOptions, validTargets, shaTargets, canUseSha,
  shanOptions, shaOptions, peachOptions, wuxieOptions, bottledTargets,
} from '../engine/responses.js';
import { FxLayer } from './fx.js';
import { attachTip, hideTip } from './tooltip.js';
import { openCodex } from './codex.js';

export class GameUI {
  constructor(engine, viewerId, opts = {}) {
    this.engine = engine;
    this.viewerId = viewerId;
    this.spectator = !!opts.spectator;
    this.rematch = opts.rematch || null; // { label, fn }
    this.exitAction = opts.exitAction || null;
    this.exitLabel = opts.exitLabel || '返回大厅';
    this.exitConfirm = opts.exitConfirm || null;
    this._goOverlay = null;
    this._unsubs = [];
    this.root = null;
    this.pending = null;        // { req, resolve }
    // 出牌阶段交互状态
    this.activeCard = null;
    this.activeOption = null;
    this.targets = [];
    this.jiedaoStep = 0;
    this.jiedaoHolder = null;
    // 弃牌选择
    this.discardSel = new Set();
    this.zhangba = null; // 丈八蛇矛：{ context:'play'|'respond', sel:[ids] }
    this.fx = null;
    // 移动端默认收起战报，减少左上角遮挡（仍可点开）
    this.logCollapsed = typeof window !== 'undefined' && window.innerWidth <= 640;
  }

  get me() { return this.engine.playerById(this.viewerId); }

  destroy() {
    this._goOverlay?.close();
    this._goOverlay = null;
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
    if (this.pending) { this.pending.resolve(null); this.pending = null; }
  }
  mountInto(rootEl) {
    this.root = rootEl;
    clear(rootEl);
    this.root.appendChild(el('div', { class: 'table-wrap', id: 'table-wrap' }));
    this.fx = new FxLayer();
    this._unsubs.push(this.engine.on('change', () => this.render()));
    this._unsubs.push(this.engine.on('log', () => this.renderLog()));
    // 动画特效
    this._unsubs.push(this.engine.on('fx', (e) => this._onFx(e)));
    this._unsubs.push(this.engine.on('damage', (e) => this.fx?.damage(this._panelEl(e.target.id), e.amount, e.nature)));
    this.render();
  }

  _panelEl(id) { return this.root?.querySelector(`[data-pid="${id}"]`); }
  _discardEl() { return this.root?.querySelector('#center-discard'); }

  _onFx(e) {
    if (!this.fx) return;
    if (e.name === 'use') {
      const fromEl = this._panelEl(e.userId);
      const toEls = (e.targetIds || []).map((id) => this._panelEl(id)).filter(Boolean);
      this.fx.flyUse(fromEl, toEls, e.card || {});
    } else if (e.name === 'discard') {
      this.fx.discardFade(this._discardEl(), e.cards || []);
    } else if (e.name === 'heal') {
      this.fx.heal(this._panelEl(e.targetId), e.amount || 1);
    } else if (e.name === 'judge') {
      const p = this.engine.snapshot ? this.engine.snapshot().players?.find((x) => x.id === e.playerId) : null;
      this.fx.judge(e.card || {}, p?.name || '');
    } else if (e.name === 'secret') {
      this.fx.secret(this._panelEl(e.playerId), e.label || '奥秘');
    }
  }

  // ============ 渲染 ============
  render() {
    if (!this.root) return;
    const wrap = this.root.querySelector('#table-wrap');
    if (!wrap) return;
    const snap = this.engine.snapshot(this.viewerId);
    // 记住手牌横向滚动位置，避免重渲染（如点击别处）后被重置到最左
    const prevHandScroll = wrap.querySelector('.hand-row')?.scrollLeft || 0;
    clear(wrap);

    wrap.appendChild(this._renderTopBar(snap));
    wrap.appendChild(this._renderOpponents(snap));
    wrap.appendChild(this._renderCenter(snap));
    wrap.appendChild(this._renderSelf(snap));
    wrap.appendChild(this._renderActionBar(snap));
    wrap.appendChild(this._renderLogPanel(snap));
    // 恢复手牌滚动位置
    const newHand = wrap.querySelector('.hand-row');
    if (newHand && prevHandScroll) newHand.scrollLeft = prevHandScroll;

    if (snap.over) this._renderGameOver(snap);
  }

  _renderTopBar(snap) {
    const cur = this.engine.playerById(snap.turnId);
    return el('div', { class: 'topbar' }, [
      el('div', { class: 'tb-left' }, [
        el('button', { class: 'tb-menu-btn', title: '菜单', onclick: () => this._openMenu(), html: '&#9776;' }),
        el('div', { class: 'tb-mode', text: { [MODE.ZHANGZHENG]: '军争模式', [MODE.DUEL2V2]: '2v2', [MODE.SOLO]: '单挑' }[snap.mode] }),
      ]),
      el('div', { class: 'tb-phase' }, [
        el('span', { class: 'tb-turn', text: cur ? `${cur.name} 的回合` : '' }),
        el('span', { class: 'tb-phase-name', text: snap.phase ? PHASE_NAME[snap.phase] : '' }),
      ]),
      el('div', { class: 'tb-deck', title: '点击查看弃牌堆', onclick: () => this._openDiscardViewer() }, [
        el('span', { html: `牌堆 <b>${snap.deckCount}</b>` }),
        el('span', { class: 'tb-discard-link', html: `弃牌 <b>${snap.discardCount}</b> ▸` }),
      ]),
    ]);
  }

  async _exitGame(overlay = null) {
    const message = this.exitConfirm || '确定返回大厅？当前对局将结束。';
    if (!confirm(message)) return;
    overlay?.close();
    if (this._goOverlay === overlay) this._goOverlay = null;
    if (this.exitAction) await this.exitAction();
    else location.reload();
  }

  _openMenu() {
    let ov;
    ov = openOverlay({
      title: '游戏菜单', closable: true,
      bodyNode: el('div', { class: 'menu-list' }, [
        el('div', { class: 'menu-hint', text: this.exitAction ? '可退出当前联机房间；房主退出会关闭房间。' : '随时可返回大厅重新开始一局。' }),
      ]),
      buttons: [
        { label: '查看弃牌堆', onClick: () => { ov.close(); this._openDiscardViewer(); } },
        { label: '图鉴室', onClick: () => { ov.close(); openCodex(); } },
        { label: this.exitLabel, danger: true, onClick: () => this._exitGame(ov) },
        { label: '继续游戏', primary: true, onClick: () => ov.close() },
      ],
    });
  }
  _openDiscardViewer() {
    const pile = this.engine.discard || [];
    const body = el('div', { class: 'discard-viewer' });
    if (!pile.length) body.appendChild(el('div', { class: 'dv-empty', text: '弃牌堆为空' }));
    else [...pile].reverse().forEach((c) => body.appendChild(miniCardNode(c)));
    let ov;
    ov = openOverlay({
      title: `弃牌堆（${pile.length} 张，最新在前）`, bodyNode: body, className: 'wide', closable: true,
      buttons: [{ label: '关闭', primary: true, onClick: () => ov.close() }],
    });
  }

  _resourceItems(p) {
    const skills = new Set(p.skills || []);
    const state = p.resourceState || {};
    const flags = p.flags || {};
    const pile = p.pile || [];
    const items = [];
    const add = (item) => items.push(item);
    const suitSummary = (cards) => {
      const counts = { spade: 0, heart: 0, club: 0, diamond: 0 };
      cards.forEach((c) => { if (c?.suit in counts) counts[c.suit]++; });
      return Object.entries(counts).filter(([, n]) => n).map(([s, n]) => `${SUIT_SYMBOL[s]}${n}`).join(' · ') || '暂无牌';
    };
    const named = (cards) => cards.map((c) => c.name || CARD_DEFS[c.kind]?.name || c.kind).join('、') || '暂无';

    if (skills.has('chenluo')) add({ key: 'sink', label: '沉', value: pile.length, color: '#55aeb5', cards: pile, desc: `${suitSummary(pile)}。内容：${named(pile)}` });
    else if (skills.has('huoyan')) {
      const shas = pile.filter((c) => c.kind === 'sha' || CARD_DEFS[c.kind]?.as === 'sha');
      add({ key: 'fire-eye', label: '火眼', value: shas.length, color: '#d66a4d', cards: shas, desc: `已收集 ${shas.length}/5 张【杀】。内容：${named(shas)}` });
    } else if (skills.has('xintu')) {
      const banked = pile.filter((c) => c.suit === 'spade' || c.suit === 'club');
      add({ key: 'believer', label: '信徒', value: banked.length, color: '#8e82c5', cards: banked, desc: `武将牌上的黑色牌：${named(banked)}` });
    }

    if (skills.has('longwang') || skills.has('shunpi') || skills.has('qtanying') || skills.has('bhlinghun')) {
      add({ key: 'blades', label: '刃', value: p.blades || 0, color: '#d4a72c', desc: `当前拥有 ${p.blades || 0} 枚“刃”；可用于【顺劈斩】【群体暗影】与【捕获灵魂】。` });
    }
    if (skills.has('posui')) add({ key: 'shards', label: '破碎', value: `${state.shardCount || 0}/12`, color: '#6d9ed8', desc: `已触发 ${state.shardCount || 0} 个破碎部件；达到4个时【组合】觉醒。` });
    if (skills.has('yuangu')) {
      const progress = (state.relicCount || 0) % 3;
      const treasures = (state.treasures || []).map((k) => CARD_DEFS[k]?.name || k);
      add({ key: 'relic', label: '圣物', value: `${progress}/3`, color: '#62b5bd', desc: `本轮宝藏进度 ${progress}/3。已获得：${treasures.join('、') || '暂无'}。` });
    }
    if (skills.has('mengji')) {
      const damage = flags.mengjiDone ? 2 : Math.min(2, flags.mengjiDmg || 0);
      add({ key: 'slam', label: '猛击', value: `${damage}/2`, color: '#d8844c', desc: '本回合累计造成2点伤害后，摸两张牌并回复1点体力。' });
    }
    if (skills.has('edwinqj')) add({ key: 'miracle', label: '奇迹', value: `${state.miracleCount || 0}/2`, color: '#9a78cc', desc: '每累计使用两张牌，摸一张牌。' });
    if (skills.has('jihua')) add({ key: 'intensify', label: '激化', value: `${Math.min(flags.cardsUsed || 0, 7)}/7`, color: '#c0688f', desc: '本回合使用3张牌后【杀】改为强制伤害，使用7张后伤害再+3。' });
    if (skills.has('xiehuo2')) add({ key: 'fel', label: '邪火', value: `${(state.xiehuoCount || 0) % 3}/3`, color: '#75ae55', desc: '每回合第3、6、9…张牌会再使用一次，并摸两张牌。' });
    if (skills.has('xuanzhuan')) {
      const count = Math.min(flags.xuanzhuanCount || 0, 3);
      add({ key: 'spin', label: '旋转', value: `${count}/3`, color: '#c99a4e', desc: `本回合已发动 ${count} 次；每回合至多3次。` });
    }
    if (skills.has('liuxing')) {
      const entries = Object.entries(state.liuxingCounts || {});
      const total = entries.reduce((sum, [, n]) => sum + n, 0);
      const detail = entries.map(([id, n]) => `${this.engine.playerById(id)?.name || id} ${n}/3`).join('、');
      add({ key: 'meteor', label: '流星', value: total, color: '#7da4d6', desc: `本回合累计发动 ${total} 次。各目标：${detail || '暂无'}。` });
    }
    if (skills.has('huxin')) {
      const cap = state.yoggAwake ? 2 : 1;
      const dodge = Math.min(state.huxinDodge || 0, cap);
      const counter = Math.min(state.huxinWuxie || 0, cap);
      add({ key: 'heartguard', label: '护心', value: `${dodge + counter}/${cap * 2}`, color: '#8880c5', desc: `本轮额度：闪避 ${dodge}/${cap}，法术反制 ${counter}/${cap}。` });
    }
    if (skills.has('shuangsheng')) {
      const pending = state.twinPending || [];
      const current = state.twinCurrent || [];
      const source = pending.length ? pending : current;
      const cards = source.map((c, i) => ({ ...c, id: `twin_${i}`, name: CARD_DEFS[c.kind]?.name || c.kind }));
      add({ key: 'twin', label: pending.length ? '待双生' : '双生', value: source.length, color: '#6f8ed2', cards, desc: `${pending.length ? '下个回合待重演' : '本回合已记录'}：${named(cards)}` });
    }
    return items;
  }

  _openResourceViewer(p, item) {
    if (!item.cards?.length) return;
    const body = el('div', { class: 'resource-viewer' });
    item.cards.forEach((c) => body.appendChild(miniCardNode(c)));
    let ov;
    ov = openOverlay({
      title: `${p.general?.name || p.name} · ${item.label}（${item.cards.length}）`,
      bodyNode: body,
      className: 'wide',
      closable: true,
      buttons: [{ label: '关闭', primary: true, onClick: () => ov.close() }],
    });
  }

  _renderResources(p) {
    const items = this._resourceItems(p);
    if (!items.length) return null;
    const row = el('div', { class: 'p-resources' });
    items.forEach((item) => {
      const tile = el('button', {
        class: `resource-tile resource-${item.key}`,
        type: 'button',
        style: { '--resource': item.color },
        onclick: (e) => { e.stopPropagation(); hideTip(); this._openResourceViewer(p, item); },
      }, [
        el('span', { class: 'resource-value', text: item.value }),
        el('span', { class: 'resource-label', text: item.label }),
      ]);
      attachTip(tile, { title: item.label, sub: `当前：${item.value}`, desc: item.desc, accent: item.color });
      row.appendChild(tile);
    });
    return row;
  }

  _renderOpponents(snap) {
    const others = snap.players.filter((p) => p.id !== this.viewerId);
    const grid = el('div', { class: `opp-grid count-${others.length}` });
    others.forEach((p) => grid.appendChild(this._renderPlayer(p, false)));
    return grid;
  }

  _renderPlayer(p, isMe) {
    const isTurn = this.engine.snapshot().turnId === p.id;
    const selectable = this._isSelectableTarget(p.id);
    const selected = this.targets.includes(p.id);
    const cls = [
      'player', isMe ? 'me' : 'opp',
      !p.alive ? 'dead' : '', isTurn ? 'is-turn' : '',
      selectable ? 'selectable' : '', selected ? 'selected' : '',
    ].join(' ');

    const facColor = p.faction ? FACTION_COLOR[p.faction] : '#555';
    const portrait = el('div', { class: 'p-portrait', style: { '--fac': facColor } }, [
      el('span', { class: 'p-pchar', text: p.general ? p.general.name[0] : '?' }),
    ]);

    // 身份/势力徽标
    const badges = el('div', { class: 'p-badges' });
    if (p.faction) badges.appendChild(el('span', { class: 'p-faction', style: { background: facColor }, text: FACTION_NAME[p.faction] }));
    if (this.engine.mode === MODE.ZHANGZHENG && p.identityVisible) {
      badges.appendChild(el('span', { class: `p-identity id-${p.identity}`, text: IDENTITY_NAME[p.identity] }));
    } else if (this.engine.mode === MODE.DUEL2V2) {
      badges.appendChild(el('span', { class: `p-team team-${p.team}`, text: `${p.team}队` }));
    }

    // 体力
    const hp = el('div', { class: 'p-hp' });
    for (let i = 0; i < p.maxHp; i++) {
      hp.appendChild(el('span', { class: `hp-bead ${i < p.hp ? 'on' : 'off'} ${p.hp <= 1 ? 'low' : ''}` }));
    }

    // 装备区
    const equips = el('div', { class: 'p-equips' });
    const mkEquipChip = (e, slot, extra = false) => {
      const chip = el('div', { class: `equip-chip ${e.red ? 'red' : 'black'}` }, [
        el('span', { class: 'eq-tag', text: (extra ? '骨架·' : '') + EQUIP_SLOT_NAME[slot] }),
        el('span', { text: e.name }),
        el('span', { class: 'eq-suit', text: `${rankLabel(e.number)}${SUIT_SYMBOL[e.suit]}` }),
      ]);
      attachTip(chip, { title: e.name, sub: `${EQUIP_SLOT_NAME[slot]} · ${rankLabel(e.number)}${SUIT_SYMBOL[e.suit]}`, desc: CARD_DEFS[e.kind]?.desc || '', accent: '#2e8b57' });
      equips.appendChild(chip);
    };
    for (const slot of [EQUIP_SLOT.WEAPON, EQUIP_SLOT.ARMOR, EQUIP_SLOT.OFFENSE_HORSE, EQUIP_SLOT.DEFENSE_HORSE]) {
      if (p.equips[slot]) mkEquipChip(p.equips[slot], slot);
      if (p.equips2 && p.equips2[slot]) mkEquipChip(p.equips2[slot], slot, true); // 骨架第二件
    }

    // 判定区
    const judge = el('div', { class: 'p-judge' });
    p.judge.forEach((j) => {
      const chip = el('span', { class: 'judge-chip', text: j.name });
      attachTip(chip, { title: j.name, sub: '延时锦囊（判定区）', desc: CARD_DEFS[j.kind]?.desc || '', accent: '#d08a3a' });
      judge.appendChild(chip);
    });

    // 盾 / 奥秘 标记
    const tokens = el('div', { class: 'p-tokens' });
    if (p.shields > 0) {
      const sh = el('span', { class: 'token-chip shield-chip', text: `🛡 ${p.shields}` });
      attachTip(sh, { title: '盾', sub: `${p.shields} 枚`, desc: '每枚盾抵挡1点伤害，破盾时拥有者摸1张牌。', accent: '#5a8ed0' });
      tokens.appendChild(sh);
    }
    if (p.secretCount > 0) {
      // 对自己显示具体奥秘名，对他人只显示数量
      if (p.secrets) {
        p.secrets.forEach((s) => {
          const sc = el('span', { class: 'token-chip secret-chip', text: s.guhuoBy ? `🗡 蛊惑·${s.name}` : `🔒 ${s.name}` });
          attachTip(sc, { title: s.name, sub: '奥秘（仅你可见）', desc: CARD_DEFS[s.kind]?.desc || '', accent: '#b186ff' });
          tokens.appendChild(sc);
        });
      } else {
        const sc = el('span', { class: 'token-chip secret-chip', text: `🔒 ${p.secretCount}` });
        attachTip(sc, { title: '奥秘', sub: `${p.secretCount} 个`, desc: '盖放的奥秘，满足条件时自动触发。', accent: '#b186ff' });
        tokens.appendChild(sc);
      }
    }

    // 技能
    const skills = el('div', { class: 'p-skills' });
    (p.skills || []).forEach((sk) => {
      const meta = SKILLS[sk];
      if (meta?.name) {
        const tag = el('span', { class: `skill-tag ${meta.lord ? 'lord' : ''}`, text: meta.name });
        attachTip(tag, { title: meta.name, sub: meta.lord ? '主公技' : (meta.active ? '主动技' : '锁定/触发技'), desc: meta.desc || '', accent: '#9a86d8' });
        skills.appendChild(tag);
      }
    });

    const resources = this._renderResources(p);

    const info = el('div', { class: 'p-info' }, [
      el('div', { class: 'p-name-row' }, [
        el('span', { class: 'p-name', text: p.name }),
        !p.isHuman ? el('span', { class: 'p-ai-tag', text: '电脑' }) : null,
      ]),
      el('div', { class: 'p-general', text: p.general ? `${p.general.name}` : '选将中…' }),
      badges, hp,
      el('div', { class: 'p-hand-count', text: `手牌 ${p.handCount}` }),
    ]);

    const node = el('div', {
      class: cls, dataset: { pid: p.id },
      onclick: () => { if (selectable) this._onTargetClick(p.id); },
    }, [portrait, info, resources, skills, equips, judge, tokens]);

    if (!p.alive) node.appendChild(el('div', { class: 'dead-overlay', text: '阵亡' }));
    return node;
  }

  _renderCenter(snap) {
    const top = snap.discardTop;
    return el('div', { class: 'table-center' }, [
      el('div', { class: 'center-deck' }, [
        el('div', { class: 'deck-pile', text: snap.deckCount }),
        el('div', { class: 'deck-label', text: '牌堆' }),
      ]),
      el('div', { class: 'center-discard', id: 'center-discard', title: '点击查看弃牌堆', onclick: () => this._openDiscardViewer() }, [
        top ? this._cardFace(top, { mini: true }) : el('div', { class: 'discard-empty', text: '弃牌堆' }),
        el('div', { class: 'discard-count-badge', text: snap.discardCount }),
      ]),
      el('div', { class: 'center-banner', id: 'center-banner' }),
    ]);
  }

  _renderSelf(snap) {
    const me = snap.players.find((p) => p.id === this.viewerId);
    if (!me) return el('div');
    const panel = this._renderPlayer(me, true);
    panel.classList.add('self-panel');
    return panel;
  }

  _cardFace(card, { mini = false, clickable = false, dim = false, selected = false, onClick } = {}) {
    const def = CARD_DEFS[card.kind] || {};
    const typeLabel = { equip: '装备', trick: '锦囊', delayed: '延时', basic: '基本', secret: '奥秘' }[def.type] || '';
    const node = el('div', {
      class: `card-face type-${def.type || 'basic'} ${card.red ? 'red' : 'black'} ${mini ? 'mini' : ''} ${dim ? 'dim' : ''} ${selected ? 'sel' : ''} ${clickable ? 'clickable' : ''} ${card.frozen ? 'frozen' : ''}`,
    }, [
      el('div', { class: 'cf-top' }, [
        el('span', { class: 'cf-rank', text: rankLabel(card.number) }),
        el('span', { class: 'cf-suit', text: SUIT_SYMBOL[card.suit] || '' }),
      ]),
      el('div', { class: 'cf-name', text: card.name }),
      el('div', { class: 'cf-type', text: typeLabel }),
      card.frozen ? el('div', { class: 'cf-frozen', text: '❄' }) : null,
    ]);
    // 精美介绍：桌面端悬停、移动端单击即显示（替代原生 title 长按）。
    // 先绑定提示再绑定选牌点击：选牌会同步 render() 把本节点替换掉，故须在替换前完成提示定位。
    const accent = { equip: '#2e8b57', trick: '#8a5bba', delayed: '#d08a3a', secret: '#b186ff' }[def.type] || 'var(--gold)';
    const sub = [typeLabel, `${rankLabel(card.number)}${SUIT_SYMBOL[card.suit] || ''}`, card.frozen ? '· 已冻结' : ''].filter(Boolean).join(' · ');
    attachTip(node, { title: card.name, sub, desc: def.desc || '', accent });
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  // ============ 手牌 + 操作栏 ============
  _renderActionBar(snap) {
    const me = this.me;
    const bar = el('div', { class: 'action-bar' });

    // 提示横幅
    const banner = el('div', { class: 'ab-banner' });
    if (this.spectator) banner.appendChild(el('span', { class: 'ab-title', text: '👁 观战中 · 旁观全局' }));
    else if (this.pending) banner.appendChild(el('span', { class: 'ab-title', text: this.pending.req.title || this._defaultTitle(this.pending.req) }));
    else if (snap.turnId === this.viewerId && snap.phase) banner.appendChild(el('span', { class: 'ab-title', text: PHASE_NAME[snap.phase] }));
    else banner.appendChild(el('span', { class: 'ab-wait', text: this._waitText(snap) }));
    bar.appendChild(banner);

    // 手牌
    const handRow = el('div', { class: 'hand-row' });
    if (me && me.alive) {
      (this.me.hand || []).forEach((card) => {
        const usable = this._isHandCardUsable(card);
        const selZhangba = this.zhangba && this.zhangba.sel.includes(card.id);
        const selected = (this.activeCard && this.activeCard.id === card.id) || selZhangba;
        const selDiscard = this.discardSel.has(card.id);
        handRow.appendChild(this._cardFace(card, {
          clickable: usable, dim: !usable && !selDiscard && !selected, selected: selected || selDiscard,
          onClick: () => this._onHandCardClick(card),
        }));
      });
      if (!this.me.hand.length) handRow.appendChild(el('div', { class: 'hand-empty', text: '（无手牌）' }));
    }
    bar.appendChild(handRow);

    // 控制按钮 / 响应选项
    bar.appendChild(this._renderControls(snap));
    return bar;
  }

  _renderControls(snap) {
    const ctrl = el('div', { class: 'ab-controls' });
    const req = this.pending?.req;
    const me = this.me;

    // 丈八蛇矛：选两张手牌当【杀】
    if (this.zhangba) {
      const n = this.zhangba.sel.length;
      ctrl.appendChild(el('span', { class: 'ab-hint', text: `丈八蛇矛：点选两张手牌当作【杀】（${n}/2）` }));
      if (this.zhangba.context === 'respond' && n === 2) {
        ctrl.appendChild(el('button', { class: 'btn btn-primary', text: '确定', onclick: () => this._confirmZhangbaRespond() }));
      }
      ctrl.appendChild(el('button', { class: 'btn btn-ghost', text: '取消', onclick: () => this._exitZhangba() }));
      return ctrl;
    }

    if (req && this._isRespondReq(req.type)) {
      // 响应类：点击手牌打出（含技能转化），不再用一堆按钮
      const opts = this._responseOptions(req);
      const canZhangba = req.type === REQ.ASK_SHA && me?.equips?.weapon?.kind === 'zhangba' && (me.hand?.length || 0) >= 2;
      ctrl.appendChild(el('span', { class: 'ab-hint', text: opts.length ? '点击高亮手牌进行响应' : (canZhangba ? '可用丈八蛇矛响应' : '无可用的牌') }));
      if (canZhangba) ctrl.appendChild(el('button', { class: 'btn btn-skill', text: '丈八·两张当杀', onclick: () => this._enterZhangba('respond') }));
      ctrl.appendChild(el('button', { class: 'btn btn-ghost', text: req.type === REQ.ASK_NULLIFY ? '不使用' : '放弃', onclick: () => this._resolve(null) }));
      return ctrl;
    }

    if (req && req.type === REQ.DISCARD_CARDS) {
      ctrl.appendChild(el('button', {
        class: `btn btn-primary ${this.discardSel.size === req.count ? '' : 'disabled'}`,
        text: `确定弃牌 (${this.discardSel.size}/${req.count})`,
        onclick: () => { if (this.discardSel.size === req.count) this._confirmDiscard(); },
      }));
      return ctrl;
    }

    if (req && req.type === REQ.ASK_SKILL && req.needCard) {
      ctrl.appendChild(el('span', { class: 'ab-hint', text: '点击手牌发动，或放弃' }));
      ctrl.appendChild(el('button', { class: 'btn btn-ghost', text: '放弃', onclick: () => this._resolve({}) }));
      return ctrl;
    }

    if (req && req.type === REQ.PLAY_TURN) {
      // 出牌阶段：确定 / 取消 / 技能 / 结束
      if (this.activeCard) {
        const ready = !this.activeOption?.needTarget || this.targets.length >= 1;
        ctrl.appendChild(el('button', { class: `btn btn-primary ${ready ? '' : 'disabled'}`, text: '确定', onclick: () => { if (ready) this._confirmPlay(); } }));
        ctrl.appendChild(el('button', { class: 'btn btn-ghost', text: '取消', onclick: () => this._clearActive() }));
      } else {
        // 主动技能按钮
        const acts = activeSkillOptions(this.engine, me);
        acts.forEach((a) => ctrl.appendChild(el('button', { class: 'btn btn-skill', text: a.name, onclick: () => this._startSkillFlow(a.skill) })));
        // 丈八蛇矛：两张手牌当【杀】
        if (me?.equips?.weapon?.kind === 'zhangba' && canUseSha(this.engine, me) && (me.hand?.length || 0) >= 2 && shaTargets(this.engine, me).length) {
          ctrl.appendChild(el('button', { class: 'btn btn-skill', text: '丈八·两张当杀', onclick: () => this._enterZhangba('play') }));
        }
        ctrl.appendChild(el('button', { class: 'btn btn-danger', text: '结束出牌', onclick: () => this._resolve({ type: 'end' }) }));
      }
      return ctrl;
    }

    return ctrl;
  }

  _renderLogPanel(snap) {
    const panel = el('div', { class: `log-panel ${this.logCollapsed ? 'collapsed' : ''}`, id: 'log-panel' });
    panel.appendChild(el('div', { class: 'log-head', onclick: () => { this.logCollapsed = !this.logCollapsed; this.render(); } }, [
      el('span', { class: 'log-title', text: '战报' }),
      el('span', { class: 'log-toggle', text: this.logCollapsed ? '展开 ▴' : '收起 ▾' }),
    ]));
    const body = el('div', { class: 'log-body', id: 'log-body' });
    if (!this.logCollapsed) {
      snap.logs.slice(-14).forEach((l) => body.appendChild(el('div', { class: `log-line log-${l.kind}`, text: l.text })));
      setTimeout(() => { body.scrollTop = body.scrollHeight; }, 0);
    }
    panel.appendChild(body);
    return panel;
  }

  renderLog() {
    const body = this.root?.querySelector('#log-body');
    if (!body || this.logCollapsed) return;
    const snap = this.engine.snapshot(this.viewerId);
    clear(body);
    snap.logs.slice(-14).forEach((l) => body.appendChild(el('div', { class: `log-line log-${l.kind}`, text: l.text })));
    body.scrollTop = body.scrollHeight;
  }

  _renderGameOver(snap) {
    if (this._goShown) return;
    this._goShown = true;
    const me = snap.players.find((p) => p.id === this.viewerId);
    let win = false;
    const w = snap.winners;
    if (w && me) {
      if (this.engine.mode === MODE.ZHANGZHENG) win = w.keys.includes(me.identity);
      else if (this.engine.mode === MODE.DUEL2V2) win = w.keys.includes(me.team);
      else win = w.keys.includes(me.id);
    }
    const resultText = this.spectator || !me ? '对局结束' : (win ? '胜利' : '失败');
    const body = el('div', { class: 'gameover-body' }, [
      el('div', { class: `go-result ${this.spectator || !me ? '' : (win ? 'win' : 'lose')}`, text: resultText }),
      el('div', { class: 'go-sub', text: w?.text || '' }),
      el('div', { class: 'go-list' }, snap.players.map((p) =>
        el('div', { class: 'go-row' }, [
          el('span', { text: `${p.name}` }),
          el('span', { text: p.general?.name || '' }),
          el('span', { text: this.engine.mode === MODE.ZHANGZHENG ? IDENTITY_NAME[p.identity] : (p.team ? p.team + '队' : '') }),
          el('span', { class: p.alive ? 'alive' : 'dead', text: p.alive ? '存活' : '阵亡' }),
        ])
      )),
    ]);
    const buttons = [];
    let ov;
    if (this.rematch) buttons.push({ label: this.rematch.label || '再来一局', primary: true, onClick: () => { ov.close(); this._goOverlay = null; this._goShown = false; this.rematch.fn(); } });
    buttons.push({ label: this.exitLabel, danger: !!this.rematch, onClick: () => this._exitGame(ov) });
    ov = openOverlay({ title: '对局结束', bodyNode: body, className: 'wide', buttons });
    this._goOverlay = ov;
  }

  // ============ 交互逻辑 ============
  _defaultTitle(req) {
    return {
      [REQ.ASK_DODGE]: '请打出【闪】', [REQ.ASK_SHA]: '请打出【杀】',
      [REQ.ASK_PEACH]: '是否使用【桃】', [REQ.ASK_NULLIFY]: '是否使用【无懈可击】',
      [REQ.PLAY_TURN]: this.activeCard ? '选择目标后点击「确定」' : '出牌阶段 · 选择要使用的牌，或结束出牌',
    }[req.type] || '请操作';
  }
  _waitText(snap) {
    const cur = this.engine.playerById(snap.turnId);
    return cur && cur.id !== this.viewerId ? `等待 ${cur.name} 行动…` : '等待…';
  }

  _isRespondReq(t) { return [REQ.ASK_DODGE, REQ.ASK_SHA, REQ.ASK_PEACH, REQ.ASK_NULLIFY].includes(t); }

  _responseOptions(req) {
    const me = this.me;
    if (req.type === REQ.ASK_DODGE) return shanOptions(this.engine, me);
    if (req.type === REQ.ASK_SHA) return shaOptions(this.engine, me);
    if (req.type === REQ.ASK_PEACH) return peachOptions(this.engine, me, true, req.dying);
    if (req.type === REQ.ASK_NULLIFY) return wuxieOptions(me);
    return [];
  }

  // 响应类：某张手牌能产生的（单张）响应选项
  _singleOptForCard(card) {
    const req = this.pending?.req;
    if (!req || !this._isRespondReq(req.type)) return [];
    return this._responseOptions(req).filter((o) =>
      o.card === card || (o.card.sourceCards && o.card.sourceCards.length === 1 && o.card.sourceCards[0] === card));
  }

  _isHandCardUsable(card) {
    const req = this.pending?.req;
    if (!req) return false;
    if (this.zhangba) return true; // 丈八模式：任意手牌可选
    if (req.type === REQ.DISCARD_CARDS) return true;
    if (req.type === REQ.ASK_SKILL && req.needCard) return true; // 鬼才：任意手牌
    if (this._isRespondReq(req.type)) return this._singleOptForCard(card).length > 0;
    if (req.type === REQ.PLAY_TURN) return cardPlayOptions(this.engine, this.me, card).length > 0;
    return false;
  }

  _onHandCardClick(card) {
    const req = this.pending?.req;
    if (!req) return;
    if (this.zhangba) { this._toggleZhangbaCard(card); return; }
    if (req.type === REQ.DISCARD_CARDS) {
      if (this.discardSel.has(card.id)) this.discardSel.delete(card.id);
      else if (this.discardSel.size < req.count) this.discardSel.add(card.id);
      this.render();
      return;
    }
    if (req.type === REQ.ASK_SKILL && req.needCard) { this._resolve({ card }); return; }
    if (this._isRespondReq(req.type)) {
      const opts = this._singleOptForCard(card);
      if (!opts.length) { toast('该牌不能用于此次响应'); return; }
      if (opts.length === 1) { this._resolve({ card: opts[0].card }); return; }
      chooseDialog('作为：', opts.map((o) => ({ value: o, label: o.label })), { closable: true }).then((o) => {
        if (o) this._resolve({ card: o.card });
      });
      return;
    }
    if (req.type === REQ.PLAY_TURN) {
      const opts = cardPlayOptions(this.engine, this.me, card);
      if (!opts.length) { toast('该牌现在不能使用'); return; }
      if (opts.length === 1) { this._setActive(card, opts[0]); return; }
      chooseDialog('使用为：', opts.map((o) => ({ value: o, label: o.asName })), { closable: true }).then((o) => {
        if (o) this._setActive(card, o);
      });
    }
  }

  // ---------- 丈八蛇矛：两张手牌当【杀】 ----------
  _enterZhangba(context) { this.zhangba = { context, sel: [] }; this.activeCard = null; this.activeOption = null; this.render(); }
  _exitZhangba() { this.zhangba = null; this.render(); }
  _toggleZhangbaCard(card) {
    const sel = this.zhangba.sel;
    const i = sel.indexOf(card.id);
    if (i >= 0) sel.splice(i, 1);
    else if (sel.length < 2) sel.push(card.id);
    if (this.zhangba.context === 'play' && sel.length === 2) {
      const v = this._buildZhangbaCard();
      this.zhangba = null;
      this._setActive(v, { kind: 'sha', asName: '丈八·杀', card: v, needTarget: true });
      return;
    }
    this.render();
  }
  _buildZhangbaCard() {
    const cards = this.zhangba.sel.map((id) => this.me.hand.find((c) => c.id === id)).filter(Boolean);
    return virtualCard('sha', cards, { suit: cards[0].suit, number: cards[0].number, red: cards[0].red });
  }
  _confirmZhangbaRespond() {
    if (this.zhangba.sel.length !== 2) return;
    const v = this._buildZhangbaCard();
    this.zhangba = null;
    this._resolve({ card: v });
  }

  _setActive(card, option) {
    this.activeCard = card;
    this.activeOption = option;
    this.targets = [];
    this.jiedaoStep = 0;
    this.jiedaoHolder = null;
    if (this._isTwoStep(option)) this.jiedaoStep = 1;
    this.render();
  }
  _clearActive() { this.activeCard = null; this.activeOption = null; this.targets = []; this.jiedaoStep = 0; this.render(); }

  // 借刀杀人 / 横冲直撞：两段选目标（先选被驱使者，再选其攻击范围内的受害者）
  _isTwoStep(o) { return o && (o.kind === 'jiedao' || o.kind === 'hengchong'); }

  _maxTargets() {
    const o = this.activeOption;
    if (!o) return 0;
    if (this._isTwoStep(o)) return 2;
    if (o.kind === 'sha') {
      const me = this.me;
      const srcCount = o.card.virtual ? (o.card.sourceCards?.length || 1) : 1;
      const isLast = me.hand.length - srcCount <= 0;
      if (me.equips[EQUIP_SLOT.WEAPON]?.kind === 'fangtian' && isLast) return 3;
      return 1;
    }
    return 1;
  }

  _isSelectableTarget(pid) {
    const req = this.pending?.req;
    if (!req || req.type !== REQ.PLAY_TURN) return false;
    if (!this.activeOption?.needTarget) return false;
    return this._currentTargetList().some((t) => t.id === pid);
  }

  _currentTargetList() {
    const o = this.activeOption;
    if (!o) return [];
    const me = this.me;
    if (this._isTwoStep(o)) {
      if (this.jiedaoStep === 1) return validTargets(this.engine, me, o.card); // 被驱使者（借刀=持武器者，横冲=任意角色）
      // step 2: 受害者 = 被驱使者攻击范围内
      const holder = this.engine.playerById(this.jiedaoHolder);
      return this.engine.alivePlayers.filter((t) => t !== holder && this.engine.inAttackRange(holder, t));
    }
    if (o.kind === 'sha') return shaTargets(this.engine, me, o.card);
    if (o.bottledOther) return bottledTargets(this.engine, me); // 瓶装闪电·弃1牌指定他人
    return validTargets(this.engine, me, o.card);
  }

  _onTargetClick(pid) {
    const o = this.activeOption;
    if (!o) return;
    if (this._isTwoStep(o)) {
      if (this.jiedaoStep === 1) { this.jiedaoHolder = pid; this.targets = [pid]; this.jiedaoStep = 2; this.render(); return; }
      // step2 选受害者
      this.targets = [this.jiedaoHolder, pid];
      this.render();
      return;
    }
    const max = this._maxTargets();
    if (this.targets.includes(pid)) this.targets = this.targets.filter((x) => x !== pid);
    else { if (this.targets.length >= max) this.targets = max === 1 ? [pid] : this.targets; if (this.targets.length < max) this.targets.push(pid); }
    this.render();
  }

  _confirmPlay() {
    const o = this.activeOption;
    if (!o) return;
    let targets = this.targets.slice();
    const options = {};
    if (this._isTwoStep(o)) {
      if (targets.length < 2) { toast('请选择被驱使者与受害者'); return; }
      options.victim = targets[1];
    }
    // 目标高亮按卡牌目标类型泛化（兼容炉石变体锦囊）
    const def = CARD_DEFS[o.card?.kind] || {};
    const others = this.engine.alivePlayers.filter((p) => p.id !== this.viewerId).map((p) => p.id);
    const allIds = this.engine.alivePlayers.map((p) => p.id);
    if (o.kind === 'tao' || o.kind === 'jiu' || def.behaves === 'wuzhong' || o.kind === 'wuzhong') targets = [this.viewerId];
    else if (def.target === 'all') targets = allIds;
    else if (def.target === 'all_other') targets = others;
    else if (o.card?.kind === 'pingzhuangshandian') {
      if (o.bottledOther) options.bottledOther = true; // 目标由点击选择
      else targets = [this.viewerId];
    } else if (def.behaves === 'shandian' || o.kind === 'shandian') targets = [this.viewerId];
    const move = { type: 'play', card: o.card, targets, options };
    this._clearActive();
    this._resolve(move);
  }

  _confirmDiscard() {
    const ids = [...this.discardSel];
    this.discardSel.clear();
    this._resolve({ cards: ids });
  }

  // ---------- 主动技能引导流程 ----------
  async _startSkillFlow(skill) {
    const me = this.me;
    const engine = this.engine;
    try {
      if (skill === 'kurou') { this._resolve({ type: 'skill', skill }); return; }
      if (skill === 'mingyun' || skill === 'diyu' || skill === 'yuanyuhuo') { this._resolve({ type: 'skill', skill }); return; }
      if (skill === 'monengshandian') {
        const others = engine.alivePlayers.filter((p) => p.id !== this.viewerId);
        const first = await this._pickPlayer('魔能闪电：选择第一名角色', others);
        if (!first) return;
        const second = await this._pickPlayer('魔能闪电：选择第二名角色', others.filter((p) => p.id !== first));
        if (!second) return;
        this._resolve({ type: 'skill', skill, firstId: first, secondId: second });
        return;
      }
      if (skill === 'shenyuan2') {
        const pile = me.pile || [];
        const suits = new Set(pile.map((c) => c.suit));
        const hasPair = Object.values(pile.reduce((m, c) => { m[c.suit] = (m[c.suit] || 0) + 1; return m; }, {})).some((n) => n >= 2);
        const opts = [];
        if (suits.size >= 4) opts.push({ value: 'big', label: '弃4张异色沉：摸2、回2、造2点伤害' });
        if (hasPair) opts.push({ value: 'small', label: '弃2张同色沉：摸1张' });
        if (!opts.length) { toast('“沉”不足'); return; }
        const mode = await chooseDialog('深渊：选择方式', opts, { closable: true });
        if (!mode) return;
        if (mode === 'big') {
          const tgt = await this._pickPlayer('深渊：选择造成2点伤害的目标', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
          if (!tgt) return;
          this._resolve({ type: 'skill', skill, mode, targetId: tgt });
        } else {
          this._resolve({ type: 'skill', skill, mode: 'small' });
        }
        return;
      }
      if (skill === 'suxing') {
        const ok = await chooseDialog('苏醒（限定技，整局一次）：-1上限+1回血，本轮治疗失效。确定？', [{ value: true, label: '发动' }, { value: false, label: '取消' }]);
        if (ok) this._resolve({ type: 'skill', skill });
        return;
      }
      if (['shenyuanhao', 'qtanying', 'bhlinghun'].includes(skill)) {
        const nameMap = { shenyuanhao: '深渊之号', qtanying: '群体暗影', bhlinghun: '捕获灵魂' };
        const ok = await chooseDialog(`${nameMap[skill]}（限定技，整局一次）：确定发动？`, [{ value: true, label: '发动' }, { value: false, label: '取消' }]);
        if (ok) this._resolve({ type: 'skill', skill });
        return;
      }
      if (skill === 'xuehou') {
        const cards = await this._pickCards('血吼：弃两张手牌（同时弃置你的武器）', me.hand.filter((c) => !c.frozen), 2, 2);
        if (!cards) return;
        const tgt = await this._pickPlayer('血吼：选择目标（造成2点强制伤害）', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cards, targetId: tgt });
        return;
      }
      if (skill === 'fushi2') {
        const cards = await this._pickCards('腐蚀：弃一张牌作为“腐”', me.hand.filter((c) => !c.frozen), 1, 1);
        if (cards) this._resolve({ type: 'skill', skill, cardId: cards[0] });
        return;
      }
      if (skill === 'zhiheng') {
        const cards = await this._pickCards('制衡：选择要换的牌（任意张）', me.hand, 1, me.hand.length);
        if (cards) this._resolve({ type: 'skill', skill, cards });
        return;
      }
      if (skill === 'qingnang') {
        const cards = await this._pickCards('青囊：弃一张手牌', me.hand, 1, 1);
        if (!cards) return;
        const tgt = await this._pickPlayer('青囊：选择回复体力的角色', engine.alivePlayers.filter((p) => p.hp < p.maxHp));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cardId: cards[0], targetId: tgt });
        return;
      }
      if (skill === 'rende') {
        const cards = await this._pickCards('仁德：选择要给出的手牌', me.hand, 1, me.hand.length);
        if (!cards) return;
        const tgt = await this._pickPlayer('仁德：选择获得牌的角色', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cards, targetId: tgt });
        return;
      }
      if (skill === 'fanjian') {
        const cards = await this._pickCards('反间：选择交给对方的手牌', me.hand, 1, 1);
        if (!cards) return;
        const tgt = await this._pickPlayer('反间：选择目标', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cardId: cards[0], targetId: tgt });
        return;
      }
      if (skill === 'lijian') {
        const cards = await this._pickCards('离间：弃一张牌', me.hand, 1, 1);
        if (!cards) return;
        const males = engine.alivePlayers.filter((p) => p.gender === 'male');
        const first = await this._pickPlayer('离间：选择第一名男性角色（决斗发起方）', males);
        if (!first) return;
        const second = await this._pickPlayer('离间：选择第二名男性角色', males.filter((p) => p.id !== first));
        if (!second) return;
        this._resolve({ type: 'skill', skill, cardId: cards[0], firstId: first, secondId: second });
        return;
      }
      // ---------- 炉石杀主动技 ----------
      if (skill === 'kuangbao') {
        const tgt = await this._pickPlayer('狂暴：选择共同受伤的角色', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, targetId: tgt });
        return;
      }
      if (skill === 'yinxue') {
        const cards = await this._pickCards('饮血：选择弃置的牌（弃 n 摸 n，回 ⌊n/2⌋）', me.hand, 1, me.hand.length);
        if (cards) this._resolve({ type: 'skill', skill, cards });
        return;
      }
      if (skill === 'guangming') {
        const cards = await this._pickCards('光明能量：弃一张牌', me.hand, 1, 1);
        if (!cards) return;
        const healId = await this._pickPlayer('光明能量：选择回复1点体力的角色', engine.alivePlayers);
        if (!healId) return;
        const drawId = await this._pickPlayer('光明能量：选择摸一张牌的角色', engine.alivePlayers.filter((p) => p.id !== healId));
        if (!drawId) return;
        this._resolve({ type: 'skill', skill, cardId: cards[0], healId, drawId });
        return;
      }
      if (skill === 'linghun') {
        // 灵魂分流可指定自己（受1点伤害，回合结束摸四张，常对自己发动）
        const tgt = await this._pickPlayer('灵魂分流：选择目标（受1点伤害，回合结束摸四张，可指定自己）', engine.alivePlayers);
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, targetId: tgt });
        return;
      }
      if (skill === 'xixue') {
        const maxHp = Math.max(...engine.alivePlayers.map((p) => p.maxHp));
        const minHp = Math.min(...engine.alivePlayers.map((p) => p.hp));
        const maxCands = engine.alivePlayers.filter((p) => p.maxHp === maxHp);
        const minCands = engine.alivePlayers.filter((p) => p.hp === minHp);
        const maxId = await this._pickPlayer('吸血：选择体力上限最多的角色（其上限-1）', maxCands);
        if (!maxId) return;
        const minId = await this._pickPlayer('吸血：选择体力最少的角色（其上限+1并回复1点）', minCands);
        if (!minId) return;
        this._resolve({ type: 'skill', skill, maxId, minId });
        return;
      }
      if (skill === 'xiehuo') {
        const cards = await this._pickCards('邪火：弃两张牌', me.hand, 2, 2);
        if (!cards) return;
        const tgt = await this._pickPlayer('邪火：选择目标（弃其装备并置入古尔丹之手）', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cards, targetId: tgt });
        return;
      }
      if (skill === 'xintu') {
        const banked = (me.pile || []).filter((c) => c.suit === 'spade' || c.suit === 'club').length;
        const ok = await chooseDialog(`信徒（限定技，整局一次）：收回武将牌上 ${banked} 张黑色牌到手牌，随后失去所有技能。确定？`, [{ value: true, label: '发动' }, { value: false, label: '取消' }]);
        if (ok) this._resolve({ type: 'skill', skill });
        return;
      }
      // 审判烈焰：选至多3名角色
      if (skill === 'shenpan') {
        const all = engine.alivePlayers.filter((p) => p.id !== this.viewerId);
        const picked = await this._pickPlayers('审判烈焰：选择至多3名角色', all, 1, Math.min(3, all.length));
        if (picked?.length) this._resolve({ type: 'skill', skill, targetIds: picked });
        return;
      }
      // 冰封：选至多3名角色
      if (skill === 'bingfeng') {
        const all = engine.alivePlayers.filter((p) => p.id !== this.viewerId);
        const picked = await this._pickPlayers('冰封：选择至多3名角色', all, 1, Math.min(3, all.length));
        if (picked?.length) this._resolve({ type: 'skill', skill, targetIds: picked });
        return;
      }
      // 暗影箭雨：明置至多3名角色（不选则由技能自动挑选手牌最多者）
      if (skill === 'anyingjian') {
        const all = engine.alivePlayers.filter((p) => p.id !== this.viewerId && p.hand.length);
        if (!all.length) { this._resolve({ type: 'skill', skill, targetIds: [] }); return; }
        const picked = await this._pickPlayers('暗影箭雨：选择至多3名要明置手牌的角色', all, 0, Math.min(3, all.length));
        if (picked) this._resolve({ type: 'skill', skill, targetIds: picked });
        return;
      }
      // 利箭：选目标 + 弃任意张手牌
      if (skill === 'lijian2') {
        const tgt = await this._pickPlayer('利箭：选择目标（其弃1张“标”，随后你按“标”点数的倍数弃牌）', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, targetId: tgt }); // 弃牌凑“标”倍数在技能内交互
        return;
      }
      // 单目标主动技
      if (['xuerou', 'liexin', 'xuanzhuan', 'hanshuang', 'dihou', 'huoyan', 'duwu'].includes(skill)) {
        const titleMap = {
          bingfeng: '冰封：选择要冻结手牌的角色',
          xuerou: '血肉成灰：选择目标（其下回合少摸1张）',
          liexin: '裂心：选择交换手牌的角色（回合结束换回）', xuanzhuan: '旋转：选择要观看手牌并交换一张牌的角色', hanshuang: '寒霜：选择目标（其下回合手牌上限-2）',
          dihou: '低吼：选择目标（获取其失去的牌）', huoyan: '火眼：选择目标（弃5张【杀】造10点强制伤害）',
          duwu: '毒雾：选择目标（其使用牌前须自行选择弃更大点数的牌）',
        };
        const tgt = await this._pickPlayer(titleMap[skill], engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, targetId: tgt });
        return;
      }
      if (skill === 'daidu') {
        const cards = await this._pickCards('歹毒：弃3张牌', me.hand.filter((c) => !c.frozen), 3, 3);
        if (!cards) return;
        const tgt = await this._pickPlayer('歹毒：选择交换体力上限/装备/奥秘的角色', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cards, targetId: tgt });
        return;
      }
      if (skill === 'fanzhao') {
        const pile = (engine.discard || []).filter((c) => !c.tessUsed); // 排除自己使用过的牌
        if (!pile.length) { toast('没有可获得的牌'); return; }
        const cards = await this._pickCards('翻找：从弃牌堆选择一张非你使用过的牌', [...pile].reverse(), 1, 1);
        if (cards) this._resolve({ type: 'skill', skill, cardId: cards[0] });
        return;
      }
      if (skill === 'xuwu') {
        const cards = await this._pickCards('虚无：弃一张牌（对方将弃同花色的牌）', me.hand, 1, 1);
        if (!cards) return;
        const tgt = await this._pickPlayer('虚无：选择目标', engine.alivePlayers.filter((p) => p.id !== this.viewerId));
        if (!tgt) return;
        this._resolve({ type: 'skill', skill, cardId: cards[0], targetId: tgt });
        return;
      }
      if (skill === 'lianyu') {
        const ok = await chooseDialog('炼狱（限定技，整局一次）：确定发动？', [{ value: true, label: '发动' }, { value: false, label: '取消' }]);
        if (ok) this._resolve({ type: 'skill', skill });
        return;
      }
      if (skill === 'tunshi') {
        const fromId = await this._pickPlayer('吞噬：拿走其一张手牌的角色', engine.alivePlayers.filter((p) => p.handCount > 0 || (p.hand && p.hand.length)));
        if (!fromId) return;
        const toId = await this._pickPlayer('吞噬：将该牌作为“盾”置于其武将牌的角色', engine.alivePlayers);
        if (!toId) return;
        this._resolve({ type: 'skill', skill, fromId, toId });
        return;
      }
    } catch (e) { console.error(e); }
  }

  // 弹层选牌 → Promise<ids[] | null>
  _pickCards(title, pool, min, max) {
    return new Promise((resolve) => {
      const sel = new Set();
      const body = el('div', { class: 'pick-cards' });
      const grid = el('div', { class: 'pick-grid' });
      const renderGrid = () => {
        clear(grid);
        pool.forEach((c) => grid.appendChild(this._cardFace(c, {
          clickable: true, selected: sel.has(c.id),
          onClick: () => { sel.has(c.id) ? sel.delete(c.id) : (sel.size < max && sel.add(c.id)); renderGrid(); updateBtn(); },
        })));
      };
      body.appendChild(grid);
      let ov, confirmBtn;
      const updateBtn = () => { confirmBtn.classList.toggle('disabled', sel.size < min || sel.size > max); confirmBtn.textContent = `确定 (${sel.size})`; };
      ov = openOverlay({
        title, bodyNode: body, className: 'wide',
        buttons: [
          { label: '确定', primary: true, onClick: () => { if (sel.size >= min && sel.size <= max) { ov.close(); resolve([...sel]); } } },
          { label: '取消', onClick: () => { ov.close(); resolve(null); } },
        ],
      });
      confirmBtn = ov.panel.querySelector('.btn-primary');
      renderGrid(); updateBtn();
    });
  }

  _pickPlayer(title, players) {
    return new Promise((resolve) => {
      if (!players.length) { toast('无合法目标'); resolve(null); return; }
      const body = el('div', { class: 'pick-players' });
      let ov;
      players.forEach((p) => body.appendChild(el('button', {
        class: 'btn pick-player-btn', text: `${p.name}（${p.general?.name || '?'}） ${'♥'.repeat(p.hp)}`,
        onclick: () => { ov.close(); resolve(p.id); },
      })));
      ov = openOverlay({ title, bodyNode: body, buttons: [{ label: '取消', onClick: () => { ov.close(); resolve(null); } }] });
    });
  }

  _pickPlayers(title, players, min, max) {
    return new Promise((resolve) => {
      if (!players.length) { toast('无合法目标'); resolve(null); return; }
      const selected = new Set();
      const body = el('div', { class: 'multi-player-body' });
      const hint = el('div', { class: 'gx-hint', text: `请选择 ${min === max ? min : `${min}～${max}`} 名角色。` });
      const grid = el('div', { class: 'multi-player-grid' });
      const summary = el('div', { class: 'gx-summary' });
      let ov, confirmBtn;
      const valid = () => selected.size >= min && selected.size <= max;
      const draw = () => {
        clear(grid);
        players.forEach((p) => {
          const active = selected.has(p.id);
          grid.appendChild(el('button', {
            class: `btn pick-player-btn multi-player-option ${active ? 'selected' : ''}`,
            onclick: () => {
              if (active) selected.delete(p.id);
              else if (selected.size < max) selected.add(p.id);
              draw();
            },
          }, [
            el('span', { class: 'mp-check', text: active ? '✓' : '' }),
            el('span', { class: 'mp-name', text: p.name }),
            el('span', { class: 'mp-meta', text: `${p.general?.name || p.general || '?'} · ${p.hp}/${p.maxHp || p.hp}体力` }),
          ]));
        });
        summary.textContent = `已选 ${selected.size}/${max} 名角色`;
        if (confirmBtn) {
          confirmBtn.textContent = `确认目标 · ${selected.size}`;
          confirmBtn.classList.toggle('disabled', !valid());
        }
      };
      body.appendChild(hint); body.appendChild(grid); body.appendChild(summary);
      ov = openOverlay({
        title, bodyNode: body, className: 'wide arrange-overlay',
        buttons: [
          { label: '确认目标', primary: true, onClick: () => { if (valid()) { ov.close(); resolve([...selected]); } } },
          { label: '取消', onClick: () => { ov.close(); resolve(null); } },
        ],
      });
      confirmBtn = ov.panel.querySelector('.btn-primary');
      draw();
    });
  }

  // ============ 决策解析 ============
  _resolve(value) {
    const p = this.pending;
    this.pending = null;
    this.activeCard = null; this.activeOption = null; this.targets = []; this.zhangba = null;
    this.render();
    if (p) p.resolve(value);
  }

  // 由 HumanAgent 调用：等待玩家给出某个决策
  await(req) {
    return new Promise((resolve) => {
      this.pending = { req, resolve };
      this.discardSel = new Set();
      this.zhangba = null;
      this.render();
    });
  }
}

// ====================== 人类玩家 Agent ======================
export class HumanAgent {
  constructor(ui) { this.ui = ui; this.kind = 'human'; }

  async respond(req) {
    const ui = this.ui;
    switch (req.type) {
      case REQ.CHOOSE_OPTION: {
        if (req.kind === 'general') {
          const gid = await chooseGeneralDialog(req.options.map((o) => o.general));
          return { value: gid };
        }
        const value = await chooseDialog(req.title || '请选择', req.options.map((o) => ({
          value: o.value, card: o.card, player: o.player,
          label: o.label || o.general?.name || (o.card ? `${o.card.name}` : String(o.value)),
        })));
        return { value };
      }
      case REQ.CHOOSE_CARD: return await this._chooseCard(req);
      case REQ.GUANXING: return await this._guanxing(req);
      case REQ.SELECT_PLAYERS: {
        const ids = await ui._pickPlayers(req.title || '选择角色', req.players || [], req.minCount || 0, req.maxCount || req.players?.length || 0);
        return ids ? { ids } : null;
      }
      case REQ.SWAP_CARDS: return await this._swapCards(req);
      case REQ.ASK_SKILL:
        if (req.auto) {
          const ok = await chooseDialog(req.title, [{ value: true, label: '发动' }, { value: false, label: '放弃' }]);
          return { ok };
        }
        return await ui.await(req); // 鬼才：点手牌
      default:
        // PLAY_TURN / ASK_* / DISCARD_CARDS 都走牌桌交互
        return await ui.await(req);
    }
  }

  async _chooseCard(req) {
    const target = this.ui.engine.playerById(req.fromPlayer);
    return new Promise((resolve) => {
      const body = el('div', { class: 'choose-card-body' });
      let ov;
      (req.visibleCards || []).forEach((v) => {
        const n = miniCardNode(v.card, () => { ov.close(); resolve({ card: v.card.id }); });
        n.appendChild(el('span', { class: 'cc-zone', text: v.zone }));
        body.appendChild(n);
      });
      if (req.handChoice && req.handChoice.handCount > 0) {
        for (let i = 0; i < req.handChoice.handCount; i++) {
          body.appendChild(el('div', { class: 'card-back small', onclick: () => { ov.close(); resolve({ card: 'hand' }); } }, [el('span', { text: '手牌' })]));
        }
      }
      ov = openOverlay({ title: req.title || '选择一张牌', bodyNode: body, className: 'wide' });
    });
  }

  async _guanxing(req) {
    return new Promise((resolve) => {
      const cards = req.cards.slice();
      const discardMode = req.mode === 'bottom_discard';
      const selectMode = req.mode === 'select_cards';
      const minCount = selectMode ? Math.max(0, Number(req.minCount) || 0) : 0;
      const requestedMax = Number(req.maxCount);
      const maxCount = selectMode && Number.isFinite(requestedMax) ? Math.max(minCount, Math.min(cards.length, requestedMax)) : cards.length;
      const minSum = selectMode ? Math.max(0, Number(req.minSum) || 0) : 0;
      const multipleOf = selectMode && Number(req.multipleOf) > 0 ? Number(req.multipleOf) : null;
      const distinctSuits = selectMode && !!req.distinctSuits;
      const topOrder = discardMode ? cards.map((c) => c.id) : [];
      const restKey = discardMode ? 'discard' : 'bottom';
      const body = el('div', { class: 'guanxing-body' });
      const rules = [];
      if (selectMode) {
        if (minCount === maxCount) rules.push(`选择 ${minCount} 张`);
        else if (minCount > 0) rules.push(`选择 ${minCount}～${maxCount} 张`);
        else rules.push(`最多选择 ${maxCount} 张`);
        if (minSum > 0) rules.push(`点数和至少 ${minSum}`);
        if (multipleOf) rules.push(`点数和为 ${multipleOf} 的倍数`);
        if (distinctSuits) rules.push('花色互不相同');
      }
      const hint = el('div', {
        class: 'gx-hint',
        text: req.hint || (selectMode
          ? `点击“${req.availableLabel || '可选手牌'}”中的牌加入选择；再次点击可移回。${rules.join('，')}。`
          : discardMode
            ? '点击上方牌面将其移入弃牌堆；再次点击可移回。牌堆顶按从左到右的顺序摸取。'
            : '点击下方牌面可按顺序置于牌堆顶；再次点击可移回牌堆底。'),
      });
      const zones = el('div', { class: 'gx-zones' });
      const topZone = el('div', { class: 'gx-zone gx-top' });
      const restZone = el('div', { class: `gx-zone ${discardMode ? 'gx-discard' : 'gx-bottom'}` });
      const summary = el('div', { class: 'gx-summary' });
      let ov, confirmBtn;
      const restCards = () => cards.filter((c) => !topOrder.includes(c.id));
      const selectedCards = () => topOrder.map((id) => cards.find((c) => c.id === id)).filter(Boolean);
      const selectedSum = () => selectedCards().reduce((sum, c) => sum + (c.number || 0), 0);
      const selectionValid = () => {
        const selected = selectedCards();
        const sum = selected.reduce((n, c) => n + (c.number || 0), 0);
        return selected.length >= minCount && selected.length <= maxCount
          && sum >= minSum
          && (!multipleOf || sum % multipleOf === 0)
          && (!distinctSuits || new Set(selected.map((c) => c.suit)).size === selected.length);
      };
      const zoneHead = (label, count) => el('div', { class: 'gx-zone-head' }, [
        el('span', { class: 'gx-label', text: label }),
        el('span', { class: 'gx-count', text: count }),
      ]);
      const cardNode = (card, onClick) => {
        const node = miniCardNode(card, onClick);
        node.classList.add('gx-card');
        return node;
      };
      const draw = () => {
        clear(topZone); clear(restZone);
        const sum = selectedSum();
        const selectedHead = req.selectedLabel || '已选手牌';
        topZone.appendChild(zoneHead(selectMode ? `${selectedHead} · 点数和 ${sum}` : '牌堆顶 · 左侧先摸', topOrder.length));
        topOrder.forEach((id) => {
          const c = cards.find((x) => x.id === id);
          if (!c) return;
          topZone.appendChild(cardNode(c, () => { const i = topOrder.indexOf(id); topOrder.splice(i, 1); draw(); }));
        });
        if (!topOrder.length) topZone.appendChild(el('div', { class: 'gx-empty', text: selectMode ? '尚未选择手牌' : '没有牌置于牌堆顶' }));

        const rest = restCards();
        restZone.appendChild(zoneHead(selectMode ? (req.availableLabel || '可选手牌') : discardMode ? '弃牌堆' : '牌堆底', rest.length));
        rest.forEach((c) => {
          restZone.appendChild(cardNode(c, () => { if (!selectMode || topOrder.length < maxCount) { topOrder.push(c.id); draw(); } }));
        });
        if (!rest.length) restZone.appendChild(el('div', {
          class: 'gx-empty',
          text: selectMode ? '没有更多可选手牌' : discardMode ? '没有牌会被弃置' : '没有牌置于牌堆底',
        }));

        summary.textContent = selectMode
          ? `已选 ${topOrder.length} 张 · 点数和 ${sum} · ${selectionValid() ? '可以确认' : rules.join(' · ')}`
          : discardMode
            ? `分配结果：${topOrder.length} 张置顶 · ${rest.length} 张弃置`
            : `分配结果：${topOrder.length} 张置顶 · ${rest.length} 张置底`;
        if (confirmBtn) {
          confirmBtn.textContent = selectMode ? `${req.confirmLabel || '确认选择'} · ${topOrder.length} 张` : `确认分配 · ${topOrder.length}/${rest.length}`;
          confirmBtn.classList.toggle('disabled', selectMode && !selectionValid());
        }
      };
      const buttons = [{
        label: selectMode ? (req.confirmLabel || '确认选择') : '确认分配',
        primary: true,
        onClick: () => {
          if (selectMode) {
            if (!selectionValid()) return;
            ov.close();
            resolve({ selected: [...topOrder] });
            return;
          }
          const rest = restCards().map((c) => c.id);
          ov.close();
          resolve({ top: [...topOrder], [restKey]: rest });
        },
      }];
      if (selectMode && req.cancelLabel) buttons.push({ label: req.cancelLabel, onClick: () => { ov.close(); resolve(null); } });
      body.appendChild(hint);
      zones.appendChild(topZone); zones.appendChild(restZone);
      body.appendChild(zones); body.appendChild(summary);
      ov = openOverlay({
        title: req.title || '观星', bodyNode: body, className: 'wide arrange-overlay',
        buttons,
      });
      confirmBtn = ov.panel.querySelector('.btn-primary');
      draw();
    });
  }

  async _swapCards(req) {
    return new Promise((resolve) => {
      const leftCards = req.leftCards || [];
      const ownRightCards = req.rightCards || [];
      let leftId = null;
      let rightId = null;
      const body = el('div', { class: 'guanxing-body swap-cards-body' });
      const hint = el('div', { class: 'gx-hint', text: req.hint || '左右各选择一张牌后确认交换；右侧也可选择刚取得的牌并原样交还。' });
      const zones = el('div', { class: 'gx-zones' });
      const leftZone = el('div', { class: 'gx-zone gx-top' });
      const rightZone = el('div', { class: 'gx-zone gx-bottom' });
      const summary = el('div', { class: 'gx-summary' });
      let ov, confirmBtn;
      const valid = () => !!leftId && !!rightId;
      const head = (label) => el('div', { class: 'gx-zone-head' }, [el('span', { class: 'gx-label', text: label })]);
      const nodeFor = (card, selected, onClick, zone) => {
        const node = miniCardNode(card, onClick);
        node.classList.add('gx-card');
        if (selected) node.classList.add('selected');
        if (zone) node.appendChild(el('span', { class: 'cc-zone', text: zone }));
        return node;
      };
      const draw = () => {
        clear(leftZone); clear(rightZone);
        leftZone.appendChild(head(req.leftLabel || '选择获得的牌'));
        leftCards.forEach((c) => leftZone.appendChild(nodeFor(c, c.id === leftId, () => {
          leftId = c.id;
          if (rightId && !ownRightCards.some((x) => x.id === rightId) && rightId !== leftId) rightId = null;
          draw();
        })));
        const selectedLeft = leftCards.find((c) => c.id === leftId);
        const rightCards = [...ownRightCards, ...(selectedLeft && !ownRightCards.some((c) => c.id === selectedLeft.id) ? [selectedLeft] : [])];
        rightZone.appendChild(head(req.rightLabel || '选择交出的牌'));
        rightCards.forEach((c) => rightZone.appendChild(nodeFor(c, c.id === rightId, () => { rightId = c.id; draw(); }, c.id === leftId ? '刚取得' : '自己的牌')));
        if (!leftCards.length) leftZone.appendChild(el('div', { class: 'gx-empty', text: '没有可获得的牌' }));
        if (!rightCards.length) rightZone.appendChild(el('div', { class: 'gx-empty', text: '请先选择左侧牌' }));
        summary.textContent = valid() ? '交换方案已就绪' : '请在左右两侧各选择一张牌';
        if (confirmBtn) confirmBtn.classList.toggle('disabled', !valid());
      };
      body.appendChild(hint); zones.appendChild(leftZone); zones.appendChild(rightZone); body.appendChild(zones); body.appendChild(summary);
      ov = openOverlay({
        title: req.title || '交换手牌', bodyNode: body, className: 'wide arrange-overlay',
        buttons: [{ label: '确认交换', primary: true, onClick: () => { if (valid()) { ov.close(); resolve({ left: leftId, right: rightId }); } } }],
      });
      confirmBtn = ov.panel.querySelector('.btn-primary');
      draw();
    });
  }
}
