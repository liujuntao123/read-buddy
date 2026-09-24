#!/usr/bin/env node
/**
 * One release, start to finish: version it, write the changelog, commit, tag,
 * push.
 *
 * This is the same five steps whether they run on a maintainer's machine or in
 * the `Release` workflow, so they live in one script rather than being written
 * out twice in YAML and prose. The workflow's only extra job is to configure
 * the git identity and hand over a token.
 *
 * Pushing the tag is what triggers the build: `release.yml` reacts to `v*`
 * tags, builds the Windows installer and publishes the GitHub Release whose
 * body is that version's changelog section.
 *
 * Usage:
 *   node scripts/release.mjs 0.2.0 [--date YYYY-MM-DD]
 *   node scripts/release.mjs --bump minor
 *   node scripts/release.mjs 0.2.0 --dry-run
 *   node scripts/release.mjs 0.2.0 --no-push
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS, applyVersion, bumpVersion, currentVersion, ROOT } from './version.mjs';

const CHANGELOG = 'CHANGELOG.md';
const RELEASE_BRANCH = 'master';

/** `git`, capturing output — with `inherit` when the user should see it live. */
function git(args, { inherit = false } = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
}

/** Paths reported by a `git diff`-family command, one per line. */
function trackedChanges(...args) {
  return git([...args])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Whether git already knows this path (as opposed to one we just created). */
function isTracked(file) {
  try {
    git(['ls-files', '--error-unmatch', '--', file]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the release's own files back the way the commit had them.
 *
 * The version bump and the changelog write are two separate steps with no
 * transaction between them, so a failure in either would otherwise leave a
 * half-released tree: versions bumped but no changelog, or a new changelog with
 * old versions. Nothing is committed yet at that point, so the repair is simply
 * "unstage, then restore — or delete what we created".
 *
 * Returns the problems it could not repair, so the caller can report them
 * instead of quietly claiming success.
 */
function rollback(paths) {
  const problems = [];
  try {
    git(['reset', '--quiet', '--', ...paths]);
  } catch (error) {
    problems.push(`无法取消暂存：${error.message}`);
  }
  for (const file of paths) {
    try {
      if (isTracked(file)) git(['checkout', '--', file]);
      else if (existsSync(path.join(ROOT, file))) rmSync(path.join(ROOT, file));
    } catch (error) {
      problems.push(`${file}: ${error.message}`);
    }
  }
  return problems;
}

/** Re-run the changelog generator as its own process: one implementation, one CLI. */
function generateChangelog(version, date) {
  const script = path.join(ROOT, 'scripts', 'changelog.mjs');
  const args = [script, '--current', version];
  if (date) args.push('--date', date);
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
}

function previewChangelog(version, date) {
  const script = path.join(ROOT, 'scripts', 'changelog.mjs');
  const args = [script, '--stdout', '--current', version];
  if (date) args.push('--date', date);
  return execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
}

const USAGE = `用法：
  node scripts/release.mjs <版本号> [--date YYYY-MM-DD] [--dry-run] [--no-push]
  node scripts/release.mjs --bump patch|minor|major

  --dry-run       只校验并预览，不写文件、不提交、不打标签
  --no-push       提交并打标签，但不推送到 origin
  --date          写进变更日志的发布日期，默认今天
  --allow-dirty   允许工作区已有未提交改动（默认拒绝，避免混进发布提交）
  --allow-branch  允许在 ${RELEASE_BRANCH} 以外的分支上发布`;

function parseArgs(argv) {
  const options = { version: null, bump: null, date: null, dryRun: false, push: true, allowDirty: false, allowBranch: false };
  const values = ['--bump', '--date'];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--no-push') options.push = false;
    else if (flag === '--allow-dirty') options.allowDirty = true;
    else if (flag === '--allow-branch') options.allowBranch = true;
    else if (values.includes(flag)) options[flag === '--bump' ? 'bump' : 'date'] = argv[++index];
    else if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag.startsWith('-')) throw new Error(`未知参数「${flag}」。\n\n${USAGE}`);
    else if (options.version) throw new Error(`多余的参数「${flag}」。\n\n${USAGE}`);
    else options.version = flag;
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.version && !options.bump) throw new Error(`需要一个版本号或 --bump。\n\n${USAGE}`);
  if (options.version && options.bump) throw new Error(`给了版本号又给了 --bump，二者只能选一个。\n\n${USAGE}`);

  const version = options.bump ? bumpVersion(options.bump) : options.version;
  const tag = `v${version}`;
  const before = currentVersion();
  const paths = [...TARGETS.map((target) => target.file), CHANGELOG];

  // Preconditions. Each one is cheap now and expensive to undo after a push.
  //
  // A release starts from a clean tree, **including the release's own files**:
  // `package.json` is one of them, so excusing the release paths here would let
  // an unrelated edit to it ride along into the version bump unnoticed. Only
  // untracked files are tolerated (the commit never `git add`s them), and
  // `--allow-dirty` is the deliberate escape hatch.
  //
  // The belt to that braces is the staged-set assertion after `git add`: even
  // if this check ever read a stale index, the commit can only ever contain the
  // paths named below.
  const tracked = [
    ...trackedChanges('diff', '--name-only'),
    ...trackedChanges('diff', '--cached', '--name-only'),
  ];
  if (tracked.length > 0 && !options.allowDirty) {
    throw new Error(
      `工作区有未提交改动：\n  ${tracked.join('\n  ')}\n先提交或 stash，或者显式加 --allow-dirty。`,
    );
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== RELEASE_BRANCH && !options.allowBranch) {
    throw new Error(`当前分支是 ${branch}，发布分支是 ${RELEASE_BRANCH}；确实要在这里发布就加 --allow-branch。`);
  }
  if (git(['tag', '--list', tag]).trim()) throw new Error(`标签 ${tag} 已经存在。`);

  console.log(`发布 read-buddy ${before} → ${version}（标签 ${tag}）`);

  if (options.dryRun) {
    console.log('\n--dry-run：只预览，不写任何文件。变更日志将变成：\n');
    process.stdout.write(previewChangelog(version, options.date));
    console.log(`\n正式执行时会：写入 ${TARGETS.length} 个版本文件 → 重新生成 ${CHANGELOG} → 提交 "chore(release): ${tag}" → 打标签 ${tag}${options.push ? ' → 推送到 origin' : '（不推送）'}。`);
    return;
  }

  // 1-3. Mutate the tree, then verify what is staged. Any failure in here is
  //      repairable, because nothing has been committed yet; from the commit
  //      onwards the release is a matter of public record and is not undone
  //      automatically.
  let staged;
  try {
    // 1. Version, everywhere it has to agree.
    const changed = applyVersion(version);
    console.log(`  版本号已写入 ${changed.length} 个文件`);

    // 2. Changelog, regenerated from the history this release is cutting.
    generateChangelog(version, options.date);

    // 3. Commit exactly the release's own files — never a blanket `git add -A`,
    //    so an unrelated stray edit cannot ride along into the tag.
    git(['add', '--', ...paths]);
    staged = trackedChanges('diff', '--cached', '--name-only');
    const foreign = staged.filter((file) => !paths.includes(file));
    if (foreign.length > 0) {
      throw new Error(
        `暂存区里有不属于本次发布的改动：\n  ${foreign.join('\n  ')}`,
      );
    }
  } catch (error) {
    const problems = rollback(paths);
    const repaired = problems.length
      ? `\n  恢复时有失败，请手工检查：\n  ${problems.join('\n  ')}`
      : `\n  已把 ${paths.length} 个发布文件恢复到改动前。`;
    throw new Error(`${error.message}\n\n✗ 已中止：未提交、未打标签。${repaired}`);
  }

  git(['commit', '-m', `chore(release): ${tag}`], { inherit: true });
  console.log(`  已提交：chore(release): ${tag}（${staged.length} 个文件）`);

  // 4. An annotated tag: it is the release's identity, and the workflow keys
  //    the build off it.
  git(['tag', '-a', tag, '-m', `read-buddy ${tag}`], { inherit: true });
  console.log(`  已打标签：${tag}`);

  // 5. Push. The tag is what starts the installer build.
  if (!options.push) {
    console.log(`\n未推送。想触发构建时执行：git push origin ${branch} && git push origin ${tag}`);
    return;
  }
  git(['push', 'origin', `HEAD:refs/heads/${branch}`], { inherit: true });
  git(['push', 'origin', `refs/tags/${tag}`], { inherit: true });
  console.log(`\n已推送 ${tag}。GitHub Actions 会构建 Windows 安装包并发布 Release。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
