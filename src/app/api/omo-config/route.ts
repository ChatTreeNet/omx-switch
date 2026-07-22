import { NextRequest, NextResponse } from 'next/server';
import { normalizeOmoGuiConfig, readConfig, writeConfig } from '@/lib/omoConfig';
import {
  collectSecretLikeFields,
  forbidden,
  isPlainObject,
  mergeUnknownConfigValue,
  stripSecretLikeFields,
  validateAgentOrCategoryField,
  validateGuiConfigField,
} from '@/lib/configValidation';

/**
 * GET /api/omo-config
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

    const vibepulse = stripSecretLikeFields(normalizeOmoGuiConfig(config.vibepulse));
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
 * POST /api/omo-config
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

    if (
      isPlainObject(teamMode) &&
      Object.prototype.hasOwnProperty.call(teamMode, 'enabled') &&
      typeof teamMode.enabled !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'team_mode.enabled must be a boolean' },
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
  const currentVibepulse = normalizeOmoGuiConfig(currentConfig.vibepulse);

  if (vibepulse !== undefined) {
    for (const [key, value] of Object.entries(currentVibepulse)) {
      updatedVibepulse[key] = value;
    }

    for (const [field, value] of Object.entries(vibepulse as Record<string, unknown>)) {
      const error = validateGuiConfigField(field, value);
      if (error) return error;

      updatedVibepulse[field] = value;
    }
  }

  // Update config and save
  const newConfig = { ...currentConfig } as Record<string, unknown>;

  for (const [field, value] of Object.entries(body)) {
    if (field !== 'agents' && field !== 'categories' && field !== 'vibepulse' && field !== 'team_mode') {
      newConfig[field] = mergeUnknownConfigValue(newConfig[field], value);
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
