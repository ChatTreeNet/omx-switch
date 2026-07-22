import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentConfigForm } from './AgentConfigForm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  delete (window.HTMLElement.prototype as any).hasPointerCapture;
  delete (window.HTMLElement.prototype as any).scrollIntoView;
});

describe('AgentConfigForm - echo bug fix', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    queryClient.clear();
    vi.clearAllMocks();
  });

  it('should display new value instead of cached value after saving', async () => {
    const user = userEvent.setup();
    
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          agents: { sisyphus: { model: 'anthropic/claude-3.5-sonnet', temperature: 0.5 } },
          categories: {},
        })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          agents: { sisyphus: { model: 'openai/gpt-4o', temperature: 0.8 } },
          categories: {},
        })
      );

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConfigForm agentName="sisyphus" apiTarget="omo" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const tempInput = screen.getByLabelText(/temperature value/i);
      expect(tempInput).toHaveValue(0.5);
    });

    const tempInput = screen.getByLabelText(/temperature value/i);
    await user.clear(tempInput);
    await user.type(tempInput, '0.8');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const updatedTempInput = screen.getByLabelText(/temperature value/i);
      expect(updatedTempInput).toHaveValue(0.8);
    });
  });

  it('preserves rich fallback_models structure on submit and updates reasoningEffort', async () => {
    const user = userEvent.setup();
    
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === '/api/omo-config' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          agents: { 
            sisyphus: { 
              model: 'openai/gpt-4o', 
              temperature: 0.5,
              fallback_models: [{ model: 'claude-3-5-sonnet-20240620', maxTokens: 4000 }]
            } 
          },
          categories: {},
        });
      }
      if (url === '/api/omo-models') {
        return jsonResponse({ models: ['openai/gpt-4o'], source: 'test' });
      }
      if (url === '/api/omo-config' && init?.method === 'POST') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConfigForm agentName="sisyphus" apiTarget="omo" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const fallbackInput = screen.getByLabelText(/fallback models \(json\)/i);
      expect(fallbackInput).toHaveValue(JSON.stringify([{ model: 'claude-3-5-sonnet-20240620', maxTokens: 4000 }], null, 2));
    });

    const reasoningSelector = screen.getByLabelText(/reasoning effort/i);
    await user.selectOptions(reasoningSelector, 'max');

    const modelTrigger = screen.getAllByRole('combobox')[0];
    await user.click(modelTrigger);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'gpt-4o' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: 'gpt-4o' }));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find((call) => call[0] === '/api/omo-config' && call[1]?.method === 'POST');
      expect(postCall).toBeTruthy();
    });

    const postCall = mockFetch.mock.calls.find((call) => call[0] === '/api/omo-config' && call[1]?.method === 'POST');
    const requestBody = JSON.parse(String(postCall?.[1]?.body));
    expect(requestBody).toEqual({
      agents: {
        sisyphus: {
          model: 'openai/gpt-4o',
          temperature: 0.5,
          top_p: 1,
          variant: '',
          prompt_append: '',
          reasoningEffort: 'max',
          fallback_models: [{ model: 'claude-3-5-sonnet-20240620', maxTokens: 4000 }],
        }
      }
    });
  });

  it('sends explicit null when fallback_models is cleared and reasoningEffort is not set', async () => {
    const user = userEvent.setup();
    
    mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === '/api/omo-config' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          agents: { 
            sisyphus: { 
              model: 'openai/gpt-4o', 
              temperature: 0.5,
              reasoningEffort: 'max',
              fallback_models: [{ model: 'claude-3-5-sonnet-20240620', maxTokens: 4000 }]
            } 
          },
          categories: {},
        });
      }
      if (url === '/api/omo-models') {
        return jsonResponse({ models: ['openai/gpt-4o'], source: 'test' });
      }
      if (url === '/api/omo-config' && init?.method === 'POST') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({});
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConfigForm agentName="sisyphus" apiTarget="omo" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/fallback models \(json\)/i)).toHaveValue(JSON.stringify([{ model: 'claude-3-5-sonnet-20240620', maxTokens: 4000 }], null, 2));
    });
    const fallbackInput = screen.getByLabelText(/fallback models \(json\)/i);
    await user.clear(fallbackInput);

    const reasoningSelector = screen.getByLabelText(/reasoning effort/i);
    await user.selectOptions(reasoningSelector, '');

    const modelTrigger = screen.getAllByRole('combobox')[0];
    await user.click(modelTrigger);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'gpt-4o' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: 'gpt-4o' }));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find((call) => call[0] === '/api/omo-config' && call[1]?.method === 'POST');
      expect(postCall).toBeTruthy();
    });

    const postCall = mockFetch.mock.calls.find((call) => call[0] === '/api/omo-config' && call[1]?.method === 'POST');
    const requestBody = JSON.parse(String(postCall?.[1]?.body));
    expect(requestBody.agents.sisyphus.fallback_models).toBeNull();
    expect(requestBody.agents.sisyphus.reasoningEffort).toBeNull();
  });
  it('shows the upstream hephaestus fallback chain when no model is configured', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          agents: {},
          categories: {},
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: [],
          source: 'test',
        })
      );

    render(
      <QueryClientProvider client={queryClient}>
        <AgentConfigForm agentName="hephaestus" apiTarget="omo" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/using default fallback chain/i)).toBeInTheDocument();
    });

    expect(screen.getByText('openai/gpt-5.4')).toBeInTheDocument();
  });

});
