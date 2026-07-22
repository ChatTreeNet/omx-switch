import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';

// The workspace is covered by its own component tests; keep the page test focused on wiring
vi.mock('@/components/config/ConfigWorkspace', () => ({
  ConfigWorkspace: ({ apiTarget }: { apiTarget: string }) => (
    <div data-testid="config-workspace" data-target={apiTarget} />
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}><Home /></QueryClientProvider>);
}

function mockBackend({ needsSync = false }: { needsSync?: boolean } = {}) {
  mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/omo-sync') {
      return jsonResponse({ needsSync, daysSincePush: needsSync ? 90 : 10, lastPush: '2026-01-01T00:00:00Z' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('Home page', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the OMO workspace by default', () => {
    mockBackend();
    renderPage();

    expect(screen.getByRole('heading', { name: 'OMX Switch' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'OMO' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('config-workspace')).toHaveAttribute('data-target', 'omo');
  });

  it('switches the workspace to OMP when the OMP tab is selected', async () => {
    mockBackend();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: 'OMP' }));

    expect(screen.getByRole('tab', { name: 'OMP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('config-workspace')).toHaveAttribute('data-target', 'omp');
  });

  it('shows the sync banner when the OMO upstream is stale', async () => {
    mockBackend({ needsSync: true });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'OMO upstream has not been updated in 90 days. Consider syncing.'
      );
    });
  });

  it('hides the sync banner when the OMO upstream is fresh', async () => {
    mockBackend({ needsSync: false });
    renderPage();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/omo-sync');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
