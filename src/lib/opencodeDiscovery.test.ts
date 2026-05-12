import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ExecSyncMock = ReturnType<typeof vi.fn>;
type DiscoveryModule = typeof import('./opencodeDiscovery');

let execSyncMock: ExecSyncMock;
const originalDiscoveryTimeout = process.env.OPENCODE_DISCOVERY_TIMEOUT_MS;

async function loadDiscovery(): Promise<DiscoveryModule> {
  vi.resetModules();
  execSyncMock = vi.fn();
  vi.doMock('child_process', () => ({
    execSync: execSyncMock,
    default: {
      execSync: execSyncMock,
    },
  }));

  return import('./opencodeDiscovery');
}

function commandText(command: unknown): string {
  return typeof command === 'string' ? command : '';
}

function setupCommandOutputs({
  lsof = '',
  psCommand = '',
  probePorts = {},
  timeoutCommands = [],
}: {
  lsof?: string;
  psCommand?: string;
  probePorts?: Record<number, { health?: boolean; doc?: boolean; healthBody?: string; docBody?: string }>;
  timeoutCommands?: string[];
}): void {
  execSyncMock.mockImplementation((command: unknown) => {
    const text = commandText(command);

    if (timeoutCommands.some((pattern) => text.includes(pattern))) {
      const error = new Error('Command timed out') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      throw error;
    }

    if (text.includes('lsof -nP -iTCP -sTCP:LISTEN')) {
      return lsof;
    }

    if (text.includes('ps -axo command')) {
      return psCommand;
    }

    if (text.includes('/global/health') || text.includes('/doc')) {
      const match = text.match(/127\.0\.0\.1:(\d+)\//);
      const port = match ? Number(match[1]) : NaN;
      const probe = probePorts[port];
      const isHealth = text.includes('/global/health');
      const ok = isHealth ? probe?.health : probe?.doc;
      if (ok) {
        return isHealth
          ? (probe?.healthBody ?? '{"health":"ok","version":"1.14.48"}')
          : (probe?.docBody ?? '{"openapi":"3.0.0","info":{"title":"OpenCode API","description":"OpenCode docs"}}');
      }
      throw new Error(`probe failed for ${port}`);
    }

    return '';
  });
}

function probeUrls(): string[] {
  return execSyncMock.mock.calls
    .map((call) => commandText(call[0]))
    .filter((command) => command.includes('/global/health') || command.includes('/doc'));
}

describe('opencodeDiscovery', () => {
  beforeEach(() => {
    process.env.OPENCODE_DISCOVERY_TIMEOUT_MS = '5000';
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.doUnmock('child_process');
    vi.unstubAllGlobals();
    if (originalDiscoveryTimeout === undefined) {
      delete process.env.OPENCODE_DISCOVERY_TIMEOUT_MS;
    } else {
      process.env.OPENCODE_DISCOVERY_TIMEOUT_MS = originalDiscoveryTimeout;
    }
  });

  it('includes explicit --port values from both space and equals process args', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: '/usr/local/bin/opencode serve --port 3456\nnode /bin/opencode --port=4567\n',
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [3456, 4567], timedOut: false });
  });

  it('includes lsof OpenCode listening ports with explicit ports', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      lsof: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nopencode 123 user 10u IPv4 0x1 0t0 TCP 127.0.0.1:7777 (LISTEN)\nnode 555 user 12u IPv4 0x2 0t0 TCP 127.0.0.1:9999 (LISTEN)\n',
      psCommand: 'opencode --port=3456\n',
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [3456, 7777], timedOut: false });
  });

  it('probes default 4096 when OpenCode is started with --port 0', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: 'opencode serve --port 0\n',
      probePorts: { 4096: { health: true, healthBody: '{"health":"ok","version":"1.14.48"}' } },
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [4096], timedOut: false });
    expect(probeUrls()).toEqual(
      expect.arrayContaining([expect.stringContaining('http://127.0.0.1:4096/global/health')])
    );
  });

  it('accepts documented healthy health response for the default candidate', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: 'opencode serve\n',
      probePorts: { 4096: { health: true, healthBody: '{"healthy":true,"version":"1.14.48"}' } },
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [4096], timedOut: false });
    expect(probeUrls()).toEqual([
      expect.stringContaining('http://127.0.0.1:4096/global/health'),
    ]);
  });

  it('rejects unhealthy or versionless health responses unless /doc is valid', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: 'opencode serve\n',
      probePorts: {
        4096: { health: true, healthBody: '{"healthy":false,"version":"1.14.48"}', doc: false },
      },
    });

    expect(discovery.discoverOpencodePortsWithMeta()).toEqual({ ports: [], timedOut: false });
    expect(probeUrls()).toEqual([
      expect.stringContaining('http://127.0.0.1:4096/global/health'),
      expect.stringContaining('http://127.0.0.1:4096/doc'),
    ]);

    setupCommandOutputs({
      psCommand: 'opencode serve\n',
      probePorts: {
        4096: { health: true, healthBody: '{"healthy":true}', doc: false },
      },
    });

    expect(discovery.discoverOpencodePortsWithMeta()).toEqual({ ports: [], timedOut: false });
  });

  it('accepts default candidate when /doc succeeds after health fails', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: 'opencode serve\n',
      probePorts: {
        4096: {
          health: false,
          doc: true,
          docBody: '{"openapi":"3.0.0","info":{"title":"OpenCode API","description":"OpenCode docs"}}',
        },
      },
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [4096], timedOut: false });
    expect(probeUrls()).toEqual([
      expect.stringContaining('http://127.0.0.1:4096/global/health'),
      expect.stringContaining('http://127.0.0.1:4096/doc'),
    ]);
  });

  it('rejects generic /doc swagger content without an OpenCode signature', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      psCommand: 'opencode serve\n',
      probePorts: {
        4096: {
          health: false,
          doc: true,
          docBody: '{"openapi":"3.0.0","info":{"title":"Generic API","description":"Generic docs"}}',
        },
      },
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [], timedOut: false });
    expect(probeUrls()).toEqual([
      expect.stringContaining('http://127.0.0.1:4096/global/health'),
      expect.stringContaining('http://127.0.0.1:4096/doc'),
    ]);
  });

  it('retains valid known ports and prunes stale known ports after probe failure', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({ psCommand: 'opencode --port=6123\n' });

    expect(discovery.discoverOpencodePortsWithMeta().ports).toEqual([6123]);

    setupCommandOutputs({ probePorts: { 6123: { health: true } } });
    expect(discovery.discoverOpencodePortsWithMeta().ports).toEqual([6123]);

    setupCommandOutputs({ probePorts: { 6123: { health: false, doc: false } } });
    expect(discovery.discoverOpencodePortsWithMeta().ports).toEqual([]);
  });

  it('keeps discovery bounded and reports command timeout', async () => {
    const discovery = await loadDiscovery();
    setupCommandOutputs({
      timeoutCommands: ['lsof -nP -iTCP -sTCP:LISTEN'],
      psCommand: 'opencode --port=4567\n',
    });

    const result = discovery.discoverOpencodePortsWithMeta();

    expect(result).toEqual({ ports: [4567], timedOut: true });
    expect(probeUrls()).toEqual([]);
  });
});
