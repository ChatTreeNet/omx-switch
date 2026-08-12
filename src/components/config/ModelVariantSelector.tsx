'use client';

import * as React from 'react';
import type { ModelsResponse } from '@/lib/queries';

export interface ReasoningConfigFields {
  reasoning?: string;
  variant?: string;
}

export interface ModelVariantConfigUpdate {
  reasoning?: string | null;
  variant?: string | null;
}

export const REASONING_EFFORT_OPTIONS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export function getConfiguredModelVariant(config?: ReasoningConfigFields): string {
  return config?.reasoning || config?.variant || '';
}

/**
 * OMO stable releases understand `variant`, while the development schema uses
 * canonical `reasoning`. Continue using canonical reasoning only when the
 * config already opted into it; otherwise write the stable-compatible variant
 * field used by released OMO versions.
 */
export function buildModelVariantConfigUpdate(
  currentConfig: ReasoningConfigFields | undefined,
  value: string
): ModelVariantConfigUpdate {
  if (value === getConfiguredModelVariant(currentConfig)) {
    return {};
  }

  if (typeof currentConfig?.reasoning === 'string') {
    return {
      reasoning: value || null,
      variant: null,
    };
  }

  return {
    variant: value || null,
  };
}

interface ModelVariantSelectorProps {
  id: string;
  model: string;
  modelsData?: ModelsResponse;
  value: string;
  onValueChange: (value: string) => void;
}

export function ModelVariantSelector({
  id,
  model,
  modelsData,
  value,
  onValueChange,
}: ModelVariantSelectorProps) {
  const metadataAvailable = modelsData?.modelDetails !== undefined;
  const detail = modelsData?.modelDetails?.find((candidate) => candidate.selector === model);
  const hasExactMetadata = metadataAvailable && detail?.variants !== undefined;
  const reportedVariants = detail?.variants ?? [];
  const valueIsUnreported = hasExactMetadata && value !== '' && !reportedVariants.includes(value);
  const variants = valueIsUnreported
    ? [value, ...reportedVariants]
    : reportedVariants;

  let helpText = 'Select a model to see its available reasoning variants.';
  if (!model && value) {
    helpText = 'No model is selected. The configured variant is preserved and can be edited manually.';
  } else if (model && !hasExactMetadata) {
    helpText = metadataAvailable
      ? 'OpenCode did not report metadata for this model. The configured value is preserved and can be edited manually.'
      : 'OpenCode variant metadata is unavailable. Enter a provider-supported value manually.';
  } else if (hasExactMetadata && reportedVariants.length === 0) {
    helpText = 'OpenCode reports no selectable variants for this model.';
  } else if (valueIsUnreported) {
    helpText = 'This configured value is not reported for the selected model. It will be preserved until you change or clear it.';
  } else if (hasExactMetadata) {
    helpText = 'Options reported by OpenCode for the selected model.';
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Model Variant
      </label>
      {!hasExactMetadata && (model !== '' || value !== '') ? (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Not set"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
        />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={!model || (variants.length === 0 && value === '')}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="">Not set</option>
          {variants.map((variant) => (
            <option key={variant} value={variant}>
              {variant}{valueIsUnreported && variant === value ? ' (configured; not reported)' : ''}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{helpText}</p>
    </div>
  );
}

interface ReasoningEffortSelectorProps {
  id: string;
  model: string;
  modelsData?: ModelsResponse;
  value: string;
  onValueChange: (value: string) => void;
}

export function ReasoningEffortSelector({
  id,
  model,
  modelsData,
  value,
  onValueChange,
}: ReasoningEffortSelectorProps) {
  const isKnownValue = value === '' || REASONING_EFFORT_OPTIONS.some((effort) => effort === value);
  const detail = modelsData?.modelDetails?.find((candidate) => candidate.selector === model);
  const isKnownUnsupported = detail?.reasoning === false;
  const disabled = !model || (isKnownUnsupported && value === '');
  const helpText = isKnownUnsupported
    ? value
      ? 'OpenCode reports that this model does not support reasoning. The configured value is preserved until you change or clear it.'
      : 'OpenCode reports that this model does not support reasoning.'
    : 'Advanced OMO provider option. The allowed names are fixed by OMO, but support still depends on the selected model and provider.';

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Reasoning Effort (Provider Override)
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled && value === ''}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <option value="">Not set</option>
        {!isKnownValue && <option value={value}>{value} (configured; custom)</option>}
        {REASONING_EFFORT_OPTIONS.map((effort) => (
          <option key={effort} value={effort}>{effort}</option>
        ))}
      </select>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{helpText}</p>
    </div>
  );
}
