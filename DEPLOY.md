# RenamerX 计数后端 · 部署与注册指南（v1.5.2）

> 计数后端已重写为 **Vercel Edge Function + Upstash Redis**。
> 前端 `app.js` 已改为调用 `COUNT_API`（读计数 / 改名后上报 +N / 按 IP 限流），
> 源码里**不含任何密钥**。本文件只讲一件事：**怎么把这个后端真正部署上线**。

---

## 0. 先说清楚：哪些必须你亲自做

代码（API、前端、测试）已经写好了。但要让它跑起来，需要**一个服务端实例**，
而创建实例要在你自己的账号下、由你授权完成——这部分我无法代劳：

| 步骤 | 谁来做 | 说明 |
|---|---|---|
| 在 Vercel 创建项目并导入仓库 | **你**（浏览器） | 需 GitHub OAuth 授权 |
| 创建 Upstash Redis 数据库 | **你**（浏览器，Vercel 控制台一键装） | 免费层够用 |
| 设置 `STATS_PASSWORD` / `IP_SALT` 环境变量 | **你**（或我代填，但值你来定） | 这两个值由你自定义 |
| 改 `config.js` 里的 `COUNT_API` 域名 | 我可代改，但需你提供 Vercel 域名 | —— |
| `git push` 推代码 | 我可代推（见 §6） | 推完 Vercel 自动部署 |

**不算"注册新网站"**：Vercel 用你的 GitHub 账号一键登录即成账号；
Upstash Redis 是在 Vercel 控制台里一键安装，不用去 Upstash 官网另注册。

---

## 1. 注册 / 登录 Vercel（≈1 分钟）

1. 打开 <https://vercel.com>
2. 点 **「Continue with GitHub」** → 授权登录
   （这步等于"注册"了 Vercel 账号，用的是你现有的 GitHub，不用填新邮箱密码）

## 2. 导入仓库（≈1 分钟）

1. 登录后点 **「Add New… → Project」**
2. 在 **Import Git Repository** 里找到 `JohnWish1590/renamerx`，点 **Import**
3. Framework Preset 选 **Other**（本项目零构建），Root Directory 保持仓库根
4. **先别急着 Deploy** —— 先去装数据库（§3），否则部署时连不上 Redis 会报错

## 3. 创建 Redis 数据库（≈2 分钟，这是"申请实例"那一步）

**路径 A（项目内 Storage 标签，最常用）：**
1. 进入 `renamerx` 项目后，在左侧项目导航或顶部标签栏找到 **「Storage」** 并点开
2. 点 **「Create Database」**（或 **「Connect Store」**）
3. 在列表里选 **「Upstash Redis」**
4. 按引导填：数据库名（随意，如 `renamerx-redis`）、区域（默认 `us-east-1` 即可）、套餐选 **Free / Hobby**
5. 出现 **Install Integration → Connect a Project** 弹窗时：Project 选 `renamerx`，Environments 保持 Production/Preview 勾选，
   **Custom Prefix 建议留空/默认**（变量名会是 `UPSTASH_REDIS_REST_*`；若填了 `STORAGE` 后端也兼容，但默认最稳妥）
6. 点 **Connect**。确认后 Vercel 会把这个数据库**连到本项目**，并**自动注入凭据环境变量**

**路径 B（Marketplace，若 A 里没看到 Storage）：**
1. 顶部 **Marketplace → Storage**，找 **Upstash Redis** → 点 **Install**
2. 选套餐（Free）、配置数据库、连接到 `renamerx` 项目

**无论哪条路，装完后 Vercel 自动注入的变量名是下面两组之一**
（新老集成命名不同，后端 `_lib.js` 两种都读，无需你手动抄）：
- 新版 Upstash 集成：`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- 老版 Vercel KV：`KV_REST_API_URL` + `KV_REST_API_TOKEN`

> 想确认注入成功：项目 **Settings → Environment Variables** 里应能看到上面某组变量（值被 Vercel 打码）。

## 4. 配置两个自定义环境变量（≈1 分钟）

项目 **Settings → Environment Variables** 里手动加（这两项 Vercel 不会自动给，必须自己加）：

| Key | 值 | 说明 |
|---|---|---|
| `STATS_PASSWORD` | 你自定义的密码，如 `renamerx2026` | `/api/stats` 统计页的访问密码 |
| `IP_SALT` | 任意随机串，如 `a8f3-renamerx-salt` | 给 IP 哈希加盐，防彩虹表反推 |

加完点 **Save**。这两个变量只在**生产环境**需要，本地测试用不到。

## 5. 把域名填进前端（10 秒）

部署成功后，Vercel 会给你一个域名，形如 `renamerx-xxx.vercel.app`
（你也可以绑定自己的域名）。

把 `config.js` 第 16 行改成：

```js
export const COUNT_API = 'https://你的域名.vercel.app/api/count';
```

> 这一步我可以代你改，但得你先告诉我 Vercel 给的域名。

## 6. 推送 & 部署

两种方式，任选：

- **方式 A（推荐，我来）**：你确认上面的 Redis、环境变量都就绪后，
  我执行 `git push`（顺带回填 `count.json` 为真实值 `123`），
  推上去 Vercel 自动触发部署。
- **方式 B（你自己）**：本地 `git push` 之后，回到 Vercel 项目页点 **Deploy**。
  或在装了 Vercel CLI 后执行 `vercel --prod`。

## 7. 验证是否跑通

部署完成后，浏览器或命令行试：

```bash
# 读计数（应返回真实值附近的数字）
curl https://你的域名.vercel.app/api/count
# → {"count":123}

# 上报 +1（应返回累加后的值）
curl -X POST https://你的域名.vercel.app/api/count -H 'Content-Type: application/json' -d '{"n":1}'
# → {"ok":true,"count":124,"added":1}
```

然后打开工具页 <https://johnwish1590.github.io/renamerx/>，
点一下「重新选择」、「应用重命名」，看顶部「已重命名」数字是否 +N 并持久。

统计页：<https://你的域名.vercel.app/api/stats?pw=你设的STATS_PASSWORD>

---

## 8. 限流与隐私说明（给用户）

- **按 IP 限流**：单 IP 每小时 ≤ 500、每天 ≤ 2000，超出直接丢弃并报 429。
  无法 100% 杜绝换 IP 刷量，但把"一次刷一万"变成"一个 IP 一天最多两千"，成本陡增。
- **隐私合规**：只存 IP 的 SHA-256 哈希前 8 位，**不落明文 IP**；
  日志含时间 / 国家-城市 / 浏览器 / 本次数量。
  目的正如你所要求——"看看是不是真人在用"（能看到来源城市、设备、频率）。

## 9. 费用

- Vercel Hobby（免费）+ Upstash Redis Free（免费）：每天几万次命令绰绰有余。
- 本工具日活极低，基本零成本。

## 10. 重要前置：先吊销泄露的 PAT

在 push 之前，**必须先**到 GitHub → Settings → Developer settings →
Fine-grained tokens → 找到 `renamerx` 那个 → **Revoke**。
（代码里已无 token，但旧 git 历史里仍有那段混淆串，吊销才是真正的止血。）
