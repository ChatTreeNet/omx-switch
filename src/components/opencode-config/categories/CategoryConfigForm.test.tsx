import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CategoryConfigForm } from './CategoryConfigForm';
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

describe('CategoryConfigForm', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 0 },
      },
    });
    vi.clearAllMocks();
  });

  const renderForm = (props: any = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CategoryConfigForm categoryName="quick" onSave={() => {}} onCancel={() => {}} {...props} />
      </QueryClientProvider>
    );
  };

  it('shows the upstream quick fallback chain when no model is configured', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        models: [],
        source: 'test',
      })
    );

    renderForm();

    await waitFor(() => {
      expect(screen.getByText(/using built-in fallback chain/i)).toBeInTheDocument();
    });

    expect(screen.getByText('openai/gpt-5.4-mini')).toBeInTheDocument();
  });

  it('allows saving new reasoningEffort and fallback_models', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        models: ['test-model'],
        source: 'test',
      })
    );

    const handleSave = vi.fn();
    renderForm({ onSave: handleSave });

    const effortSelect = screen.getByLabelText(/reasoning effort/i);
    fireEvent.change(effortSelect, { target: { value: 'high' } });

    const fallbackArea = screen.getByLabelText(/fallback models \(json\)/i);
    fireEvent.change(fallbackArea, { target: { value: '["test-backup"]' } });

    const submitBtn = screen.getByText(/save changes/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(expect.objectContaining({
        reasoningEffort: 'high',
        fallback_models: ['test-backup']
      }));
    });
  });

  it('sends explicit null when fallback_models is cleared and reasoningEffort is not set', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      models: ['test-model'],
      source: 'test'
    }));

    const handleSave = vi.fn();
    renderForm({ 
      onSave: handleSave,
      initialConfig: {
        reasoningEffort: 'high',
        fallback_models: ['test-backup']
      }
    });

    const fallbackArea = screen.getByLabelText(/fallback models \(json\)/i);
    fireEvent.change(fallbackArea, { target: { value: '' } });

    const effortSelect = screen.getByLabelText(/reasoning effort/i);
    fireEvent.change(effortSelect, { target: { value: '' } });

    const submitBtn = screen.getByText(/save changes/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(expect.objectContaining({
        reasoningEffort: null,
        fallback_models: null
      }));
    });
  });

  it('shows error toast on invalid JSON in fallback_models', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        models: ['test-model'],
        source: 'test',
      })
    );

    const handleSave = vi.fn();
    renderForm({ onSave: handleSave });

    const fallbackArea = screen.getByLabelText(/fallback models \(json\)/i);
    fireEvent.change(fallbackArea, { target: { value: '["missing-bracket' } });

    const submitBtn = screen.getByText(/save changes/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/invalid json in fallback_models/i)).toBeInTheDocument();
    });
    
    expect(handleSave).not.toHaveBeenCalled();
  });
});
