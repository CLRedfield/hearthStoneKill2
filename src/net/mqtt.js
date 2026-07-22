// ====================== 公共 MQTT 传输层（免费 / 国内可用 / 免注册） ======================
// 默认使用 EMQX 免费公共 broker（国内可访问）。也可在界面自定义为其它公共 broker。
import mqtt from 'mqtt';

export const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
// 备选公共 broker（如默认连接失败可在界面更换）：
//   wss://test.mosquitto.org:8081/mqtt
//   wss://broker.hivemq.com:8884/mqtt
export const BROKER_ALTERNATIVES = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const NS = 'sgskill3'; // 主题命名空间，避免与公共 broker 上其它应用冲突

export function getBroker() { return localStorage.getItem('mqtt_broker') || DEFAULT_BROKER; }
export function storeBroker(u) { localStorage.setItem('mqtt_broker', u); }

export function genRoomCode() {
  // 6 位，降低公共 broker 上的撞号概率
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export function genClientId() {
  let id = sessionStorage.getItem('sgs_cid');
  if (!id) { id = 'u' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('sgs_cid', id); }
  return id;
}

// 房间主题集合
export function topics(code) {
  const base = `${NS}/${code}`;
  return {
    lobby: `${base}/lobby`,           // 房间信息（retained，房主发布）
    join: `${base}/join`,             // 加入请求（玩家发布，房主订阅）
    move: `${base}/move`,             // 换座申请（非房主发布，房主订阅）
    act: `${base}/act`,               // 决策应答（玩家发布，房主订阅）
    fx: `${base}/fx`,                 // 动画特效广播（房主发布）
    chat: `${base}/chat`,             // 聊天 / 快捷喊话
    spec: `${base}/spec`,             // 观战者公共快照（房主发布）
    state: (pid) => `${base}/st/${pid}`, // 各玩家专属游戏快照
    req: (pid) => `${base}/rq/${pid}`,   // 各玩家专属决策请求
  };
}

export class MqttBus {
  constructor(broker) {
    this.broker = broker || getBroker();
    this.client = null;
    this.handlers = new Map();   // topic -> Set(fn)
    this.subscribed = new Set();
    this.statusCb = null;        // 连接状态回调
  }

  onStatus(fn) { this.statusCb = fn; }
  _status(s) { try { this.statusCb?.(s); } catch (e) {} }

  connect() {
    return new Promise((resolve, reject) => {
      let done = false;
      this.client = mqtt.connect(this.broker, {
        clientId: 'sgs_' + Math.random().toString(16).slice(2, 10),
        clean: true, connectTimeout: 9000, reconnectPeriod: 4000, keepalive: 30,
      });
      this.client.on('connect', () => { if (!done) { done = true; storeBroker(this.broker); resolve(); } else this._status('connect'); });
      this.client.on('reconnect', () => this._status('reconnect'));
      this.client.on('offline', () => this._status('offline'));
      this.client.on('close', () => { if (done) this._status('offline'); });
      this.client.on('error', (e) => { if (!done) { done = true; reject(e); } });
      this.client.on('message', (topic, payload) => this._onMessage(topic, payload));
      setTimeout(() => { if (!done) { done = true; reject(new Error('连接超时')); } }, 10000);
    });
  }

  _onMessage(topic, payload) {
    let data;
    try { data = JSON.parse(payload.toString()); } catch (e) { return; }
    const set = this.handlers.get(topic);
    if (set) set.forEach((fn) => { try { fn(data, topic); } catch (err) { console.error('[mqtt handler]', err); } });
  }

  sub(topic, fn, opts = {}) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic).add(fn);
    if (!this.subscribed.has(topic)) {
      this.subscribed.add(topic);
      this.client.subscribe(topic, { qos: opts.qos ?? 1 });
    }
    return () => this.handlers.get(topic)?.delete(fn);
  }

  pub(topic, data, opts = {}) {
    if (!this.client) return;
    this.client.publish(topic, JSON.stringify(data), { qos: opts.qos ?? 1, retain: !!opts.retain });
  }

  // 清除某 retained 主题
  clearRetained(topic) {
    if (!this.client) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      setTimeout(finish, 900);
      this.client.publish(topic, '', { qos: 1, retain: true }, finish);
    });
  }

  end() { try { this.client?.end(true); } catch (e) {} }
  get connected() { return !!this.client?.connected; }
}
