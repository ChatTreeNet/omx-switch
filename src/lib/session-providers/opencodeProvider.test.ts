import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock('@/lib/opencodeDiscovery', () => ({
  discoverOpencodePortsWithMeta: vi.fn(),
  discoverOpencodeProcessCwdsWithoutPortWithMeta: vi.fn(),
}));

vi.mock('@/lib/sessionArchiveOverrides', () => ({
  clearSessionForceUnarchived: vi.fn(),
  markSessionForceUnarchived: vi.fn(),
  pruneSessionStickyStatusBlocked: vi.fn(),
  pruneSessionForceUnarchived: vi.fn(),
  shouldForceSessionUnarchived: vi.fn(() => false),
  takeSessionStickyStatusBlocked: vi.fn(() => false),
}));

import { createOpencodeClient } from '@opencode-ai/sdk';
import {
  discoverOpencodePortsWithMeta,
  discoverOpencodeProcessCwdsWithoutPortWithMeta,
} from '@/lib/opencodeDiscovery';
import { opencodeLocalSessionProvider } from './opencodeProvider';
import {
  createVibePulseOpencodeClient,
  deleteOpencodeSession,
  formatOpencodeSdkError,
  getOpencodeSession,
  getOpencodeSessionMessages,
  getOpencodeSessionStatus,
  listOpencodeSessions,
  streamOpencodeGlobalEvents,
} from './opencodeSdkCompat';

const mockCreateOpencodeClient: any = createOpencodeClient;
const mockDiscoverPortsWithMeta: any = discoverOpencodePortsWithMeta;
const mockDiscoverProcessCwdsWithoutPortWithMeta: any = discoverOpencodeProcessCwdsWithoutPortWithMeta;

describe('opencode SDK compatibility boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverPortsWithMeta.mockReturnValue({ ports: [7777], timedOut: false });
    mockDiscoverProcessCwdsWithoutPortWithMeta.mockReturnValue({ processes: [], timedOut: false });
  });

  it('wraps current root SDK calls with latest-style response shapes', async () => {
    const signal = new AbortController().signal;
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'session.status' };
      },
    };
    const client = {
      session: {
        list: vi.fn(async () => ({ data: [{ id: 'session-1' }] })),
        status: vi.fn(async () => ({ data: { 'session-1': { type: 'busy' } } })),
        messages: vi.fn(async () => ({ data: [{ parts: [{ state: { status: 'running' } }] }] })),
        get: vi.fn(async () => ({ data: { id: 'session-1', directory: '/tmp/project' } })),
        delete: vi.fn(async () => ({ data: { success: true } })),
      },
      global: {
        event: vi.fn(async () => ({ stream })),
      },
    };
    mockCreateOpencodeClient.mockReturnValue(client);

    const createdClient = createVibePulseOpencodeClient('http://localhost:7777');

    await expect(listOpencodeSessions(createdClient, signal)).resolves.toEqual({ data: [{ id: 'session-1' }] });
    await expect(getOpencodeSessionStatus(createdClient, signal)).resolves.toEqual({ data: { 'session-1': { type: 'busy' } } });
    await expect(getOpencodeSessionMessages(createdClient, 'session-1', 8, signal)).resolves.toEqual({
      data: [{ parts: [{ state: { status: 'running' } }] }],
    });
    await expect(getOpencodeSession(createdClient, 'session-1')).resolves.toEqual({
      data: { id: 'session-1', directory: '/tmp/project' },
    });
    await expect(deleteOpencodeSession(createdClient, 'session-1')).resolves.toEqual({ data: { success: true } });
    await expect(streamOpencodeGlobalEvents(createdClient, signal)).resolves.toEqual({ stream });

    expect(mockCreateOpencodeClient).toHaveBeenCalledWith({ baseUrl: 'http://localhost:7777' });
    expect(client.session.list).toHaveBeenCalledWith({ signal });
    expect(client.session.status).toHaveBeenCalledWith({ signal });
    expect(client.session.messages).toHaveBeenCalledWith({
      path: { id: 'session-1' },
      query: { limit: 8 },
      signal,
    });
    expect(client.session.get).toHaveBeenCalledWith({ path: { id: 'session-1' } });
    expect(client.session.delete).toHaveBeenCalledWith({ path: { id: 'session-1' } });
    expect(client.global.event).toHaveBeenCalledWith({ signal });
  });

  it('reads current root SDK session.list/status data through the provider', async () => {
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        list: vi.fn(async () => ({
          data: [
            {
              id: 'parent-1',
              title: 'Parent',
              directory: '/tmp/vibepulse-project',
              time: { created: 1_700_000_000_000, updated: 1_700_000_001_000 },
            },
          ],
        })),
        status: vi.fn(async () => ({ data: { 'parent-1': { type: 'busy' } } })),
        messages: vi.fn(async () => ({ data: [] })),
      },
    });

    const result = await opencodeLocalSessionProvider.getSessionsResult({ stickyBusyDelayMs: 0 });

    expect(result.status).toBeUndefined();
    expect(result.sourceMeta).toEqual({ online: true });
    expect(result.payload.sessions).toEqual([
      expect.objectContaining({
        id: 'parent-1',
        projectName: 'vibepulse-project',
        realTimeStatus: 'busy',
        children: [],
      }),
    ]);
  });

  it('degrades failed ports with object-shaped BadRequest SDK errors instead of throwing', async () => {
    mockCreateOpencodeClient.mockReturnValue({
      session: {
        list: vi.fn(async () => {
          throw {
            name: 'BadRequestError',
            status: 400,
            body: { message: 'invalid query shape' },
          };
        }),
        status: vi.fn(async () => ({ data: {} })),
        messages: vi.fn(async () => ({ data: [] })),
      },
    });

    const result = await opencodeLocalSessionProvider.getSessionsResult({ stickyBusyDelayMs: 0 });

    expect(result.status).toBe(503);
    expect(result.payload).toEqual({
      error: 'Failed to fetch sessions from OpenCode ports',
      hint: 'All discovered OpenCode API ports timed out or failed. Retry shortly or increase OPENCODE_SESSIONS_LIST_TIMEOUT_MS.',
      failedPorts: [
        {
          port: 7777,
          reason: 'BadRequestError 400: invalid query shape',
        },
      ],
    });
    expect(result.sourceMeta).toEqual({
      online: false,
      degraded: true,
      reason: 'Failed to fetch sessions from OpenCode ports',
    });
  });

  it('formats latest object-shaped SDK errors predictably', () => {
    expect(formatOpencodeSdkError({
      name: 'BadRequestError',
      statusCode: 400,
      data: { error: 'invalid request' },
    })).toBe('BadRequestError 400: invalid request');
  });
});
