import Ajv2020, { ValidateFunction, ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// allErrors:true — collect every violation in one pass instead of only the first.
// verbose:true   — attach the offending value to each error so `type` failures can report the
//                  actual JS type (only the type name is surfaced, never the value itself — §13.3).
const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false, useDefaults: false });
addFormats(ajv as any);

// Upper bound on the number of failures echoed back to the client. A badly-shaped payload can
// produce hundreds of errors; we report at most this many and flag the overflow.
const MAX_FAILURES = 8;

const inputCache = new WeakMap<object, ValidateFunction>();
const outputCache = new WeakMap<object, ValidateFunction>();

function compile(schema: object, cache: WeakMap<object, ValidateFunction>, label: string): ValidateFunction {
  const cached = cache.get(schema);
  if (cached) {
    return cached;
  }
  try {
    const validate = ajv.compile(schema as any);
    cache.set(schema, validate);
    return validate;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown schema compilation error';
    throw new Error(`${label} is not a valid JSON Schema: ${detail}`);
  }
}

/** Compile every published schema eagerly so an invalid contract fails before a tool can run. */
export function assertToolSchemas(tools: Tool[]): void {
  for (const tool of tools) {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
      throw new Error(`Tool "${tool.name}" inputSchema must be a JSON Schema object.`);
    }
    compile(tool.inputSchema as object, inputCache, `Tool "${tool.name}" inputSchema`);

    const { outputSchema } = tool as any;
    if (outputSchema !== undefined) {
      if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
        throw new Error(`Tool "${tool.name}" outputSchema must be a JSON Schema object.`);
      }
      compile(outputSchema as object, outputCache, `Tool "${tool.name}" outputSchema`);
    }
  }
}

export interface IValidationFailure {
  /** JSON Pointer to the offending location, e.g. `/items/0/price`, or the property name. */
  field: string;
  /** Stable Ajv keyword: `required` | `type` | `enum` | `pattern` | … — safe for machine routing. */
  reason: string;
  /** Human-readable explanation (English). Never echoes the offending value, only its type. */
  message: string;
}

export interface IValidationOk {
  valid: true;
}

export interface IValidationErr extends IValidationFailure {
  valid: false;
  /** Up to {@link MAX_FAILURES} individual failures. */
  errors: IValidationFailure[];
  /** Total number of violations Ajv reported, before truncation to {@link MAX_FAILURES}. */
  errorCount: number;
  /** Combined one-line summary of the reported failures, suitable for an error message. */
  summary: string;
}

function jsType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/** Field path: instance path plus the specific offending property for keyword-level errors. */
function fieldOf(e: ErrorObject): string {
  const p = (e.params as any) ?? {};
  // `additionalProperty` / `propertyName` come from caller-controlled object keys and may contain
  // credentials or PII. Required-property names come from the server-owned schema and are safe to name.
  const sub = e.keyword === 'required' ? p.missingProperty || '' : '';
  const path = e.instancePath || '';
  if (sub) {
    return path ? `${path}/${sub}` : sub;
  }
  return path || 'root';
}

/** Map a raw Ajv error to a concise English reason that names the constraint and the actual type. */
function reasonOf(e: ErrorObject): string {
  const p = (e.params as any) ?? {};
  switch (e.keyword) {
    case 'required':
      return `missing required property "${p.missingProperty}"`;
    case 'additionalProperties':
      return 'unexpected property';
    case 'type':
      return `expected ${p.type}, got ${jsType(e.data)}`;
    case 'enum':
      return 'must be one of the declared values';
    case 'const':
      return 'must equal the declared constant';
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return `must be ${p.comparison} ${p.limit}`;
    case 'multipleOf':
      return `must be a multiple of ${p.multipleOf}`;
    case 'minLength':
      return `string length must be >= ${p.limit}`;
    case 'maxLength':
      return `string length must be <= ${p.limit}`;
    case 'minItems':
      return `array length must be >= ${p.limit}`;
    case 'maxItems':
      return `array length must be <= ${p.limit}`;
    case 'minProperties':
      return `object must have >= ${p.limit} properties`;
    case 'maxProperties':
      return `object must have <= ${p.limit} properties`;
    case 'pattern':
      return 'must match the declared pattern';
    case 'format':
      return `invalid format, expected ${p.format}`;
    case 'uniqueItems':
      return 'array items must be unique';
    default:
      return e.message || e.keyword || 'schema violation';
  }
}

function toFailure(e: ErrorObject): IValidationFailure {
  const field = fieldOf(e);
  return { field, reason: e.keyword || 'schema_violation', message: `${field}: ${reasonOf(e)}` };
}

function fail(errors: ErrorObject[] | null | undefined): IValidationErr {
  const all = errors ?? [];
  const list = all.slice(0, MAX_FAILURES).map(toFailure);
  const first = list[0] ?? { field: 'root', reason: 'schema_violation', message: 'schema violation' };
  const overflow = all.length - list.length;
  const summary = list.map((f) => f.message).join('; ') + (overflow > 0 ? ` (+${overflow} more)` : '');
  return {
    valid: false,
    field: first.field,
    reason: first.reason,
    message: first.message,
    errors: list,
    errorCount: all.length,
    summary,
  };
}

export function validateToolInput(tool: Tool, args: unknown): IValidationOk | IValidationErr {
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }
  const validate = compile(schema as object, inputCache, `Tool "${tool.name}" inputSchema`);
  return validate(args ?? {}) ? { valid: true } : fail(validate.errors);
}

export function validateToolOutput(tool: Tool, structuredContent: unknown): IValidationOk | IValidationErr {
  const schema = (tool as any).outputSchema;
  if (!schema || typeof schema !== 'object') {
    return { valid: true };
  }
  const validate = compile(schema as object, outputCache, `Tool "${tool.name}" outputSchema`);
  return validate(structuredContent ?? null) ? { valid: true } : fail(validate.errors);
}
