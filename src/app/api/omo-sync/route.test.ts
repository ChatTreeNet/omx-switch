import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const DAY_MS = 1000 * 60 * 60 * 24;

function pushedAtDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function mockGitHubResponse(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ));
}

describe('/api/omo-sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no sync needed for a freshly pushed upstream repo', async () => {
    const lastPush = pushedAtDaysAgo(10);
    mockGitHubResponse({ pushed_at: lastPush });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.needsSync).toBe(false);
    expect(data.daysSincePush).toBe(10);
    expect(data.lastPush).toBe(lastPush);
  });

  it('flags sync when the upstream repo is stale for 90 days', async () => {
    const lastPush = pushedAtDaysAgo(90);
    mockGitHubResponse({ pushed_at: lastPush });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.needsSync).toBe(true);
    expect(data.daysSincePush).toBe(90);
    expect(data.lastPush).toBe(lastPush);
  });

  it('returns 503 with an error payload when the GitHub request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.needsSync).toBe(false);
    expect(data.daysSincePush).toBeNull();
    expect(data.lastPush).toBeNull();
    expect(data.error).toBe('Failed to check OMO upstream status');
  });

  it('returns 503 when the GitHub response is missing pushed_at', async () => {
    mockGitHubResponse({ full_name: 'code-yeongyu/oh-my-openagent' });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe('Failed to check OMO upstream status');
  });

  it('returns 503 when GitHub responds with a non-OK status', async () => {
    mockGitHubResponse({ message: 'rate limited' }, 403);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.needsSync).toBe(false);
  });
});
