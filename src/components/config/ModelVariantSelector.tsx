'use client';

import * as React from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
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

  let helpText = 'Select a model to see its available thinking presets.';
  if (!model && value) {
    helpText = 'No model is selected. The configured preset is preserved and can be edited manually.';
  } else if (model && !hasExactMetadata) {
    helpText = metadataAvailable
      ? 'OpenCode did not report presets for this model. The configured value is preserved and can be edited manually.'
      : 'OpenCode preset metadata is unavailable. Enter a provider-supported value manually.';
  } else if (hasExactMetadata && reportedVariants.length === 0) {
    helpText = 'OpenCode reports no selectable thinking presets for this model.';
  } else if (valueIsUnreported) {
    helpText = 'This configured preset is not reported for the selected model. It will be preserved until you change or clear it.';
  } else if (hasExactMetadata) {
    helpText = 'Model-specific presets reported by OpenCode.';
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Thinking Level
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

interface AdvancedReasoningEffortSelectorProps extends ReasoningEffortSelectorProps {
  variantValue: string;
}

export function AdvancedReasoningEffortSelector({
  id,
  model,
  modelsData,
  value,
  variantValue,
  onValueChange,
}: AdvancedReasoningEffortSelectorProps) {
  const [isExpanded, setIsExpanded] = React.useState(value !== '');
  const panelId = `${id}-panel`;
  const hasConflict = variantValue !== '' && value !== '';

  React.useEffect(() => {
    if (value !== '') setIsExpanded(true);
  }, [value]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Advanced Provider Override
            </span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Most users should leave this unset.
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {value && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Configured: {value}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {isExpanded && (
        <div id={panelId} className="space-y-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
          {hasConflict && (
            <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              A model preset and a Provider override are both set. Leave the override unset unless you specifically need to replace the Provider&apos;s reasoning effort.
            </div>
          )}
          <ReasoningEffortSelector
            id={id}
            model={model}
            modelsData={modelsData}
            value={value}
            onValueChange={onValueChange}
          />
        </div>
      )}
    </div>
  );
}
