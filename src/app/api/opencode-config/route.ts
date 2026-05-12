import { NextRequest, NextResponse } from 'next/server';
import { normalizeVibePulseConfig, readConfig, writeConfig } from '@/lib/opencodeConfig';

const SECRET_FIELD_PATTERNS = [
  'api',
  'key',
  'token',
  'secret',
  'password',
  'auth',
  'credential',
  'private',
  'cert',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSecretLikeField(field: string): boolean {
  const normalizedField = field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

  const parts = normalizedField.split(/[^a-z0-9]+/);

  // 1. Check for separated or camelCase fields (exact token matches)
  if (parts.some((p) => p !== '' && SECRET_FIELD_PATTERNS.includes(p))) {
    // If it is a token match, verify it's not a common non-secret configuration
    // (e.g. maxTokens, budget_tokens)
    const hasToken = parts.includes('token');

    if (hasToken && parts.some((p) => p === 'max' || p === 'budget')) {
      return false;
    }

    return true;
  }

  // 2. Check for common concatenated sensitive fields (whole string matches)
  // This satisfies the Codex check for "apikey", "accesstoken", "privatekey"
  const concatenatedSecrets = [
    'apikey',
    'accesskey',
    'accesstoken',
    'authtoken',
    'privatekey',
    'secretkey',
    'passwordhash',
    'credential'
  ];
  if (concatenatedSecrets.includes(normalizedField)) {
    return true;
  }

  return false;
}

function collectSecretLikeFields(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSecretLikeFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const disallowedFields: string[] = [];

  for (const [key, childValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;

    if (isSecretLikeField(key)) {
      disallowedFields.push(fieldPath);
      continue;
    }

    disallowedFields.push(...collectSecretLikeFields(childValue, fieldPath));
  }

  return disallowedFields;
}

function stripSecretLikeFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecretLikeFields);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const safeValue: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (!isSecretLikeField(key)) {
      safeValue[key] = stripSecretLikeFields(childValue);
    }
  }

  return safeValue;
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function forbidden(disallowedFields: string[]) {
  return NextResponse.json(
    { error: `Config contains disallowed fields: ${disallowedFields.join(', ')}` },
    { status: 403 }
  );
}

function validateStringField(section: string, field: string, value: unknown, options: { nonEmpty?: boolean } = {}) {
  if (typeof value !== 'string' || (options.nonEmpty && value.trim() === '')) {
    return badRequest(`${section}: ${field} must be ${options.nonEmpty ? 'a non-empty string' : 'a string'}`);
  }

  return null;
}

function validateFiniteNumber(section: string, field: string, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return badRequest(`${section}: ${field} must be a finite number`);
  }

  return null;
}

function validateFallbackModelEntry(section: string, value: unknown) {
  if (typeof value === 'string' || isPlainObject(value)) {
    return null;
  }

  return badRequest(`${section}: fallback_models entries must be strings or objects`);
}

function validateAgentOrCategoryField(section: string, field: string, value: unknown) {
  switch (field) {
    case 'model':
      return validateStringField(section, field, value, { nonEmpty: true });
    case 'variant':
    case 'prompt_append':
    case 'description':
    case 'category':
    case 'system':
      return validateStringField(section, field, value);
    case 'reasoningEffort':
      if (value === null) return null;
      return validateStringField(section, field, value);
    case 'temperature': {
      const error = validateFiniteNumber(section, field, value);
      if (error) return error;

      const temperature = value as number;
      if (temperature < 0 || temperature > 2) {
        return badRequest(`${section}: temperature must be a number between 0 and 2`);
      }

      return null;
    }
    case 'top_p': {
      const error = validateFiniteNumber(section, field, value);
      if (error) return error;

      const topP = value as number;
      if (topP < 0 || topP > 1) {
        return badRequest(`${section}: top_p must be a number between 0 and 1`);
      }

      return null;
    }
    case 'maxTokens':
    case 'max_tokens': {
      const error = validateFiniteNumber(section, field, value);
      if (error) return error;

      if ((value as number) <= 0) {
        return badRequest(`${section}: ${field} must be greater than 0`);
      }

      return null;
    }
    case 'thinking':
      if (typeof value !== 'boolean' && !isPlainObject(value)) {
        return badRequest(`${section}: thinking must be a boolean or object`);
      }

      return null;
    case 'fallback_models':
      if (value === null) return null;
      if (Array.isArray(value)) {
        for (const entry of value) {
          const error = validateFallbackModelEntry(section, entry);
          if (error) return error;
        }

        return null;
      }

      return validateFallbackModelEntry(section, value);
    default:
      return null;
  }
}

function validateVibePulseField(field: string, value: unknown) {
  if (field === 'stickyBusyDelayMs' || field === 'sessionsRefreshIntervalMs') {
    const error = validateFiniteNumber('Vibepulse', field, value);
    if (error) return error;

    if (field === 'stickyBusyDelayMs' && (value as number) < 0) {
      return badRequest(`Vibepulse: '${field}' must be a non-negative number`);
    }

    if (field === 'sessionsRefreshIntervalMs' && (value as number) <= 0) {
      return badRequest(`Vibepulse: '${field}' must be greater than 0`);
    }
  }

  if (field === 'openEditorTargetMode' && value !== 'remote' && value !== 'hub') {
    return badRequest(`Vibepulse: '${field}' must be either 'remote' or 'hub'`);
  }

  return null;
}

/**
 * GET /api/opencode-config
 * Returns safe v4-compatible configuration
 * Filters out sensitive fields (apiKey, token, password, etc.)
 */
export async function GET() {
  try {
    const config = await readConfig();
    const safeConfig = stripSecretLikeFields(config) as Record<string, unknown>;
    const agents = config.agents || {};
    const filteredAgents: Record<string, Record<string, unknown>> = {};
    
    for (const [agentName, agentConfig] of Object.entries(agents)) {
      if (isPlainObject(agentConfig)) {
        filteredAgents[agentName] = stripSecretLikeFields(agentConfig) as Record<string, unknown>;
      }
    }

    const categories = config.categories || {};
    const filteredCategories: Record<string, Record<string, unknown>> = {};
    
    for (const [catName, catConfig] of Object.entries(categories)) {
      if (isPlainObject(catConfig)) {
        filteredCategories[catName] = stripSecretLikeFields(catConfig) as Record<string, unknown>;
      }
    }

    const vibepulse = stripSecretLikeFields(normalizeVibePulseConfig(config.vibepulse));
    const teamMode = isPlainObject(config.team_mode)
      ? stripSecretLikeFields(config.team_mode)
      : config.team_mode;

    return NextResponse.json({
      ...safeConfig,
      agents: filteredAgents,
      categories: filteredCategories,
      team_mode: teamMode,
      vibepulse
    });
  } catch (error) {
    console.error('Error reading config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/opencode-config
 * Updates agent configuration with validation
 * Rejects sensitive fields (apiKey, token, password, secret, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request structure
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const disallowedFields = collectSecretLikeFields(body);
    if (disallowedFields.length > 0) {
      return forbidden(disallowedFields);
    }

    const { agents, categories, vibepulse, team_mode: teamMode } = body;

    // If neither agents, categories, nor vibepulse provided, nothing to update
    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: 'Missing config fields to update' },
        { status: 400 }
      );
    }

    // Validate agents is an object (if provided)
    if (agents !== undefined && (typeof agents !== 'object' || agents === null || Array.isArray(agents))) {
      return NextResponse.json(
        { error: 'Agents must be an object' },
        { status: 400 }
      );
    }
    
    // Validate categories is an object (if provided)
    if (categories !== undefined && (typeof categories !== 'object' || categories === null || Array.isArray(categories))) {
      return NextResponse.json(
        { error: 'Categories must be an object' },
        { status: 400 }
      );
    }

    // Validate vibepulse is an object (if provided)
    if (vibepulse !== undefined && (typeof vibepulse !== 'object' || vibepulse === null || Array.isArray(vibepulse))) {
      return NextResponse.json(
        { error: 'Vibepulse must be an object' },
        { status: 400 }
      );
    }

    if (teamMode !== undefined && (typeof teamMode !== 'object' || teamMode === null || Array.isArray(teamMode))) {
      return NextResponse.json(
        { error: 'team_mode must be an object' },
        { status: 400 }
      );
    }

    // Read current config
    const currentConfig = await readConfig();
    const currentAgents = currentConfig.agents || {};

    // Validate and merge agent updates
    const updatedAgents: Record<string, Record<string, unknown>> = {};

    for (const [name, config] of Object.entries(currentAgents)) {
      if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
        updatedAgents[name] = config as Record<string, unknown>;
      }
    }

    if (agents !== undefined) {
      for (const [agentName, agentConfig] of Object.entries(agents)) {
        if (!isPlainObject(agentConfig)) {
          return NextResponse.json(
            { error: `Agent '${agentName}' config must be an object` },
            { status: 400 }
          );
        }

        const config = agentConfig as Record<string, unknown>;

      const validatedConfig: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(config)) {
        const error = validateAgentOrCategoryField(`Agent '${agentName}'`, field, value);
        if (error) return error;

        validatedConfig[field] = value;
      }

      updatedAgents[agentName] = {
        ...(currentAgents[agentName] as Record<string, unknown> || {}),
        ...validatedConfig
      };
      
      if (validatedConfig.reasoningEffort === null) {
        delete updatedAgents[agentName].reasoningEffort;
      }
      if (validatedConfig.fallback_models === null) {
        delete updatedAgents[agentName].fallback_models;
      }
    }
  }

  // Process categories updates if provided
  const updatedCategories: Record<string, Record<string, unknown>> = {};
  const currentCategories = (currentConfig.categories || {}) as Record<string, Record<string, unknown>>;

  for (const [name, config] of Object.entries(currentCategories)) {
    if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
      updatedCategories[name] = config as Record<string, unknown>;
    }
  }

  if (categories !== undefined) {
    for (const [categoryName, categoryConfig] of Object.entries(categories)) {
      if (!isPlainObject(categoryConfig)) {
        return NextResponse.json(
          { error: `Category '${categoryName}' config must be an object` },
          { status: 400 }
        );
      }

      const configObj = categoryConfig as Record<string, unknown>;
      const validatedCategoryConfig: Record<string, unknown> = {};

      for (const [field, value] of Object.entries(configObj)) {
        const error = validateAgentOrCategoryField(`Category '${categoryName}'`, field, value);
        if (error) return error;

        validatedCategoryConfig[field] = value;
      }
      
      updatedCategories[categoryName] = {
        ...((currentCategories[categoryName] as Record<string, unknown>) || {}),
        ...validatedCategoryConfig
      };
      
      if (validatedCategoryConfig.reasoningEffort === null) {
        delete updatedCategories[categoryName].reasoningEffort;
      }
      if (validatedCategoryConfig.fallback_models === null) {
        delete updatedCategories[categoryName].fallback_models;
      }
    }
  }

  // Process vibepulse updates if provided
  const updatedVibepulse: Record<string, unknown> = {};
  const currentVibepulse = normalizeVibePulseConfig(currentConfig.vibepulse);

  if (vibepulse !== undefined) {
    for (const [key, value] of Object.entries(currentVibepulse)) {
      updatedVibepulse[key] = value;
    }
    
    for (const [field, value] of Object.entries(vibepulse as Record<string, unknown>)) {
      const error = validateVibePulseField(field, value);
      if (error) return error;

      updatedVibepulse[field] = value;
    }
  }

  // Update config and save
  const newConfig = { ...currentConfig } as Record<string, unknown>;

  for (const [field, value] of Object.entries(body)) {
    if (field !== 'agents' && field !== 'categories' && field !== 'vibepulse' && field !== 'team_mode') {
      newConfig[field] = value;
    }
  }

  if (agents !== undefined) newConfig.agents = updatedAgents;
  if (categories !== undefined) newConfig.categories = updatedCategories;
  if (vibepulse !== undefined) newConfig.vibepulse = updatedVibepulse;
  if (teamMode !== undefined) {
    newConfig.team_mode = {
      ...(isPlainObject(currentConfig.team_mode) ? currentConfig.team_mode : {}),
      ...(teamMode as Record<string, unknown>),
    };
  }
  
  // writeConfig type doesn't natively expose categories yet, safely bypassing
  await writeConfig(
    newConfig as { 
       agents?: Record<string, Record<string, unknown>>; 
       categories?: Record<string, Record<string, unknown>>; 
       vibepulse?: Record<string, unknown>;
       team_mode?: Record<string, unknown>;
     }
   );

  const safeResponse = stripSecretLikeFields(newConfig) as Record<string, unknown>;

  return NextResponse.json(
    {
      ...safeResponse,
      success: true,
      agents: safeResponse.agents,
      categories: safeResponse.categories,
      team_mode: safeResponse.team_mode,
      vibepulse: safeResponse.vibepulse,
    },
    { status: 200 }
  );
} catch (error) {
  console.error('Error updating config:', error);
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}
}
