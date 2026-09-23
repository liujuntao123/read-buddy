/**
 * Clipboard write with a legacy fallback — the one implementation of
 * 「把这串文本放进剪贴板」.
 *
 * The logic used to live inline in `ChatTab`'s 复制对话 handler. Two more copy
 * actions (单条回答、总结) are now on the same path, and a third of a clipboard
 * rule would have been easy and silent.
 *
 * The fallback is not nostalgia: the app also runs in non-secure contexts (and
 * inside the Tauri webview) where `navigator.clipboard` is undefined or
 * rejects, and the reader's expectation there is that 复制 still works.
 *
 * Returns success instead of throwing so callers can render 「已复制」 honestly:
 * a failed copy must not claim it worked.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    return clipboard.writeText(text).then(
      () => true,
      // Permission denied / insecure context: try the legacy path rather than
      // reporting failure with a working fallback right here.
      () => copyViaExecCommand(text),
    );
  }
  return Promise.resolve(copyViaExecCommand(text));
}

/**
 * `document.execCommand('copy')` over an off-screen textarea. Synchronous,
 * deprecated, and still the only thing that works where the async Clipboard API
 * does not. The helper node is removed in `finally` so a throwing `execCommand`
 * cannot leave it in the DOM.
 */
function copyViaExecCommand(text: string): boolean {
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.top = '0';
  helper.style.opacity = '0';
  helper.style.pointerEvents = 'none';
  try {
    document.body.appendChild(helper);
    helper.select();
    return document.execCommand?.('copy') ?? false;
  } catch {
    return false;
  } finally {
    helper.remove();
  }
}
