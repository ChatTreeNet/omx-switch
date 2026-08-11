import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRolesPanel } from './ModelRolesPanel';

vi.mock('../ModelSelector', () => ({
  ModelSelector: ({
    value,
    onValueChange,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Not set</option>
      {value !== '' && !['kimi-code/k3', 'openai/gpt-5.4'].includes(value) && (
        <option value={value}>{value}</option>
      )}
      <option value="kimi-code/k3">kimi-code/k3</option>
      <option value="openai/gpt-5.4">openai/gpt-5.4</option>
    </select>
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

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ModelRolesPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    const savedRoles: Record<string, string> = { default: 'kimi-code/k3' };
    const savedChains: Record<string, string[]> = { default: ['openai/gpt-5.4'] };
    let savedDefaultThinkingLevel: string | undefined = 'high';
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/omp-config' && init?.method !== 'POST') {
        return jsonResponse({
          modelRoles: { ...savedRoles },
          fallbackChains: { ...savedChains },
          modelFallback: true,
          defaultThinkingLevel: savedDefaultThinkingLevel,
        });
      }
      if (url === '/api/omp-config' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.modelRoles) {
          for (const [role, model] of Object.entries(body.modelRoles)) {
            if (model === null) {
              delete savedRoles[role];
            } else {
              savedRoles[role] = model as string;
            }
          }
        }
        if (body.fallbackChains) {
          for (const [key, chain] of Object.entries(body.fallbackChains)) {
            if (chain === null) {
              delete savedChains[key];
            } else {
              savedChains[key] = chain as string[];
            }
          }
        }
        if (Object.prototype.hasOwnProperty.call(body, 'defaultThinkingLevel')) {
          savedDefaultThinkingLevel = body.defaultThinkingLevel ?? undefined;
        }
        return jsonResponse({
          success: true,
          modelRoles: savedRoles,
          fallbackChains: savedChains,
          defaultThinkingLevel: savedDefaultThinkingLevel,
        });
      }
      if (url === '/api/omp-models') {
        return jsonResponse({
          models: ['kimi-code/k3', 'openai/gpt-5.4'],
          modelDetails: [
            { selector: 'kimi-code/k3', reasoning: false, thinking: null },
            {
              selector: 'openai/gpt-5.4',
              reasoning: true,
              thinking: ['low', 'medium', 'high'],
            },
          ],
          source: 'omp',
        });
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all built-in roles with configured models', async () => {
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    expect(screen.getByText('Smol')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Advisor')).toBeInTheDocument();
    expect(screen.getByLabelText('omp-role-smol-model')).toHaveValue('');
  });

  it('posts only the edited role on save', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    await user.selectOptions(screen.getByLabelText('omp-role-smol-model'), 'openai/gpt-5.4');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        modelRoles: { smol: 'openai/gpt-5.4' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });
  });

  it('saves the global default thinking level independently', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('OMP default thinking level')).toHaveValue('high');
    });

    await user.selectOptions(screen.getByLabelText('OMP default thinking level'), 'auto');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        defaultThinkingLevel: 'auto',
      });
    });
  });

  it('clears the explicit global thinking level to use the OMP default', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('OMP default thinking level')).toHaveValue('high');
    });

    await user.selectOptions(screen.getByLabelText('OMP default thinking level'), '');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        defaultThinkingLevel: null,
      });
    });
  });

  it('writes a model-role thinking override as a selector suffix', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-smol-model')).toHaveValue('');
    });

    await user.selectOptions(screen.getByLabelText('omp-role-smol-model'), 'openai/gpt-5.4');
    await user.selectOptions(screen.getByLabelText('omp-role-smol-thinking'), 'high');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        modelRoles: { smol: 'openai/gpt-5.4:high' },
      });
    });
  });

  it('limits role thinking choices to the selected model capabilities', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-thinking')).toBeDisabled();
    });

    await user.selectOptions(screen.getByLabelText('omp-role-smol-model'), 'openai/gpt-5.4');
    const thinkingSelect = screen.getByLabelText('omp-role-smol-thinking');
    expect(thinkingSelect).toBeEnabled();
    expect(within(thinkingSelect).getByRole('option', { name: 'high' })).toBeInTheDocument();
    expect(within(thinkingSelect).queryByRole('option', { name: 'xhigh' })).not.toBeInTheDocument();
  });

  it('sends null for a cleared role on save', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    await user.click(screen.getByRole('button', { name: 'Unset Default role' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        modelRoles: { default: null },
      });
    });
  });

  it('keeps save disabled until a role changes', async () => {
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('edits a fallback chain and posts it on save', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    // expand the smol fallback editor and add one entry
    await user.click(screen.getByRole('button', { name: 'Fallback chain for Smol' }));
    await user.click(screen.getByRole('button', { name: 'Add fallback' }));
    await user.type(screen.getByLabelText('Smol fallback 1'), 'openai/gpt-5.4');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        fallbackChains: { smol: ['openai/gpt-5.4'] },
      });
    });
  });

  it('removing every fallback entry deletes the chain on save', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    await user.click(screen.getByRole('button', { name: 'Fallback chain for Default' }));
    // configured chain has one entry; remove it
    await user.click(screen.getByRole('button', { name: 'Remove fallback 1' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        fallbackChains: { default: null },
      });
    });
  });

  it('clears the stale selection after a role is unset and saved', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    await user.click(screen.getByRole('button', { name: 'Unset Default role' }));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    // After the save, the refetched config no longer contains the role; the
    // selector must fall back to the unset placeholder, not the stale model.
    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('');
    });
    expect(screen.queryByRole('button', { name: 'Unset Default role' })).not.toBeInTheDocument();
  });

  it('posts the fallback master toggle when changed', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('kimi-code/k3');
    });

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) => String(url) === '/api/omp-config' && (init as RequestInit)?.method === 'POST'
      );
      expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({
        modelFallback: false,
      });
    });
  });

  it('parses an existing role thinking suffix without marking it dirty', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/omp-config') {
        return jsonResponse({
          modelRoles: { default: 'openai/gpt-5.4:high' },
          fallbackChains: {},
          modelFallback: true,
          defaultThinkingLevel: 'medium',
        });
      }
      if (url === '/api/omp-models') {
        return jsonResponse({
          models: ['openai/gpt-5.4'],
          modelDetails: [
            {
              selector: 'openai/gpt-5.4',
              reasoning: true,
              thinking: ['low', 'medium', 'high'],
            },
          ],
          source: 'omp',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue('openai/gpt-5.4');
      expect(screen.getByLabelText('omp-role-default-thinking')).toHaveValue('high');
    });
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('keeps an unavailable model ending in a thinking token opaque', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/omp-config') {
        return jsonResponse({
          modelRoles: { default: 'vendor/literal-model:max' },
          fallbackChains: {},
          modelFallback: true,
          defaultThinkingLevel: null,
        });
      }
      if (url === '/api/omp-models') {
        return jsonResponse({
          models: ['openai/gpt-5.4'],
          modelDetails: [
            {
              selector: 'openai/gpt-5.4',
              reasoning: true,
              thinking: ['low', 'medium', 'high'],
            },
          ],
          source: 'omp',
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText('omp-role-default-model')).toHaveValue(
        'vendor/literal-model:max'
      );
    });
    expect(screen.getByLabelText('omp-role-default-thinking')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('shows an error state when the config fetch fails', async () => {
    mockFetch.mockImplementation(async () => jsonResponse({ error: 'Internal server error' }, 500));

    renderWithQuery(<ModelRolesPanel />);

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });
});
