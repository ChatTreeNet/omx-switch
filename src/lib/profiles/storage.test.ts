import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'comment-json';

const SCHEMA_URL = 'https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-openagent.schema.json';

describe('profile storage schema handling', () => {
  let testHomeDir: string;
  let originalHome: string | undefined;
  let storage: typeof import('./storage');

  beforeEach(async () => {
    vi.resetModules();
    testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-profile-storage-'));
    originalHome = process.env.HOME;
    process.env.HOME = testHomeDir;

    storage = await import('./storage');
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(testHomeDir, { recursive: true, force: true });
  });

  it('injects schema when writing profile config', async () => {
    await storage.writeProfileConfig('custom', {
      agents: {
        sisyphus: { model: 'openai/gpt-5.3-codex' },
      },
    });

    const configPath = join(storage.PROFILES_DIR, 'custom.json');
    const persisted = parse(await readFile(configPath, 'utf-8'), null, false) as unknown as {
      $schema?: string;
      agents: Record<string, { model?: string }>;
    };

    expect(persisted.$schema).toBe(SCHEMA_URL);
    expect(persisted.agents.sisyphus.model).toBe('openai/gpt-5.3-codex');
  });

  it('backfills schema when reading legacy profile configs', async () => {
    const profilesDir = storage.PROFILES_DIR;
    await mkdir(profilesDir, { recursive: true });

    const configPath = join(profilesDir, 'legacy.json');
    await writeFile(
      configPath,
      JSON.stringify({ agents: { oracle: { model: 'openai/gpt-5.4' } } }),
      'utf-8'
    );

    const loaded = await storage.readProfileConfig('legacy');
    expect(loaded.$schema).toBe(SCHEMA_URL);
    expect(loaded.agents.oracle.model).toBe('openai/gpt-5.4');

    const persisted = parse(await readFile(configPath, 'utf-8'), null, false) as unknown as {
      $schema?: string;
    };
    expect(persisted.$schema).toBe(SCHEMA_URL);
  });

  it('returns schema-included defaults when profile file is missing', async () => {
    const loaded = await storage.readProfileConfig('missing');

    expect(loaded).toEqual({
      $schema: SCHEMA_URL,
      agents: {},
    });
  });

  it('preserves v4 overlay fields and unknown metadata when reading and writing profile config', async () => {
    await storage.writeProfileConfig('v4-overlay', {
      agents: {
        sisyphus: {
          model: 'openai/gpt-5.4',
          reasoningEffort: 'max',
          maxTokens: 64000,
          thinking: { type: 'enabled', budget_tokens: 12000 },
          future_agent_knob: { mode: 'experimental' },
          fallback_models: [
            'anthropic/claude-opus-4-6',
            {
              model: 'google/gemini-3.1-pro',
              variant: 'high',
              reasoningEffort: 'max',
              maxTokens: 32000,
              thinking: { budget_tokens: 2048 },
              futureFallbackField: 'preserve-me',
            },
          ],
        },
      },
      categories: {
        ultrabrain: {
          reasoningEffort: 'max',
          fallback_models: [
            'openai/gpt-5.4',
            { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max', thinking: { enabled: true } },
          ],
          future_category_knob: 'keep-me',
        },
      },
      team_mode: {
        enabled: true,
        strategy: 'pairing',
      },
      metadata: {
        owner: 'platform',
      },
    });

    const loaded = await storage.readProfileConfig('v4-overlay');

    expect(loaded.$schema).toBe(SCHEMA_URL);
    expect(loaded.agents.sisyphus.reasoningEffort).toBe('max');
    expect(loaded.agents.sisyphus.maxTokens).toBe(64000);
    expect(loaded.agents.sisyphus.thinking).toEqual({ type: 'enabled', budget_tokens: 12000 });
    expect(loaded.agents.sisyphus.future_agent_knob).toEqual({ mode: 'experimental' });
    expect(loaded.agents.sisyphus.fallback_models).toEqual([
      'anthropic/claude-opus-4-6',
      {
        model: 'google/gemini-3.1-pro',
        variant: 'high',
        reasoningEffort: 'max',
        maxTokens: 32000,
        thinking: { budget_tokens: 2048 },
        futureFallbackField: 'preserve-me',
      },
    ]);
    expect(loaded.categories?.ultrabrain).toEqual({
      reasoningEffort: 'max',
      fallback_models: [
        'openai/gpt-5.4',
        { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max', thinking: { enabled: true } },
      ],
      future_category_knob: 'keep-me',
    });
    expect(loaded.team_mode).toEqual({
      enabled: true,
      strategy: 'pairing',
    });
    expect(loaded.metadata).toEqual({
      owner: 'platform',
    });
  });

  it('returns parsed config when schema backfill write fails', async () => {
    const profilesDir = storage.PROFILES_DIR;
    await mkdir(profilesDir, { recursive: true });

    const configPath = join(profilesDir, 'readonly.json');
    await writeFile(
      configPath,
      JSON.stringify({ agents: { explore: { model: 'anthropic/claude-haiku-4-5' } } }),
      'utf-8'
    );

    await chmod(configPath, 0o400);

    try {
      const loaded = await storage.readProfileConfig('readonly');

      expect(loaded).toEqual({
        $schema: SCHEMA_URL,
        agents: {
          explore: {
            model: 'anthropic/claude-haiku-4-5',
          },
        },
      });

      const persisted = parse(await readFile(configPath, 'utf-8'), null, false) as unknown as {
        $schema?: string;
      };
      expect(persisted.$schema).toBeUndefined();
    } finally {
      await chmod(configPath, 0o600);
    }
  });

  it('creates the built-in balanced profile with upstream-aligned defaults', async () => {
    await storage.readProfileIndex();

    const balanced = await storage.readProfileConfig('balanced');

    expect(balanced.agents.hephaestus).toMatchObject({
      model: 'openai/gpt-5.5',
      variant: 'medium',
    });
    expect((balanced.agents as Record<string, unknown>).hepheastus).toBeUndefined();
    expect(balanced.agents.librarian).toMatchObject({
      model: 'openai/gpt-5.4-mini-fast',
    });
    expect(balanced.agents.explore).toMatchObject({
      model: 'openai/gpt-5.4-mini-fast',
    });
    expect(balanced.agents['multimodal-looker']).toMatchObject({
      model: 'openai/gpt-5.5',
      variant: 'medium',
    });
    expect(balanced.agents['sisyphus-junior']).toMatchObject({
      model: 'anthropic/claude-sonnet-4-6',
    });
    expect(balanced.categories?.quick).toMatchObject({
      model: 'openai/gpt-5.4-mini',
    });
    expect(balanced.categories?.ultrabrain).toMatchObject({
      model: 'openai/gpt-5.5',
      variant: 'xhigh',
    });
    expect(balanced.categories?.deep).toMatchObject({
      model: 'openai/gpt-5.5',
      variant: 'medium',
    });
    expect(balanced.categories?.['unspecified-high']).toMatchObject({
      model: 'anthropic/claude-opus-4-7',
      variant: 'max',
    });
  });
});
