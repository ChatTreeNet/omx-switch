import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findProjectConfigPath,
  migrateLegacyConfig,
  OH_MY_OPENAGENT_CONFIG_SCHEMA,
  readEffectiveConfig,
  normalizeVibePulseConfig,
  readConfig,
  writeConfig,
} from './opencodeConfig';
import { readFile, writeFile, unlink, mkdir, mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type { CategoryConfig, OhMyOpenAgentConfig, ProfileConfig } from '@/types/opencodeConfig';

const TEST_CONFIG_DIR = join(tmpdir(), 'vibepulse-test-' + Date.now());
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'oh-my-openagent.jsonc');
const FIXTURE_DIR = join(process.cwd(), 'src', 'lib', 'fixtures', 'opencode-config');
const LEGACY_V3_FIXTURE_PATH = join(FIXTURE_DIR, 'oh-my-opencode.v3.jsonc');
const CANONICAL_V4_FIXTURE_PATH = join(FIXTURE_DIR, 'oh-my-openagent.v4.jsonc');
const SECRET_LIKE_V4_FIXTURE_PATH = join(FIXTURE_DIR, 'oh-my-openagent.v4.secret-like.jsonc');

const typedV4Config: OhMyOpenAgentConfig = {
  team_mode: {
    enabled: true,
    futureTeamModeField: 'preserved',
  },
  agents: {
    sisyphus: {
      model: 'anthropic/claude-opus-4-6',
      variant: 'max',
      reasoningEffort: 'max',
      maxTokens: 64000,
      thinking: { enabled: true, budget_tokens: 12000 },
      fallback_models: [
        'openai/gpt-5.4',
        {
          model: 'google/gemini-3.1-pro',
          variant: 'high',
          reasoningEffort: 'max',
          temperature: 0.1,
          top_p: 0.95,
          maxTokens: 32000,
          thinking: { enabled: true },
          futureFallbackField: 'preserved',
        },
      ],
    },
  },
};

const categoryWithFutureFields: CategoryConfig = {
  model: 'openai/gpt-5.4',
  reasoningEffort: 'max',
  fallback_models: [{ model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max' }],
  futureCategoryField: true,
};

const profileWithFutureFields: ProfileConfig = {
  agents: typedV4Config.agents ?? {},
  categories: {
    ultrabrain: categoryWithFutureFields,
  },
  futureProfileField: { enabled: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function cleanup() {
  try {
    if (existsSync(TEST_CONFIG_PATH)) {
      await unlink(TEST_CONFIG_PATH);
    }
  } catch {}
}

describe('opencodeConfig', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('config echo bug fixes', () => {
    it('should correctly read config immediately after saving', async () => {
      const originalConfig = {
        agents: {
          sisyphus: {
            model: 'claude-sonnet-4-20250514',
            variant: 'high',
            temperature: 0.2,
            top_p: 0.9,
          },
        },
        categories: {
          coding: { model: 'gpt-4', variant: 'high' },
        },
      };

      await writeConfig(originalConfig, TEST_CONFIG_PATH);
      const echoed = await readConfig(TEST_CONFIG_PATH);

      expect(echoed).toEqual(originalConfig);
    });

    it('should not lose other fields during partial update', async () => {
      await writeConfig({
        agents: {
          sisyphus: { model: 'claude', temperature: 0.5 },
          prometheus: { model: 'gpt-4', temperature: 0.7 },
        },
      }, TEST_CONFIG_PATH);

      const loaded = await readConfig(TEST_CONFIG_PATH);
      const existingAgents = isRecord(loaded.agents) ? loaded.agents : {};
      const existingSisyphus = isRecord(existingAgents.sisyphus) ? existingAgents.sisyphus : {};
      const updated = {
        ...loaded,
        agents: {
          ...existingAgents,
          sisyphus: { ...existingSisyphus, temperature: 0.9 },
        },
      };

      await writeConfig(updated, TEST_CONFIG_PATH);
      const final = await readConfig(TEST_CONFIG_PATH);

      expect(final.agents?.prometheus).toEqual({ model: 'gpt-4', temperature: 0.7 });
    });

    it('should return empty object when file does not exist', async () => {
      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });

    it('should return empty object for invalid JSON', async () => {
      await mkdir(TEST_CONFIG_DIR, { recursive: true });
      await writeFile(TEST_CONFIG_PATH, 'invalid {{{ json');

      const config = await readConfig(TEST_CONFIG_PATH);
      expect(config).toEqual({});
    });

    it('normalizes missing openEditorTargetMode to remote', () => {
      expect(normalizeVibePulseConfig({ stickyBusyDelayMs: 1000 })).toEqual({
        stickyBusyDelayMs: 1000,
        openEditorTargetMode: 'remote',
      });
    });

    it('preserves hub openEditorTargetMode when configured', () => {
      expect(normalizeVibePulseConfig({ openEditorTargetMode: 'hub' })).toEqual({
        openEditorTargetMode: 'hub',
      });
    });

    it('injects the canonical schema when writing the default config path', async () => {
      vi.resetModules();
      const testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-home-'));
      const originalHome = process.env.HOME;

      process.env.HOME = testHomeDir;

      try {
        const { CONFIG_PATH: defaultConfigPath, readConfig: readDefaultConfig, writeConfig: writeDefaultConfig } = await import('./opencodeConfig');

        await writeDefaultConfig({ agents: { sisyphus: { model: 'claude' } } });

        const persisted = await readDefaultConfig(defaultConfigPath);

        expect(persisted.$schema).toBe(OH_MY_OPENAGENT_CONFIG_SCHEMA);
      } finally {
        process.env.HOME = originalHome;
        await rm(testHomeDir, { recursive: true, force: true });
      }
    });

    it('detects and reads the legacy default config when the new file is absent', async () => {
      vi.resetModules();
      const testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-home-'));
      const originalHome = process.env.HOME;

      process.env.HOME = testHomeDir;

      try {
        const {
          LEGACY_CONFIG_PATH: legacyConfigPath,
          detectConfig: detectDefaultConfig,
          readConfig: readDefaultConfig,
        } = await import('./opencodeConfig');

        await mkdir(join(testHomeDir, '.config', 'opencode'), { recursive: true });
        await writeFile(legacyConfigPath, '{"agents":{"sisyphus":{"model":"claude"}}}');

        expect(detectDefaultConfig()).toBe(true);

        const config = await readDefaultConfig();

        expect(config.agents?.sisyphus).toEqual({ model: 'claude' });
      } finally {
        process.env.HOME = originalHome;
        await rm(testHomeDir, { recursive: true, force: true });
      }
    });

    it('detects and reads the canonical default config when only the canonical file exists', async () => {
      vi.resetModules();
      const testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-home-'));
      const originalHome = process.env.HOME;

      process.env.HOME = testHomeDir;

      try {
        const {
          CONFIG_PATH: defaultConfigPath,
          LEGACY_CONFIG_PATH: legacyConfigPath,
          detectConfig: detectDefaultConfig,
          detectLegacyConfig: detectDefaultLegacyConfig,
          readConfig: readDefaultConfig,
        } = await import('./opencodeConfig');

        await mkdir(join(testHomeDir, '.config', 'opencode'), { recursive: true });
        await writeFile(defaultConfigPath, '{"agents":{"sisyphus":{"model":"canonical"}}}');

        expect(detectDefaultConfig()).toBe(true);
        expect(detectDefaultLegacyConfig()).toBe(false);
        expect(legacyConfigPath).toContain('oh-my-opencode.jsonc');

        const config = await readDefaultConfig();

        expect(config.agents?.sisyphus).toEqual({ model: 'canonical' });
      } finally {
        process.env.HOME = originalHome;
        await rm(testHomeDir, { recursive: true, force: true });
      }
    });

    it('prefers canonical config when canonical and legacy files both exist', async () => {
      vi.resetModules();
      const testHomeDir = await mkdtemp(join(tmpdir(), 'vibepulse-home-'));
      const originalHome = process.env.HOME;

      process.env.HOME = testHomeDir;

      try {
        const {
          CONFIG_PATH: defaultConfigPath,
          LEGACY_CONFIG_PATH: legacyConfigPath,
          detectLegacyConfig: detectDefaultLegacyConfig,
          readConfig: readDefaultConfig,
        } = await import('./opencodeConfig');

        await mkdir(join(testHomeDir, '.config', 'opencode'), { recursive: true });
        await writeFile(defaultConfigPath, '{"agents":{"sisyphus":{"model":"canonical"}}}');
        await writeFile(legacyConfigPath, '{"agents":{"sisyphus":{"model":"legacy"}}}');

        expect(detectDefaultLegacyConfig()).toBe(true);

        const config = await readDefaultConfig();

        expect(config.agents?.sisyphus).toEqual({ model: 'canonical' });
      } finally {
        process.env.HOME = originalHome;
        await rm(testHomeDir, { recursive: true, force: true });
      }
    });

    it('finds the nearest ancestor project config', async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'vibepulse-project-'));
      const nestedDir = join(projectRoot, 'packages', 'app', 'src');
      const rootProjectConfig = join(projectRoot, '.opencode', 'oh-my-openagent.jsonc');
      const nearestProjectConfig = join(projectRoot, 'packages', 'app', '.opencode', 'oh-my-openagent.json');

      try {
        await mkdir(dirname(rootProjectConfig), { recursive: true });
        await mkdir(dirname(nearestProjectConfig), { recursive: true });
        await mkdir(nestedDir, { recursive: true });
        await writeFile(rootProjectConfig, '{"project":{"name":"root"}}');
        await writeFile(nearestProjectConfig, '{"project":{"name":"nearest"}}');

        expect(findProjectConfigPath(nestedDir)).toBe(nearestProjectConfig);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    });

    it('ignores a corrupt project file when reading effective config', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'vibepulse-effective-'));
      const userConfigPath = join(testDir, 'user.jsonc');
      const projectConfigPath = join(testDir, 'project', '.opencode', 'oh-my-openagent.jsonc');

      try {
        await mkdir(dirname(projectConfigPath), { recursive: true });
        await writeFile(userConfigPath, '{"agents":{"sisyphus":{"model":"user"}}}');
        await writeFile(projectConfigPath, 'not valid {{{ json');

        const config = await readEffectiveConfig({ userConfigPath, projectConfigPath });

        expect(config.agents?.sisyphus).toEqual({ model: 'user' });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('uses project config when the user file is missing while reading effective config', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'vibepulse-effective-'));
      const missingUserConfigPath = join(testDir, 'missing-user.jsonc');
      const projectConfigPath = join(testDir, '.opencode', 'oh-my-openagent.jsonc');

      try {
        await mkdir(dirname(projectConfigPath), { recursive: true });
        await writeFile(projectConfigPath, '{"agents":{"sisyphus":{"model":"project"}}}');

        const config = await readEffectiveConfig({ userConfigPath: missingUserConfigPath, projectConfigPath });

        expect(config.agents?.sisyphus).toEqual({ model: 'project' });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('effective config deep-merges user base and project overlay with arrays replaced', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'vibepulse-effective-'));
      const userConfigPath = join(testDir, 'user.jsonc');
      const projectConfigPath = join(testDir, 'workspace', '.opencode', 'oh-my-openagent.jsonc');

      try {
        await mkdir(dirname(projectConfigPath), { recursive: true });
        await writeFile(userConfigPath, JSON.stringify({
          agents: {
            sisyphus: {
              model: 'user-model',
              temperature: 0.2,
              fallback_models: ['user-fallback'],
              nested: { keep: true, replace: 'user' },
            },
            prometheus: { model: 'user-prometheus' },
          },
          future_top_level: { keep: true },
        }));
        await writeFile(projectConfigPath, JSON.stringify({
          agents: {
            sisyphus: {
              variant: 'max',
              fallback_models: ['project-fallback'],
              nested: { replace: 'project' },
            },
          },
        }));

        const config = await readEffectiveConfig({ userConfigPath, projectConfigPath });

        expect(config.agents?.sisyphus).toEqual({
          model: 'user-model',
          temperature: 0.2,
          variant: 'max',
          fallback_models: ['project-fallback'],
          nested: { keep: true, replace: 'project' },
        });
        expect(config.agents?.prometheus).toEqual({ model: 'user-prometheus' });
        expect(config.future_top_level).toEqual({ keep: true });
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('migrates legacy config explicitly with a timestamped backup', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'vibepulse-migrate-'));
      const legacyPath = join(testDir, 'oh-my-opencode.jsonc');
      const canonicalPath = join(testDir, 'oh-my-openagent.jsonc');

      try {
        await writeFile(legacyPath, '{"agents":{"sisyphus":{"model":"legacy"}}}');

        const result = await migrateLegacyConfig({
          legacyPath,
          canonicalPath,
          now: () => new Date('2026-05-11T12:00:00.000Z'),
        });

        expect(result).toEqual({
          migrated: true,
          legacyPath,
          canonicalPath,
          backupPath: join(testDir, 'oh-my-opencode.jsonc.backup-2026-05-11T12-00-00-000Z'),
        });
        expect(await readConfig(canonicalPath)).toEqual({ agents: { sisyphus: { model: 'legacy' } } });
        expect(await readFile(result.backupPath!, 'utf-8')).toBe('{"agents":{"sisyphus":{"model":"legacy"}}}');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('migration rollback keeps legacy and backup when canonical write fails', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'vibepulse-migrate-'));
      const legacyPath = join(testDir, 'oh-my-opencode.jsonc');
      const canonicalPath = join(testDir, 'oh-my-openagent.jsonc');
      const backupPath = join(testDir, 'legacy.backup');

      await writeFile(legacyPath, '{"agents":{"sisyphus":{"model":"legacy"}}}');

      try {
        await expect(migrateLegacyConfig({
          legacyPath,
          canonicalPath,
          backupPath,
          writeCanonicalConfig: async () => {
            await writeFile(canonicalPath, 'partial canonical');
            throw new Error('canonical write failed');
          },
        })).rejects.toThrow('canonical write failed');

        expect(await readFile(legacyPath, 'utf-8')).toBe('{"agents":{"sisyphus":{"model":"legacy"}}}');
        expect(await readFile(backupPath, 'utf-8')).toBe('{"agents":{"sisyphus":{"model":"legacy"}}}');
        expect(existsSync(canonicalPath)).toBe(false);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('reads the legacy v3 basename fixture', async () => {
      const config = await readConfig(LEGACY_V3_FIXTURE_PATH);

      expect(config.$schema).toContain('oh-my-opencode.schema.json');
      expect(config.agents?.sisyphus).toEqual({
        model: 'anthropic/claude-sonnet-4-5',
        variant: 'high',
        temperature: 0.2,
        top_p: 0.9,
      });
    });

    it('preserves canonical v4 team mode, fallback model objects, and future fields', async () => {
      const config = await readConfig(CANONICAL_V4_FIXTURE_PATH);

      expect(config.$schema).toBe('https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-openagent.schema.json');
      expect(config.team_mode).toEqual({
        enabled: true,
        workspace: 'team-alpha',
        future_policy: { approval: 'required' },
      });
      expect(config.agents?.sisyphus?.reasoningEffort).toBe('max');
      expect(config.agents?.sisyphus?.maxTokens).toBe(64000);
      expect(config.agents?.sisyphus?.thinking).toEqual({ type: 'enabled', budget_tokens: 12000 });
      expect(config.agents?.sisyphus?.fallback_models).toEqual([
        'openai/gpt-5.4',
        expect.objectContaining({
          model: 'google/gemini-3.1-pro',
          variant: 'high',
          reasoningEffort: 'max',
          maxTokens: 32000,
          futureFallbackField: 'preserve-me',
        }),
      ]);
      expect(config.categories?.ultrabrain?.fallback_models).toEqual([
        'anthropic/claude-opus-4-6',
        expect.objectContaining({ reasoningEffort: 'max', thinking: { enabled: true } }),
      ]);
      expect(config.categories?.ultrabrain?.future_category_knob).toBe('keep-me');
      expect(config.future_top_level).toEqual({ enabled: true });

      await writeConfig(config, TEST_CONFIG_PATH);
      const echoed = await readConfig(TEST_CONFIG_PATH);

      expect(echoed.team_mode).toEqual(config.team_mode);
      expect(echoed.agents?.sisyphus?.fallback_models).toEqual(config.agents?.sisyphus?.fallback_models);
      expect(echoed.categories?.ultrabrain?.future_category_knob).toBe('keep-me');
      expect(echoed.future_top_level).toEqual({ enabled: true });
    });

    it('keeps secret-like v4 fixture payloads available for later rejection tests', async () => {
      const config = await readConfig(SECRET_LIKE_V4_FIXTURE_PATH);

      expect(config.agents?.['dangerous-example']?.apiKey).toBe('sk-test-do-not-use');
      expect(config.agents?.['dangerous-example']?.fallback_models).toEqual([
        expect.objectContaining({ password: 'example-password' }),
      ]);
      expect(config.future_secret_payload).toEqual({ client_secret: 'example-secret' });
    });

    it('type-checks rich v4 fallback models and future profile/category fields', () => {
      expect(typedV4Config.agents?.sisyphus?.fallback_models).toEqual([
        'openai/gpt-5.4',
        expect.objectContaining({ reasoningEffort: 'max', maxTokens: 32000 }),
      ]);
      expect(profileWithFutureFields.categories?.ultrabrain.futureCategoryField).toBe(true);
      expect(profileWithFutureFields.futureProfileField).toEqual({ enabled: true });
    });
  });
});
