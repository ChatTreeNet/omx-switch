import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readConfig } from './ompConfig';

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
