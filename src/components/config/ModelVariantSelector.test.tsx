import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ModelVariantSelector,
  AdvancedReasoningEffortSelector,
  ReasoningEffortSelector,
  buildModelVariantConfigUpdate,
  getConfiguredModelVariant,
} from './ModelVariantSelector';

describe('ModelVariantSelector', () => {
  it('shows only the variants reported for the selected model', () => {
    render(
      <ModelVariantSelector
        id="reasoning"
        model="anthropic/claude-haiku"
        modelsData={{
          models: ['anthropic/claude-haiku', 'openai/gpt-5'],
          source: 'opencode',
          modelDetails: [
            { selector: 'anthropic/claude-haiku', reasoning: true, variants: ['high', 'max'] },
            { selector: 'openai/gpt-5', reasoning: true, variants: ['minimal', 'low', 'high', 'xhigh'] },
          ],
        }}
        value=""
        onValueChange={() => {}}
      />
    );

    expect(screen.getByRole('option', { name: 'high' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'max' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'minimal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'xhigh' })).not.toBeInTheDocument();
  });

  it('supports arbitrary OpenCode variant names', () => {
    render(
      <ModelVariantSelector
        id="reasoning"
        model="provider/custom"
        modelsData={{
          models: ['provider/custom'],
          source: 'opencode',
          modelDetails: [{ selector: 'provider/custom', variants: ['fast', 'deep'] }],
        }}
        value="fast"
        onValueChange={() => {}}
      />
    );

    expect(screen.getByRole('option', { name: 'fast' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'deep' })).toBeInTheDocument();
  });

  it('does not invent variants for a reasoning model with an empty variant map', () => {
    render(
      <ModelVariantSelector
        id="reasoning"
        model="provider/reasoning"
        modelsData={{
          models: ['provider/reasoning'],
          source: 'opencode',
          modelDetails: [{ selector: 'provider/reasoning', reasoning: true, variants: [] }],
        }}
        value=""
        onValueChange={() => {}}
      />
    );

    expect(screen.getByLabelText('Thinking Level')).toBeDisabled();
    expect(screen.getByText(/no selectable thinking presets/i)).toBeInTheDocument();
  });

  it('preserves an unreported configured value and still allows clearing it', () => {
    const onValueChange = vi.fn();
    render(
      <ModelVariantSelector
        id="reasoning"
        model="provider/model"
        modelsData={{
          models: ['provider/model'],
          source: 'opencode',
          modelDetails: [{ selector: 'provider/model', variants: ['low', 'high'] }],
        }}
        value="custom"
        onValueChange={onValueChange}
      />
    );

    expect(screen.getByRole('option', { name: /custom.*not reported/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Thinking Level'), { target: { value: '' } });
    expect(onValueChange).toHaveBeenCalledWith('');
  });

  it('uses a free-form input when metadata is unavailable', () => {
    const onValueChange = vi.fn();
    render(
      <ModelVariantSelector
        id="reasoning"
        model="provider/model"
        modelsData={{ models: ['provider/model'], source: 'opencode' }}
        value="legacy"
        onValueChange={onValueChange}
      />
    );

    const input = screen.getByLabelText('Thinking Level');
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.change(input, { target: { value: 'provider-custom' } });
    expect(onValueChange).toHaveBeenCalledWith('provider-custom');
  });

  it('keeps a configured variant visible when no model is selected', () => {
    render(
      <ModelVariantSelector
        id="variant"
        model=""
        modelsData={{ models: [], source: 'opencode', modelDetails: [] }}
        value="legacy"
        onValueChange={() => {}}
      />
    );

    expect(screen.getByLabelText('Thinking Level')).toHaveValue('legacy');
    expect(screen.getByText(/configured preset is preserved/i)).toBeInTheDocument();
  });
});

describe('ReasoningEffortSelector', () => {
  it('uses the complete enum published by OMO for agents and categories', () => {
    render(
      <ReasoningEffortSelector
        id="effort"
        model="provider/model"
        value=""
        onValueChange={() => {}}
      />
    );

    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      '',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('preserves an unknown configured provider value', () => {
    render(
      <ReasoningEffortSelector
        id="effort"
        model="provider/model"
        value="provider-custom"
        onValueChange={() => {}}
      />
    );

    expect(screen.getByRole('option', { name: /provider-custom.*custom/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/reasoning effort/i)).toHaveValue('provider-custom');
  });

  it('disables new effort selection for a known non-reasoning model', () => {
    render(
      <ReasoningEffortSelector
        id="effort"
        model="provider/plain"
        modelsData={{
          models: ['provider/plain'],
          source: 'opencode',
          modelDetails: [{ selector: 'provider/plain', reasoning: false, variants: [] }],
        }}
        value=""
        onValueChange={() => {}}
      />
    );

    expect(screen.getByLabelText(/reasoning effort/i)).toBeDisabled();
    expect(screen.getByText(/does not support reasoning/i)).toBeInTheDocument();
  });

  it('keeps a configured effort clearable for a known non-reasoning model', () => {
    render(
      <ReasoningEffortSelector
        id="effort"
        model="provider/plain"
        modelsData={{
          models: ['provider/plain'],
          source: 'opencode',
          modelDetails: [{ selector: 'provider/plain', reasoning: false, variants: [] }],
        }}
        value="high"
        onValueChange={() => {}}
      />
    );

    expect(screen.getByLabelText(/reasoning effort/i)).not.toBeDisabled();
    expect(screen.getByText(/configured value is preserved/i)).toBeInTheDocument();
  });
});

describe('AdvancedReasoningEffortSelector', () => {
  const baseProps = {
    id: 'advanced-effort',
    model: 'openai/gpt-5',
    modelsData: {
      models: ['openai/gpt-5'],
      source: 'opencode',
      modelDetails: [{ selector: 'openai/gpt-5', reasoning: true, variants: ['low', 'high'] }],
    },
    onValueChange: () => {},
  };

  it('keeps the Provider override collapsed for ordinary configurations', () => {
    render(
      <AdvancedReasoningEffortSelector
        {...baseProps}
        value=""
        variantValue="high"
      />
    );

    expect(screen.getByRole('button', { name: /advanced provider override/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(/reasoning effort/i)).not.toBeInTheDocument();
    expect(screen.getByText(/most users should leave this unset/i)).toBeInTheDocument();
  });

  it('reveals the Provider override only after an explicit expansion', () => {
    render(
      <AdvancedReasoningEffortSelector
        {...baseProps}
        value=""
        variantValue="high"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /advanced provider override/i }));
    expect(screen.getByLabelText(/reasoning effort/i)).toBeInTheDocument();
    expect(screen.queryByText(/both set/i)).not.toBeInTheDocument();
  });

  it('automatically exposes and labels an existing Provider override', () => {
    render(
      <AdvancedReasoningEffortSelector
        {...baseProps}
        value="high"
        variantValue=""
      />
    );

    expect(screen.getByRole('button', { name: /advanced provider override/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Configured: high')).toBeInTheDocument();
    expect(screen.getByLabelText(/reasoning effort/i)).toHaveValue('high');
  });

  it('warns without clearing when a preset and Provider override coexist', () => {
    render(
      <AdvancedReasoningEffortSelector
        {...baseProps}
        value="high"
        variantValue="low"
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/model preset and a Provider override are both set/i);
    expect(screen.getByLabelText(/reasoning effort/i)).toHaveValue('high');
  });
});

describe('model variant config compatibility', () => {
  it('reads canonical reasoning first, then the published variant field', () => {
    expect(getConfiguredModelVariant({ reasoning: 'high', variant: 'low' })).toBe('high');
    expect(getConfiguredModelVariant({ variant: 'low' })).toBe('low');
  });

  it('does not rewrite legacy fields when the effective value is unchanged', () => {
    expect(buildModelVariantConfigUpdate({ variant: 'high' }, 'high')).toEqual({});
  });

  it('updates canonical configs canonically and clears legacy fields', () => {
    expect(buildModelVariantConfigUpdate({ reasoning: 'high', variant: 'low' }, 'xhigh')).toEqual({
      reasoning: 'xhigh',
      variant: null,
    });
  });

  it('uses the published variant field when canonical reasoning is absent', () => {
    expect(buildModelVariantConfigUpdate(undefined, 'max')).toEqual({
      variant: 'max',
    });
  });
});
