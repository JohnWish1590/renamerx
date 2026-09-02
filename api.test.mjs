// api.test.mjs — 计数后端测试（node api.test.mjs）
// 用内存版 Redis 注入，真跑 api/count.js 的 handler，验证：
//   正常上报 / 单次硬上限 / 小时限流 / 每日限流 / 来源白名单 / 日志与访客记录

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// 内存版 Redis（只实现本项目用到的几条命令）
// ---------------------------------------------------------------------------
class MemRedis {
  constructor() { this.data = new Map(); this.exp = new Map(); }
  _gc(k) {
    const t = this.exp.get(k);
    if (t && t < Date.now()) { this.data.delete(k); this.exp.delete(k); }
  }
  async get(k) { this._gc(k); return this.data.has(k) ? this.data.get(k) : null; }
  async set(k, v) { this.data.set(k, v); return 'OK'; }
  async incrby(k, n) { this._gc(k); const v = (Number(this.data.get(k)) || 0) + n; this.data.set(k, v); return v; }
  async expire(k, s) { this.exp.set(k, Date.now() + s * 1000); return 1; }
  async lpush(k, v) { const a = (await this.get(k)) || []; a.unshift(v); this.data.set(k, a); return a.length; }
  async ltrim(k, s, e) { const a = (await this.get(k)) || []; this.data.set(k, a.slice(s, e + 1)); return 'OK'; }
  async lrange(k, s, e) {                       // 支持 Redis 的负索引（-1 = 最后一个）
    const a = (await this.get(k)) || [];
    const start = s < 0 ? Math.max(0, a.length + s) : s;
    const end = e < 0 ? a.length + e + 1 : e + 1;
    return a.slice(start, end);
  }
  async sadd(k, m) { const a = (await this.get(k)) || []; if (!a.includes(m)) a.push(m); this.data.set(k, a); return 1; }
  async scard(k) { const a = (await this.get(k)) || []; return a.length; }
}

process.env.IP_SALT ||= 'test-salt';
process.env.KV_REST_API_URL ||= 'https://example.upstash.io';
process.env.KV_REST_API_TOKEN ||= 'fake-token';

const lib = await import('./api/_lib.js');
const { default: handler } = await import('./api/count.js');

let mem;
function reset() { mem = new MemRedis(); lib.__setRedis(mem); }

const OK_ORIGIN = 'https://johnwish1590.github.io';
const API_HOST = 'api.example.com';
// 注意：host 是禁改头，undici 会忽略我们传的 host、改用 URL 里的域名，
// 所以同源测试要用「URL 域名 = Origin 域名」来模拟，而不是靠 header。
function req(method, body, origin = OK_ORIGIN, urlHost = API_HOST) {
  return new Request(`https://${urlHost}/api/count`, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
      'user-agent': 'Mozilla/5.0 Chrome/126.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function call(method, body, origin, urlHost) {
  const res = await handler(req(method, body, origin, urlHost));
  return { status: res.status, body: await res.json() };
}

let passed = 0;
async function test(name, fn) {
  reset();
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

console.log('api/count.js 计数后端');

await test('GET：首次读取以真实历史值 123 初始化', async () => {
  const r = await call('GET');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 123);
});

await test('POST +5：累加并返回新总数 128', async () => {
  const r = await call('POST', { n: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.added, 5);
  assert.equal(r.body.count, 128);
});

await test('单次上报硬上限：传 99999 只按 500 计', async () => {
  const r = await call('POST', { n: 99999 });
  assert.equal(r.body.added, 500);
  assert.equal(r.body.count, 623);
});

await test('非法 n（负数 / 非数字）返回 400', async () => {
  assert.equal((await call('POST', { n: -3 })).status, 400);
  assert.equal((await call('POST', { n: 'abc' })).status, 400);
});

await test('单 IP 小时限流：已用 495 再报 10 → 429 且不累加', async () => {
  const iph = await lib.hashIp('203.0.113.7');
  const { hour } = lib.timeKeys();
  await mem.set(`rl:h:${iph}:${hour}`, 495);
  const r = await call('POST', { n: 10 });
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'hourly_limit');
  assert.equal(r.body.count, 123, '计数应纹丝不动');
  assert.equal(await mem.get('count') === null || Number(await mem.get('count')) === 123, true);
});

await test('单 IP 每日限流：当日已用 1995 再报 10 → 429', async () => {
  const iph = await lib.hashIp('203.0.113.7');
  const { day, hour } = lib.timeKeys();
  await mem.set(`rl:h:${iph}:${hour}`, 0);
  await mem.set(`rl:d:${iph}:${day}`, 1995);
  const r = await call('POST', { n: 10 });
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'daily_limit');
  assert.equal(r.body.count, 123);
});

await test('未授权来源（别人的网页 / 脚本带 Origin）→ 403 且不读计数', async () => {
  const r = await call('GET', undefined, 'https://evil.example');
  assert.equal(r.status, 403);
  assert.equal(r.body.reason, 'origin_not_allowed');
  assert.equal(r.body.count, undefined);
});

await test('授权来源 johnwish1590.github.io → 200', async () => {
  const r = await call('GET', undefined, OK_ORIGIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 123);
});

await test('同源（前端也部署在该 Vercel 域名）→ 放行', async () => {
  const r = await call('GET', undefined, 'https://renamerx.vercel.app', 'renamerx.vercel.app');
  assert.equal(r.status, 200, '同源应放行');
});

await test('上报后写入使用日志（含地区 / 浏览器 / 数量）与当日访客集合', async () => {
  await call('POST', { n: 4 });
  const logs = await mem.lrange('logs', 0, -1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].n, 4);
  assert.equal(logs[0].ua, 'Mozilla/5.0 Chrome/126.0');
  assert.equal(String(logs[0].ip).length, 8, 'IP 只留哈希前 8 位');
  assert.notEqual(logs[0].ip, '203.0.113.7', '不得出现明文 IP');

  const { day } = lib.timeKeys();
  assert.equal(await mem.scard(`v:${day}`), 1);
});

await test('不同 IP 的用量互不干扰', async () => {
  const iph = await lib.hashIp('203.0.113.7');
  const { hour } = lib.timeKeys();
  await mem.set(`rl:h:${iph}:${hour}`, 500);   // 让这个 IP 触顶
  const r = await handler(new Request('https://api.example.com/api/count', {
    method: 'POST',
    headers: { origin: OK_ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.22' },
    body: JSON.stringify({ n: 2 }),
  }));
  const body = await r.json();
  assert.equal(r.status, 200, '另一个 IP 不受影响');
  assert.equal(body.count, 125);
});

console.log(`\n通过 ${passed} 项测试` + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
