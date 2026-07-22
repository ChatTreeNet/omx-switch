import { NextRequest, NextResponse } from 'next/server';
import {
  readOmpProfileIndex,
  writeOmpProfileIndex,
  getOmpProfileById,
  writeOmpProfileConfig,
} from '@/lib/profiles/ompStorage';
import type { Profile } from '@/types/omoConfig';

export async function GET() {
  try {
    const index = await readOmpProfileIndex();

    return NextResponse.json({
      profiles: index.profiles,
      activeProfileId: index.activeProfileId,
    });
  } catch (error) {
    console.error('Error reading OMP profiles:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Support both { id, name, ... } and { profile: { id, name, ... }, config } formats
    const profileData = body.profile || body;
    const { id, name, emoji, description } = profileData;
    const config = body.config || profileData.config;

    if (!id || typeof id !== 'string' || id.trim() === '') {
      return NextResponse.json(
        { error: 'Profile ID is required' },
        { status: 400 }
      );
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: 'Profile name is required' },
        { status: 400 }
      );
    }

    const existingProfile = await getOmpProfileById(id);
    if (existingProfile) {
      return NextResponse.json(
        { error: 'Profile with this ID already exists' },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json(
        { error: 'Profile ID can only contain letters, numbers, hyphens, and underscores' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const newProfile: Profile = {
      id,
      name: name.trim(),
      emoji: emoji || '⚙️',
      description: description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      isDefault: false,
      isBuiltIn: false,
    };

    const index = await readOmpProfileIndex();
    index.profiles.push(newProfile);
    await writeOmpProfileIndex(index);

    try {
      if (config && typeof config === 'object') {
        await writeOmpProfileConfig(id, config);
      } else {
        await writeOmpProfileConfig(id, { modelRoles: {} });
      }
    } catch {
      index.profiles = index.profiles.filter((p) => p.id !== id);
      await writeOmpProfileIndex(index);
      throw new Error('Failed to persist profile config');
    }

    return NextResponse.json(
      { profile: newProfile },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating OMP profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
