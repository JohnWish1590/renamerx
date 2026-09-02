// api/count.js
// RenamerX 计数接口（Vercel Edge Function）
//
//   GET  /api/count         → { count: 当前总重命名数 }
//   POST /api/count {n}     → 累加 n 个文件，返回 { ok, count, added }
//                             若触发限流：429 + { ok:false, reason, limit, used, count }
//
// 关键点：接口同步返回真实计数，前端不需要「乐观显示 + 轮询回正」那套逻辑，
// 因此改名后数字立刻准确，刷新也不会回退。

import {
  clientIp,
  hashIp,
  getCount,
  bumpCount,
  json,
  corsHeaders,
  isOriginAllowed,
  SINGLE_MAX,
} from './_lib.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  // 用 URL 里的 host 而非 Host 请求头（更可靠：Edge 与 Node 测试里都能取到，
  // 且同源判断只关心「前端域名是否等于本 API 域名」）
  const host = (() => { try { return new URL(req.url).host; } catch (_) { return ''; } })();

  // CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // 来源不在白名单里（脚本 / 别人网页直接打）：直接拒绝，连计数都不读
  if (origin && !isOriginAllowed(origin, host)) {
    return json({ ok: false, reason: 'origin_not_allowed' }, 403, origin);
  }

  try {
    if (req.method === 'GET') {
      return json({ count: await getCount() }, 200, origin);
    }

    if (req.method === 'POST') {
      let n = 0;
      try {
        const body = await req.json();
        n = parseInt(body && body.n, 10);
      } catch (_) {
        return json({ ok: false, reason: 'bad_body' }, 400, origin);
      }

      if (!Number.isFinite(n) || n < 0) return json({ ok: false, reason: 'bad_n' }, 400, origin);
      if (n === 0) return json({ ok: true, count: await getCount(), added: 0 }, 200, origin);

      n = Math.min(n, SINGLE_MAX); // 单次硬上限，防止一次传天文数字

      const ip = clientIp(req);
      const ipHash = await hashIp(ip);
      const geo = req.geo || {}; // Vercel Edge 提供：city / country / region

      const result = await bumpCount(n, ipHash, {
        city: geo.city || '',
        country: geo.country || '',
        ua: req.headers.get('user-agent') || '',
      });

      if (!result.ok) return json(result, 429, origin); // 超限：丢弃，但把真值告诉前端
      return json(result, 200, origin);
    }

    return json({ ok: false, reason: 'method_not_allowed' }, 405, origin);
  } catch (e) {
    return json({ ok: false, reason: 'server_error', message: String((e && e.message) || e) }, 500, origin);
  }
}
