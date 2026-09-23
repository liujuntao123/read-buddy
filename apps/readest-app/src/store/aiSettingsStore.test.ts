import { afterAll, describe, expect, it } from 'vitest';
import { ReadestPlusDatabase } from '@/services/db/database';
import { AISettingsRepository } from '@/services/db/repositories';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import { createAISettingsStore } from './aiSettingsStore';

/** Each test gets an isolated Dexie (fake-indexeddb) instance via injection. */
const databases: ReadestPlusDatabase[] = [];

const newStore = (fetchImpl?: typeof fetch) => {
  const db = new ReadestPlusDatabase(`ai-settings-store-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const repository = new AISettingsRepository(db);
  return { db, repository, store: createAISettingsStore({ repository, fetchImpl }) };
};

afterAll(async () => {
  await Promise.all(databases.map((db) => db.delete()));
});

const custom: AISettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-custom',
  model: 'deepseek-chat',
  temperature: 0.3,
  maxTurnsPerTopic: 12,
};

describe('createAISettingsStore', () => {
  it('starts with defaults, idle status and no toast', () => {
    const { store } = newStore();
    const state = store.getState();
    expect(state.settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(state.status).toBe('idle');
    expect(state.toast).toBeNull();
    expect(state.availableModels).toBeNull();
  });

  it('load() reads persisted settings through the repository', async () => {
    const { repository, store } = newStore();
    await repository.save(custom);
    await store.getState().load();
    const state = store.getState();
    expect(state.settings).toEqual(custom);
    expect(state.status).toBe('ready');
  });

  it('load() falls back to defaults when nothing is stored', async () => {
    const { store } = newStore();
    await store.getState().load();
    expect(store.getState().settings).toEqual(DEFAULT_AI_SETTINGS);
    expect(store.getState().status).toBe('ready');
  });

  it('save() rejects invalid settings without touching the repository', async () => {
    const { repository, store } = newStore();
    const errors = await store.getState().save({ ...custom, model: '' });
    expect(errors.model).toBeTruthy();
    expect(await repository.load()).toEqual(DEFAULT_AI_SETTINGS);
    expect(store.getState().settings).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('save() persists valid settings, updates state and returns an empty error map', async () => {
    const { repository, store } = newStore();
    const errors = await store.getState().save(custom);
    expect(errors).toEqual({});
    expect(store.getState().settings).toEqual(custom);
    expect(store.getState().toast).toEqual({ type: 'success', text: '设置已成功保存' });
    expect(await repository.load()).toEqual(custom);
  });

  it('testConnection() writes a success toast on HTTP 200', async () => {
    const okFetch: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    const { store } = newStore(okFetch);
    const result = await store.getState().testConnection();
    expect(result.ok).toBe(true);
    expect(store.getState().toast).toEqual({ type: 'success', text: '连接成功：模型服务可用' });
  });

  it('testConnection() writes an error toast on HTTP 401', async () => {
    const deniedFetch: typeof fetch = () => Promise.resolve(new Response('{}', { status: 401 }));
    const { store } = newStore(deniedFetch);
    const result = await store.getState().testConnection();
    expect(result.ok).toBe(false);
    expect(store.getState().toast).toEqual({ type: 'error', text: 'API Key 无效或未授权' });
  });

  it('clearToast() dismisses the current toast', async () => {
    const okFetch: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    const { store } = newStore(okFetch);
    await store.getState().testConnection();
    store.getState().clearToast();
    expect(store.getState().toast).toBeNull();
  });

  it('loadModels() tags the pulled list with the endpoint it came from', async () => {
    const fetchModels: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'm-b' }, { id: 'm-a' }] }), { status: 200 }));
    const { store } = newStore(fetchModels);

    const result = await store.getState().loadModels({ ...custom, baseUrl: 'https://api.deepseek.com/v1/' });

    expect(result.ok).toBe(true);
    expect(store.getState().availableModels).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['m-a', 'm-b'],
    });
    expect(store.getState().toast).toEqual({ type: 'success', text: '已拉取 2 个模型，可在下方选择' });
  });

  it('loadModels() drops a previous list when the pull fails', async () => {
    let status = 200;
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        status === 200
          ? new Response(JSON.stringify({ data: [{ id: 'm-a' }] }), { status: 200 })
          : new Response('{}', { status }),
      );
    const { store } = newStore(fetchImpl);

    await store.getState().loadModels();
    expect(store.getState().availableModels?.models).toEqual(['m-a']);

    status = 401;
    await store.getState().loadModels();
    expect(store.getState().availableModels).toBeNull();
    expect(store.getState().toast).toEqual({ type: 'error', text: 'API Key 无效或未授权' });
  });
});
