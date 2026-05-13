import { describe, expect, it } from 'vitest';
import { createExportedProfileFile, parseImportedProfileFile } from './share';

describe('profile share helpers', () => {
  it('creates an exported profile file payload', () => {
    const result = createExportedProfileFile(
      {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: 'Shared team profile',
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
      },
      {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: {
          deep: { model: 'openai/gpt-5.3-codex', variant: 'medium' },
        },
      }
    );

    expect(result).toMatchObject({
      version: 1,
      source: 'vibepulse',
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: 'Shared team profile',
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: {
          deep: { model: 'openai/gpt-5.3-codex', variant: 'medium' },
        },
      },
    });
    expect(result.exportedAt).toBeTypeOf('string');
  });

  it('round-trips a v4 overlay with team mode, rich fallback models, and unknown metadata', () => {
    const exported = createExportedProfileFile(
      {
        id: 'v4-overlay',
        name: 'V4 Overlay',
        emoji: '🧩',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
      {
        agents: {
          oracle: {
            model: 'openai/gpt-5.4',
            reasoningEffort: 'max',
            maxTokens: 64000,
            thinking: { type: 'enabled', budget_tokens: 12000 },
            fallback_models: [
              'anthropic/claude-opus-4-6',
              {
                model: 'google/gemini-3.1-pro',
                variant: 'high',
                reasoningEffort: 'max',
                maxTokens: 4096,
                thinking: { budget_tokens: 1024 },
                futureFallbackField: 'preserve-me',
              },
            ],
            future_agent_knob: { mode: 'experimental' },
          },
        },
        categories: {
          ultrabrain: {
            reasoningEffort: 'max',
            fallback_models: [
              'openai/gpt-5.4',
              { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max' },
            ],
            future_category_knob: 'keep-me',
          },
        },
        team_mode: {
          enabled: true,
          routing: 'round-robin',
        },
        metadata: {
          owner: 'agents-team',
        },
      }
    );

    const imported = parseImportedProfileFile(exported);

    expect(imported.config).toMatchObject({
      agents: {
        oracle: {
          reasoningEffort: 'max',
          maxTokens: 64000,
          thinking: { type: 'enabled', budget_tokens: 12000 },
          fallback_models: [
            'anthropic/claude-opus-4-6',
            {
              model: 'google/gemini-3.1-pro',
              variant: 'high',
              reasoningEffort: 'max',
              maxTokens: 4096,
              thinking: { budget_tokens: 1024 },
              futureFallbackField: 'preserve-me',
            },
          ],
          future_agent_knob: { mode: 'experimental' },
        },
      },
      categories: {
        ultrabrain: {
          reasoningEffort: 'max',
          fallback_models: [
            'openai/gpt-5.4',
            { model: 'anthropic/claude-opus-4-6', reasoningEffort: 'max' },
          ],
          future_category_knob: 'keep-me',
        },
      },
      team_mode: {
        enabled: true,
        routing: 'round-robin',
      },
      metadata: {
        owner: 'agents-team',
      },
    });
  });

  it('parses a valid imported profile payload', () => {
    const result = parseImportedProfileFile({
      version: 1,
      source: 'vibepulse',
      exportedAt: '2026-03-18T00:00:00.000Z',
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
      },
    });

    expect(result).toEqual({
      profile: {
        id: 'team-sync',
        name: 'Team Sync',
        emoji: '🤝',
        description: undefined,
      },
      config: {
        agents: {
          sisyphus: { model: 'openai/gpt-5.4' },
        },
        categories: undefined,
      },
    });
  });

  it('rejects an imported profile with an invalid id', () => {
    expect(() =>
      parseImportedProfileFile({
        profile: {
          id: 'team sync',
          name: 'Team Sync',
          emoji: '🤝',
        },
        config: { agents: {} },
      })
    ).toThrow('Imported profile id must contain only letters, numbers, hyphens, and underscores');
  });
});
