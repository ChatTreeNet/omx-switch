import { copyFile, readFile, rm, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join, parse as parsePath } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';
import type { OhMyOpenAgentConfig, OpenEditorTargetMode, VibePulseConfig } from '@/types/opencodeConfig';

export const CONFIG_DIR = join(homedir(), '.config', 'opencode');
export const CONFIG_PATH = join(CONFIG_DIR, 'oh-my-openagent.jsonc');
export const LEGACY_CONFIG_PATH = join(CONFIG_DIR, 'oh-my-opencode.jsonc');
export const PROJECT_CONFIG_DIR = '.opencode';
export const PROJECT_CONFIG_JSONC = 'oh-my-openagent.jsonc';
export const PROJECT_CONFIG_JSON = 'oh-my-openagent.json';
export const OH_MY_OPENAGENT_CONFIG_SCHEMA = 'https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-openagent.schema.json';
export const DEFAULT_OPEN_EDITOR_TARGET_MODE: OpenEditorTargetMode = 'remote';

export type OpenCodeConfig = OhMyOpenAgentConfig;

export interface EffectiveConfigOptions {
  userConfigPath?: string;
  projectStartDir?: string;
  projectConfigPath?: string | null;
}

export interface LegacyMigrationOptions {
  legacyPath?: string;
  canonicalPath?: string;
  backupPath?: string;
  now?: () => Date;
  writeCanonicalConfig?: (config: OpenCodeConfig, canonicalPath: string) => Promise<void>;
}

export interface LegacyMigrationResult {
  migrated: boolean;
  legacyPath: string;
  canonicalPath: string;
  backupPath?: string;
  reason?: 'legacy-missing' | 'canonical-exists';
}

export function normalizeOpenEditorTargetMode(value: unknown): OpenEditorTargetMode {
  return value === 'hub' ? 'hub' : DEFAULT_OPEN_EDITOR_TARGET_MODE;
}

export function normalizeVibePulseConfig(value: unknown): VibePulseConfig {
  const vibepulse = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

  return {
    ...vibepulse,
    openEditorTargetMode: normalizeOpenEditorTargetMode(vibepulse.openEditorTargetMode),
  };
}

export function getCanonicalUserConfigPath(): string {
  return CONFIG_PATH;
}

export function getLegacyUserConfigPath(): string {
  return LEGACY_CONFIG_PATH;
}

export function detectLegacyConfig(legacyPath: string = LEGACY_CONFIG_PATH): boolean {
  try {
    return existsSync(legacyPath);
  } catch {
    return false;
  }
}

export function resolveConfigPath(configPath: string = CONFIG_PATH): string {
  if (configPath !== CONFIG_PATH) {
    return configPath;
  }

  if (existsSync(CONFIG_PATH)) {
    return CONFIG_PATH;
  }

  if (existsSync(LEGACY_CONFIG_PATH)) {
    return LEGACY_CONFIG_PATH;
  }

  return CONFIG_PATH;
}

export function detectConfig(configPath: string = CONFIG_PATH): boolean {
  try {
    return existsSync(resolveConfigPath(configPath));
  } catch {
    return false;
  }
}

export function findProjectConfigPath(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (true) {
    const jsoncPath = join(currentDir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_JSONC);
    if (existsSync(jsoncPath)) {
      return jsoncPath;
    }

    const jsonPath = join(currentDir, PROJECT_CONFIG_DIR, PROJECT_CONFIG_JSON);
    if (existsSync(jsonPath)) {
      return jsonPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeConfig(base: OpenCodeConfig, overlay: OpenCodeConfig): OpenCodeConfig {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];

    if (isPlainObject(baseValue) && isPlainObject(overlayValue)) {
      merged[key] = mergeConfig(baseValue as OpenCodeConfig, overlayValue as OpenCodeConfig);
      continue;
    }

    merged[key] = overlayValue;
  }

  return merged as OpenCodeConfig;
}

export async function readConfig(configPath: string = CONFIG_PATH): Promise<OpenCodeConfig> {
  try {
    const content = await readFile(resolveConfigPath(configPath), 'utf-8');
    const config = parse(content, null, false) as OpenCodeConfig;
    return config;
  } catch {
    return {};
  }
}

export async function readEffectiveConfig(options: EffectiveConfigOptions = {}): Promise<OpenCodeConfig> {
  const userConfig = await readConfig(options.userConfigPath);
  const projectConfigPath = options.projectConfigPath === undefined
    ? findProjectConfigPath(options.projectStartDir)
    : options.projectConfigPath;

  if (!projectConfigPath) {
    return userConfig;
  }

  const projectConfig = await readConfig(projectConfigPath);
  return mergeConfig(userConfig, projectConfig);
}

export async function writeConfig(
  config: OpenCodeConfig, 
  configPath: string = CONFIG_PATH
): Promise<void> {
  try {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    const shouldEnforceSchema = configPath === CONFIG_PATH;
    const configWithSchema: OpenCodeConfig = shouldEnforceSchema
      ? {
          ...config,
          $schema: config.$schema || OH_MY_OPENAGENT_CONFIG_SCHEMA,
        }
      : config;

    const content = stringify(configWithSchema, null, 2);
    await writeFile(configPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write config: ${error}`);
  }
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function defaultBackupPath(legacyPath: string, date: Date): string {
  const parsed = parsePath(legacyPath);
  return join(parsed.dir, `${parsed.base}.backup-${formatBackupTimestamp(date)}`);
}

export async function migrateLegacyConfig(options: LegacyMigrationOptions = {}): Promise<LegacyMigrationResult> {
  const legacyPath = options.legacyPath ?? LEGACY_CONFIG_PATH;
  const canonicalPath = options.canonicalPath ?? CONFIG_PATH;

  if (!existsSync(legacyPath)) {
    return { migrated: false, legacyPath, canonicalPath, reason: 'legacy-missing' };
  }

  if (existsSync(canonicalPath)) {
    return { migrated: false, legacyPath, canonicalPath, reason: 'canonical-exists' };
  }

  const backupPath = options.backupPath ?? defaultBackupPath(legacyPath, options.now?.() ?? new Date());
  const canonicalDir = dirname(canonicalPath);
  if (!existsSync(canonicalDir)) {
    mkdirSync(canonicalDir, { recursive: true });
  }

  await copyFile(legacyPath, backupPath);

  try {
    const legacyConfig = await readConfig(legacyPath);
    const writeCanonicalConfig = options.writeCanonicalConfig ?? writeConfig;
    await writeCanonicalConfig(legacyConfig, canonicalPath);
    return { migrated: true, legacyPath, canonicalPath, backupPath };
  } catch (error) {
    await rm(canonicalPath, { force: true });
    throw error;
  }
}
