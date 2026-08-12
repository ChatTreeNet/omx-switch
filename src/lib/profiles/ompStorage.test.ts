import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ompStorage', () => {
  let testHomeDir: string;
  let originalHome: string | undefined;
  let storage: typeof import('./ompStorage');

  beforeEach(async () => {
    vi.resetModules();
    testHomeDir = await mkdtemp(join(tmpdir(), 'omp-profile-storage-'));
    originalHome = process.env.HOME;
    process.env.HOME = testHomeDir;

    storage = await import('./ompStorage'); // intentional: module constants derive from HOME at import time, so we re-import after overriding it
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(testHomeDir, { recursive: true, force: true });
  });

  it('bootstraps an empty index on first read', async () => {
    const index = await storage.readOmpProfileIndex();

    expect(index.profiles).toEqual([]);
    expect(index.activeProfileId).toBeNull();
    expect(index.version).toBe(1);
  });

  it('round-trips a profile config with normalization', async () => {
    await storage.writeOmpProfileConfig('fast', {
      modelRoles: { default: 'kimi-code/k3', bad: 42 as never },
      defaultThinkingLevel: 'xhigh',
      fallbackChains: {
        default: ['openai/gpt-5.4'],
        junk: 'nope' as never,
        numeric: [42] as never,
        blank: [''],
      },
      modelFallback: true,
      futureSetting: { enabled: true },
    });

    const config = await storage.readOmpProfileConfig('fast');

    expect(config.modelRoles).toEqual({ default: 'kimi-code/k3' });
    expect(config.defaultThinkingLevel).toBe('xhigh');
    expect(config.fallbackChains).toEqual({ default: ['openai/gpt-5.4'] });
    expect(config.modelFallback).toBe(true);
    expect(config.futureSetting).toEqual({ enabled: true });
  });

  it('preserves null as an explicit default thinking level reset and removes invalid values', async () => {
    await storage.writeOmpProfileConfig('reset-thinking', {
      modelRoles: {},
      defaultThinkingLevel: null,
    });
    await storage.writeOmpProfileConfig('invalid-thinking', {
      modelRoles: {},
      defaultThinkingLevel: 'off' as never,
    });

    await expect(storage.readOmpProfileConfig('reset-thinking')).resolves.toEqual({
      modelRoles: {},
      defaultThinkingLevel: null,
    });
    await expect(storage.readOmpProfileConfig('invalid-thinking')).resolves.toEqual({
      modelRoles: {},
    });
  });

  it('keeps the default thinking level through profile export and import', async () => {
    const { createExportedOmpProfileFile, parseImportedOmpProfileFile } = await import('./ompShare');
    const exported = createExportedOmpProfileFile({
      id: 'deep-work',
      name: 'Deep Work',
      emoji: '🧠',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, {
      modelRoles: { default: 'openai/gpt-5.6-sol' },
      defaultThinkingLevel: 'max',
    });

    const imported = parseImportedOmpProfileFile(
      JSON.parse(JSON.stringify(exported)) as unknown
    );

    expect(exported.config.defaultThinkingLevel).toBe('max');
    expect(imported.config.defaultThinkingLevel).toBe('max');
  });

  it('returns empty modelRoles for a missing profile config', async () => {
    const config = await storage.readOmpProfileConfig('missing');

    expect(config).toEqual({ modelRoles: {} });
  });

  it('tracks the active profile id', async () => {
    await storage.setOmpActiveProfileId('fast');
    let index = await storage.readOmpProfileIndex();
    expect(index.activeProfileId).toBe('fast');

    await storage.setOmpActiveProfileId(null);
    index = await storage.readOmpProfileIndex();
    expect(index.activeProfileId).toBeNull();
  });
});
