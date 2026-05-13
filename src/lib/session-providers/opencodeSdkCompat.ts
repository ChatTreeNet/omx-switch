import { createOpencodeClient } from '@opencode-ai/sdk';

export type OpencodeSdkClient = ReturnType<typeof createOpencodeClient>;

export function createVibePulseOpencodeClient(baseUrl: string): OpencodeSdkClient {
  return createOpencodeClient({ baseUrl });
}

export function listOpencodeSessions(client: OpencodeSdkClient, signal?: AbortSignal) {
  return client.session.list({ signal });
}

export function getOpencodeSessionStatus(client: OpencodeSdkClient, signal?: AbortSignal) {
  return client.session.status({ signal });
}

export function getOpencodeSessionMessages(
  client: OpencodeSdkClient,
  sessionId: string,
  limit: number,
  signal?: AbortSignal
) {
  return client.session.messages({
    path: { id: sessionId },
    query: { limit },
    signal,
  });
}

export function getOpencodeSession(client: OpencodeSdkClient, sessionId: string) {
  return client.session.get({ path: { id: sessionId } });
}

export function deleteOpencodeSession(client: OpencodeSdkClient, sessionId: string) {
  return client.session.delete({ path: { id: sessionId } });
}

export function streamOpencodeGlobalEvents(client: OpencodeSdkClient, signal?: AbortSignal) {
  return client.global.event({ signal });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNestedErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const message = value['message'];
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const error = value['error'];
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return null;
}

export function formatOpencodeSdkError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (!isRecord(error)) {
    return String(error);
  }

  const name = typeof error['name'] === 'string' && error['name'].trim()
    ? error['name']
    : 'OpenCode SDK error';
  const status = typeof error['status'] === 'number'
    ? error['status']
    : typeof error['statusCode'] === 'number'
      ? error['statusCode']
      : undefined;
  const message =
    readNestedErrorMessage(error) ||
    readNestedErrorMessage(error['body']) ||
    readNestedErrorMessage(error['data']);

  const prefix = status ? `${name} ${status}` : name;
  return message ? `${prefix}: ${message}` : prefix;
}
