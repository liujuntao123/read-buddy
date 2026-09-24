// Runs in the page: double-page (paginated) regression checks against the patched
// paginator. Loaded with `agent-browser eval -b <base64>`.
(async () => {
  const h = window.h;
  const report = [];
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures += 1;
    report.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
  };

  const opened = await h.open({ continuous: false, pageMode: 'double', book: 'long-book.epub' });
  check('double-page opens on one document', opened.contents.length === 1 && opened.contents[0] === 0, opened);

  // Page turns inside the chapter, then across its end (the upstream contract).
  const fractions = [opened.fraction];
  let index = opened.lastIndex;
  for (let i = 0; i < 14; i += 1) {
    const m = await h.next(1);
    fractions.push(m.fraction);
    index = m.lastIndex;
    if (index === 1) break;
  }
  check('page turns advance through the chapter', fractions.some((f, i) => i > 0 && f > fractions[i - 1]), fractions);
  check('paging past the chapter end crosses into the next chapter', index === 1, { index, fractions });

  const back = await h.prev(1);
  check('paging back stays in the flow (one document)', back.contents.length === 1, back);

  const jumped = await h.goTo('OEBPS/ch5.xhtml');
  check('goTo lands on the requested chapter', jumped.lastIndex === 4 && jumped.contents[0] === 4, jumped);

  const headJump = await h.goTo('OEBPS/ch5.xhtml#head');
  const midJump = await h.goTo('OEBPS/ch5.xhtml#mid');
  check('an anchor jump stays in the chapter', headJump.lastIndex === 4 && midJump.lastIndex === 4, {
    head: headJump.lastIndex,
    mid: midJump.lastIndex,
  });
  // Paginated mode lands on the *page* holding the anchor, so its visible range
  // starts at or before the anchored paragraph and later than the chapter head's.
  const anchoredP = Number((String(midJump.rangeText).match(/CH5P(\d+)/) ?? [])[1]);
  const headP = Number((String(headJump.rangeText).match(/CH5P(\d+)/) ?? [])[1]);
  check('the anchor jump lands on the page holding the anchored paragraph',
    midJump.fraction > headJump.fraction && anchoredP <= 30 && (Number.isNaN(headP) || headP < anchoredP),
    { head: headJump.rangeText, mid: midJump.rangeText, headFraction: headJump.fraction, midFraction: midJump.fraction });

  // The patched `unload` signal (the app drops a chapter's listeners with it).
  h.clearLogs();
  await h.goTo('OEBPS/ch6.xhtml');
  check('replacing a document reports the old one as unloaded',
    h.logs().some((l) => l.type === 'unload' && l.index === 4), h.logs());

  // Styles still reach the live document after the refactor.
  const styled = await h.styles('<html><style>x</style></html>');
  check('setStyles reports back the document it styled', Boolean(styled), styled);

  return JSON.stringify({ failures, report }, null, 1);
})()
