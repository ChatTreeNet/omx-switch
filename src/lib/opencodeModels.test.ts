import { describe, expect, it } from 'vitest';
import { parseOpenCodeModelsVerbose } from './opencodeModels';

describe('parseOpenCodeModelsVerbose', () => {
  it('extracts model-specific reasoning variants from nested metadata', () => {
    const parsed = parseOpenCodeModelsVerbose(`openai/gpt-5.5
{
  "capabilities": { "reasoning": true },
  "options": { "note": "a } brace inside a string" },
  "variants": {
    "minimal": { "reasoningEffort": "minimal" },
    "high": { "reasoningEffort": "high" },
    "xhigh": { "reasoningEffort": "xhigh" }
  }
}
anthropic/claude-haiku-4.5
{
  "capabilities": { "reasoning": true },
  "variants": {
    "high": { "thinking": { "type": "enabled", "budgetTokens": 16000 } },
    "max": { "thinking": { "type": "enabled", "budgetTokens": 31999 } }
  }
}
openai/gpt-4.1
{
  "capabilities": { "reasoning": false },
  "variants": {}
}
`);

    expect(parsed.models).toEqual([
      'openai/gpt-5.5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-4.1',
    ]);
    expect(parsed.modelDetails).toEqual([
      {
        selector: 'openai/gpt-5.5',
        reasoning: true,
        variants: ['minimal', 'high', 'xhigh'],
      },
      {
        selector: 'anthropic/claude-haiku-4.5',
        reasoning: true,
        variants: ['high', 'max'],
      },
      { selector: 'openai/gpt-4.1', reasoning: false, variants: [] },
    ]);
  });

  it('supports custom variant names and ignores duplicate selectors', () => {
    const parsed = parseOpenCodeModelsVerbose(`openai/custom
{"capabilities":{"reasoning":true},"variants":{"fast":{},"deep":{}}}
openai/custom
{"capabilities":{"reasoning":true},"variants":{"other":{}}}
`);

    expect(parsed).toEqual({
      models: ['openai/custom'],
      modelDetails: [
        { selector: 'openai/custom', reasoning: true, variants: ['fast', 'deep'] },
      ],
    });
  });

  it('omits malformed optional metadata while retaining the model', () => {
    const parsed = parseOpenCodeModelsVerbose(`openrouter/vendor/model/path
{"capabilities":{"reasoning":"yes"},"variants":["high"],"headers":{"authorization":"secret"}}
`);

    expect(parsed).toEqual({
      models: ['openrouter/vendor/model/path'],
      modelDetails: [{ selector: 'openrouter/vendor/model/path' }],
    });
    expect(JSON.stringify(parsed)).not.toContain('authorization');
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  it('throws on truncated metadata so the route can use its plain-list fallback', () => {
    expect(() => parseOpenCodeModelsVerbose('openai/gpt-5.5\n{"variants": {'))
      .toThrow('Unterminated OpenCode model metadata');
  });
});
