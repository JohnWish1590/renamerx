// api/_lib.js
// RenamerX 计数后端公共库（Vercel Edge Runtime）
//
// 设计要点：
//   1. 前端不再保存任何密钥 —— 凭据只存在于 Vercel 的环境变量里，源码里没有。
//   2. 按 IP 限流：单个 IP 每小时最多加 HOURLY_LIMIT、每天最多加 DAILY_LIMIT，超出直接丢弃。
//      这不能 100% 杜绝刷量（换 IP 仍可），但把「一次刷一万」变成「一个 IP 一天最多两千」，
//      成本陡增，且异常一眼可见。
//   3. 只存 IP 的哈希，不落明文 IP（隐私友好），够用于限流与访客去重。

import { Redis } from '@upstash/redis';

// —— Redis 连接 ——
// 注意：不要用 @vercel/kv！Vercel KV 产品已于 2024-12 日落，npm 包也已废弃。
// 现在统一走 Vercel Marketplace 的 Upstash Redis + @upstash/redis（REST 客户端，Edge 可用）。
// 兼容多组环境变量名：
//   - 新版 Upstash 集成：UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   - 老版 Vercel KV 集成：KV_REST_API_URL / KV_REST_API_TOKEN
//   - 新版 Marketplace 的通用 Storage 前缀：STORAGE_URL / STORAGE_TOKEN（前缀可自定义，若用默认则兼容）
// 装完集成 Vercel 会自动注入，不用手动抄；如果名字实在对不上，把变量名告诉我再扩列表。
let _redis = null;
export function redis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL
           || process.env.KV_REST_API_URL
           || process.env.STORAGE_URL
           || process.env.REDIS_REST_URL
           || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
             || process.env.KV_REST_API_TOKEN
             || process.env.STORAGE_TOKEN
             || process.env.REDIS_REST_TOKEN
             || '';
  if (!url || !token) {
    throw new Error('Redis 未配置：缺少 UPSTASH_REDIS_REST_URL / KV_REST_API_URL / STORAGE_URL 等');
  }
  _redis = new Redis({ url, token });
  return _redis;
}
// 仅供测试注入内存版 Redis
export function __setRedis(r) { _redis = r; }

// —— 限额 ——
export const HOURLY_LIMIT = 500;   // 单 IP 每小时上限
export const DAILY_LIMIT = 2000;   // 单 IP 每天上限
export const SINGLE_MAX = 500;     // 单次上报硬上限（防止一次传个天文数字）
export const LOG_KEEP = 2000;      // 日志最多保留条数
export const INITIAL_COUNT = 123;  // 真实历史累计（2026-09-02 核查后回填的真实值）

// 只允许自己的前端域名调用：就算别人拿到接口地址，浏览器同源策略也会挡下。
// 注意这挡不住 curl / 脚本直接打（那种由限流兜底），但能挡住「别人网页里嵌你的接口」。
const ALLOWED_ORIGINS = [
  'https://johnwish1590.github.io',   // 工具页（GitHub Pages）
  'https://renamerx.github.io',       // 短域名（重定向到上面，保险起见也放行）
  'http://localhost:5173',            // 本地 node server.mjs 调试
  'http://127.0.0.1:5173',
];

// 来源是否放行（浏览器发的请求一定带 Origin）
// 除了白名单，还允许「同源」——即前端页面也部署在本 Vercel 域名上的情况
// （本项目的工具页托管在 GitHub Pages，但万一以后迁过来就不用改代码）
export function isOriginAllowed(origin, host) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch (_) { /* origin 非法 */ }
  }
  return false;
}

// 依据请求来源回显；不在白名单里就退回主域名（浏览器会拒绝跨域读响应）
export function corsHeaders(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

// 客户端真实 IP（Vercel 通过 x-forwarded-for 传递，取第一个）
export function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') || '';
  const ip = (xff.split(',')[0] || '').trim();
  return ip || req.headers.get('x-real-ip') || 'unknown';
}

// IP → 哈希（不存明文，隐私友好）
export async function hashIp(ip) {
  const salt = process.env.IP_SALT || 'renamerx';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + salt));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// UTC 时间的天/小时键（避免服务器时区混乱）
export function timeKeys() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return { day, hour: `${day}${p(d.getUTCHours())}`, isoDay: d.toISOString().slice(0, 10) };
}

export async function getCount() {
  const r = redis();
  const c = await r.get('count');
  if (c === null || c === undefined) {
    await r.set('count', INITIAL_COUNT);
    return INITIAL_COUNT;
  }
  return Number(c) || 0;
}

// 累加计数 + 记使用日志；超限则原样丢弃（不累加，但把当前真值返回给前端，界面不会跳变）
export async function bumpCount(n, ipHash, meta) {
  const { day, hour } = timeKeys();
  const hKey = `rl:h:${ipHash}:${hour}`;
  const dKey = `rl:d:${ipHash}:${day}`;

  const r = redis();
  // 先确保 count 键存在（空库首次被写入时会以 INITIAL_COUNT 落基），
  // 否则下面的 incrby 会从 0 起算，把真实历史值抹掉。
  const [base, hUsed, dUsed] = await Promise.all([getCount(), r.get(hKey), r.get(dKey)]);
  const hourUsed = Number(hUsed) || 0;
  const dayUsed = Number(dUsed) || 0;

  if (hourUsed + n > HOURLY_LIMIT) {
    return { ok: false, reason: 'hourly_limit', limit: HOURLY_LIMIT, used: hourUsed, count: await getCount() };
  }
  if (dayUsed + n > DAILY_LIMIT) {
    return { ok: false, reason: 'daily_limit', limit: DAILY_LIMIT, used: dayUsed, count: await getCount() };
  }

  // 用 incrby 的返回值作为新总数（Redis 自增是原子的，多个请求同时改名也不会互相覆盖）
  const [newCount] = await Promise.all([
    r.incrby('count', n),
    r.incrby(hKey, n),
    r.incrby(dKey, n),
  ]);
  // incrby 创建的键可能没有过期时间，补一次 TTL
  await Promise.all([
    r.expire(hKey, 7200),    // 2 小时
    r.expire(dKey, 93600),   // 26 小时
  ]);

  const entry = {
    t: new Date().toISOString(),
    n,
    ip: ipHash.slice(0, 8),                 // 只留哈希前 8 位，够区分不同访客
    city: meta.city || '',
    country: meta.country || '',
    ua: (meta.ua || '').slice(0, 160),
  };
  await r.lpush('logs', entry);
  await r.ltrim('logs', 0, LOG_KEEP - 1);

  // 当日访客集合（用于「今天有多少人」）
  await r.sadd(`v:${day}`, ipHash);
  await r.expire(`v:${day}`, 172800);

  return { ok: true, count: newCount, added: n };
}
