import { readFile, writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { parse, stringify } from 'yaml';

export const CONFIG_DIR = join(homedir(), '.omp', 'agent');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.yml');

/**
 * OMP (Oh My Pi) config. Only modelRoles is typed; every other setting is
 * preserved opaquely so writes never drop fields the CLI manages.
 */
export interface OmpConfig {
  modelRoles?: Record<string, string>;
  [key: string]: unknown;
}

export function detectConfig(configPath: string = CONFIG_PATH): boolean {
  try {
    return existsSync(configPath);
  } catch {
    return false;
  }
}

export async function readConfig(configPath: string = CONFIG_PATH): Promise<OmpConfig> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = parse(content) as OmpConfig | null;
    return config ?? {};
  } catch {
    return {};
  }
}

export async function writeConfig(
  config: OmpConfig,
  configPath: string = CONFIG_PATH
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
