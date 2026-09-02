// api/stats.js
// RenamerX 使用统计（密码保护）→ /api/stats?pw=你的密码
//
// 环境变量（Vercel → Settings → Environment Variables）：
//   STATS_PASSWORD  必填，统计页访问密码
//
// 页面展示：累计重命名数、今日访客（IP 去重）、今日新增、来源城市 Top10、最近 50 次改名记录。
// 隐私：只存 IP 的哈希前 8 位，不落明文 IP。

import { getCount, timeKeys, clientIp, hashIp, redis } from './_lib.js';

export const config = { runtime: 'edge' };

const MAX_TRIES = 10;        // 单 IP 每小时最多试 10 次密码
const LOCK_TTL = 3600;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function html(body, title = 'RenamerX 统计') {
  const CSS = `
    :root{--bg:#f6f7f9;--card:#fff;--text:#1a1a1a;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;}
    *{box-sizing:border-box}
    body{margin:0;padding:24px;background:var(--bg);color:var(--text);
      font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
    .wrap{max-width:980px;margin:0 auto}
    h1{font-size:20px;margin:0 0 16px}
    h2{font-size:15px;margin:24px 0 10px}
    .cards{display:flex;gap:12px;flex-wrap:wrap}
    .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:160px;flex:1}
    .card .k{font-size:12px;color:var(--muted)}
    .card .v{font-size:26px;font-weight:700;margin-top:4px}
    table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
      border-radius:10px;overflow:hidden;font-size:13px}
    th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}
    th{background:#fafbfc;color:var(--muted);font-weight:600}
    tr:last-child td{border-bottom:none}
    .muted{color:var(--muted)}
    .login{max-width:340px;margin:80px auto;background:var(--card);border:1px solid var(--line);
      border-radius:10px;padding:24px}
    input{padding:8px 10px;border:1px solid var(--line);border-radius:6px;font-size:14px;width:100%}
    button{margin-top:12px;padding:8px 14px;background:var(--accent);color:#fff;border:0;
      border-radius:6px;font-size:14px;cursor:pointer;width:100%}
  `;
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new Response(page, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function parseEntry(e) {
  if (e && typeof e === 'object') return e;
  if (typeof e === 'string') { try { return JSON.parse(e); } catch (_) { return null; } }
  return null;
}

export default async function handler(req) {
  const pw = new URL(req.url).searchParams.get('pw') || '';
  const expected = process.env.STATS_PASSWORD || '';

  if (!expected) {
    return html(`<div class="login"><h1>未启用</h1>
      <p class="muted">请先在 Vercel 项目 → Settings → Environment Variables 添加 <b>STATS_PASSWORD</b>。</p></div>`);
  }
  if (pw !== expected) {
    // 防暴力破解：按 IP 统计失败次数，一小时内超过 10 次就锁住
    const r = redis();
    const ipHash = await hashIp(clientIp(req));
    const failKey = `pwfail:${ipHash}:${timeKeys().hour}`;
    const tries = Number((await r.get(failKey).catch(() => 0))) || 0;
    if (pw) {                                  // 只在真的提交了密码时才计数
      await r.incrby(failKey, 1).catch(() => {});
      await r.expire(failKey, LOCK_TTL).catch(() => {});
    }
    if (tries >= MAX_TRIES) {
      return html(`<div class="login"><h1>尝试次数过多</h1>
        <p class="muted">该网络一小时内密码错误已达 ${MAX_TRIES} 次，请稍后再试。</p></div>`);
    }
    const tip = pw ? '<p class="muted">密码错误，请重试。</p>' : '';
    return html(`<div class="login"><h1>RenamerX 使用统计</h1>
      <form method="get"><input type="password" name="pw" placeholder="访问密码" autofocus>
      <button type="submit">查看</button></form>${tip}</div>`);
  }

  const { day, isoDay } = timeKeys();
  const r = redis();
  const [count, uv, rawLogs] = await Promise.all([
    getCount(),
    r.scard(`v:${day}`).catch(() => 0),
    r.lrange('logs', 0, 499).catch(() => []),
  ]);

  const items = (rawLogs || []).map(parseEntry).filter(Boolean);
  const todayAdd = items
    .filter(e => String(e.t || '').startsWith(isoDay))
    .reduce((a, e) => a + (Number(e.n) || 0), 0);

  const cities = {};
  for (const e of items) {
    const k = [e.country, e.city].filter(Boolean).join(' · ') || '未知';
    cities[k] = (cities[k] || 0) + (Number(e.n) || 0);
  }
  const cityTop = Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const browserOf = (ua) => /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '其他';

  const cityRows = cityTop.length
    ? cityTop.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">暂无数据</td></tr>';

  const rows = items.length
    ? items.slice(0, 50).map(e => `<tr>
        <td>${esc(String(e.t || '').replace('T', ' ').slice(0, 19))}</td>
        <td>${esc([e.country, e.city].filter(Boolean).join(' · ') || '—')}</td>
        <td>${esc(browserOf(String(e.ua || '')))}</td>
        <td>${esc(e.n)}</td>
        <td class="muted">${esc(e.ip || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="muted">暂无数据</td></tr>';

  return html(`
    <h1>RenamerX 使用统计</h1>
    <div class="cards">
      <div class="card"><div class="k">累计重命名</div><div class="v">${esc(count)}</div></div>
      <div class="card"><div class="k">今日访客（IP 去重）</div><div class="v">${esc(uv || 0)}</div></div>
      <div class="card"><div class="k">今日新增</div><div class="v">${esc(todayAdd)}</div></div>
      <div class="card"><div class="k">近期记录</div><div class="v">${esc(items.length)}</div></div>
    </div>

    <h2>来源分布 Top 10</h2>
    <table><thead><tr><th>国家 / 城市</th><th>文件数</th></tr></thead><tbody>${cityRows}</tbody></table>

    <h2>最近 50 次改名</h2>
    <table><thead><tr><th>时间（UTC）</th><th>地区</th><th>浏览器</th><th>数量</th><th>访客</th></tr></thead><tbody>${rows}</tbody></table>

    <p class="muted" style="margin-top:16px">IP 仅保存哈希前 8 位用于区分访客，不存储明文 IP。</p>
  `);
}
