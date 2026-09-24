#!/usr/bin/env node
/**
 * The single writer of this repository's version number.
 *
 * One version has to appear in five files, because five different tools read
 * it and none of them reads any of the others:
 *
 * | File                                            | Who reads it                     |
 * | ----------------------------------------------- | -------------------------------- |
 * | `package.json`                                  | the workspace, the tag name       |
 * | `apps/read-buddy-app/package.json`                 | the app package                   |
 * | `apps/read-buddy-app/src-tauri/tauri.conf.json`    | `tauri build` (installer name)    |
 * | `apps/read-buddy-app/src-tauri/Cargo.toml`         | the Rust crate                    |
 * | `apps/read-buddy-app/src-tauri/Cargo.lock`         | `cargo` (a stale lock dirties CI) |
 *
 * Hand-editing five files is how a release ends up shipping an installer named
 * `0.2.0` from a crate that says `0.1.0`. So the workspace root `package.json`
 * is the **single source of truth**, this script is the only thing that writes
 * the other four, and CI runs `check` on every push to catch a hand edit that
 * slipped through.
 *
 * Usage:
 *   node scripts/version.mjs                        # print the current version
 *   node scripts/version.mjs check [--expect X.Y.Z] # verify all five agree
 *   node scripts/version.mjs set 0.2.0              # write 0.2.0 everywhere
 *   node scripts/version.mjs bump patch|minor|major # derive, then write
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root — this file lives in `<root>/scripts/`. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The version file every other target is compared against. */
export const SOURCE_FILE = 'package.json';

/**
 * One site that holds the version, plus the exact text around it.
 *
 * `regex` always captures the value in group 2, with group 1 as the head and
 * group 3 as the tail, so one pattern both reads (`match[2]`) and writes
 * (`replace`, keeping the surrounding text byte-identical and the diff minimal).
 * Every pattern is anchored on enough structure to hit the *right* key: the
 * first `"version"` of a JSON file, the one inside `[package]`, the one inside
 * the `read-buddy` entry of the lock file.
 */
export const TARGETS = [
  {
    file: SOURCE_FILE,
    label: '工作区根包（事实来源）',
    regex: /^(\s*"version"\s*:\s*")([^"]*)(")/m,
  },
  {
    file: 'apps/read-buddy-app/package.json',
    label: '前端应用包',
    regex: /^(\s*"version"\s*:\s*")([^"]*)(")/m,
  },
  {
    file: 'apps/read-buddy-app/src-tauri/tauri.conf.json',
    label: 'Tauri 打包配置（决定安装包文件名）',
    regex: /^(\s*"version"\s*:\s*")([^"]*)(")/m,
  },
  {
    file: 'apps/read-buddy-app/src-tauri/Cargo.toml',
    label: 'Rust crate 清单',
    regex: /(\[package\][\s\S]*?^\s*version\s*=\s*")([^"]*)(")/m,
  },
  {
    file: 'apps/read-buddy-app/src-tauri/Cargo.lock',
    label: 'Rust 锁文件',
    // `\r?\n`, not `\n`: a Windows checkout has CRLF here while CI has LF, and
    // this pattern is the only one that spans lines. Only the matched span is
    // rewritten, so each file keeps whatever line endings it already had.
    regex: /(\[\[package\]\]\r?\nname = "read-buddy"\r?\nversion = ")([^"]*)(")/,
  },
];

/** `1.2.3`, optionally with a pre-release and/or build suffix (SemVer 2.0.0). */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const readFile = (file) => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * The version of one target file, or `null` when its pattern no longer matches.
 *
 * `null` is deliberately distinct from "a version that differs": the first
 * means this script's assumption about the file broke and a human has to look,
 * the second is ordinary drift the script can repair.
 */
function readTarget(target) {
  const match = readFile(target.file).match(target.regex);
  return match ? match[2] : null;
}

function writeTarget(target, version) {
  const source = readFile(target.file);
  if (!target.regex.test(source)) {
    throw new Error(
      `${target.file} 里找不到版本号字段——脚本的匹配规则与文件已经对不上了，请先修 scripts/version.mjs。`,
    );
  }
  const next = source.replace(target.regex, (_, head, _value, tail) => `${head}${version}${tail}`);
  if (next !== source) writeFileSync(path.join(ROOT, target.file), next, 'utf8');
}

/** The canonical version: whatever the workspace root currently declares. */
export function currentVersion() {
  const version = readTarget(TARGETS[0]);
  if (!version) throw new Error(`${SOURCE_FILE} 缺少 version 字段。`);
  return version;
}

/** Every target with its own version — `version: null` when unmatched. */
export function inspect() {
  return TARGETS.map((target) => ({ ...target, version: readTarget(target) }));
}

/** Write `version` into every target; returns the files that actually changed. */
export function applyVersion(version) {
  requireSemver(version);

  // Match every target *before* writing the first one. A pattern that no longer
  // matches must stop the run while the tree is still consistent: bumping four
  // files and then failing on the fifth leaves a half-released repo that no
  // check can read.
  const rows = inspect();
  const unmatched = rows.filter((row) => row.version === null);
  if (unmatched.length > 0) {
    throw new Error(
      `这些文件里找不到版本号字段：\n  ${unmatched.map((row) => row.file).join('\n  ')}\n` +
        '脚本的匹配规则与文件已经对不上了，请先修 scripts/version.mjs（本次未写入任何文件）。',
    );
  }

  const changed = rows.filter((row) => row.version !== version).map((row) => row.file);
  for (const target of TARGETS) writeTarget(target, version);
  return changed;
}

/** Next version for a release type, computed from the canonical version. */
export function bumpVersion(release) {
  const [major, minor, patch] = currentVersion()
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  switch (release) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`未知的版本类型「${release}」——可用：patch / minor / major。`);
  }
}

function requireSemver(version) {
  if (!SEMVER.test(version)) {
    throw new Error(`「${version}」不是合法版本号，应为 x.y.z（可带 -rc.1 之类的预发布后缀）。`);
  }
}

const USAGE = `用法：
  node scripts/version.mjs                        打印当前版本号
  node scripts/version.mjs check [--expect X.Y.Z] 校验五个文件是否一致
  node scripts/version.mjs set X.Y.Z              把 X.Y.Z 写入五个文件
  node scripts/version.mjs bump patch|minor|major 按语义化版本推导新版本号并写入`;

function main(argv) {
  const [command = 'show', ...rest] = argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  if (command === 'show') {
    const version = currentVersion();
    console.log(version);
    for (const target of inspect()) {
      console.log(`  ${target.version === version ? '✓' : '✗'} ${target.file} → ${target.version ?? '未找到'}`);
    }
    return;
  }

  if (command === 'check') {
    const expectIndex = rest.indexOf('--expect');
    const expected = expectIndex >= 0 ? rest[expectIndex + 1] : currentVersion();
    if (!expected) throw new Error('--expect 后面要跟一个版本号。');

    const rows = inspect();
    const drifted = rows.filter((row) => row.version !== expected);
    for (const row of rows) {
      console.log(`${row.version === expected ? '✓' : '✗'} ${row.file} → ${row.version ?? '未找到'}`);
    }
    if (drifted.length > 0) {
      console.error(
        `\n版本号不一致：期望 ${expected}，但上面标 ✗ 的文件不是这个值。\n` +
          `修复：node scripts/version.mjs set ${expected}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\n版本号一致：${expected}`);
    return;
  }

  if (command === 'set' || command === 'bump') {
    const input = rest[0];
    if (!input) throw new Error(`${command} 需要一个参数。\n\n${USAGE}`);
    const version = command === 'bump' ? bumpVersion(input) : input;
    requireSemver(version);
    const changed = applyVersion(version);
    console.log(`版本号 → ${version}`);
    for (const file of changed) console.log(`  已写入 ${file}`);
    if (changed.length === 0) console.log('  五个文件本来就都是这个版本，无需改动。');
    return;
  }

  throw new Error(`未知命令「${command}」。\n\n${USAGE}`);
}

// Only run the CLI when invoked directly, so `release.mjs` can import from here.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
