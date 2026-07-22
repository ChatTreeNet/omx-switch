import { NextRequest, NextResponse } from 'next/server';
import {
  readOmpProfileConfig,
  getOmpProfileById,
  setOmpActiveProfileId,
} from '@/lib/profiles/ompStorage';
import { readConfig, writeConfig } from '@/lib/ompConfig';
import { isPlainObject } from '@/lib/configValidation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getOmpProfileById(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const profileConfig = await readOmpProfileConfig(id);
    const currentConfig = await readConfig();

    // Merge per-key: profile assignments win, unmentioned roles/chains keep
    // their current values, and every other config.yml field is untouched.
    const currentRoles = isPlainObject(currentConfig.modelRoles)
      ? (currentConfig.modelRoles as Record<string, string>)
      : {};
    const currentRetry = isPlainObject(currentConfig.retry) ? { ...currentConfig.retry } : {};
    const currentChains = isPlainObject(currentRetry.fallbackChains)
      ? (currentRetry.fallbackChains as Record<string, string[]>)
      : {};

    const mergedConfig = {
      ...currentConfig,
      modelRoles: { ...currentRoles, ...(profileConfig.modelRoles ?? {}) },
      retry: {
        ...currentRetry,
        fallbackChains: { ...currentChains, ...(profileConfig.fallbackChains ?? {}) },
        ...(profileConfig.modelFallback !== undefined
          ? { modelFallback: profileConfig.modelFallback }
          : {}),
      },
    };

    try {
      await writeConfig(mergedConfig);
      await setOmpActiveProfileId(id);
    } catch (error) {
      await writeConfig(currentConfig).catch(() => {});
      throw error;
    }

    return NextResponse.json({
      message: 'Profile applied successfully',
      profile,
      config: profileConfig,
    });
  } catch (error) {
    console.error('Error applying OMP profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
