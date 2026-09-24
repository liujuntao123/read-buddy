// Runs in the page: drives the continuous-scroll assertions and returns a report.
// Loaded with `agent-browser eval -b <base64>`. Index expectations are 0-based
// (ch9.xhtml is the ninth spine item = index 8).
(async () => {
  const h = window.h;
  const report = [];
  let failures = 0;
  const check = (name, ok, detail) => {
    if (!ok) failures += 1;
    report.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
  };

  // --- the flow itself -----------------------------------------------------
  const opened = await h.open({ continuous: true, pageMode: 'single', book: 'long-book.epub' });
  check('opens with content in the flow', opened.contents.length >= 1 && opened.scrollHeight > opened.clientHeight, opened);

  const steps = [];
  for (let i = 0; i < 6; i += 1) {
    const m = await h.scrollToBottom();
    steps.push({ scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, contents: m.contents, index: m.lastIndex });
    check(`scroll step ${i}: scrollTop does not reset to 0`, m.scrollTop > 0, m.scrollTop);
  }
  check('content keeps growing while scrolling down', steps[5].scrollHeight > steps[0].scrollHeight, steps.map((s) => s.scrollHeight));
  check('index advances with the scroll', steps[5].index > steps[0].index, steps.map((s) => s.index));
  check('window is capped at 5 live chapters', steps.every((s) => s.contents.length <= 5), steps.map((s) => s.contents));
  check('window slid forward (first chapter dropped)', steps[5].contents[0] > 0, steps[5].contents);
  check('the chapters in the window stay contiguous', steps.every((s, i) =>
    s.contents.every((v, j) => j === 0 || v === s.contents[j - 1] + 1)), steps.map((s) => s.contents));
  // Spine item 10 is `linear="no"` auxiliary content: the flow must step over it
  // exactly as the paginated reader does.
  check('non-linear spine items never enter the flow',
    steps.every((s) => !s.contents.includes(10) && s.index <= 9), steps.map((s) => ({ c: s.contents, i: s.index })));

  // 1b) All the way to the end of the book: the flow stops at the last linear
  //     chapter instead of running on into the auxiliary one. (A freshly
  //     appended chapter takes a moment to lay out, so this keeps pulling to the
  //     bottom instead of stopping at the first iteration that does not move.)
  let previous = h.metrics();
  for (let i = 0; i < 16; i += 1) previous = await h.scrollToBottom();
  check('the flow ends at the last linear chapter',
    previous.lastIndex === 9 &&
    previous.scrollTop >= previous.scrollHeight - previous.clientHeight - 4 &&
    !previous.contents.includes(10), previous);

  // --- 章节跳转 = 滚动到锚点 -----------------------------------------------
  const loaded = h.metrics();
  const loadedJumpTarget = loaded.contents[Math.floor(loaded.contents.length / 2)];
  h.clearLogs();
  const jumpLoaded = await h.goTo(`OEBPS/ch${loadedJumpTarget + 1}.xhtml#head`);
  const jumpLoadedLogs = h.logs();
  check('a jump to a loaded chapter reloads nothing', !jumpLoadedLogs.some((l) => l.type === 'load' || l.type === 'unload'), {
    target: loadedJumpTarget,
    logs: jumpLoadedLogs,
  });
  check('a jump to a loaded chapter lands there', jumpLoaded.lastIndex === loadedJumpTarget, {
    target: loadedJumpTarget,
    index: jumpLoaded.lastIndex,
  });

  // A chapter the flow pushed out has to be loaded back in. After the run to the
  // end of the book the window is the tail of the book, so chapter 1 is gone.
  h.clearLogs();
  const dropped = await h.goTo('OEBPS/ch1.xhtml');
  check('a jump to a dropped chapter loads it', h.logs().some((l) => l.type === 'load' && l.index === 0), h.logs());
  check('the dropped-chapter jump lands on it', dropped.lastIndex === 0, dropped);
  check('the target chapter is the one on screen', String(dropped.rangeText || '').includes('第1章'), dropped.rangeText);

  // An intra-chapter anchor lands mid-chapter, not at its head.
  const head = await h.goTo('OEBPS/ch9.xhtml#head');
  const mid = await h.goTo('OEBPS/ch9.xhtml#mid');
  check('both anchor jumps stay in chapter 9', head.lastIndex === 8 && mid.lastIndex === 8, { head: head.lastIndex, mid: mid.lastIndex });
  check('the mid-chapter anchor scrolls past the head', mid.scrollTop > head.scrollTop, { head: head.scrollTop, mid: mid.scrollTop });
  check('the mid-chapter anchor lands on that paragraph', String(mid.rangeText || '').includes('CH9P30'), mid.rangeText);

  // --- scrolling back up ---------------------------------------------------
  const beforePrepend = h.metrics();
  h.scrollToNow(0);
  await h.wait(1200);
  const settled = h.metrics();
  const MARGIN_TOTAL = 96; // the harness sets margin=48, applied above and below
  const heightsAbove = h.text().filter((t) => t.index < settled.lastIndex);
  const above = heightsAbove.reduce((total, t) => total + t.height + MARGIN_TOTAL, 0);
  check('a prepend leaves the reader on exactly the same text',
    Math.abs(settled.scrollTop - above) <= 2, {
      scrollTop: settled.scrollTop,
      heightAbove: above,
      index: settled.lastIndex,
      contents: settled.contents,
    });
  check('older chapters were attached above', settled.contents[0] < beforePrepend.contents[0], {
    before: beforePrepend.contents,
    after: settled.contents,
  });

  // --- page turns are scrolls, never chapter jumps -------------------------
  const beforeNext = h.metrics();
  const afterNext = await h.next(1);
  check('next() scrolls forward inside the flow', afterNext.scrollTop > beforeNext.scrollTop, {
    before: beforeNext.scrollTop,
    after: afterNext.scrollTop,
  });
  const afterPrev = await h.prev(1);
  check('prev() scrolls back inside the flow', afterPrev.scrollTop < afterNext.scrollTop, {
    from: afterNext.scrollTop,
    to: afterPrev.scrollTop,
  });

  // --- leaving and re-entering the flow ------------------------------------
  const paged = await h.setFlow('paginated', false);
  check('leaving the flow leaves a single document', paged.iframes === 1 && paged.contents.length === 1, paged);
  const back = await h.setFlow('scrolled', true);
  const grown = await h.scrollToBottom();
  check('re-entering the flow scrolls across chapters again',
    grown.iframes >= 1 && grown.contents.length >= 1 && grown.scrollHeight >= paged.scrollHeight,
    { paged: paged.scrollHeight, grown: grown.scrollHeight, contents: grown.contents });

  return JSON.stringify({ failures, report }, null, 1);
})()
