import Ajv2020, { ValidateFunction, ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

const ajv = new Ajv2020({ allErrors: false, strict: false, useDefaults: false });
addFormats(ajv as any);

const inputCache = new WeakMap<object, ValidateFunction>();
const outputCache = new WeakMap<object, ValidateFunction>();

function compile(schema: object, cache: WeakMap<object, ValidateFunction>): ValidateFunction | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  try {
    const validate = ajv.compile(schema as any);
    cache.set(schema, validate);
    return validate;
  } catch {
    return undefined;
  }
}

export interface IValidationFailure {
  field: string;
  reason: string;
}

function firstError(errors: ErrorObject[] | null | undefined): IValidationFailure {
  const e = errors?.[0];
  if (!e) {
    return { field: '', reason: 'schema_violation' };
  }
  const fieldFromParams =
    (e.params as any)?.missingProperty ||
    (e.params as any)?.additionalProperty ||
    (e.params as any)?.propertyName ||
    '';
  const path = e.instancePath || '';
  const field = fieldFromParams ? (path ? `${path}/${fieldFromParams}` : fieldFromParams) : path || 'root';
  return { field, reason: e.message || e.keyword || 'schema_violation' };
}

export function validateToolInput(
  tool: Tool,
  args: unknown,
): { valid: true } | ({ valid: false } & IValidationFailure) {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }
  const validate = compile(schema as object, inputCache);
  if (!validate) {
    return { valid: true };
  }
  const ok = validate(args ?? {});
  if (ok) {
    return { valid: true };
  }
  return { valid: false, ...firstError(validate.errors) };
}

export function validateToolOutput(
  tool: Tool,
  structuredContent: unknown,
): { valid: true } | ({ valid: false } & IValidationFailure) {
  const schema = (tool as any).outputSchema;
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }
  const validate = compile(schema as object, outputCache);
  if (!validate) {
    return { valid: true };
  }
  const ok = validate(structuredContent ?? null);
  if (ok) {
    return { valid: true };
  }
  return { valid: false, ...firstError(validate.errors) };
}
