#!/usr/bin/env node
/**
 * CHANGELOG.md generator: Conventional Commits in, Keep a Changelog out.
 *
 * The repository's commits already follow the Conventional Commits spec
 * (`feat(reader): …`, `fix(app): …`), so the changelog is a pure function of
 * git history plus the tag list — nobody has to hand-write "what changed in
 * 0.2.0", and the file can be regenerated at any time without losing anything.
 *
 * The file is therefore **generated**: `pnpm changelog` rewrites it whole, and
 * a release writes it as part of the release commit. Section headings are
 * Chinese (the language of the app's UI and docs); commit subjects are carried
 * over verbatim, because a machine cannot translate them without inventing
 * meaning.
 *
 * Usage:
 *   node scripts/changelog.mjs                        # rewrite CHANGELOG.md
 *   node scripts/changelog.mjs --current 0.2.0        # + a 0.2.0 section at the top
 *   node scripts/changelog.mjs --stdout               # print instead of writing
 *   node scripts/changelog.mjs --notes 0.2.0          # one version's notes, for a Release body
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_OUT = 'CHANGELOG.md';

/** Field / record separators for `git log`, so no commit text needs escaping. */
const FIELD = '\x1f';
const RECORD = '\x1e';

/**
 * Conventional Commit type → the changelog section it belongs to, in the order
 * sections are printed. `chore` doubles as the home of unrecognized types, so
 * a commit can never fall out of the changelog entirely.
 */
const SECTIONS = [
  { key: 'feat', title: '✨ 新功能' },
  { key: 'fix', title: '🐛 问题修复' },
  { key: 'perf', title: '⚡ 性能优化' },
  { key: 'refactor', title: '♻️ 重构' },
  { key: 'revert', title: '⏪ 回滚' },
  { key: 'docs', title: '📝 文档' },
  { key: 'test', title: '✅ 测试' },
  { key: 'build', title: '📦 构建与依赖' },
  { key: 'ci', title: '🤖 持续集成' },
  { key: 'style', title: '💄 代码风格' },
  { key: 'chore', title: '🔧 其他变更' },
];

const FALLBACK_SECTION = 'chore';
const BREAKING_TITLE = '⚠️ 破坏性变更';

/**
 * Commit scopes worth naming in Chinese. Anything else falls through to its raw
 * scope (a gateway or a package name is already the clearest label), and a
 * numeric scope — this repo tags work by ticket number — is labelled as a task.
 */
const SCOPE_LABELS = {
  reader: '阅读器',
  app: '应用',
  companion: 'AI 伴读',
  sidebar: '伴读侧栏',
  summary: '章节总结',
  chat: '对话',
  shelf: '书架',
  library: '书架',
  settings: '设置',
  ai: 'AI 接入',
  agent: '伴读引擎',
  highlight: '划线',
  highlights: '划线',
  db: '本地存储',
  theme: '主题',
  ui: '界面',
  docs: '文档',
  tracker: '任务跟踪',
  vendor: '第三方依赖',
  release: '发布',
  deps: '依赖',
  retro: '复盘',
};

/**
 * Commits that describe the act of releasing rather than a change in it.
 * Dropped so a regenerated changelog does not list its own generation.
 */
const SKIP_SUBJECT = /^chore(\(release\))?!?:\s*(v?\d+\.\d+\.\d+|release\b)/i;

const CONVENTIONAL = /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^()]+)\))?(?<breaking>!)?:\s*(?<subject>.+)$/;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** `owner/repo` from any of the shapes a GitHub remote or `repository` field takes. */
function githubSlug(value) {
  if (!value) return null;
  const text = String(value).trim().replace(/\.git$/, '').replace(/\/$/, '');
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/,
    /^git@github\.com:([^/]+)\/([^/]+)$/,
    /^git\+https:\/\/github\.com\/([^/]+)\/([^/]+)$/,
    /^github:([^/]+)\/([^/]+)$/,
    // A bare `owner/repo` (the npm `repository` shorthand). Anchored to a
    // single slash and to name-shaped segments so a local or relative path
    // (`C:\src\repo`, `../repo`) is rejected instead of becoming a URL.
    /^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

/**
 * Where the repository lives, so commit and compare links point somewhere real.
 *
 * `GITHUB_REPOSITORY` wins (it is what a fork's CI should use), then the
 * `origin` remote, then the `repository` field of the root `package.json` —
 * which is also what keeps a local run correct when `origin` is a path or a
 * self-hosted mirror. Nothing is guessed: without an answer this throws rather
 * than writing `C:\…\clone/commit/abc` into a published file.
 */
function repoUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    const slug = githubSlug(process.env.GITHUB_REPOSITORY);
    if (slug) return `https://github.com/${slug}`;
  }

  const fromRemote = githubSlug(git(['remote', 'get-url', 'origin']).trim());
  if (fromRemote) return `https://github.com/${fromRemote}`;

  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const declared = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const fromPackage = githubSlug(declared);
    if (fromPackage) return `https://github.com/${fromPackage}`;
  } catch {
    // A missing or malformed package.json falls through to the error below.
  }

  throw new Error(
    '无法确定 GitHub 仓库地址：origin 不是 github.com 仓库时，请设置 GITHUB_REPOSITORY，' +
      '或在根 package.json 的 repository 字段里写明仓库地址。',
  );
}

/** `v`-prefixed SemVer tags, oldest first, with the date of the tagged commit. */
function readTags() {
  const raw = git([
    'for-each-ref',
    `--format=%(refname:short)${FIELD}%(creatordate:short)`,
    '--sort=creatordate',
    'refs/tags',
  ]);
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tag, date] = line.split(FIELD);
      return { tag, date, version: tag.replace(/^v/, '') };
    })
    .filter(({ version }) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version));
}

/** Commits reachable from `range` (a `git log` revision expression). */
function readCommits(range) {
  let raw;
  try {
    raw = git(['log', `--format=%H${FIELD}%h${FIELD}%s${FIELD}%b${RECORD}`, range]);
  } catch {
    throw new Error(`git log ${range} 失败——这个 revision 范围不存在（是不是标签还没打？）。`);
  }
  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim().length > 0)
    .map(parseCommit)
    .filter(Boolean);
}

function parseCommit(record) {
  const [hash, shortHash, subject, body = ''] = record.split(FIELD);
  if (!subject) return null;
  if (SKIP_SUBJECT.test(subject)) return null;

  const match = subject.match(CONVENTIONAL);
  if (!match) {
    // Not a Conventional Commit: keep it, ungrouped but visible, under 其他变更.
    return {
      hash,
      shortHash,
      subject,
      scope: '',
      section: FALLBACK_SECTION,
      breaking: /^BREAKING[ -]CHANGE:/m.test(body),
      summary: subject,
    };
  }

  const { type, scope = '', breaking, subject: text } = match.groups;
  const known = SECTIONS.some((section) => section.key === type.toLowerCase());
  return {
    hash,
    shortHash,
    subject,
    scope,
    section: known ? type.toLowerCase() : FALLBACK_SECTION,
    breaking: Boolean(breaking) || /^BREAKING[ -]CHANGE:/m.test(body),
    summary: text.trim(),
  };
}

function scopeLabel(scope) {
  if (!scope) return '';
  if (SCOPE_LABELS[scope]) return SCOPE_LABELS[scope];
  if (/^\d/.test(scope)) return `任务 ${scope}`;
  return scope;
}

const escapeLinkText = (text) => text.replace(/([\\`*_[\]])/g, '\\$1');

function renderEntry(commit, { url }) {
  const scope = scopeLabel(commit.scope);
  const prefix = scope ? `**${scope}** · ` : '';
  const link = url ? `（[\`${commit.shortHash}\`](${url}/commit/${commit.hash})）` : `（\`${commit.shortHash}\`）`;
  return `- ${prefix}${escapeLinkText(commit.summary)}${link}`;
}

/** One version's Markdown body: the breaking block, then one block per section. */
function renderBody(commits, context) {
  const blocks = [];

  const breaking = commits.filter((commit) => commit.breaking);
  if (breaking.length > 0) {
    blocks.push(`### ${BREAKING_TITLE}\n\n${breaking.map((c) => renderEntry(c, context)).join('\n')}`);
  }

  for (const section of SECTIONS) {
    const rows = commits.filter((commit) => commit.section === section.key);
    if (rows.length === 0) continue;
    blocks.push(`### ${section.title}\n\n${rows.map((c) => renderEntry(c, context)).join('\n')}`);
  }

  if (blocks.length === 0) return '_本版本没有可整理的变更条目。_';

  return blocks.join('\n\n');
}

/**
 * The whole changelog, newest first.
 *
 * Every released version comes from a tag (`<previous tag>..<tag>`), so dates
 * and contents survive regeneration. `current` adds a section for a version
 * that has no tag yet — the release in progress.
 */
function buildChangelog({ current, date, synthesize = true }) {
  const url = repoUrl();
  const context = { url };
  const tags = readTags();

  const entries = [];
  let previous = null;
  for (const { tag, version, date: tagDate } of tags) {
    // Every tagged version gets a section, even an empty one: a version that
    // vanishes from the file is a version nobody can look up, and the
    // `--notes` lookup for a Release body depends on it being here.
    const commits = readCommits(previous ? `${previous}..${tag}` : tag);
    entries.push({ version, date: tagDate, tag, commits });
    previous = tag;
  }

  // Read from the tag list, not from `entries`: comparing against the *last
  // section* would wrongly re-release an already-tagged version.
  const released = tags.at(-1)?.version;
  if (current && current !== released) {
    // Always materialize the version being released, even when nothing but the
    // previous release commit lies in range — skipping the empty case is how a
    // version disappears from the file entirely.
    const commits = readCommits(previous ? `${previous}..HEAD` : 'HEAD');
    entries.push({ version: current, date: date ?? today(), tag: `v${current}`, commits });
  } else if (!current && synthesize) {
    const commits = readCommits(previous ? `${previous}..HEAD` : 'HEAD');
    if (commits.length > 0) entries.push({ version: null, date: null, tag: null, commits });
  }

  return { url, entries, previous };
}

/**
 * Where the file links a version: a comparison against the version before it,
 * or — for the first release — the tag's own release page.
 */
function versionLink({ version, tag }, before, url) {
  if (!tag) return `${url}/compare/${before}...HEAD`;
  return before ? `${url}/compare/${before}...${tag}` : `${url}/releases/tag/${tag}`;
}

function renderFile({ url, entries }) {
  const head = [
    '# 变更日志',
    '',
    '本项目的所有重要变更都记录在此文件。',
    '',
    '格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，',
    '版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)，',
    '条目依据 [约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 从 git 历史整理生成。',
    '',
    '> 本文件由 `pnpm changelog` 自动生成，请勿手工编辑；要调整分组或措辞，请改提交信息或 `scripts/changelog.mjs`。',
    '',
  ];

  const body = [];
  const links = [];
  // Newest first in the document; the link list walks the same order, and each
  // version is compared against the one *before* it in release order.
  const ordered = [...entries].reverse();
  ordered.forEach((entry, index) => {
    const before = ordered[index + 1]?.tag ?? null;
    body.push(entry.version ? `## [${entry.version}] - ${entry.date}` : '## [未发布]');
    body.push('');
    body.push(renderBody(entry.commits, { url }));
    body.push('');
    links.push(`[${entry.version ?? '未发布'}]: ${versionLink(entry, before, url)}`);
  });

  const footer = [
    '',
    `[未发布]: ${url}/compare/${entries.at(-1)?.tag ?? 'HEAD'}...HEAD`,
    ...links.filter((link) => !link.startsWith('[未发布]:')),
    '',
  ];

  return `${[...head, ...body, ...footer].join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const USAGE = `用法：
  node scripts/changelog.mjs [--current X.Y.Z] [--date YYYY-MM-DD] [--out FILE] [--stdout]
  node scripts/changelog.mjs --notes X.Y.Z

  --current  为尚未打标签的版本（正在进行中的发布）生成一节
  --date     该节的日期，默认今天
  --out      写入路径，默认 CHANGELOG.md
  --stdout   只打印，不写文件
  --notes    只打印某个版本的正文，用于 GitHub Release 说明`;

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, current: null, date: null, notes: null, stdout: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--stdout') options.stdout = true;
    else if (flag === '--current') options.current = argv[++index];
    else if (flag === '--date') options.date = argv[++index];
    else if (flag === '--out') options.out = argv[++index];
    else if (flag === '--notes') options.notes = argv[++index];
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`未知参数「${flag}」。\n\n${USAGE}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (options.notes) {
    // Tag-backed versions only: notes for a version that was never tagged would
    // be a plausible-looking empty Release body, which is worse than a failure.
    const { url, entries } = buildChangelog({ current: null, synthesize: false });
    const entry = entries.find((row) => row.version === options.notes);
    if (!entry) {
      throw new Error(
        `没有 ${options.notes} 这个版本——标签 v${options.notes} 还没有打。` +
          '（Release 说明只取已发布的版本；如果版本号写错了，请核对标签。）',
      );
    }
    const body = renderBody(entry.commits, { url });
    console.log(body || '本次发布没有可整理的变更条目。');
    return;
  }

  const model = buildChangelog(options);
  const markdown = renderFile(model);

  if (options.stdout) {
    process.stdout.write(markdown);
    return;
  }

  const target = path.join(ROOT, options.out);
  const previous = (() => {
    try {
      return readFileSync(target, 'utf8');
    } catch {
      return null;
    }
  })();

  if (previous === markdown) {
    console.log(`${options.out} 已是最新，无需改动。`);
    return;
  }
  writeFileSync(target, markdown, 'utf8');
  const versions = model.entries.length;
  console.log(`已写入 ${options.out}（${versions} 个版本，${model.entries.reduce((sum, e) => sum + e.commits.length, 0)} 条变更）。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
