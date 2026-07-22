import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/omoConfig', async () => {
  const actual = await vi.importActual<typeof import('@/lib/omoConfig')>('@/lib/omoConfig');
  return {
    ...actual,
    readConfig: vi.fn(),
    writeConfig: vi.fn(),
  };
});

import { readConfig, writeConfig } from '@/lib/omoConfig';
import { GET, POST } from './route';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

const richV4Config = {
  $schema: 'https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-openagent.schema.json',
  team_mode: {
    enabled: true,
    workspace: 'team-alpha',
    future_policy: { approval: 'required' },
  },
  agents: {
    sisyphus: {
      model: 'anthropic/claude-opus-4-6',
      variant: 'max',
      reasoningEffort: 'max',
      temperature: 0.2,
      top_p: 0.9,
      maxTokens: 64000,
      thinking: { type: 'enabled', budget_tokens: 12000 },
      fallback_models: [
        'openai/gpt-5.4',
        {
          model: 'google/gemini-3.1-pro',
          variant: 'high',
          reasoningEffort: 'max',
          maxTokens: 32000,
          thinking: { enabled: true },
          futureFallbackField: 'preserve-me',
        },
      ],
      future_agent_knob: { mode: 'experimental' },
      apiKey: 'sk-should-not-leak',
      nested: {
        access_token: 'nested-token-should-not-leak',
        safe_hint: 'keep-me',
      },
    },
  },
  categories: {
    ultrabrain: {
      model: 'openai/gpt-5.4',
      variant: 'xhigh',
      reasoningEffort: 'max',
      maxTokens: 48000,
      thinking: { enabled: true },
      fallback_models: [
        'anthropic/claude-opus-4-6',
        { model: 'google/gemini-3.1-pro', reasoningEffort: 'max', maxTokens: 32000 },
      ],
      future_category_knob: 'keep-me',
      password: 'category-secret-should-not-leak',
    },
  },
  vibepulse: {
    stickyBusyDelayMs: 25000,
    futureVibePulseField: { enabled: true },
    token: 'vibepulse-token-should-not-leak',
  },
  future_top_level: { enabled: true },
};

function createPostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/omo-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('/api/omo-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns remote as the default openEditorTargetMode when vibepulse config is missing', async () => {
    mockReadConfig.mockResolvedValue({});

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.vibepulse).toEqual({ openEditorTargetMode: 'remote' });
  });

  it('rejects invalid openEditorTargetMode updates', async () => {
    mockReadConfig.mockResolvedValue({ vibepulse: { stickyBusyDelayMs: 1000 } });

    const response = await POST(new Request('http://localhost/api/omo-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibepulse: {
          openEditorTargetMode: 'desktop',
        },
      }),
    }) as never);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('openEditorTargetMode');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects array request bodies', async () => {
    const arrayBodies = [[], ['item'], [{ key: 'value' }]];

    for (const body of arrayBodies) {
      const response = await POST(new Request('http://localhost/api/omo-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }) as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request body');
      expect(mockWriteConfig).not.toHaveBeenCalled();
    }
  });

  it('persists a valid openEditorTargetMode update', async () => {
    mockReadConfig.mockResolvedValue({
      vibepulse: {
        stickyBusyDelayMs: 1000,
        sessionsRefreshIntervalMs: 5000,
      },
    });
    mockWriteConfig.mockResolvedValue();

    const response = await POST(new Request('http://localhost/api/omo-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vibepulse: {
          openEditorTargetMode: 'hub',
        },
      }),
    }) as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.vibepulse).toEqual({
      stickyBusyDelayMs: 1000,
      sessionsRefreshIntervalMs: 5000,
      openEditorTargetMode: 'hub',
    });
    expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({
      vibepulse: {
        stickyBusyDelayMs: 1000,
        sessionsRefreshIntervalMs: 5000,
        openEditorTargetMode: 'hub',
      },
    }));
  });

  it('returns safe v4-compatible config while filtering secret-like fields', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.team_mode).toEqual(richV4Config.team_mode);
    expect(data.agents.sisyphus).toEqual({
      model: 'anthropic/claude-opus-4-6',
      variant: 'max',
      reasoningEffort: 'max',
      temperature: 0.2,
      top_p: 0.9,
      maxTokens: 64000,
      thinking: { type: 'enabled', budget_tokens: 12000 },
      fallback_models: [
        'openai/gpt-5.4',
        expect.objectContaining({
          model: 'google/gemini-3.1-pro',
          reasoningEffort: 'max',
          futureFallbackField: 'preserve-me',
        }),
      ],
      future_agent_knob: { mode: 'experimental' },
      nested: { safe_hint: 'keep-me' },
    });
    expect(data.categories.ultrabrain).toEqual(expect.objectContaining({
      reasoningEffort: 'max',
      maxTokens: 48000,
      thinking: { enabled: true },
      future_category_knob: 'keep-me',
    }));
    expect(data.vibepulse).toEqual({
      stickyBusyDelayMs: 25000,
      futureVibePulseField: { enabled: true },
      openEditorTargetMode: 'remote',
    });
    expect(JSON.stringify(data)).not.toContain('should-not-leak');
  });

  it('preserves v4 fields when updating one known agent field', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      agents: {
        sisyphus: {
          temperature: 0.4,
          reasoningEffort: 'high',
        },
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents.sisyphus.temperature).toBe(0.4);
    expect(data.agents.sisyphus.reasoningEffort).toBe('high');
    expect(data.team_mode).toEqual(richV4Config.team_mode);
    expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({
      team_mode: richV4Config.team_mode,
      future_top_level: { enabled: true },
      agents: expect.objectContaining({
        sisyphus: expect.objectContaining({
          reasoningEffort: 'high',
          fallback_models: richV4Config.agents.sisyphus.fallback_models,
          maxTokens: 64000,
          thinking: { type: 'enabled', budget_tokens: 12000 },
          future_agent_knob: { mode: 'experimental' },
        }),
      }),
    }));
  });

  it.each([
    ['string', 'yes'],
    ['number', 1],
    ['null', null],
  ])('rejects team_mode.enabled when it is a %s without writing config', async (_name, enabled) => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      team_mode: {
        enabled,
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('team_mode.enabled');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('accepts boolean team_mode.enabled updates while preserving unknown sibling fields', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      team_mode: {
        enabled: false,
        rollout_note: 'pause team mode',
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.team_mode).toEqual({
      enabled: false,
      workspace: 'team-alpha',
      future_policy: { approval: 'required' },
      rollout_note: 'pause team mode',
    });
    expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({
      team_mode: {
        enabled: false,
        workspace: 'team-alpha',
        future_policy: { approval: 'required' },
        rollout_note: 'pause team mode',
      },
    }));
  });

  it('round-trips v4 config fields through GET, POST write, and GET readback', async () => {
    mockReadConfig.mockResolvedValueOnce(richV4Config);

    const initialGetResponse = await GET();
    const initialGetData = await initialGetResponse.json();

    expect(initialGetResponse.status).toBe(200);
    expect(initialGetData.team_mode.enabled).toBe(true);
    expect(initialGetData.future_top_level).toEqual({ enabled: true });
    expect(initialGetData.agents.sisyphus.reasoningEffort).toBe('max');
    expect(initialGetData.agents.sisyphus.fallback_models).toEqual([
      'openai/gpt-5.4',
      expect.objectContaining({
        model: 'google/gemini-3.1-pro',
        reasoningEffort: 'max',
        maxTokens: 32000,
        thinking: { enabled: true },
        futureFallbackField: 'preserve-me',
      }),
    ]);
    expect(JSON.stringify(initialGetData)).not.toContain('should-not-leak');

    mockReadConfig.mockResolvedValueOnce(richV4Config);
    mockWriteConfig.mockResolvedValueOnce();

    const postResponse = await POST(createPostRequest({
      ...initialGetData,
      agents: {
        ...initialGetData.agents,
        sisyphus: {
          ...initialGetData.agents.sisyphus,
          temperature: 0.35,
        },
      },
    }));
    const postData = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postData.team_mode).toEqual(initialGetData.team_mode);
    expect(postData.future_top_level).toEqual({ enabled: true });
    expect(postData.agents.sisyphus).toEqual(expect.objectContaining({
      reasoningEffort: 'max',
      maxTokens: 64000,
      thinking: { type: 'enabled', budget_tokens: 12000 },
      temperature: 0.35,
      future_agent_knob: { mode: 'experimental' },
    }));

    const writtenConfig = mockWriteConfig.mock.calls[0][0];
    expect(writtenConfig).toEqual(expect.objectContaining({
      team_mode: expect.objectContaining({
        enabled: true,
        future_policy: { approval: 'required' },
      }),
      future_top_level: { enabled: true },
      agents: expect.objectContaining({
        sisyphus: expect.objectContaining({
          reasoningEffort: 'max',
          fallback_models: initialGetData.agents.sisyphus.fallback_models,
          maxTokens: 64000,
          thinking: { type: 'enabled', budget_tokens: 12000 },
        }),
      }),
      categories: expect.objectContaining({
        ultrabrain: expect.objectContaining({
          reasoningEffort: 'max',
          fallback_models: initialGetData.categories.ultrabrain.fallback_models,
          future_category_knob: 'keep-me',
        }),
      }),
    }));

    mockReadConfig.mockResolvedValueOnce(writtenConfig as Awaited<ReturnType<typeof readConfig>>);
    const readbackResponse = await GET();
    const readbackData = await readbackResponse.json();

    expect(readbackResponse.status).toBe(200);
    expect(readbackData.team_mode).toEqual(writtenConfig.team_mode);
    expect(readbackData.future_top_level).toEqual({ enabled: true });
    expect(readbackData.agents.sisyphus.fallback_models).toEqual(initialGetData.agents.sisyphus.fallback_models);
    expect(readbackData.categories.ultrabrain.fallback_models).toEqual(initialGetData.categories.ultrabrain.fallback_models);
    expect(JSON.stringify(readbackData)).not.toContain('apiKey');
    expect(JSON.stringify(readbackData)).not.toContain('access_token');
  });

  it('removes reasoningEffort and fallback_models when explicitly set to null, while preserving unknown safe fields', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      agents: {
        sisyphus: {
          reasoningEffort: null,
          fallback_models: null
        }
      },
      categories: {
        ultrabrain: {
          reasoningEffort: null,
          fallback_models: null
        }
      }
    }));

    await response.json();
    expect(response.status).toBe(200);

    const writeCall = mockWriteConfig.mock.calls[0];
    const writtenConfig = writeCall[0];

    expect(writtenConfig.agents!.sisyphus.reasoningEffort).toBeUndefined();
    expect(writtenConfig.agents!.sisyphus.fallback_models).toBeUndefined();
    
    expect(writtenConfig.categories!.ultrabrain.reasoningEffort).toBeUndefined();
    expect(writtenConfig.categories!.ultrabrain.fallback_models).toBeUndefined();

    expect(writtenConfig.agents!.sisyphus.future_agent_knob).toBeDefined();
    expect(writtenConfig.categories!.ultrabrain.future_category_knob).toBeDefined();
  });

  it('rejects null for non-clearable fields like variant or prompt_append', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      agents: {
        sisyphus: {
          variant: null,
          prompt_append: null
        },
      },
    }));

    const data = await response.json();
    expect(response.status).toBe(400);
    expect(data.error).toContain('variant must be a string');
    
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('preserves existing disk secrets in safe POST writes while redacting the response', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      agents: {
        sisyphus: {
          temperature: 0.4,
        },
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents.sisyphus).toEqual(expect.objectContaining({
      temperature: 0.4,
      future_agent_knob: { mode: 'experimental' },
      nested: { safe_hint: 'keep-me' },
      fallback_models: richV4Config.agents.sisyphus.fallback_models,
    }));
    expect(JSON.stringify(data)).not.toContain('should-not-leak');
    expect(JSON.stringify(data)).not.toContain('apiKey');
    expect(JSON.stringify(data)).not.toContain('access_token');
    expect(JSON.stringify(data)).not.toContain('password');
    expect(data.vibepulse).not.toHaveProperty('token');

    const writtenConfig = mockWriteConfig.mock.calls[0][0];
    expect(writtenConfig).toEqual(expect.objectContaining({
      team_mode: richV4Config.team_mode,
      future_top_level: { enabled: true },
      agents: expect.objectContaining({
        sisyphus: expect.objectContaining({
          temperature: 0.4,
          apiKey: 'sk-should-not-leak',
          future_agent_knob: { mode: 'experimental' },
          nested: expect.objectContaining({
            access_token: 'nested-token-should-not-leak',
            safe_hint: 'keep-me',
          }),
          fallback_models: richV4Config.agents.sisyphus.fallback_models,
        }),
      }),
      categories: expect.objectContaining({
        ultrabrain: expect.objectContaining({
          future_category_knob: 'keep-me',
          password: 'category-secret-should-not-leak',
        }),
      }),
      vibepulse: expect.objectContaining({
        futureVibePulseField: { enabled: true },
        token: 'vibepulse-token-should-not-leak',
      }),
    }));
  });

  it('preserves hidden secrets inside unknown top-level object sections during sanitized POST round trips', async () => {
    const configWithUnknownSection = {
      ...richV4Config,
      mcp: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: {
            api_token: 'mcp-token-should-not-leak',
            mode: 'readonly',
          },
        },
      },
    };

    mockReadConfig.mockResolvedValueOnce(configWithUnknownSection);
    const getResponse = await GET();
    const getData = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getData.mcp.filesystem.env).toEqual({ mode: 'readonly' });
    expect(JSON.stringify(getData)).not.toContain('mcp-token-should-not-leak');

    mockReadConfig.mockResolvedValueOnce(configWithUnknownSection);
    mockWriteConfig.mockResolvedValueOnce();

    const postResponse = await POST(createPostRequest({
      ...getData,
      mcp: {
        ...getData.mcp,
        filesystem: {
          ...getData.mcp.filesystem,
          timeoutMs: 1000,
        },
      },
    }));
    const postData = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postData.mcp.filesystem).toEqual(expect.objectContaining({
      command: 'npx',
      timeoutMs: 1000,
      env: { mode: 'readonly' },
    }));
    expect(JSON.stringify(postData)).not.toContain('mcp-token-should-not-leak');
    expect(postData.mcp.filesystem.env).not.toHaveProperty('api_token');

    const writtenConfig = mockWriteConfig.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenConfig.mcp).toEqual({
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {
          api_token: 'mcp-token-should-not-leak',
          mode: 'readonly',
        },
        timeoutMs: 1000,
      },
    });
  });

  it.each([
    ['apiKey', { agents: { sisyphus: { apiKey: 'sk-test' } } }],
    ['apikey', { agents: { sisyphus: { apikey: 'sk-test' } } }],
    ['accesstoken', { agents: { sisyphus: { accesstoken: 'token-test' } } }],
    ['privatekey', { agents: { sisyphus: { privatekey: 'key-test' } } }],
    ['token', { vibepulse: { token: 'secret-token' } }],
    ['password', { categories: { ultrabrain: { password: 'secret-password' } } }],
    ['nested secret-like keys', { agents: { sisyphus: { thinking: { access_token: 'nested-token' } } } }],
    ['unknown top-level object nested secret-like keys', { mcp: { filesystem: { env: { api_token: 'nested-token' } } } }],
  ])('rejects secret-like POST field %s without writing config', async (_name, payload) => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest(payload));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('disallowed');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['max_api_token', { agents: { sisyphus: { max_api_token: 'should-fail' } } }],
    ['budget_secret_token', { agents: { sisyphus: { thinking: { budget_secret_token: 'should-fail' } } } }],
  ])('rejects unsafe token exception bypass field %s without writing config', async (_name, payload) => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest(payload));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('disallowed');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('preserves safe unknown fields containing secret-like substrings (e.g., keyboard, monkey)', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const payload = {
      agents: {
        sisyphus: {
          keyboard: 'mechanical',
          monkey: 'patch',
        },
      },
    };

    const response = await POST(createPostRequest(payload));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents.sisyphus.keyboard).toBe('mechanical');
    expect(data.agents.sisyphus.monkey).toBe('patch');
  });

  it('allows secret-like agent and category names when their config fields are safe', async () => {
    mockReadConfig.mockResolvedValue({ agents: {}, categories: {} });
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest({
      agents: {
        auth: { model: 'anthropic/claude-opus-4-6', maxTokens: 64000 },
        token: { thinking: { enabled: true, budget_tokens: 12000 } },
      },
      categories: {
        private: { model: 'openai/gpt-5.4', reasoningEffort: 'max' },
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents.auth).toEqual({ model: 'anthropic/claude-opus-4-6', maxTokens: 64000 });
    expect(data.agents.token).toEqual({ thinking: { enabled: true, budget_tokens: 12000 } });
    expect(data.categories.private).toEqual({ model: 'openai/gpt-5.4', reasoningEffort: 'max' });
    expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({
      agents: expect.objectContaining({
        auth: { model: 'anthropic/claude-opus-4-6', maxTokens: 64000 },
        token: { thinking: { enabled: true, budget_tokens: 12000 } },
      }),
      categories: expect.objectContaining({
        private: { model: 'openai/gpt-5.4', reasoningEffort: 'max' },
      }),
    }));
  });

  it.each([
    ['agent secret field', { agents: { auth: { apiKey: 'sk-test' } } }],
    ['agent nested thinking secret field', { agents: { token: { thinking: { access_token: 'nested-token' } } } }],
    ['category secret field', { categories: { private: { password: 'secret-password' } } }],
  ])('rejects %s inside secret-like agent/category names without writing config', async (_name, payload) => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const response = await POST(createPostRequest(payload));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain('disallowed');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('rejects additional concatenated lowercase sensitive fields and separated key tokens', async () => {
    mockReadConfig.mockResolvedValue(richV4Config);
    mockWriteConfig.mockResolvedValue();

    const additionalRejections = [
      'accesskey',
      'authtoken',
      'secretkey',
      'passwordhash',
      'credential',
      'monkey_key',
      'board_key',
      'monkeyKey',
      'boardKey',
      'token_limit',
      'token_count'
    ];

    for (const field of additionalRejections) {
      const response = await POST(createPostRequest({
        agents: { sisyphus: { [field]: 'should-fail' } }
      }));
      expect(response.status).toBe(403);
    }
  });

  it('filters out concatenated secrets from GET response', async () => {
    mockReadConfig.mockResolvedValue({
      agents: {
        sisyphus: {
          apikey: 'leak-1',
          accesstoken: 'leak-2',
          privatekey: 'leak-3',
          keyboard: 'keep-me'
        }
      }
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents.sisyphus.keyboard).toBe('keep-me');
    expect(data.agents.sisyphus).not.toHaveProperty('apikey');
    expect(data.agents.sisyphus).not.toHaveProperty('accesstoken');
    expect(data.agents.sisyphus).not.toHaveProperty('privatekey');
  });
});
