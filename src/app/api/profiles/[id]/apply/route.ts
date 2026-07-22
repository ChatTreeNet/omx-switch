import { NextRequest, NextResponse } from 'next/server';
import {
  readProfileConfig,
  getProfileById,
  setActiveProfileId,
} from '@/lib/profiles/storage';
import { mergeConfig, readConfig, writeConfig } from '@/lib/omoConfig';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getProfileById(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const profileConfig = await readProfileConfig(id);
    const currentConfig = await readConfig();
    const mergedConfig = mergeConfig(currentConfig, profileConfig);
    let configWasWritten = false;

    try {
      await writeConfig(mergedConfig);
      configWasWritten = true;
      await setActiveProfileId(id);
    } catch (error) {
      if (configWasWritten) {
        await writeConfig(currentConfig);
      }
      throw error;
    }

    return NextResponse.json({
      message: 'Profile applied successfully',
      profile,
      config: profileConfig,
    });
  } catch (error) {
    console.error('Error applying profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
