import type { OmoModelDetail } from '@/lib/queries';

export interface ParsedOpenCodeModels {
  models: string[];
  modelDetails: OmoModelDetail[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonObject(source: string, start: number): { value: unknown; end: number } {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          value: JSON.parse(source.slice(start, index + 1)),
          end: index + 1,
        };
      }
    }
  }

  throw new Error('Unterminated OpenCode model metadata');
}

/**
 * `opencode models --verbose` emits a selector line followed by one JSON object.
 * The JSON contains nested provider options, so parse balanced objects instead
 * of depending on line-oriented regular expressions.
 */
export function parseOpenCodeModelsVerbose(stdout: string): ParsedOpenCodeModels {
  const models: string[] = [];
  const modelDetails: OmoModelDetail[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (cursor < stdout.length) {
    const lineEnd = stdout.indexOf('\n', cursor);
    const end = lineEnd === -1 ? stdout.length : lineEnd;
    const selector = stdout.slice(cursor, end).trim();
    cursor = lineEnd === -1 ? stdout.length : lineEnd + 1;

    if (!/^\S+\/\S+$/.test(selector)) continue;

    while (cursor < stdout.length && /\s/.test(stdout[cursor])) cursor += 1;
    if (stdout[cursor] !== '{') {
      throw new Error(`Missing metadata for OpenCode model ${selector}`);
    }

    const parsed = readJsonObject(stdout, cursor);
    cursor = parsed.end;
    if (!isRecord(parsed.value)) {
      throw new Error(`Invalid metadata for OpenCode model ${selector}`);
    }

    if (seen.has(selector)) continue;
    seen.add(selector);

    const detail: OmoModelDetail = { selector };
    const capabilities = parsed.value.capabilities;
    if (isRecord(capabilities) && typeof capabilities.reasoning === 'boolean') {
      detail.reasoning = capabilities.reasoning;
    }

    if (isRecord(parsed.value.variants)) {
      detail.variants = Object.keys(parsed.value.variants).filter(
        (variant) => variant.trim() !== ''
      );
    }

    models.push(selector);
    modelDetails.push(detail);
  }

  return { models, modelDetails };
}
