// RenamerX 计数触发器配置
//
// ⚠️ 安全说明：此 token 会出现在公开仓库的前端代码中，因此【绝不能】用你的主账号
// PAT（ghp_...）。必须到 GitHub 创建一个「fine-grained PAT」：
//   1. 打开 https://github.com/settings/tokens?type=beta
//   2. 仅勾选仓库 JohnWish1590/renamerx
//   3. Permissions 里只给 Repository permissions → Actions: Read and write
//      （仅用于触发 workflow_dispatch；不要给 Contents 写权限，写文件由 Action 的
//       GITHUB_TOKEN 完成，前端 token 拿不到）
//   4. 生成后把值粘到下面。
// 这样即使 token 被看到，最坏情况也只是被人反复触发你的 workflow 刷计数器，
// 动不了你其他仓库或源码。
export const GH_DISPATCH_TOKEN = '';

// 触发 dispatch 的目标仓库
export const GH_REPO = 'JohnWish1590/renamerx';
