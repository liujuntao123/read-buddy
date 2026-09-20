import { useLibraryStore } from '@/store/libraryStore';

/**
 * Desktop (Tauri 2) bridge: receives book files launched via OS file
 * association / CLI argument (`book-file-opened` event from src-tauri),
 * reads the bytes through the `read_book_file` command and routes them
 * into the normal import flow. No-ops in the plain web build.
 */

export interface DesktopBridgeDeps {
  listen?: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
  invoke?: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  importFiles?: (files: File[]) => Promise<unknown>;
}

export const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const fileNameFromPath = (path: string): string =>
  path.split(/[\\/]/).pop() || 'book.epub';

/**
 * Wires the file-open channel. Returns the unlisten function (or null when
 * not running inside the desktop shell). Every dependency is injectable so
 * unit tests never touch Tauri APIs.
 */
export async function initDesktopFileOpen(
  deps: DesktopBridgeDeps = {},
): Promise<(() => void) | null> {
  if (!isDesktop() && !deps.listen) return null;

  let listen = deps.listen;
  let invoke = deps.invoke;
  if (!listen || !invoke) {
    const [{ listen: tauriListen }, { invoke: tauriInvoke }] = await Promise.all([
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/core'),
    ]);
    listen =
      listen ??
      ((event, handler) =>
        tauriListen(event, (e) => handler(e.payload)).then((un) => () => un()));
    invoke = invoke ?? ((cmd, args) => tauriInvoke(cmd, args) as Promise<unknown>);
  }
  const importFiles = deps.importFiles ?? ((files: File[]) => useLibraryStore.getState().importFiles(files));

  return listen('book-file-opened', async (payload) => {
    const path = String(payload);
    try {
      const bytes = (await invoke('read_book_file', { path })) as number[] | Uint8Array;
      const file = new File([new Uint8Array(bytes)], fileNameFromPath(path));
      await importFiles([file]);
    } catch (error) {
      console.error('desktop book open failed', error);
    }
  });
}
