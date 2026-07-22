import type { Profile } from '@/types/omoConfig';
import { normalizeOmpProfileConfig, type OmpProfileConfig } from './ompStorage';

export interface ExportedOmpProfileFile {
  version: 1;
  source: 'omx-switch';
  exportedAt: string;
  profile: {
    id: string;
    name: string;
    emoji: string;
    description?: string;
  };
  config: OmpProfileConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createExportedOmpProfileFile(
  profile: Profile,
  config: OmpProfileConfig
): ExportedOmpProfileFile {
  return {
    version: 1,
    source: 'omx-switch',
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name,
      emoji: profile.emoji,
      description: profile.description,
    },
    config: normalizeOmpProfileConfig(config),
  };
}

export function parseImportedOmpProfileFile(value: unknown): {
  profile: ExportedOmpProfileFile['profile'];
  config: OmpProfileConfig;
} {
  if (!isRecord(value)) {
    throw new Error('Imported profile file must be a JSON object');
  }

  const profileValue = value.profile;
  if (!isRecord(profileValue)) {
    throw new Error('Imported profile file is missing a valid profile block');
  }

  const id = profileValue.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Imported profile id is required');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id.trim())) {
    throw new Error('Imported profile id must contain only letters, numbers, hyphens, and underscores');
  }

  const name = profileValue.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Imported profile name is required');
  }

  const emojiValue = profileValue.emoji;
  const descriptionValue = profileValue.description;

  return {
    profile: {
      id: id.trim(),
      name: name.trim(),
      emoji: typeof emojiValue === 'string' && emojiValue.trim() ? emojiValue : '⚙️',
      description:
        typeof descriptionValue === 'string' && descriptionValue.trim()
          ? descriptionValue.trim()
          : undefined,
    },
    config: normalizeOmpProfileConfig(value.config),
  };
}
