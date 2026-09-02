// RenamerX 计数接口配置
//
// ✅ 安全说明（2026-09-02 起）：本文件【不再保存任何密钥 / 令牌】。
//
// 历史教训：此前这里用「拆段数组拼接」存放 GitHub fine-grained PAT，以为能防住，
// 但混淆 ≠ 加密——任何人打开 DevTools 看一眼 config.js 就能拼出完整 token，
// 随后被自动化 bot 扫到，被人反复调用 API 把计数从 123 刷到 12555。
// 教训：只要凭据放在前端，就一定能被拿走。GitHub Actions 又拿不到客户端 IP，无法限流。
//
// 现在的架构：计数后端部署在 Vercel（Edge Function + KV），
//   - 凭据只存在于 Vercel 的环境变量里，源码里一个密钥都没有；
//   - 接口侧能拿到客户端 IP，按 IP 限流（每小时 500 / 每天 2000），超限直接丢弃；
//   - 顺带记录去标识化的使用日志（时间 / 国家-城市 / 浏览器 / 数量），可在 /api/stats 查看。
//
// 部署后请把下面的地址换成你自己的 Vercel 域名（Vercel 项目 → Domains 里能看到）。
// 注意：早期拿到的 renamerx-byohg4s77-…vercel.app 是已失效的旧域名（指向旧构建、一直 500），
// 当前有效生产域名为 renamerx-investment-biubiubius-projects.vercel.app（alias 已指向 c0c1519 构建）。
export const COUNT_API = 'https://renamerx-investment-biubiubius-projects.vercel.app/api/count';
