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
      fallbackChains: {
        default: ['openai/gpt-5.4'],
        junk: 'nope' as never,
        numeric: [42] as never,
        blank: [''],
      },
      modelFallback: true,
    });

    const config = await storage.readOmpProfileConfig('fast');

    expect(config.modelRoles).toEqual({ default: 'kimi-code/k3' });
    expect(config.fallbackChains).toEqual({ default: ['openai/gpt-5.4'] });
    expect(config.modelFallback).toBe(true);
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
