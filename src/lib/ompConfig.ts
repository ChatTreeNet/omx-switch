import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';
import { isPlainObject } from '@/lib/configValidation';

function normalizeProfileName(value: string | undefined): string | undefined {
  const profile = value?.trim();
  if (!profile || profile === 'default') return undefined;
  if (
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile)
    || profile === '.'
    || profile === '..'
    || profile.endsWith('.')
    || /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(profile)
  ) {
    throw new Error(`Invalid OMP profile: "${value}"`);
  }
  return profile;
}

/** Match OMP 18's active profile and agent-directory precedence. */
export function getConfigDir(): string {
  const root = join(homedir(), process.env.PI_CONFIG_DIR || '.omp');
  const profile = normalizeProfileName(process.env.OMP_PROFILE ?? process.env.PI_PROFILE);
  if (profile) return join(root, 'profiles', profile, 'agent');

  const override = process.env.PI_CODING_AGENT_DIR;
  // OMP propagates a profile-derived directory to child processes. An explicit
  // default profile must not adopt that inherited directory as an override.
  let inheritedProfile: string | undefined;
  try {
    inheritedProfile = normalizeProfileName(process.env.PI_PROFILE);
  } catch {
    // A bypassed legacy variable does not invalidate the canonical selection.
  }
  if (
    override
    && !(inheritedProfile && override === join(root, 'profiles', inheritedProfile, 'agent'))
  ) {
    return resolve(override);
  }
  return join(root, 'agent');
}

export function getConfigPath(configDir: string = getConfigDir()): string {
  const canonical = join(configDir, 'config.yml');
  const alternate = join(configDir, 'config.yaml');
  return existsSync(canonical) || !existsSync(alternate) ? canonical : alternate;
}

export const OMP_DEFAULT_THINKING_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'auto',
] as const;

export type OmpDefaultThinkingLevel = (typeof OMP_DEFAULT_THINKING_LEVELS)[number];

export function isOmpDefaultThinkingLevel(value: unknown): value is OmpDefaultThinkingLevel {
  return typeof value === 'string'
    && OMP_DEFAULT_THINKING_LEVELS.some((level) => level === value);
}

/**
 * OMP (Oh My Pi) config. Only the settings managed by OMX Switch are typed;
 * every other setting is preserved opaquely so writes never drop fields the
 * CLI manages.
 */
export interface OmpConfig {
  modelRoles?: Record<string, string>;
  defaultThinkingLevel?: OmpDefaultThinkingLevel;
  [key: string]: unknown;
}

export function detectConfig(configPath: string = getConfigPath()): boolean {
  try {
    return existsSync(configPath);
  } catch {
    return false;
  }
}

export async function readConfig(configPath: string = getConfigPath()): Promise<OmpConfig> {
  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Failed to read OMP config at ${configPath}: ${error}`);
  }

  try {
    const config: unknown = parse(content);
    if (config === null) {
      return {};
    }
    if (!isPlainObject(config)) {
      throw new Error('config root must be a mapping');
    }
    return config;
  } catch (error) {
    // A malformed file must surface loudly: callers would otherwise merge
    // into {} and silently overwrite the user's recoverable config
    throw new Error(`Failed to parse OMP config at ${configPath}: ${error}`);
  }
}

export async function writeConfig(
  config: OmpConfig,
  configPath: string = getConfigPath()
): Promise<void> {
  try {
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    await writeFile(configPath, stringify(config), 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write OMP config: ${error}`);
  }
}
