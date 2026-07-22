import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './ModelSelector';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ModelSelector value display', () => {
  afterEach(() => cleanup());

  it('shows the selected model in the trigger for a controlled value', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ models: ['openai/gpt-4o'], source: 'opencode' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ModelSelector apiTarget="omo" value="kimi-for-coding/k3" onValueChange={() => {}} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toHaveAttribute('data-placeholder');
    });
    expect(screen.getByRole('combobox')).toHaveTextContent('kimi-for-coding/k3');
  });

  it('ignores the spurious empty onValueChange Radix emits for unmounted values', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ models: ['openai/gpt-4o'], source: 'opencode' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const onValueChange = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ModelSelector apiTarget="omo" value="kimi-for-coding/k3" onValueChange={onValueChange} />
      </QueryClientProvider>
    );

    // Radix Select fires onValueChange('') when the controlled value has no
    // mounted item; the component must swallow it instead of clobbering state.
    await waitFor(() => {
      expect(screen.getByRole('combobox')).not.toHaveAttribute('data-placeholder');
    });
    expect(onValueChange).not.toHaveBeenCalledWith('');
    expect(screen.getByRole('combobox')).toHaveTextContent('kimi-for-coding/k3');
  });
});
