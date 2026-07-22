import { NextRequest, NextResponse } from 'next/server';
import {
  readOmpProfileIndex,
  writeOmpProfileIndex,
  getOmpProfileById,
  readOmpProfileConfig,
  writeOmpProfileConfig,
  deleteOmpProfileConfig,
} from '@/lib/profiles/ompStorage';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getOmpProfileById(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const config = await readOmpProfileConfig(id);

    return NextResponse.json({ profile, config });
  } catch (error) {
    console.error('Error reading OMP profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getOmpProfileById(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Support both { name, ... } and { profile: { name, ... }, config } formats
    const profileData = body.profile || body;
    const { name, description, emoji } = profileData;
    const config = body.config || profileData.config;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return NextResponse.json(
          { error: 'Profile name must be a non-empty string' },
          { status: 400 }
        );
      }
      profile.name = name.trim();
    }

    if (description !== undefined) {
      profile.description = description?.trim() || undefined;
    }

    if (emoji !== undefined) {
      profile.emoji = emoji || '⚙️';
    }

    profile.updatedAt = new Date().toISOString();

    const index = await readOmpProfileIndex();
    const profileIndex = index.profiles.findIndex((p) => p.id === id);

    if (profileIndex === -1) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    index.profiles[profileIndex] = profile;
    await writeOmpProfileIndex(index);

    if (config && typeof config === 'object') {
      await writeOmpProfileConfig(id, config);
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Error updating OMP profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getOmpProfileById(id);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const index = await readOmpProfileIndex();
    index.profiles = index.profiles.filter((p) => p.id !== id);
    if (index.activeProfileId === id) {
      index.activeProfileId = null;
    }
    await writeOmpProfileIndex(index);
    await deleteOmpProfileConfig(id);

    return NextResponse.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    console.error('Error deleting OMP profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
