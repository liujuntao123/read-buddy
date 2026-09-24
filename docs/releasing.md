# 发布流程

面向维护者。**流程的细节以 `scripts/` 与 `.github/workflows/` 为准**——本文只说明它们为什么这样组织，以及手滑时的后果。

用户只需要看 [`CHANGELOG.md`](../CHANGELOG.md) 和 [Releases 页面](https://github.com/liujuntao123/readest-plus/releases)。

---

## 1. 一条规则：版本号只有一个来源

同一个版本号必须出现在五个地方，因为读它的五个工具谁也不读别人的：

| 文件 | 谁在读 |
| --- | --- |
| `package.json` | 工作区根包 |
| `apps/readest-app/package.json` | 前端应用包 |
| `apps/readest-app/src-tauri/tauri.conf.json` | `tauri build`，决定安装包文件名 |
| `apps/readest-app/src-tauri/Cargo.toml` | Rust crate |
| `apps/readest-app/src-tauri/Cargo.lock` | `cargo`，锁文件过期会让工作区变脏 |

**只有 `scripts/version.mjs` 会写这五个文件。** 手工改就是「安装包叫 0.2.0、里面的 crate 说 0.1.0」这类事故的来源；`pnpm version:check` 在每次 CI 与每次发布的构建前都会拦截它（`release.yml` 的 `build` 作业另加 `--expect`，防止手工推的标签与树里的版本号不符）。

```bash
pnpm version:show          # 打印版本号，并列出五个文件各自的读数
pnpm version:check         # 五者必须一致，否则退出码 1
pnpm version:set 0.2.0     # 写入五个文件
pnpm version:bump minor    # 按语义化版本推导（0.1.0 → 0.2.0）
```

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)；带 `-` 的预发布版本（`0.2.0-rc.1`）会被自动标成 GitHub Pre-release。

## 2. 另一条规则：`CHANGELOG.md` 是生成物

它由 `scripts/changelog.mjs` 从[约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/)历史生成（格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)），**不要手工编辑**。脚本文档头列出了全部行为：哪些提交进哪一节、scope 的中文映射表、破坏性变更的判定、重新生成为什么是幂等的。

想让变更日志说人话，就把提交信息写好——条目正文照抄提交标题，不做翻译。

## 3. 发一次版本

```bash
pnpm release 0.2.0 --dry-run   # 先看：校验分支/工作区，并打印将写入的变更日志
pnpm release 0.2.0             # 正式：改版本号 → 生成变更日志 → 提交 → 打附注标签 → 推送
```

或到 Actions → **Release** → *Run workflow* 填版本号，跑的是同一个脚本，因此不需要本地仓库。

两条路径都汇入同一个 `release.yml`：推送 `v*` 标签触发 `build`；手动触发则先由 `tag` 作业提交并推标签。用 `GITHUB_TOKEN` 推的标签不会再触发工作流，所以 `tag` 与 `build` 是同一工作流里的两个作业。

## 4. CI 门槛

`ci.yml` 的 `verify` 是合并门槛：`pnpm version:check` → `typecheck` → `test` → `build`，所有推送与 PR 都跑。安装包（`windows-installer`）只在非 PR 的推送与手动触发时构建，作为 artifact 上传——Tauri 发布构建很慢，产物是用完即弃的。

发布产物：GitHub Release `v0.2.0`（正文是该版本的变更日志）+ 附件 `readest-plus_0.2.0_x64-setup.exe`。

## 5. 手滑了怎么办

- **推了标签却没有构建**：标签名要匹配 `v*`（`v0.2.0`，不是 `0.2.0`）。
- **`build` 报版本号不一致**：手工打了标签却没改版本号。本地与远端都删掉标签，改用 `pnpm release <版本>` 重来。
- **`tag` 作业推送失败**：`master` 的分支保护不允许机器人推送。给分支保护加 Actions 例外，或改在本地发布。
- **安装包要签名吗**：目前没有代码签名，SmartScreen 会提示「未知发布者」，选「仍要运行」即可；要消除提示需要购买证书并配置 `TAURI_SIGNING_*` 与 `tauri.conf.json`。
