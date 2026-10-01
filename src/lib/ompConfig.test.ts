import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getConfigDir,
  getConfigPath,
  isOmpDefaultThinkingLevel,
  readConfig,
  writeConfig,
} from './ompConfig';

describe('readConfig', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'omp-config-'));
    configPath = join(testDir, 'config.yml');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('reads a mapping config and treats an empty document as no config', async () => {
    await writeFile(configPath, 'modelRoles:\n  default: kimi-code/k3\n', 'utf-8');
    await expect(readConfig(configPath)).resolves.toEqual({
      modelRoles: { default: 'kimi-code/k3' },
    });

    await writeFile(configPath, '', 'utf-8');
    await expect(readConfig(configPath)).resolves.toEqual({});
  });

  it('round-trips the default thinking level without dropping unknown settings', async () => {
    await writeConfig({
      defaultThinkingLevel: 'xhigh',
      autoResume: true,
      nested: { futureSetting: 42 },
    }, configPath);

    await expect(readConfig(configPath)).resolves.toEqual({
      defaultThinkingLevel: 'xhigh',
      autoResume: true,
      nested: { futureSetting: 42 },
    });
  });

  it.each([
    ['a sequence', '- kimi-code/k3\n'],
    ['a string scalar', 'kimi-code/k3\n'],
    ['a numeric scalar', '42\n'],
  ])('rejects %s at the YAML root', async (_label, content) => {
    await writeFile(configPath, content, 'utf-8');

    await expect(readConfig(configPath)).rejects.toThrow(
      `Failed to parse OMP config at ${configPath}: Error: config root must be a mapping`
    );
  });
});

describe('active OMP configuration', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'omp-active-config-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('PI_CONFIG_DIR', '');
    vi.stubEnv('PI_CODING_AGENT_DIR', '');
    vi.stubEnv('PI_PROFILE', '');
    vi.stubEnv('OMP_PROFILE', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('reads and updates an existing config.yaml in the overridden agent directory', async () => {
    const agent = join(home, 'custom-agent');
    await mkdir(agent);
    vi.stubEnv('PI_CODING_AGENT_DIR', agent);
    const alternate = join(agent, 'config.yaml');
    await writeFile(alternate, 'modelRoles:\n  default: vendor/old\nfutureSetting: keep\n');

    const config = await readConfig();
    expect(config.modelRoles?.default).toBe('vendor/old');
    await writeConfig({ ...config, modelRoles: { default: 'vendor/new' } });

    expect(await readConfig()).toEqual({
      modelRoles: { default: 'vendor/new' },
      futureSetting: 'keep',
    });
    await expect(readFile(join(agent, 'config.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prefers config.yml when both YAML filenames exist', async () => {
    const agent = getConfigDir();
    await mkdir(agent, { recursive: true });
    await writeFile(join(agent, 'config.yml'), 'modelRoles:\n  default: vendor/canonical\n');
    await writeFile(join(agent, 'config.yaml'), 'modelRoles:\n  default: vendor/alternate\n');

    expect((await readConfig()).modelRoles?.default).toBe('vendor/canonical');
    await writeConfig({ modelRoles: { default: 'vendor/updated' } });
    expect(await readFile(join(agent, 'config.yaml'), 'utf-8')).toContain('vendor/alternate');
  });

  it('isolates named profile writes and ignores the default agent override', async () => {
    vi.stubEnv('PI_CONFIG_DIR', '.custom-omp');
    vi.stubEnv('PI_CODING_AGENT_DIR', join(home, 'override'));
    vi.stubEnv('PI_PROFILE', 'legacy');
    vi.stubEnv('OMP_PROFILE', 'work');
    const path = join(home, '.custom-omp', 'profiles', 'work', 'agent', 'config.yml');

    await writeConfig({ modelRoles: { default: 'vendor/work' } });
    expect(getConfigPath()).toBe(path);
    expect(await readFile(path, 'utf-8')).toContain('vendor/work');
    await expect(readFile(join(home, 'override', 'config.yml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses PI_PROFILE only when OMP_PROFILE is absent, not explicitly empty', () => {
    vi.stubEnv('PI_PROFILE', 'legacy');
    vi.stubEnv('OMP_PROFILE', undefined);
    expect(getConfigDir()).toBe(join(home, '.omp', 'profiles', 'legacy', 'agent'));
    vi.stubEnv('OMP_PROFILE', '');
    expect(getConfigDir()).toBe(join(home, '.omp', 'agent'));
  });

  it('does not adopt an inherited named-profile directory when selecting default', () => {
    vi.stubEnv('OMP_PROFILE', 'default');
    vi.stubEnv('PI_PROFILE', 'work');
    vi.stubEnv('PI_CODING_AGENT_DIR', join(home, '.omp', 'profiles', 'work', 'agent'));
    expect(getConfigDir()).toBe(join(home, '.omp', 'agent'));
  });

  it.each(['../work', 'work.', 'CON', 'a/b', 'UPPER'])(
    'refuses invalid profile %s instead of writing elsewhere',
    async (profile) => {
      vi.stubEnv('OMP_PROFILE', profile);
      await expect(writeConfig({ modelRoles: {} })).rejects.toThrow('Invalid OMP profile');
    }
  );

  it('surfaces an unreadable config instead of treating it as empty', async () => {
    const agent = getConfigDir();
    await mkdir(join(agent, 'config.yml'), { recursive: true });
    await expect(readConfig()).rejects.toThrow('Failed to read OMP config');
  });
});

describe('isOmpDefaultThinkingLevel', () => {
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'])('accepts %s', (level) => {
    expect(isOmpDefaultThinkingLevel(level)).toBe(true);
  });

  it.each(['off', '', 'HIGH', null, 42])('rejects %j', (level) => {
    expect(isOmpDefaultThinkingLevel(level)).toBe(false);
  });
});
