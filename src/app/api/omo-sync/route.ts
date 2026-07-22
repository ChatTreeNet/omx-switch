import { NextResponse } from 'next/server';

const UPSTREAM_REPO_API = 'https://api.github.com/repos/code-yeongyu/oh-my-openagent';
const STALE_THRESHOLD_DAYS = 60;
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * GET /api/omo-sync
 * Reports whether the upstream OMO repository has gone stale (no push in 60 days)
 */
export async function GET() {
  try {
    const response = await fetch(UPSTREAM_REPO_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const payload = await response.json();
    const pushedAt = typeof payload?.pushed_at === 'string' ? payload.pushed_at : null;
    const pushedAtMs = pushedAt ? Date.parse(pushedAt) : NaN;

    if (!pushedAt || Number.isNaN(pushedAtMs)) {
      throw new Error('GitHub API response is missing pushed_at');
    }

    const daysSincePush = (Date.now() - pushedAtMs) / DAY_MS;

    return NextResponse.json({
      needsSync: daysSincePush > STALE_THRESHOLD_DAYS,
      daysSincePush: Math.floor(daysSincePush),
      lastPush: pushedAt,
    });
  } catch (error) {
    console.error('[omo-sync] failed to check upstream status:', error);
    return NextResponse.json(
      {
        needsSync: false,
        daysSincePush: null,
        lastPush: null,
        error: 'Failed to check OMO upstream status',
      },
      { status: 503 }
    );
  }
}
