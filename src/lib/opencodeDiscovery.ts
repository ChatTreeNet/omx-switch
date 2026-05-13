import { execSync } from 'child_process';

const DEFAULT_DISCOVERY_COMMAND_TIMEOUT_MS = 5000;
const DEFAULT_OPENCODE_PORT = 4096;
const OPENCODE_PROBE_ENDPOINTS = ['/global/health', '/doc'] as const;
const knownPorts = new Set<number>();

export type OpencodeProcessCwd = {
  pid: number;
  cwd: string;
};

export type OpencodePortDiscoveryResult = {
  ports: number[];
  timedOut: boolean;
};

export type OpencodeProcessCwdDiscoveryResult = {
  processes: OpencodeProcessCwd[];
  timedOut: boolean;
};

type DiscoveryState = {
  timedOut: boolean;
  timeoutMs: number;
  deadlineMs: number;
};

type ProcessPortDiscovery = {
  ports: number[];
  shouldProbeDefaultPort: boolean;
};

type ProbeResult = 'ok' | 'failed' | 'timedOut';

function parseJsonResponse(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isOpenCodeHealthResponse(body: string): boolean {
  const parsed = parseJsonResponse(body);
  if (!parsed) {
    return false;
  }

  const health = parsed.health;
  const healthy = parsed.healthy;
  const version = parsed.version;
  return (
    (health === 'ok' || healthy === true) &&
    typeof version === 'string' &&
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
  );
}

function isOpenCodeDocsResponse(body: string): boolean {
  const parsed = parseJsonResponse(body);
  if (!parsed || typeof parsed.openapi !== 'string' || !/^3(?:\.\d+)?/.test(parsed.openapi)) {
    return false;
  }

  const info = parsed.info;
  const infoRecord = info && typeof info === 'object' && !Array.isArray(info) ? info as Record<string, unknown> : null;
  const title = typeof infoRecord?.title === 'string' ? infoRecord.title : '';
  const description = typeof infoRecord?.description === 'string' ? infoRecord.description : '';
  const rootTitle = typeof parsed.title === 'string' ? parsed.title : '';
  const rootDescription = typeof parsed.description === 'string' ? parsed.description : '';

  return [title, description, rootTitle, rootDescription].some((value) => /opencode/i.test(value));
}

function getDiscoveryCommandTimeoutMs(): number {
  const parsedTimeout = Number(process.env.OPENCODE_DISCOVERY_TIMEOUT_MS);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_DISCOVERY_COMMAND_TIMEOUT_MS;
}

function isCommandTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  type TimeoutLikeError = Error & {
    code?: string;
    signal?: string;
    killed?: boolean;
  };

  const timeoutError = error as TimeoutLikeError;
  const message = timeoutError.message.toLowerCase();
  return timeoutError.code === 'ETIMEDOUT' || message.includes('timed out') || message.includes('etimedout');
}

function getRemainingTimeoutMs(state: DiscoveryState): number | null {
  const remainingMs = state.deadlineMs - Date.now();
  if (remainingMs <= 0) {
    state.timedOut = true;
    return null;
  }

  return Math.max(1, Math.min(state.timeoutMs, remainingMs));
}

function toUniqueSortedPorts(ports: number[]): number[] {
  return Array.from(
    new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))
  ).sort((a, b) => a - b);
}

function getPortsFromLsof(state: DiscoveryState): number[] {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return [];
    }

    const output = execSync('lsof -nP -iTCP -sTCP:LISTEN', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });
    const lines = output.split('\n');
    const ports: number[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('COMMAND')) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      const command = parts[0]?.toLowerCase();
      if (command !== 'opencode') {
        continue;
      }

      const match = trimmed.match(/:(\d+)\s+\(LISTEN\)/);
      if (!match) {
        continue;
      }

      const port = parseInt(match[1], 10);
      if (Number.isFinite(port)) {
        ports.push(port);
      }
    }

    return ports;
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return [];
  }
}

function isOpencodeCommand(command: string): boolean {
  return /\bopencode\b/.test(command);
}

function extractPortFlags(command: string): number[] {
  const ports: number[] = [];
  const matches = command.matchAll(/--port(?:=(\d+)|\s+(\d+))\b/g);

  for (const match of matches) {
    const parsedPort = parseInt(match[1] ?? match[2] ?? '', 10);
    if (Number.isFinite(parsedPort)) {
      ports.push(parsedPort);
    }
  }

  return ports;
}

function getPortsFromProcessArgs(state: DiscoveryState): ProcessPortDiscovery {
  const result: ProcessPortDiscovery = { ports: [], shouldProbeDefaultPort: false };

  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return result;
    }

    const output = execSync('ps -axo command', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });

    for (const line of output.split('\n')) {
      const command = line.trim();
      if (!command || !isOpencodeCommand(command)) {
        continue;
      }

      const ports = extractPortFlags(command);
      if (ports.length === 0) {
        result.shouldProbeDefaultPort = true;
        continue;
      }

      for (const port of ports) {
        if (port === 0) {
          result.shouldProbeDefaultPort = true;
        } else {
          result.ports.push(port);
        }
      }
    }

    return result;
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return result;
  }
}

function probeOpencodePort(port: number, state: DiscoveryState): ProbeResult {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return 'failed';
  }

  for (const endpoint of OPENCODE_PROBE_ENDPOINTS) {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return 'timedOut';
    }

    try {
      const timeoutSeconds = Math.max(0.001, timeoutMs / 1000).toFixed(3);
      const response = execSync(`curl -fsS --max-time ${timeoutSeconds} http://127.0.0.1:${port}${endpoint}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: timeoutMs,
      });

      const body = typeof response === 'string' ? response : String(response);
      const isValidProbe = endpoint === '/global/health'
        ? isOpenCodeHealthResponse(body)
        : isOpenCodeDocsResponse(body);

      if (isValidProbe) {
        return 'ok';
      }
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        state.timedOut = true;
        return 'timedOut';
      }
    }
  }

  return 'failed';
}

export function discoverOpencodePorts(): number[] {
  return discoverOpencodePortsWithMeta().ports;
}

export function discoverOpencodePortsWithMeta(): OpencodePortDiscoveryResult {
  const timeoutMs = getDiscoveryCommandTimeoutMs();
  const state: DiscoveryState = {
    timedOut: false,
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs,
  };

  const processDiscovery = getPortsFromProcessArgs(state);
  const discoveredPorts = toUniqueSortedPorts([
    ...getPortsFromLsof(state),
    ...processDiscovery.ports,
  ]);

  for (const port of discoveredPorts) {
    knownPorts.add(port);
  }

  const probeCandidates = new Set<number>();
  if (processDiscovery.shouldProbeDefaultPort && !discoveredPorts.includes(DEFAULT_OPENCODE_PORT)) {
    probeCandidates.add(DEFAULT_OPENCODE_PORT);
  }

  for (const port of knownPorts) {
    if (!discoveredPorts.includes(port)) {
      probeCandidates.add(port);
    }
  }

  const probedPorts: number[] = [];
  for (const port of probeCandidates) {
    const probeResult = probeOpencodePort(port, state);
    if (probeResult === 'ok') {
      knownPorts.add(port);
      probedPorts.push(port);
    } else if (probeResult === 'failed' && knownPorts.has(port)) {
      knownPorts.delete(port);
    }
  }

  const ports = toUniqueSortedPorts([
    ...discoveredPorts,
    ...probedPorts,
    ...Array.from(knownPorts),
  ]);

  return {
    ports,
    timedOut: state.timedOut,
  };
}

function getOpencodePidsWithoutPortFlag(state: DiscoveryState): number[] {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return [];
    }

    const output = execSync('ps -axo pid=,command=', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });

    const pids: number[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(/^(\d+)\s+(.+)$/);
      if (!match) continue;

      const pid = parseInt(match[1], 10);
      const command = match[2];

      if (!Number.isFinite(pid)) continue;
      if (!/\bopencode\b/.test(command)) continue;
      if (extractPortFlags(command).length > 0) continue;

      pids.push(pid);
    }

    return Array.from(new Set(pids));
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return [];
  }
}

function getCwdForPid(pid: number, state: DiscoveryState): string | null {
  try {
    const timeoutMs = getRemainingTimeoutMs(state);
    if (timeoutMs === null) {
      return null;
    }

    const output = execSync(`lsof -nP -a -p ${pid} -d cwd -Fn`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    });

    const cwdLine = output
      .split('\n')
      .find((line) => line.startsWith('n') && line.length > 1);

    if (!cwdLine) return null;
    return cwdLine.slice(1);
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      state.timedOut = true;
    }
    return null;
  }
}

export function discoverOpencodeProcessCwdsWithoutPort(): OpencodeProcessCwd[] {
  return discoverOpencodeProcessCwdsWithoutPortWithMeta().processes;
}

export function discoverOpencodeProcessCwdsWithoutPortWithMeta(): OpencodeProcessCwdDiscoveryResult {
  const timeoutMs = getDiscoveryCommandTimeoutMs();
  const state: DiscoveryState = {
    timedOut: false,
    timeoutMs,
    deadlineMs: Date.now() + timeoutMs,
  };

  const pids = getOpencodePidsWithoutPortFlag(state);
  if (!pids.length) {
    return {
      processes: [],
      timedOut: state.timedOut,
    };
  }

  const processes: OpencodeProcessCwd[] = [];
  const seen = new Set<string>();

  for (const pid of pids) {
    const cwd = getCwdForPid(pid, state);
    if (!cwd) continue;

    const key = `${pid}:${cwd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processes.push({ pid, cwd });
  }

  return {
    processes,
    timedOut: state.timedOut,
  };
}
