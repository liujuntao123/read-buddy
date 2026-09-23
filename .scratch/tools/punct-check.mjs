import { readFileSync } from 'node:fs';
const RE = /[。！？…”」』：；!?]$/;
for (const [file, label] of [
  ['nodes-说理-陈嘉映.json', '目录'],
  ['nodes-何为良好生活-陈嘉映.json', '目录'],
  ['nodes-走出唯一真理观-陈嘉映.json', '目录'],
  ['nodes-2000年以来的西方-刘擎.json', '目录'],
  ['nodes-刘擎西方现代思想讲义-刘擎.json', '目录'],
]) {
  const n = JSON.parse(readFileSync(`.scratch/out/${file}`, 'utf8')).find((x) => x.label === label);
  if (!n) continue;
  const hit = n.shape.lines.filter((l) => RE.test(l));
  console.log(
    `${file.replace('nodes-', '').replace('.json', '')} / ${label}: ${n.shape.lineCount} lines, ${hit.length} end with sentence punct (endP=${n.shape.endPunctFraction})`,
  );
  console.log('   ', JSON.stringify(hit.slice(0, 10)));
}
