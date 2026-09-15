// One demand-driven canvas, bounded particles, independent visual random stream.
export class FxParticles {
  constructor(root) {
    this.root = root; this.items = []; this.frame = null; this.canvas = null;
    this.ctx = null; this.seed = (Date.now() ^ 0x9e3779b9) >>> 0;
    this.lastTime = 0; this.disposed = false;
  }
  random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  burst(point, color, count = 14, shape = 'spark') {
    if (this.disposed || !point || document.hidden) return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas'); this.canvas.className = 'fx-particles';
      this.canvas.setAttribute('aria-hidden', 'true'); this.root.prepend(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    }
    if (!this.ctx) return;
    if (!this.frame) {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.ceil(window.innerWidth * dpr);
      this.canvas.height = Math.ceil(window.innerHeight * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.lastTime = performance.now();
    }
    for (let i = 0; i < Math.min(count, 36); i++) {
      const a = this.random() * Math.PI * 2, speed = 45 + this.random() * 110;
      const life = .35 + this.random() * .5;
      this.items.push({ x: point.x, y: point.y, vx: Math.cos(a) * speed,
        vy: shape === 'heal' ? -50 - this.random() * 95 : Math.sin(a) * speed,
        life, total: life, size: 1.2 + this.random() * 2.5, color, shape });
    }
    this.items = this.items.slice(-160);
    if (!this.frame) this.frame = requestAnimationFrame((time) => this.tick(time));
  }
  tick(time) {
    this.frame = null;
    if (this.disposed || document.hidden) { this.clear(); return; }
    const dt = Math.min(.04, Math.max(0, (time - this.lastTime) / 1000)); this.lastTime = time;
    const ctx = this.ctx; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of this.items) {
      p.life -= dt; if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.shape === 'heal' ? -12 : 55) * dt;
      ctx.globalAlpha = Math.min(1, p.life / p.total * 1.8); ctx.fillStyle = p.color;
      if (p.shape === 'heal') {
        ctx.fillRect(p.x - p.size, p.y - .7, p.size * 2, 1.4);
        ctx.fillRect(p.x - .7, p.y - p.size, 1.4, p.size * 2);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * Math.max(.2, p.life / p.total), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; this.items = this.items.filter((p) => p.life > 0);
    if (this.items.length) this.frame = requestAnimationFrame((t) => this.tick(t));
    else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
  clear() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null; this.items = [];
    this.ctx?.clearRect(0, 0, this.canvas?.width || 0, this.canvas?.height || 0);
  }
  destroy() { this.disposed = true; this.clear(); this.canvas?.remove(); }
}
