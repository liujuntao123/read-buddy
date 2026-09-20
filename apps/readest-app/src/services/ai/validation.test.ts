import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_SETTINGS,
  MAX_TURNS_PER_TOPIC,
  MIN_TURNS_PER_TOPIC,
  type AISettings,
} from '@/types/ai';
import { validateAISettings } from './validation';

/** A baseline that passes every rule (non-ollama provider needs a key). */
const valid = (): AISettings => ({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' });

describe('validateAISettings', () => {
  it('accepts a fully valid settings object with an empty error map', () => {
    expect(validateAISettings(valid())).toEqual({});
  });

  describe('baseUrl', () => {
    it('rejects a non-URL string', () => {
      const errors = validateAISettings({ ...valid(), baseUrl: 'not-a-url' });
      expect(errors.baseUrl).toBeTruthy();
    });

    it('rejects non-http(s) schemes', () => {
      const errors = validateAISettings({ ...valid(), baseUrl: 'ftp://example.com/v1' });
      expect(errors.baseUrl).toBeTruthy();
    });

    it('accepts http and https URLs (incl. localhost with trailing slash)', () => {
      expect(validateAISettings({ ...valid(), baseUrl: 'http://localhost:11434/v1/' }).baseUrl).toBeUndefined();
      expect(validateAISettings({ ...valid(), baseUrl: 'https://api.deepseek.com/v1' }).baseUrl).toBeUndefined();
    });
  });

  describe('model', () => {
    it('rejects an empty or whitespace-only model id', () => {
      expect(validateAISettings({ ...valid(), model: '' }).model).toBeTruthy();
      expect(validateAISettings({ ...valid(), model: '   ' }).model).toBeTruthy();
    });
  });

  describe('provider', () => {
    it('rejects a provider outside the four-value enum', () => {
      const errors = validateAISettings({ ...valid(), provider: 'grok' as AISettings['provider'] });
      expect(errors.provider).toBeTruthy();
    });

    it('accepts each of the four supported providers', () => {
      for (const provider of ['openai-compatible', 'deepseek', 'claude', 'ollama'] as const) {
        expect(validateAISettings({ ...valid(), provider }).provider).toBeUndefined();
      }
    });
  });

  describe('temperature', () => {
    it('rejects values below 0 and above 2', () => {
      expect(validateAISettings({ ...valid(), temperature: -0.01 }).temperature).toBeTruthy();
      expect(validateAISettings({ ...valid(), temperature: 2.01 }).temperature).toBeTruthy();
    });

    it('accepts the 0 and 2 boundaries', () => {
      expect(validateAISettings({ ...valid(), temperature: 0 }).temperature).toBeUndefined();
      expect(validateAISettings({ ...valid(), temperature: 2 }).temperature).toBeUndefined();
    });

    it('rejects NaN', () => {
      expect(validateAISettings({ ...valid(), temperature: Number.NaN }).temperature).toBeTruthy();
    });
  });

  describe('maxTurnsPerTopic', () => {
    it('rejects integers outside the quota window', () => {
      expect(
        validateAISettings({ ...valid(), maxTurnsPerTopic: MIN_TURNS_PER_TOPIC - 1 }).maxTurnsPerTopic,
      ).toBeTruthy();
      expect(
        validateAISettings({ ...valid(), maxTurnsPerTopic: MAX_TURNS_PER_TOPIC + 1 }).maxTurnsPerTopic,
      ).toBeTruthy();
    });

    it('rejects non-integers', () => {
      expect(validateAISettings({ ...valid(), maxTurnsPerTopic: 10.5 }).maxTurnsPerTopic).toBeTruthy();
    });

    it('accepts the 5 and 20 boundaries', () => {
      expect(
        validateAISettings({ ...valid(), maxTurnsPerTopic: MIN_TURNS_PER_TOPIC }).maxTurnsPerTopic,
      ).toBeUndefined();
      expect(
        validateAISettings({ ...valid(), maxTurnsPerTopic: MAX_TURNS_PER_TOPIC }).maxTurnsPerTopic,
      ).toBeUndefined();
    });
  });

  describe('apiKey', () => {
    it('requires a key for remote providers', () => {
      for (const provider of ['openai-compatible', 'deepseek', 'claude'] as const) {
        expect(validateAISettings({ ...valid(), provider, apiKey: '' }).apiKey).toBeTruthy();
      }
    });

    it('allows an empty key for ollama', () => {
      const errors = validateAISettings({
        ...valid(),
        provider: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
      });
      expect(errors.apiKey).toBeUndefined();
    });
  });

  it('collects multiple field errors at once', () => {
    const errors = validateAISettings({
      ...valid(),
      baseUrl: 'nope',
      model: '',
      temperature: 5,
      maxTurnsPerTopic: 99,
    });
    expect(Object.keys(errors).sort()).toEqual(['baseUrl', 'maxTurnsPerTopic', 'model', 'temperature']);
  });
});
