import { create } from 'zustand';
import { AISettingsRepository } from '@/services/db/repositories';
import { validateAISettings, type AISettingsErrors } from '@/services/ai/validation';
import { testConnection, type TestConnectionResult } from '@/services/ai/testConnection';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';

export type AISettingsStatus = 'idle' | 'loading' | 'ready';

export interface AISettingsToast {
  type: 'success' | 'error';
  text: string;
}

export interface AISettingsState {
  settings: AISettings;
  status: AISettingsStatus;
  toast: AISettingsToast | null;
  /** Reads the persisted settings (IndexedDB) at app start. */
  load: () => Promise<void>;
  /**
   * Persists `next` only when it passes validation.
   * @returns the field-error map (empty map = saved successfully).
   */
  save: (next: AISettings) => Promise<AISettingsErrors>;
  /** Probes the configured endpoint and surfaces the outcome as a toast. */
  testConnection: (settings?: AISettings) => Promise<TestConnectionResult>;
  clearToast: () => void;
}

export interface CreateAISettingsStoreOptions {
  /** Repository seam; defaults to the app Dexie singleton. */
  repository?: AISettingsRepository;
  /** Injectable fetch so tests never hit the real network. */
  fetchImpl?: typeof fetch;
}

/**
 * Factory so tests can inject an isolated ReadestPlusDatabase + fake fetch;
 * the app uses the exported `useAISettingsStore` singleton below.
 */
export function createAISettingsStore({
  repository = new AISettingsRepository(),
  fetchImpl = fetch,
}: CreateAISettingsStoreOptions = {}) {
  return create<AISettingsState>()((set, get) => ({
    settings: { ...DEFAULT_AI_SETTINGS },
    status: 'idle',
    toast: null,
    load: async () => {
      set({ status: 'loading' });
      try {
        const settings = await repository.load();
        set({ settings, status: 'ready' });
      } catch {
        // Offline-first: fall back to defaults rather than blocking the UI.
        set({ settings: { ...DEFAULT_AI_SETTINGS }, status: 'ready' });
      }
    },
    save: async (next) => {
      const errors = validateAISettings(next);
      if (Object.keys(errors).length > 0) return errors;
      await repository.save(next);
      set({ settings: next });
      return {};
    },
    testConnection: async (settings) => {
      const result = await testConnection(settings ?? get().settings, fetchImpl);
      set({
        toast: result.ok
          ? { type: 'success', text: result.message }
          : { type: 'error', text: result.message },
      });
      return result;
    },
    clearToast: () => set({ toast: null }),
  }));
}

/** App-wide singleton; Workspace calls `load()` on mount. */
export const useAISettingsStore = createAISettingsStore();
