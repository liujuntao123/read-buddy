# 发布流程

本文面向维护者，说明 `readest-plus` 的版本号怎么管、变更日志怎么来、GitHub 上的自动构建怎么跑。

用户只需要看 [`CHANGELOG.md`](../CHANGELOG.md) 和 [Releases 页面](https://github.com/liujuntao123/readest-plus/releases)。

---

## 1. 版本号：一个事实来源，五个文件

同一个版本号必须出现在五个文件里，因为五个工具各读各的，谁也不读别人的：

| 文件 | 谁在读 |
| --- | --- |
| `package.json` | 工作区根包，**版本号的事实来源** |
| `apps/readest-app/package.json` | 前端应用包 |
| `apps/readest-app/src-tauri/tauri.conf.json` | `tauri build`，决定安装包文件名 |
| `apps/readest-app/src-tauri/Cargo.toml` | Rust crate |
| `apps/readest-app/src-tauri/Cargo.lock` | `cargo`，锁文件过期会让工作区变脏 |

手工改这五个文件，就是「安装包叫 `0.2.0`、里面的 crate 说 `0.1.0`」这种事故的来源。所以：

- **只有 `scripts/version.mjs` 会写这五个文件**，别手工改；
- 改版本号用 `pnpm version:set` / `pnpm version:bump`；
- CI 的每一次 `verify` 都跑 `pnpm version:check`，手工改漏了一个文件会在 PR 上就红掉。

```bash
pnpm version:show          # 打印当前版本号，并列出五个文件各自的读数
pnpm version:check         # 五个文件必须一致，否则退出码 1
pnpm version:set 0.2.0     # 把 0.2.0 写进五个文件
pnpm version:bump minor    # 按语义化版本推导（0.1.0 → 0.2.0）
```

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)：`0.2.0`、`1.0.0-rc.1` 都合法。
预发布版本（带 `-` 的）会被自动标记为 GitHub 上的 Pre-release。

---

## 2. 变更日志：从提交历史生成，不手写

`CHANGELOG.md` 是**生成文件**，别手工编辑。它由 `scripts/changelog.mjs` 依据
[约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 的提交历史整理，
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

```bash
pnpm changelog                       # 依据全部标签重新生成 CHANGELOG.md
node scripts/changelog.mjs --stdout  # 只打印，不写文件
node scripts/changelog.mjs --notes 0.2.0   # 打印某个已发布版本的正文（用作 Release 说明）
```

规则：

- **提交信息决定条目**：`feat(reader): 边缘翻页` 会进「✨ 新功能」，`fix(app): …` 进「🐛 问题修复」。
  想让变更日志说人话，就把提交信息写好。
- **scope 会翻成中文**：`reader` → 阅读器、`companion` → AI 伴读、`docs` → 文档……
  映射表在 `scripts/changelog.mjs` 的 `SCOPE_LABELS`；纯数字 scope（本仓库用它标任务号）
  会写成「任务 07」。没收录的 scope 原样显示。
- **破坏性变更**：`feat(api)!: …` 或正文里的 `BREAKING CHANGE:`，会单独进「⚠️ 破坏性变更」并排在最前。
- **提交标题不翻译**：机器翻译会凭空发明意思，所以条目正文照抄提交标题。
- **每个已打标签的版本都会有一节**，日期取标签所在提交的日期，重新生成不会改变历史日期。
- 重新生成是幂等的：没有新提交时 `pnpm changelog` 会告诉你「已是最新，无需改动」。

---

## 3. 发一次版本

### 方式一：本地一条命令（推荐）

```bash
pnpm release 0.2.0 --dry-run   # 先看：校验分支/工作区，并打印将写入的变更日志
pnpm release 0.2.0             # 正式：改版本号 → 生成变更日志 → 提交 → 打标签 → 推送
```

`pnpm release` 会依次做五件事：

1. 校验工作区干净（含版本文件本身）、分支是 `master`、标签 `v0.2.0` 尚不存在；
2. 把 `0.2.0` 写进那五个文件；
3. 重新生成 `CHANGELOG.md`，新增 `## [0.2.0] - YYYY-MM-DD` 一节；
4. 提交 `chore(release): v0.2.0` 并打**附注标签** `v0.2.0`；
5. 推送分支与标签。

推送标签就是触发构建的那一下——`.github/workflows/release.yml` 监听 `v*` 标签，
构建 Windows 安装包并发布 Release。

其他参数：`--bump minor` 免去手算版本号；`--no-push` 只提交打标签不推送；
`--allow-dirty` / `--allow-branch` 是逃生门，正常发布不要用。

### 方式二：在 GitHub 上点一下

Actions → **Release** → *Run workflow* → 填版本号（如 `0.2.0`）。

`tag` 作业会做和上面完全相同的五件事（跑的就是同一个脚本），因此**不需要本地仓库**。
之后 `build` 作业检出刚推的标签、构建、发布。

> 注意：用 `GITHUB_TOKEN` 推的标签不会再次触发工作流，所以 `tag` 与 `build` 是同一个工作流里的两个作业，
> 而不是「推标签」再「被标签触发」。

---

## 4. CI 机制

### `ci.yml` —— 每次推送与 PR

| 作业 | 触发 | 做什么 |
| --- | --- | --- |
| `verify` | 所有推送与 PR | `pnpm version:check` → `pnpm typecheck` → `pnpm test` → `pnpm build` |
| `windows-installer` | 非 PR 的推送、手动 | `pnpm build:installer` 构建 NSIS 安装包，作为 artifact 上传（保留 14 天） |

合并门槛是 `verify`；PR 不构建安装包（Tauri 发布构建很慢，产物也是用完即弃）。

### `release.yml` —— 发布

| 作业 | 触发 | 做什么 |
| --- | --- | --- |
| `resolve` | 总是 | 从标签名或手动输入推导版本号，校验格式，判断是否预发布 |
| `tag` | 仅手动触发 | 跑 `scripts/release.mjs`：改版本、写日志、提交、打标签、推送 |
| `build` | `tag` 成功或被跳过 | 检出标签 → 校验版本号与标签一致 → 生成 Release 说明 → `tauri-action` 构建并发布 → 用日志正文覆盖 Release 说明 |

发布产物：

- GitHub Release `v0.2.0`，正文是该版本的变更日志；
- 附件 `readest-plus_0.2.0_x64-setup.exe`（NSIS 安装包）。

`build` 作业里的「校验标签与版本号一致」是刻意的：手工推标签时如果树里的版本号对不上，
这一步会失败，而不是发出一个文件名与内部版本不符的安装包。

---

## 5. 常见问题

**推送标签后没有开始构建？**
标签名要匹配 `v*`（`v0.2.0`，不是 `0.2.0`）。到 Actions 页面看 Release 工作流有没有跑。

**`build` 报「版本号不一致」？**
手工打了标签但没改版本号。删除标签（本地与远端都要删），改用 `pnpm release <版本>` 重来。

**`tag` 作业推送失败？**
`master` 分支保护规则不允许机器人直接推送。两种解法：给分支保护加上 GitHub Actions 例外，
或者改用「方式一」在本地发布（然后标签推送不受分支保护限制）。

**安装包要签名吗？**
目前没有代码签名，Windows SmartScreen 会对未签名安装包给出提示，选择「仍要运行」即可。
要消除提示需要购买代码签名证书并配置 `TAURI_SIGNING_*` 相关密钥与 `tauri.conf.json`。

**预发布版本怎么发？**
版本号带后缀即可：`pnpm release 0.2.0-rc.1`，工作流会自动把 Release 标成 Pre-release。

**首次发布（0.1.0）怎么处理？**
仓库还没有任何 `v*` 标签，`CHANGELOG.md` 已按 `0.1.0` 生成好现有全部历史。
执行 `pnpm release 0.1.0` 即可；之后每次发布都会在它上面追加一节。
