# RenamerX

> 🌐 **纯网页 · 免安装 · 打开就能用** 的批量重命名工具 —— 不用下载、不用安装，浏览器打开即用。

受 **[SmanRenamer](https://sman.cn)** 启发而写。SmanRenamer 是一款非常好用的批量重命名软件，
但作者已停止更新。本项目以**完全从零重写**的方式，复刻它的核心设计——**模板式重命名 + 标签系统**，
并以开源形式继续维护，让所有人都能免费使用。

> ⚠️ 本项目与 SmanRenamer 没有代码继承关系（SmanRenamer 未公开源码），是受其**设计灵感**启发、
> 用网页技术重新实现的独立作品。

---

## 在线使用

- **主地址（短域名）**：https://renamerx.github.io  ← 推荐分享这个（会自动跳到工具页）
- **工具本体**：https://johnwish1590.github.io/renamerx/

两个地址指向同一个工具页，短域名只是更好记的入口。

---

## 为什么是网页版？

- **不用下载、不用安装**：直接打开网页就能用，没有客户端、没有安装包、不占电脑空间。
- **跨平台**：Windows / macOS / Linux 任意系统，只要有个现代浏览器（Chrome / Edge 最佳）就能用。
- **纯前端、零依赖、零构建**：全部逻辑跑在浏览器里，几个 JS 文件即可运行，文件不出本机。
- **MIT 开源协议**：代码完全公开，可随意查看、修改、自行部署。

---

## 核心原理（改一个名字，全部自动套用）

拖入一批**结构相似**的文件后，列表中排在第一位的文件名会成为「重命名模板」。
你只修改这一个名字，软件通过**单词对齐**自动把你的改动套用到所有文件：

- 把 `Plan Report 2023` 改成 `P R 2023` → 其它文件自动取每个单词的首字母
- 删词、插字、改大小写，都按相同规则应用到每个文件
- 配合「标签」可实现自动编号、父目录名、随机字符、归档到子目录等

> ⚠️ 软件可能无法完全理解你的改名意图，重命名前请务必核对每个文件名！

---

## 标签（可直接写进模板）

标签是「占位符」，软件会根据每个文件自动算出真正的内容。下面用**大白话 + 例子**说明：

| 标签写法 | 大白话意思 | 举个栗子（假设 3 个文件） |
| --- | --- | --- |
| `<n>` | **自动编号**，位数跟着文件总数走（1→001，12→012） | 001、002、003 |
| `<n,5>` | 自动编号，**从 5 开始**数 | 005、006、007 |
| `<dir>` 或 `<dir,1>` | 放进**当前文件夹的名字** | 若文件夹叫 `照片`，就填「照片」 |
| `<dir,2>` | 向上数**第 2 层父文件夹**的名字 | 如 `D:\旅行\2024\照片` → 填「旅行」 |
| `<r>` | **6 位随机数字**（用于制造不重复的名字） | 如 `482913` |
| `<r,4>` 或 `<rn,4>` | **4 位随机数字** | 如 `0193` |
| `<rl,4>` | **4 位随机小写字母** | 如 `akzp` |
| `<ru,4>` | **4 位随机大写字母** | 如 `AKZP` |
| `<ra,4>` | **4 位随机小写字母 + 数字** | 如 `a3k9` |
| `<rA,4>` | **4 位随机大写字母 + 数字** | 如 `A3K9` |
| `<rABC,6>` | **6 位「ABC」这几个字里的随机组合**（ABC 可换成任意字符） | 如 `CBAABC` |
| `<abc>` | **原样输出「abc」三个字**（基本用不到：模板里直接打字本来就是原文；只有当你要原样输出像 `<n>` 这种「长得像标签」的文字时才需要） | 输出 `abc` |

> 小提示：模板里**直接打字就是原文**，比如写 `假期照片_<n>` ，「假期照片_」会原样保留，只有 `<n>` 变成编号。

**归档到子文件夹**：模板里用 `/` 或 `\` 新建下级目录，例如 `Photos/<n>` 会把文件移入 Photos 子目录；
用 `../` 或 `..\` 可把文件上移一级。

---

## 使用方法

### 方式一：直接打开网页（推荐，免安装）🌟
访问 https://renamerx.github.io ，在浏览器中点「选择文件夹」即可使用。
**不用下载任何东西**，关掉网页什么都不会留下。

> ℹ️ **关于兼容性**：真实改名需要浏览器支持 **File System Access API**（Chrome / Edge / 新版 Opera 支持）。
> 其它浏览器（Safari / Firefox）或 `file://` 双击打开时，可正常预览、编辑模板，但**无法写入本机文件**。

### 方式二：本机运行（开发者 / 离线调试）
```bash
git clone https://github.com/JohnWish1590/renamerx.git
cd renamerx
node server.mjs          # 然后打开 http://localhost:5173
```

### 方式三：双击 HTML（兼容模式）
如果直接双击 `index.html` 以 `file://` 方式打开，浏览器出于安全限制：
**「选择文件夹」按钮和拖拽都无法读取本机文件，也无法真实改名**。此时请使用界面上的
**「兼容模式选择」** 按钮（基于 `<input webkitdirectory>`）读取文件名预览。

> ⚠️ **注意**：当前版本已**移除**「导出重命名脚本」功能。兼容模式下只能预览改名效果，
> 若要真实改名，请改用方式一（在线网页版）或方式二（本地 `server.mjs`）。
> 早期的 PowerShell 导出脚本逻辑（`scriptgen.js` / `scriptgen.test.mjs`）仍保留在仓库中，
> 若未来需要重新启用可参考。

---

## 界面交互说明（当前版本）

- **拖入 / 选择文件夹** 后，上方的「把文件夹拖到这里」提示区会**自动隐藏**，进入编辑态。
- 工具栏右侧显示 **「已选择 N 个文件」**。
- 点击 **🔄 重新选择** 会**清空当前所有文件、模板与预览**，回到初始空界面，由你重新选文件夹。
- 预览表只有三列：**# / 原文件名 / 新文件名**（无警告列、无撤销列）。
- 编辑完成后点 **✅ 应用重命名** 即可（Chrome / Edge 下真实改写本机文件）。

---

## 统计计数器（重要 · 当前状态）

页面顶部统计条显示两个数字：

1. **已服务 X 位用户** —— 来自 **不蒜子（busuanzi）**，真实全网共享访客统计，无需注册。
2. **已重命名 Y 个文件** —— 设计为**真·全网共享**（由 GitHub Actions 累加 `count.json`）。

> ⚠️ **当前真实状态（截至 2026-07-28）**：
> 「已重命名」的**真共享后端代码已全部写好并实测跑通**（触发 → Action +N → 写回 → 全网可读），
> 但承载触发 token 的 `config.js` 推送被 **GitHub Push Protection（密钥扫描）** 拦截，
> **尚未上线**。因此在你在 GitHub 批准放行之前，线上该数字**暂时回落为本机 `localStorage` 累计**
> （仅记录你这一台浏览器、这一次改名，换浏览器/清缓存会归零；这是诚实的本地统计，并非伪造）。
>
> **上线真共享计数只需一步**：仓库管理员访问下方链接并点 Allow 即可（GitHub 官方的"明知密钥仍放行"机制，
> 因为本场景 token 必须进公开前端源码）：
> `https://github.com/JohnWish1590/renamerx/security/secret-scanning/unblock-secret/3H7aXIUJeOmhLTE3PXHMysyYshq`
>
> 放行后我（或接手者）`git push` 即正式生效。

### 计数架构（已落地，待放行）
- `count.json`：仓库根目录存 `{ "renamed": N }` 真实总数。
- `.github/workflows/bump-count.yml`：监听 `workflow_dispatch`（带 `inputs.count`），
  用自带的 `GITHUB_TOKEN` 读 `count.json`、+N、写回 `main`。
- `config.js`：`GH_DISPATCH_TOKEN`（**仅限 `JohnWish1590/renamerx` 单仓库 `Actions: Read and write` 的
  fine-grained PAT**，绝不能用主账号 token）、`GH_REPO`。
- `app.js`：改名成功后本机乐观 +N 显示 + `triggerBump()` 触发 Action；打开页面时从
  `raw.githubusercontent.com/.../main/count.json` 只读真实总数；读取失败或 token 未配置时回退本机累计。

---

## 更新日志（Changelog / Release Notes）

> 格式：版本 · 日期 · 改动。带 🐞 的是修复的真实 bug（含根因）。
> 完整提交历史见 GitHub commits。

### v1.3.0 · 2026-07-28 · 真共享计数 + 极简 UI 收尾
- 新增 **GitHub Actions 真共享「已重命名」计数**架构（`count.json` + `bump-count.yml` + `config.js` + 前端触发/读取），
  替代此前「本机 localStorage 诚实累计」。
- 统计条从页脚**上移到工具区上方**（`#stats-bar`），并显示「已服务 X 位用户 · 已重命名 Y 个文件」。
- 计数器访客数改用 **不蒜子官方源 `busuanzi.ibruce.info`**（此前用的 `busuanzi.9420.ltd` 镜像失效）。
- 工具栏新增 **🔄 重新选择** 按钮：点后清空一切、回到初始空界面。
- hero 示例图（mock）宽度与下方卡片对齐（`max-width:980px`），内部内容保持紧凑不硬拉。

### v1.2.0 · 2026-07-28 · 工具页重做 + 短域名（推广）
- 工具页本体（`johnwish1590.github.io/renamerx`）重做成与落地页同一套美观设计，单页既好看又能真改名。
- 新增 `renamerx.github.io`（GitHub 组织页）作为**短域名入口**，纯重定向到工具页，不再 iframe 嵌套。
- 🐞 **修复：重做工具页后所有按钮失效、拖文件夹变"显示目录"**。
  根因：重做 `index.html` 时删掉了 `id="githubLink"`，但 `app.js` 顶层仍 `getElementById('githubLink').href`
  取到 `null` 抛异常，**整个 module 初始化中断**，后续事件全没绑定。修复：删掉这两行失效引用，按钮/拖拽恢复。
- 后续微调（同属本阶段）：移除未使用的 `githubLink`/`exportBtn`/`undoBtn` 引用与函数，避免再次误引用。

### v1.1.0 · 2026-07-28 · 回归极简
- 移除「导出重命名脚本」「撤销」按钮（用户反馈不需要）。
- 移除预览表「警告」列（仅保留 # / 原文件名 / 新文件名）。
- 文件加载后 **dropzone 自动隐藏**，进入编辑态。
- 「它能做什么」卡片精简为 3 张（模板批量改名 / 标签自动编号 / 纯网页零依赖）。

### v1.0.1 · 2026-07-27 · 标签人话化 + 一键插入
- 标签说明改为「大白话 + 例子」三列表，不再需要背 `<rA,4>` 这类语法。
- 模板下方新增 **「一键插入标签」** 按钮组（10 个常用标签），点选即插入。
- 🐞 导出 PowerShell 脚本补全 **UTF-8 BOM**，修复中文系统下脚本报错崩溃。

### v1.0.0 · 2026-07-26 · 首发
- 从零复刻 SmanRenamer 的**模板式重命名 + 标签系统**，纯网页、零依赖、开源。
- 🐞 修复「E01 不递增」+ 输入标点/字母时卡顿崩溃（加权 LCS 对齐 + 输入框防抖）。
- 🐞 修复超大文件夹导致浏览器 **Out of Memory** 崩溃（预览限行 + 超大文件夹警告 + 递归深度保护）。
- 🐞 修复 `file://` 双击打开时拖拽变成「打开文件夹」、「选择文件夹」按钮失效。
- 建立完整自测体系（engine 27 + scriptgen 5 + integration 2 + app 4，**共 38 项全绿**）。

---

## 错误记录（留给接手者的避坑清单）

以下都是本项目**真实踩过的坑**，重做/改 HTML 时务必对照，避免重演：

1. **🔴 改 HTML 后必须逐一对齐 `app.js` 的 `getElementById`**。
   删掉一个元素 ID（如 `githubLink`），而 `app.js` 仍引用它 → 取 `null` → 顶层抛 TypeError →
   **整段 module 初始化中断 → 所有按钮/拖拽事件全失效，且无任何报错提示**。
   教训：重做/精简 UI 前，先 grep `app.js` 里所有 `getElementById` 和 `els.xxx`，确保 HTML 都有对应 ID。

2. **🔴 跨域 iframe 无法真实改名**。
   把工具页用 iframe 嵌到 `renamerx.github.io` 时，「应用重命名」点了完全没反应、无报错。
   根因：浏览器安全策略**禁止跨域 iframe 申请 File System Access API 的本地文件修改权限**，
   权限弹窗被吞。解决：不要 iframe 嵌套，改用「新标签页打开」或「短域名直接重定向」。

3. **🟡 GitHub fine-grained PAT 触发计数器的两个硬限制**：
   - ① fine-grained PAT **不能触发 `repository_dispatch`**（报 `Resource not accessible by personal access token`，
     平台硬限制）→ 改用 `workflow_dispatch`。
   - ② 触发 `workflow_dispatch` 需要 **`Actions: Read and write`** 权限（不是 `Administration`！
     Administration 只够读仓库元数据，触发 Action 会 403）。
   - ③ 创建时 **Resource owner 必须选个人账号 `JohnWish1590`**，且 selected repository 选 `JohnWish1590/renamerx`
     （不是 `renamerx/renamerx.github.io` 组织仓库），否则对目标仓库无权限，dispatch 报 403。

4. **🟡 第三方服务可达性**：
   - 不蒜子镜像 `busuanzi.9420.ltd` 已失效（对 JS 路径返回 HTML 而非 JS），改用官方 `busuanzi.ibruce.info`。
   - countapi.xyz 等国外计数器在中国大陆可能连不上，已弃用。

5. **🟡 NAS 工作副本的 git 推送约定**：
   - 本仓库 canonical 在 `D:\SynologyDrive\CODING\renamerx`。
   - 此 shell 无 github 凭据，推送用 **token-in-URL**：
     `git remote set-url origin https://<TOKEN>@github.com/JohnWish1590/renamerx.git` → push →
     再 `set-url` 回 `https://github.com/JohnWish1590/renamerx.git` 去掉明文 token。
   - 若 push 报 `no remote`，先 `git remote add origin <token-url>`。
   - 若 push 报 `non-fast-forward`，先 `git fetch origin main && git merge FETCH_HEAD`（GitHub Action 会往 main 写 count.json，
     可能和本地冲突，解决 count.json 冲突即可）。

6. **🟡 GitHub Push Protection（密钥扫描）**：
   把 fine-grained token 写进公开前端源码 `config.js` 会被 GitHub 拦截，需仓库管理员访问
   `security/secret-scanning/unblock-secret/...` 链接 Allow 后才能推送。这是预期流程，不是异常。

---

## 与 SmanRenamer 的功能对照

| 能力 | SmanRenamer | RenamerX（网页版） |
| --- | --- | --- |
| 模板式重命名（改一个套全部） | ✅ | ✅ |
| 单词增 / 删 / 改 / 移动 | ✅ | ✅（基于单词对齐） |
| 自动编号 `<n>` / `<n,x>` | ✅ | ✅ |
| 父目录名 `<dir,x>` | ✅ | ✅ |
| 随机字符 `<r,...>` | ✅ | ✅ |
| 原样文本 | ✅ | ✅（直接打字即可，无需特殊标签） |
| 按名称 / 时间 / 大小排序后编号 | ✅ | ✅ |
| 归档到子目录 `/` 与 `../` 上移 | ✅ | ✅ |
| 实时预览 | ✅ | ✅ |
| 拖拽导入 | ✅ | ✅（拖入文件夹） |
| 是否需要下载安装 | 需要桌面客户端 | **不需要，打开网页即用** ✅ |
| 跨平台 | 仅 Windows 客户端 | 任意系统的浏览器 ✅ |

> 注：SmanRenamer 的「撤销」与「导出 PowerShell 脚本」功能在当前网页版中已移除（用户反馈不需要），
> 如需恢复可参考仓库中保留的 `scriptgen.js` 与历史提交。

---

## 开发 / 测试

重命名核心算法在 `engine.js`，与界面解耦，可在 Node 中直接测试：

```bash
npm test            # 运行 engine / scriptgen / integration / app 四套测试（共 38 项）
node server.mjs     # 本地静态预览，http://localhost:5173
node --check app.js # 语法检查
```

测试分布：engine 27 + scriptgen 5 + integration 2 + app 4 = **38 项**。

---

## 算法简述

1. **分词**：把文件名拆成「单词 / 分隔符」令牌；模板额外解析 `<...>` 标签。
2. **对齐**：模板原文 ↔ 编辑后模板，先用「文本完全相同」做锚点，再在间隙内做同类 LCS，
   从而区分「插入的新词」与「被改写的词」。
3. **传播**：对每个目标文件，按其令牌结构与模板原文对齐，套用相同的变换
   （前缀 / 后缀截断、大小写、整体替换、标签求值）。
4. **标签求值**：编号按排序后序号补零；随机字符支持数字 / 大小写字母 / 自定义字符集。
5. **路径解析**：`/` 与 `../` 解析为目标相对路径，支持归档与跨目录移动。

---

## 协议

[MIT](./LICENSE) © Weixin Zhang (JohnWish1590)
