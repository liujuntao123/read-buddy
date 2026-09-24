/**
 * One-shot codemod: unify the book-node vocabulary across the app source.
 *
 * Ordered literal replacements with ASCII word boundaries; run from the repo
 * root. Idempotent-ish: running it twice is harmless because every target name
 * is distinct from its source.
 *
 * Usage: node .scratch/tools/rename-domain-terms.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/read-buddy-app/src';
const DRY = process.argv.includes('--dry');

/** Order matters: longer / more specific first. */
const MAP = [
  // --- repositories & ids -------------------------------------------------
  ['ChapterNodeRepository', 'BookNodeRepository'],
  ['ChapterNodeRecord', 'BookNodeRecord'],
  ['chapterNodeId', 'bookNodeId'],
  ['ChapterIndexStatus', 'NodeIndexStatus'],
  ['chapter_nodes', 'book_nodes'],
  // --- summaries ----------------------------------------------------------
  ['ChapterSummaryRepository', 'NodeSummaryRepository'],
  ['SummaryChapterContext', 'SummaryNodeContext'],
  ['resolveCurrentChapterContext', 'resolveCurrentNodeContext'],
  ['summaryChapterKey', 'summaryNodeKey'],
  ['chapterSummaries', 'nodeSummaries'],
  ['chapterSummaryId', 'nodeSummaryId'],
  ['ChapterSummary', 'NodeSummary'],
  // --- node type ----------------------------------------------------------
  ['ChapterNode', 'BookNode'],
  ['parentChapterId', 'parentNodeId'],
  ['chapterId', 'nodeId'],
  // --- node accessors / pipeline -----------------------------------------
  ['allChapterBriefs', 'allNodeBriefs'],
  ['currentChapterTitle', 'currentNodeTitle'],
  ['currentChapterText', 'currentNodeText'],
  ['parentChapterTitle', 'parentNodeTitle'],
  ['resolveCurrentChapterText', 'resolveCurrentNodeText'],
  ['resolveSectionHierarchy', 'resolveNodeHierarchy'],
  ['chapterTitles', 'nodeTitles'],
  ['chapterTitle', 'nodeTitle'],
  ['totalChapters', 'totalNodes'],
  ['chapterCount', 'nodeCount'],
  ['chapterIndex', 'nodeIndex'],
  ['getChapterPath', 'getNodePath'],
  ['getChapterText', 'getNodeText'],
  // --- hierarchy types ----------------------------------------------------
  ['SectionHierarchy', 'NodeHierarchy'],
  ['SectionNodeKind', 'NodeKindLabel'],
  // --- text extraction ----------------------------------------------------
  ['extractChapterText', 'extractNodeText'],
  ['ChapterText', 'NodeText'],
  // --- source resolver ----------------------------------------------------
  ['createChapterSource', 'createNodeSource'],
  ['ChapterSourceResult', 'NodeSourceResult'],
  ['ChapterSourceDeps', 'NodeSourceDeps'],
  ['chapterSource', 'nodeSource'],
  // --- positions ----------------------------------------------------------
  ['sectionIndex', 'nodeIndex'],
  ['sectionCount', 'spineCount'],
  ['CHAPTER_HEADING_PATTERN', 'NODE_HEADING_PATTERN'],
  // --- engine / opened-book physical spine accessors ----------------------
  ['getSectionTitleAsync', 'getSpineTitleAsync'],
  ['getSectionTextAsync', 'getSpineTextAsync'],
  ['getCachedSectionHtml', 'getCachedSpineHtml'],
  ['getCachedSectionText', 'getCachedSpineText'],
  ['getSectionTitle', 'getSpineTitle'],
  ['getSectionText', 'getSpineText'],
  ['getSectionHtml', 'getSpineHtml'],
  ['SectionHtml', 'SpineHtml'],
  ['sectionHtml', 'spineHtml'],
  ['sectionText', 'spineText'],
];

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
};
walk(ROOT);

let touched = 0;
const report = new Map();
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [from, to] of MAP) {
    // Skip the file rename plumbing names that are legitimately 'Chapter...'
    const pattern = new RegExp(`\\b${from}\\b`, 'g');
    const hits = (after.match(pattern) ?? []).length;
    if (hits === 0) continue;
    after = after.replace(pattern, to);
    report.set(from, (report.get(from) ?? 0) + hits);
  }
  if (after !== before) {
    touched += 1;
    if (!DRY) writeFileSync(file, after);
  }
}

console.log(DRY ? '[dry run]' : '[applied]', `${touched} files`);
for (const [from, hits] of report) console.log(`  ${from} -> ${hits}`);
