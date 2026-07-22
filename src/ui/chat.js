// ====================== 房间内聊天 / 快捷喊话（联机） ======================
import { el, clear } from './dom.js';
import { topics, PROTOCOL_VERSION } from '../net/mqtt.js';

const QUICK = ['你好~', '请稍等', '快点啊', '打得漂亮！', '救救我！', '别针对我', '认输吗', '再来一局', '稳住能赢', 'GG'];
const STATUS_TEXT = { connect: '已连接', reconnect: '重连中…', offline: '已断开', 'host-offline': '房主离线' };

export class ChatBox {
  constructor(bus, code, me, context = {}) {
    this.bus = bus;
    this.me = me;
    this.T = topics(code);
    this.context = context;
    this.msgs = [];
    this.collapsed = window.innerWidth <= 640;
    this.status = 'connect';
    this.unread = 0;
    this.rate = new Map();
    this.lastSend = 0;
    this.node = el('div', { class: 'chat-box' });
    document.body.appendChild(this.node);
    this._build();
    this._unsub = bus.sub(this.T.chat, (m) => this._onMsg(m), { qos: 0 });
  }

  setName(name) { if (name) this.me.name = name; }
  setStatus(s) { this.status = s; this._refreshHeader(); }
  destroy() { this._unsub?.(); this._unsub = null; this.node?.remove(); }

  _build() {
    clear(this.node);
    this.header = el('div', { class: 'chat-head', onclick: () => { this.collapsed = !this.collapsed; this.unread = 0; this._build(); } }, [
      el('span', { class: `chat-dot ${this.status}` }),
      el('span', { class: 'chat-title', text: '聊天' }),
      el('span', { class: 'chat-status', text: STATUS_TEXT[this.status] || '' }),
      el('span', { class: 'chat-toggle', text: this.collapsed ? (this.unread ? `▴ ${this.unread}` : '▴') : '▾' }),
    ]);
    this.node.appendChild(this.header);
    if (this.collapsed) { this.node.classList.add('collapsed'); return; }
    this.node.classList.remove('collapsed');

    this.msgEl = el('div', { class: 'chat-msgs' });
    this.node.appendChild(this.msgEl);
    this._renderMsgs();

    const quick = el('div', { class: 'chat-quick' });
    QUICK.forEach((q) => quick.appendChild(el('button', { class: 'chat-q', text: q, onclick: () => this.send(q) })));
    this.node.appendChild(quick);

    const input = el('input', { class: 'chat-input', placeholder: '说点什么…', maxlength: '60',
      onkeydown: (e) => { if (e.key === 'Enter') { this.send(input.value); input.value = ''; } } });
    const sendBtn = el('button', { class: 'btn btn-primary chat-send', text: '发送', onclick: () => { this.send(input.value); input.value = ''; } });
    this.node.appendChild(el('div', { class: 'chat-input-row' }, [input, sendBtn]));
  }

  _refreshHeader() {
    if (!this.header) return;
    const dot = this.header.querySelector('.chat-dot');
    if (dot) dot.className = `chat-dot ${this.status}`;
    const st = this.header.querySelector('.chat-status');
    if (st) st.textContent = STATUS_TEXT[this.status] || '';
  }

  _onMsg(value) {
    if (!value || value.v !== PROTOCOL_VERSION || value.roomEpoch !== this.context.getRoomEpoch?.()
      || typeof value.from !== 'string' || typeof value.text !== 'string' || !this.context.isMember?.(value.from)) return;
    const text = value.text.trim().slice(0, 60);
    if (!text) return;
    const now = Date.now();
    const recent = (this.rate.get(value.from) || []).filter((ts) => now - ts < 4000);
    if (recent.length >= 6) return;
    recent.push(now);
    this.rate.set(value.from, recent);
    const msg = {
      from: value.from.slice(0, 40),
      name: (typeof value.name === 'string' ? value.name.trim() : '').slice(0, 16) || '玩家',
      text,
    };
    this.msgs.push(msg);
    if (this.msgs.length > 60) this.msgs.shift();
    if (this.collapsed) { this.unread++; this._build(); }
    else this._renderMsgs();
  }

  _renderMsgs() {
    if (!this.msgEl) return;
    clear(this.msgEl);
    this.msgs.forEach((m) => {
      const mine = m.from === this.me.id;
      this.msgEl.appendChild(el('div', { class: `chat-line ${mine ? 'mine' : ''}` }, [
        el('span', { class: 'chat-name', text: (m.name || '玩家') + '：' }),
        el('span', { class: 'chat-text', text: m.text }),
      ]));
    });
    this.msgEl.scrollTop = this.msgEl.scrollHeight;
  }

  send(value) {
    const text = String(value || '').trim().slice(0, 60);
    const now = Date.now();
    if (!text || now - this.lastSend < 350) return;
    this.lastSend = now;
    this.bus.pub(this.T.chat, {
      v: PROTOCOL_VERSION, roomEpoch: this.context.getRoomEpoch?.(),
      from: this.me.id, name: (this.me.name || '玩家').slice(0, 16), text,
    }, { qos: 0 });
  }
}