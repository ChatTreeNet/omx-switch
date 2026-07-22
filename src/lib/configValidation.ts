import { NextResponse } from 'next/server';

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

const SAFE_TOKEN_FIELD_NAMES: Record<string, true> = {
  max_tokens: true,
  budget_tokens: true,
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSecretLikeField(field: string): boolean {
  const normalizedField = field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

  const parts = normalizedField.split(/[^a-z0-9]+/);

  // 1. Check for separated or camelCase fields (exact token matches)
  if (parts.some((p) => p !== '' && SECRET_FIELD_PATTERNS.includes(p))) {
    if (SAFE_TOKEN_FIELD_NAMES[normalizedField]) {
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

// Map-valued config sections whose keys are identifiers (agent/category/role
// names), not fields — secret-like names there are validated separately, not
// rejected as secrets
function isConfigMapIdentifierPath(path: string): boolean {
  return path === 'agents' || path === 'categories' || path === 'modelRoles' || path === 'fallbackChains';
}

export function collectSecretLikeFields(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectSecretLikeFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const disallowedFields: string[] = [];

  for (const [key, childValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const isMapIdentifier = isConfigMapIdentifierPath(path);

    if (!isMapIdentifier && isSecretLikeField(key)) {
      disallowedFields.push(fieldPath);
      continue;
    }

    disallowedFields.push(...collectSecretLikeFields(childValue, fieldPath));
  }

  return disallowedFields;
}

export function stripSecretLikeFields(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => stripSecretLikeFields(entry, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const safeValue: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const isMapIdentifier = isConfigMapIdentifierPath(path);

    if (isMapIdentifier || !isSecretLikeField(key)) {
      safeValue[key] = stripSecretLikeFields(childValue, fieldPath);
    }
  }

  return safeValue;
}

export function mergeUnknownConfigValue(currentValue: unknown, submittedValue: unknown): unknown {
  if (!isPlainObject(currentValue) || !isPlainObject(submittedValue)) {
    return submittedValue;
  }

  const mergedValue: Record<string, unknown> = { ...currentValue };

  for (const [key, childValue] of Object.entries(submittedValue)) {
    mergedValue[key] = mergeUnknownConfigValue(mergedValue[key], childValue);
  }

  return mergedValue;
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function forbidden(disallowedFields: string[]) {
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

export function validateAgentOrCategoryField(section: string, field: string, value: unknown) {
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

export function validateGuiConfigField(field: string, value: unknown) {
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
