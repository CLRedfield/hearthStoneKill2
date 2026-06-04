// ====================== 房间内聊天 / 快捷喊话（联机） ======================
import { el, clear } from './dom.js';
import { topics } from '../net/mqtt.js';

const QUICK = ['你好~', '请稍等', '快点啊', '打得漂亮！', '救救我！', '别针对我', '认输吧', '再来一局', '稳住能赢', 'GG'];
const STATUS_TEXT = { connect: '已连接', reconnect: '重连中…', offline: '已断开' };

export class ChatBox {
  constructor(bus, code, me) {
    this.bus = bus; this.me = me; this.T = topics(code);
    this.msgs = []; this.collapsed = false; this.status = 'connect'; this.unread = 0;
    this.node = el('div', { class: 'chat-box' });
    document.body.appendChild(this.node);
    this._build();
    bus.sub(this.T.chat, (m) => this._onMsg(m), { qos: 0 });
  }

  setName(name) { if (name) this.me.name = name; }
  setStatus(s) { this.status = s; this._refreshHeader(); }

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

  _onMsg(m) {
    if (!m || !m.text) return;
    this.msgs.push(m);
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

  send(text) {
    text = (text || '').trim();
    if (!text) return;
    this.bus.pub(this.T.chat, { from: this.me.id, name: this.me.name || '玩家', text: text.slice(0, 60) }, { qos: 0 });
  }
}
