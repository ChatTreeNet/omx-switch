import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@/lib/ompConfig';
import {
  collectSecretLikeFields,
  forbidden,
  isPlainObject,
  stripSecretLikeFields,
} from '@/lib/configValidation';

const ROLE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
// Role names, model selectors (provider/model-id), provider wildcards (provider/*),
// and id-prefixed wildcards (openrouter/google/*)
const CHAIN_KEY_PATTERN = /^[a-zA-Z0-9_*./-]+$/;

/**
 * GET /api/omp-config
 * Returns the OMP (Oh My Pi) config.yml with sensitive fields filtered out.
 * The model switching surface is the modelRoles map plus retry fallback chains.
 */
export async function GET() {
  try {
    const config = await readConfig();
    const safeConfig = stripSecretLikeFields(config) as Record<string, unknown>;

    const modelRoles: Record<string, string> = {};
    if (isPlainObject(config.modelRoles)) {
      for (const [role, model] of Object.entries(config.modelRoles)) {
        if (typeof model === 'string') {
          modelRoles[role] = model;
        }
      }
    }

    const retry = isPlainObject(config.retry) ? config.retry : {};
    const fallbackChains: Record<string, string[]> = {};
    if (isPlainObject(retry.fallbackChains)) {
      for (const [key, chain] of Object.entries(retry.fallbackChains)) {
        if (Array.isArray(chain)) {
          fallbackChains[key] = chain.filter((entry): entry is string => typeof entry === 'string');
        }
      }
    }

    return NextResponse.json({
      ...safeConfig,
      modelRoles,
      modelFallback: retry.modelFallback !== false,
      fallbackChains,
    });
  } catch (error) {
    console.error('Error reading OMP config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/omp-config
 * Updates OMP model role assignments and retry fallback chains.
 * Payload: {
 *   modelRoles?: { [role]: "provider/model" | null },      — null unsets a role
 *   fallbackChains?: { [key]: string[] | null },           — null deletes a chain
 *   modelFallback?: boolean                                — master fallback toggle
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

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

    const { modelRoles, fallbackChains, modelFallback } = body;

    if (modelRoles === undefined && fallbackChains === undefined && modelFallback === undefined) {
      return NextResponse.json(
        { error: 'Missing config fields to update' },
        { status: 400 }
      );
    }

    if (modelRoles !== undefined && !isPlainObject(modelRoles)) {
      return NextResponse.json(
        { error: 'modelRoles must be an object' },
        { status: 400 }
      );
    }

    if (fallbackChains !== undefined && !isPlainObject(fallbackChains)) {
      return NextResponse.json(
        { error: 'fallbackChains must be an object' },
        { status: 400 }
      );
    }

    if (modelFallback !== undefined && typeof modelFallback !== 'boolean') {
      return NextResponse.json(
        { error: 'modelFallback must be a boolean' },
        { status: 400 }
      );
    }

    if (isPlainObject(modelRoles)) {
      for (const [role, model] of Object.entries(modelRoles)) {
        if (!ROLE_NAME_PATTERN.test(role)) {
          return NextResponse.json(
            { error: `Invalid role name: '${role}'` },
            { status: 400 }
          );
        }

        if (model === null) continue;

        if (typeof model !== 'string' || model.trim() === '') {
          return NextResponse.json(
            { error: `Role '${role}': model must be a non-empty string or null` },
            { status: 400 }
          );
        }
      }
    }

    if (isPlainObject(fallbackChains)) {
      for (const [key, chain] of Object.entries(fallbackChains)) {
        if (!CHAIN_KEY_PATTERN.test(key)) {
          return NextResponse.json(
            { error: `Invalid fallback chain key: '${key}'` },
            { status: 400 }
          );
        }

        if (chain === null) continue;

        if (!Array.isArray(chain) || chain.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
          return NextResponse.json(
            { error: `Fallback chain '${key}' must be an array of non-empty strings or null` },
            { status: 400 }
          );
        }
      }
    }

    const currentConfig = await readConfig();
    const currentRoles = isPlainObject(currentConfig.modelRoles)
      ? { ...(currentConfig.modelRoles as Record<string, string>) }
      : {};

    if (isPlainObject(modelRoles)) {
      for (const [role, model] of Object.entries(modelRoles)) {
        if (model === null) {
          delete currentRoles[role];
        } else {
          currentRoles[role] = model as string;
        }
      }
    }

    const currentRetry = isPlainObject(currentConfig.retry) ? { ...currentConfig.retry } : {};
    const currentChains = isPlainObject(currentRetry.fallbackChains)
      ? { ...(currentRetry.fallbackChains as Record<string, string[]>) }
      : {};

    if (isPlainObject(fallbackChains)) {
      for (const [key, chain] of Object.entries(fallbackChains)) {
        if (chain === null) {
          delete currentChains[key];
        } else {
          currentChains[key] = chain as string[];
        }
      }
    }

    if (modelFallback !== undefined) {
      currentRetry.modelFallback = modelFallback;
    }
    if (isPlainObject(fallbackChains)) {
      currentRetry.fallbackChains = currentChains;
    }

    const retryTouched = modelFallback !== undefined || isPlainObject(fallbackChains);
    const newConfig = {
      ...currentConfig,
      modelRoles: currentRoles,
    };
    // Only write retry when it was modified or already present — never invent it
    if (retryTouched || currentConfig.retry !== undefined) {
      (newConfig as Record<string, unknown>).retry = currentRetry;
    }
    await writeConfig(newConfig);

    return NextResponse.json(
      {
        success: true,
        modelRoles: currentRoles,
        modelFallback: currentRetry.modelFallback !== false,
        fallbackChains: currentChains,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating OMP config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
