import { NextResponse } from 'next/server';
import { getOmpProfileById, readOmpProfileConfig } from '@/lib/profiles/ompStorage';
import { createExportedOmpProfileFile } from '@/lib/profiles/ompShare';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const profile = await getOmpProfileById(id);

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const config = await readOmpProfileConfig(id);
    const payload = createExportedOmpProfileFile(profile, config);
    const filename = `${profile.id}.omx-omp-profile.json`;

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
