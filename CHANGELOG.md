# 变更日志

本项目的所有重要变更都记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)，
条目依据 [约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 从 git 历史整理生成。

> 本文件由 `pnpm changelog` 自动生成，请勿手工编辑；要调整分组或措辞，请改提交信息或 `scripts/changelog.mjs`。

## [0.2.0] - 2026-09-24

### 📝 文档

- **scratch** · record the post-rename verify run in ticket 15（[`18bf3c5`](https://github.com/liujuntao123/read-buddy/commit/18bf3c51d9f12e7261681c48a29cc031347d6364)）
- reframe the README around the reading-difficulty problem（[`30b4622`](https://github.com/liujuntao123/read-buddy/commit/30b46227c2df64ea6ddfcac42394d0e9131ece97)）
- replace the design docs with docs/architecture.md（[`7e34d79`](https://github.com/liujuntao123/read-buddy/commit/7e34d7935e4e54b6badfb2f7302499b643e39b89)）

### 🔧 其他变更

- rename the project from readest-plus to read-buddy（[`2136ea1`](https://github.com/liujuntao123/read-buddy/commit/2136ea100567f15544bae0fbc9164210f95f4ea0)）

## [0.1.0] - 2026-09-24

### ✨ 新功能

- **阅读器** · reading experience enhancements — continuous scroll, clickable highlights, edge page-turn (issue 15)（[`da8e0f8`](https://github.com/liujuntao123/read-buddy/commit/da8e0f81946b4d44c2e3a82edf0519b8c07576d3)）
- **应用** · product-review polish + summary prompt fidelity contract（[`8aafffc`](https://github.com/liujuntao123/read-buddy/commit/8aafffc6bc7fe3b6132428ce0c263a8b2f1eb3f9)）
- **阅读器** · reader highlights (划线) — mark, persist, revisit（[`1b20921`](https://github.com/liujuntao123/read-buddy/commit/1b209217d2daff048e1e8aa3d64f8e0be864cdd4)）
- **AI 伴读** · gate the summary CTA by node content, plus sidebar polish（[`6e3c88e`](https://github.com/liujuntao123/read-buddy/commit/6e3c88eb3ba0f3d580069ced7ed4900001569fc8)）
- **AI 伴读** · reading-agent index, two-provider AI settings with model pull, and companion UX（[`d4cc1a6`](https://github.com/liujuntao123/read-buddy/commit/d4cc1a66020d0e74f97a019bf154563cf5681f7b)）
- **任务 08-13** · unify the book node model, plus TOC hierarchy, EPUB fixes and UX polish（[`e05d480`](https://github.com/liujuntao123/read-buddy/commit/e05d480526740b3c91394a7fed267f6b3772ba4b)）
- **任务 07** · Foliate-js paginated engine integration and desktop wiring（[`b941c8c`](https://github.com/liujuntao123/read-buddy/commit/b941c8cee1d05c41d7d4c71a946ecdde722f2a70)）
- **任务 07a** · Tauri 2 desktop shell and file-open bridge（[`d7ca2dd`](https://github.com/liujuntao123/read-buddy/commit/d7ca2dda6f8722bdb2beb205248380ad8c084711)）
- **任务 06** · real book import, local library and open-to-read（[`b2c8b9b`](https://github.com/liujuntao123/read-buddy/commit/b2c8b9bfb8013d29f39c4dcb52dd011f60c98d4d)）
- **书架** · foundation for real book import — registry + db table（[`23708b3`](https://github.com/liujuntao123/read-buddy/commit/23708b3f76db7444fdf225707c85d077e67c1471)）
- **任务 05** · native selection AI toolbar, responsive drawer and theme switching（[`ccf6e23`](https://github.com/liujuntao123/read-buddy/commit/ccf6e238ad082f411033b83cd0282c408af9e45d)）
- **integration** · mount real summary and chat tabs in AI sidebar（[`cdf7be0`](https://github.com/liujuntao123/read-buddy/commit/cdf7be03cc596760d6e415a944afe40a4412378e)）
- **任务 04** · turn-quota companion chat with anti-spoiler context（[`36ae362`](https://github.com/liujuntao123/read-buddy/commit/36ae362c1bfd006266c5b62b8ade011bd20fcca1)）
- **任务 03** · manual-trigger chapter summary with map-reduce pipeline（[`848ffda`](https://github.com/liujuntao123/read-buddy/commit/848ffda1a9aaf92750055dfa021a7818d07bd0d0)）
- **AI 接入** · shared streaming seam over Vercel AI SDK v7（[`6e522b6`](https://github.com/liujuntao123/read-buddy/commit/6e522b6d3f970a7b10d93669d5b149d39e0aa788)）
- **任务 02** · chapter text extraction and adaptive book segmentation（[`d1dd070`](https://github.com/liujuntao123/read-buddy/commit/d1dd07078512b5a4a31eea40dd5f8c48c4d1d50c)）
- **任务 01** · split-screen AI sidebar container and provider config center（[`8954fef`](https://github.com/liujuntao123/read-buddy/commit/8954fef20f7fad94f34b48fcccffca3a97ef28f3)）
- **任务跟踪** · publish tracer-bullet tickets 01-05（[`2da1ea5`](https://github.com/liujuntao123/read-buddy/commit/2da1ea56a6cd139db4677ee3ee25193755719000)）

### 🐛 问题修复

- **阅读器** · make chapter navigation place-aware (file + anchor)（[`6fd0cb0`](https://github.com/liujuntao123/read-buddy/commit/6fd0cb0a8259ae4c6f38a17a49696ac2c11d8f13)）
- **review** · address spec/standards findings（[`d74db55`](https://github.com/liujuntao123/read-buddy/commit/d74db55e0b24dfb4416a7b5e435718879951c006)）

### 📝 文档

- rewrite README in Chinese and add an English edition（[`3d1510b`](https://github.com/liujuntao123/read-buddy/commit/3d1510baeb1b15f1f9bac874ecf9335b4dd031df)）
- **复盘** · record ADR 0009, tracker planning rules, ticket 07 and verify gate（[`5edee03`](https://github.com/liujuntao123/read-buddy/commit/5edee032b3cad09c306f0cd5322fa850de73f601)）
- finalize design spec and adrs（[`23b93ba`](https://github.com/liujuntao123/read-buddy/commit/23b93ba955bb9823ab7baf47eb1ec975d6e917a0)）

### ✅ 测试

- **阅读器** · pin chapter navigation to 《说理》's real NCX rows（[`fdae461`](https://github.com/liujuntao123/read-buddy/commit/fdae461c8a497e7c8f9bf447a1f5d5b30eac4d0f)）

### 🤖 持续集成

- add the CI gate and the tag-driven Windows release workflow（[`4102de4`](https://github.com/liujuntao123/read-buddy/commit/4102de447de228876814edb5eb4934ae3f8331f6)）

### 🔧 其他变更

- **发布** · single-source version number and generated changelog（[`ab2cb65`](https://github.com/liujuntao123/read-buddy/commit/ab2cb65eae24f10f6df06b712b0734a8bea94ed8)）
- add MIT license（[`f32ee6e`](https://github.com/liujuntao123/read-buddy/commit/f32ee6e766653152c07969ec4ce7800ff63567d8)）
- stop tracking the generated next-env.d.ts（[`11aedb0`](https://github.com/liujuntao123/read-buddy/commit/11aedb05b83eb9c90bf9537869706bbee7655484)）
- ignore and untrack src-tauri build artifacts（[`fe4ac1b`](https://github.com/liujuntao123/read-buddy/commit/fe4ac1ba3695b2ece93a1d9a10fd0a5e13325398)）
- **第三方依赖** · vendor foliate-js (MIT) as the paginated rendering engine（[`10c3ead`](https://github.com/liujuntao123/read-buddy/commit/10c3eada5e233708d434cf8f91afd6ecfcde27cd)）
- **任务跟踪** · close ticket 05（[`7f8748f`](https://github.com/liujuntao123/read-buddy/commit/7f8748fa5326c7ffb976c6b48a642cb9c81a813e)）
- **任务跟踪** · ticket 05 in progress marker（[`8d1bd62`](https://github.com/liujuntao123/read-buddy/commit/8d1bd62f1ee19247fc0749e30ecabfd8eb884dec)）
- **任务跟踪** · close tickets 03 and 04（[`620597d`](https://github.com/liujuntao123/read-buddy/commit/620597dbbba48a97fcd65c0ef9e038794204e3a8)）
- scaffold readest-plus monorepo foundation（[`884a211`](https://github.com/liujuntao123/read-buddy/commit/884a21145d955ee168b71a30b87df76eb92238d7)）

[未发布]: https://github.com/liujuntao123/read-buddy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/liujuntao123/read-buddy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/liujuntao123/read-buddy/releases/tag/v0.1.0
