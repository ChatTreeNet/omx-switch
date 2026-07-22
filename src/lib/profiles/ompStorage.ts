import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'comment-json';
import type { Profile, ProfileIndex } from '@/types/omoConfig';

export const OMP_PROFILES_DIR = join(homedir(), '.omp', 'agent', 'profiles');
export const OMP_PROFILE_INDEX_PATH = join(OMP_PROFILES_DIR, 'index.json');

/**
 * OMP profile payload: the model-related slices of ~/.omp/agent/config.yml.
 */
export interface OmpProfileConfig {
  modelRoles?: Record<string, string>;
  fallbackChains?: Record<string, string[]>;
  modelFallback?: boolean;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ensureOmpProfilesDir(): void {
  if (!existsSync(OMP_PROFILES_DIR)) {
    mkdirSync(OMP_PROFILES_DIR, { recursive: true });
  }
}

function getProfileConfigPath(id: string): string {
  return join(OMP_PROFILES_DIR, `${id}.json`);
}

function createDefaultProfileIndex(): ProfileIndex {
  return {
    version: 1,
    profiles: [],
    activeProfileId: null,
    lastModified: new Date().toISOString(),
  };
}

export function normalizeOmpProfileConfig(config: unknown): OmpProfileConfig {
  if (!isRecord(config)) {
    return { modelRoles: {} };
  }

  const normalized: OmpProfileConfig = { ...config };

  normalized.modelRoles = isRecord(config.modelRoles)
    ? Object.fromEntries(
        Object.entries(config.modelRoles).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    : {};

  if (isRecord(config.fallbackChains)) {
    normalized.fallbackChains = Object.fromEntries(
      Object.entries(config.fallbackChains).filter(([, v]) => Array.isArray(v))
    ) as Record<string, string[]>;
  } else {
    delete normalized.fallbackChains;
  }

  if (typeof config.modelFallback !== 'boolean') {
    delete normalized.modelFallback;
  }

  return normalized;
}

export async function readOmpProfileIndexStrict(): Promise<ProfileIndex> {
  ensureOmpProfilesDir();

  if (!existsSync(OMP_PROFILE_INDEX_PATH)) {
    const defaultIndex = createDefaultProfileIndex();
    await writeOmpProfileIndex(defaultIndex);
    return defaultIndex;
  }

  const content = await readFile(OMP_PROFILE_INDEX_PATH, 'utf-8');
  return parse(content, null, false) as unknown as ProfileIndex;
}

export async function readOmpProfileIndex(): Promise<ProfileIndex> {
  try {
    return await readOmpProfileIndexStrict();
  } catch {
    return createDefaultProfileIndex();
  }
}

export async function writeOmpProfileIndex(index: ProfileIndex): Promise<void> {
  ensureOmpProfilesDir();

  index.lastModified = new Date().toISOString();
  await writeFile(OMP_PROFILE_INDEX_PATH, stringify(index, null, 2), 'utf-8');
}

export async function readOmpProfileConfig(id: string): Promise<OmpProfileConfig> {
  try {
    const configPath = getProfileConfigPath(id);

    if (!existsSync(configPath)) {
      return { modelRoles: {} };
    }

    const content = await readFile(configPath, 'utf-8');
    return normalizeOmpProfileConfig(parse(content, null, false));
  } catch {
    return { modelRoles: {} };
  }
}

export async function writeOmpProfileConfig(
  id: string,
  config: OmpProfileConfig
): Promise<void> {
  ensureOmpProfilesDir();

  const configPath = getProfileConfigPath(id);
  await writeFile(configPath, stringify(normalizeOmpProfileConfig(config), null, 2), 'utf-8');
}

export async function deleteOmpProfileConfig(id: string): Promise<boolean> {
  const configPath = getProfileConfigPath(id);

  if (!existsSync(configPath)) {
    return false;
  }

  await unlink(configPath);
  return true;
}

export async function getOmpProfileById(id: string): Promise<Profile | undefined> {
  const index = await readOmpProfileIndex();
  return index.profiles.find((p) => p.id === id);
}

export async function setOmpActiveProfileId(id: string | null): Promise<void> {
  const index = await readOmpProfileIndex();
  index.activeProfileId = id;
  await writeOmpProfileIndex(index);
}
