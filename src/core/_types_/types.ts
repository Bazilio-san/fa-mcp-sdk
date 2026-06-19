import { ClientCapabilities, Tool } from '@modelcontextprotocol/sdk/types.js';
import { ILoggerSettings } from 'af-logger-ts';
import { Router } from 'express';

import { AuthResult } from '../auth/types.js';

/**
 * Client capabilities surfaced from the MCP initialize handshake, extended with
 * the open-ended `extensions` map that the MCP Apps spec (SEP-1865) and other
 * future extensions advertise alongside the standard fields.
 *
 * Hosts that support MCP Apps publish their extension settings as:
 *   capabilities.extensions["io.modelcontextprotocol/ui"]: { mimeTypes: [...] }
 *
 * Use {@link getUiCapability} from the SDK to read the UI extension specifically.
 */
export type IClientCapabilities = ClientCapabilities & { extensions?: Record<string, unknown> };

/**
 * Input data for Token Generator authorization handler
 * Contains user information based on the admin auth type
 */
export interface TokenGenAuthInput {
  /** Username (from JWT payload, basic auth, or NTLM) */
  user: string;
  /** Domain name (only for NTLM authentication) */
  domain?: string;
  /** Full JWT payload (only for jwtToken authentication) */
  payload?: Record<string, any>;
  /** The authentication type used */
  authType: 'jwtToken' | 'basic' | 'ntlm' | 'permanentServerTokens';
}

/**
 * Custom authorization handler for Token Generator admin page
 * Called after standard authentication to perform additional authorization checks
 *
 * @param input - User information from the authentication layer
 * @returns AuthResult indicating whether user is authorized to access Token Generator
 *
 * @example
 * // Only allow users from specific AD groups
 * const tokenGenAuthHandler: TokenGenAuthHandler = async (input) => {
 *   if (input.authType === 'ntlm') {
 *     const isAdmin = await isUserInGroup(input.user, 'TokenGeneratorAdmins');
 *     if (!isAdmin) {
 *       return { success: false, error: 'User is not in TokenGeneratorAdmins group' };
 *     }
 *   }
 *   return { success: true, username: input.user };
 * };
 */
export type TokenGenAuthHandler = (input: TokenGenAuthInput) => Promise<AuthResult> | AuthResult;

/**
 * Standard §10.5 / §11.3 (MAY) — a single icon descriptor for display in the client UI, per
 * MCP 2025-11-25. Used by prompts ({@link IPromptData.icons}) and resources
 * ({@link IResourceInfo.icons}). All fields except `src` are optional.
 */
export interface IIcon {
  /** Icon source: an absolute URL, or a `data:` URI with the inlined bytes. */
  src: string;
  /** Optional MIME type of the icon (e.g. `image/png`, `image/svg+xml`). */
  mimeType?: string;
  /** Optional size hints as HTML `sizes` strings (e.g. `['48x48', '96x96']`, `['any']`). */
  sizes?: string[];
}

/**
 * Standard §10.5 — descriptor for a single prompt argument. The host advertises these
 * to the LLM in `prompts/list`, then passes the resolved values as `request.params.arguments`
 * (string-keyed map) on `prompts/get`.
 */
export interface IPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface IPromptData {
  name: string;
  /** Standard §10.5 (MAY) — human-readable name shown in the client UI; falls back to `name`. */
  title?: string;
  description: string;
  /** Per standard §10.5 — list of supported arguments; empty array if the prompt is static. */
  arguments: IPromptArgument[];
  /** Standard §10.5 (MAY) — icons for display in the client UI. See {@link IIcon}. */
  icons?: IIcon[];
  content: IPromptContent;
  requireAuth?: boolean;
  /**
   * Standard §7.5 — OAuth-style scopes required to read this prompt.
   * Checked against `payload.scope` (space-separated). Missing scopes → 403 (forbidden).
   */
  requiredScopes?: string[];
  /** Standard §17.2 — deprecation lifecycle. See {@link IDeprecationInfo}. */
  deprecated?: IDeprecationInfo;
}

export interface IUsedHttpHeader {
  name: string; // E.g. "Authorization",
  description: string; // E.g. "JWT Token issued on request"
  isOptional?: boolean;
}

/**
 * Optional MCP Apps UI metadata that a `ui://...` resource can declare so the
 * host knows how to sandbox the iframe (SEP-1865 / ext-apps spec).
 *
 * Only meaningful for resources with `mimeType: 'text/html;profile=mcp-app'`.
 * For single-file widgets with all assets inlined, every field stays
 * `undefined` and the host applies a deny-by-default CSP.
 */
export interface IUiResourceMeta {
  /**
   * Per-directive CSP overrides for the sandboxed iframe. Each value is the
   * list of allowed sources for that directive (e.g.
   * `{ 'script-src': ["'self'", 'https://cdn.example.com'] }`). Hosts merge
   * these with their own defaults — only declare sources the widget actually
   * needs.
   */
  csp?: Record<string, string[]>;
  /**
   * Sandbox permissions the widget requests (e.g. `['microphone', 'camera',
   * 'clipboard-read']`). The host decides whether to grant them; users may be
   * prompted. Leave empty when the widget needs nothing beyond DOM access.
   */
  permissions?: string[];
  /**
   * Hint for the host on the initial iframe size, as a `[width, height]`
   * tuple. Each entry may be a CSS dimension (`'100%'`, `'600px'`) or a number
   * of pixels. Hosts may ignore this on small viewports.
   */
  preferredFrameSize?: [string | number, string | number];
  [key: string]: unknown;
}

export interface IResourceInfo {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
  /** Standard §11.3 (MAY) — content size in bytes, surfaced on `resources/list`. */
  size?: number;
  /** Standard §11.3 (MAY) — icons for display in the client UI. See {@link IIcon}. */
  icons?: IIcon[];
  requireAuth?: boolean;
  /**
   * Standard §7.5 — OAuth-style scopes required to read this resource.
   * Checked against `payload.scope` (space-separated). Missing scopes → 403 (forbidden).
   */
  requiredScopes?: string[];
  /**
   * Optional `_meta` block surfaced on `resources/list` and `resources/read`.
   * For MCP Apps resources (`ui://...`) populate `_meta.ui` with
   * {@link IUiResourceMeta}. Other extensions may add their own keys here.
   */
  _meta?: { ui?: IUiResourceMeta; [key: string]: unknown };
  /** Standard §17.2 — deprecation lifecycle. See {@link IDeprecationInfo}. */
  deprecated?: IDeprecationInfo;
}

export interface IResourceData extends IResourceInfo {
  content: IResourceContent;
}

/**
 * Standard §11.5 — descriptor returned by `resources/templates/list`.
 * `uriTemplate` follows RFC 6570 (e.g. `repo://{owner}/{name}`).
 */
export interface IResourceTemplateInfo {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

/**
 * Standard §11.4 / §12.2 — binary resource payload. Use this instead of a plain string when the
 * resource is an image, PDF, archive or any other non-text artefact. The SDK base64-encodes it
 * into `contents[0].blob` (with the resource's `mimeType`) so clients can decode the original
 * bytes; the `text` field is omitted for binary resources.
 */
export interface IResourceBinaryContent {
  /** Raw bytes as a Buffer, or an already-base64-encoded string (set {@link base64} to `true`). */
  blob: Buffer | string;
  /**
   * `true`  — `blob` is already a base64 string, emitted as-is.
   * `false` — `blob` is a string of raw bytes; the SDK base64-encodes it.
   * Omitted — a Buffer is base64-encoded; a string is assumed to be base64 already.
   */
  base64?: boolean;
}

export type TResourceContentFunction = (uri: string) => string | Promise<string>;
export type TResourceBinaryContentFunction = (uri: string) => IResourceBinaryContent | Promise<IResourceBinaryContent>;
export type IResourceContent =
  | string
  | object
  | TResourceContentFunction
  | IResourceBinaryContent
  | TResourceBinaryContentFunction;

export interface IResource {
  contents: [
    {
      uri: string;
      mimeType: string;
      /** Present for text resources. Exactly one of `text` / `blob` is set per standard §11.4. */
      text?: string | object;
      /** Present for binary resources — base64-encoded bytes (standard §12.2). */
      blob?: string;
      /** Mirrors `_meta` from the resource definition; see {@link IResourceInfo._meta}. */
      _meta?: { ui?: IUiResourceMeta; [key: string]: unknown };
    },
  ];
}

export type IEndpointsOn404 = Record<string, string | string[]>;

/**
 * Custom Authentication validation function
 * @param req - Express request object containing all authentication information
 * @returns Promise<AuthResult> or AuthResult with detailed authentication result
 */
export type CustomAuthValidator = (req: any) => Promise<AuthResult> | AuthResult;

export type TTransportType = 'stdio' | 'sse' | 'http';

/**
 * Standard §17.2 — structured deprecation block surfaced on tools / prompts / resources.
 * Authors set this instead of hand-rolling a `[DEPRECATED] …` description prefix.
 */
export interface IDeprecationInfo {
  /** ISO date (YYYY-MM-DD) when the deprecated entry will be removed. */
  until: string;
  /** Replacement name or URI. */
  replacedBy?: string;
  /** Free-form migration hint shown alongside runtime warnings. */
  note?: string;
}

export interface IToolHandlerParams {
  name: string;
  arguments?: any;
  transport: TTransportType;
  headers?: Record<string, string>;
  payload?: { user: string; [key: string]: any } | undefined;
  /**
   * Client capabilities reported during the MCP initialize handshake.
   * Populated for STDIO/SSE on every call; for Streamable HTTP only when the
   * client sends an `Mcp-Session-Id` header (cached from the initialize call).
   * `undefined` means "unknown" — the handler MUST treat absence as "no extra
   * capabilities" and fall back to the plain text `content[]` contract.
   */
  clientCapabilities?: IClientCapabilities;
  /**
   * Standard §8.5 — abort signal flipped when the client sends
   * `notifications/cancelled` for this request. Tool handlers SHOULD pass it to
   * downstream AbortSignal-aware APIs (`fetch`, `pg`, etc.). When the signal
   * aborts, the handler MUST stop work and let the rejection propagate — the
   * SDK then skips the JSON-RPC response per §8.5.
   */
  signal?: AbortSignal;
  /**
   * Standard §8.6 — emit a `notifications/progress` for this request. Active only
   * when the original request carried `_meta.progressToken`. Progress MUST be
   * monotonically non-decreasing; the SDK throttles emissions to
   * `mcp.progress.throttleMs` (default 100 ms / 10 events/s).
   * No-op when `progressToken` is absent — call it unconditionally.
   */
  sendProgress?: (progress: number, total?: number, message?: string) => void;
}

export interface ITransportContext {
  transport: TTransportType;
  headers?: Record<string, string>;
  payload?: { user: string; [key: string]: any } | undefined;
  /** See {@link IToolHandlerParams.clientCapabilities}. */
  clientCapabilities?: IClientCapabilities;
}

export interface IGetPromptRequest {
  id?: string | number; // if an RPC identifier is used
  method: 'prompts/get' | 'prompts/content';
  params: IGetPromptParams;
}

/**
 * All data that needs to be passed to initialize the MCP server
 */
export interface McpServerData {
  // MCP components
  tools: Tool[] | ((args: ITransportContext) => Promise<Tool[]>);
  toolHandler: <T = unknown>(params: IToolHandlerParams) => Promise<TToolHandlerResponse<T>>;

  // Prompts
  agentBrief: string;
  agentPrompt: string;
  /**
   * Optional tool-specific prompt served by the `tool_prompt` prompt. Receives the required
   * `tool` argument (the MCP tool name) in `args.tool` and returns instructions scoped to that
   * tool. The whole logic lives in the child project. When omitted, a built-in stub returns an
   * empty string.
   */
  toolPrompt?: TPromptContentFunction;
  customPrompts?: IPromptData[] | ((args: ITransportContext) => Promise<IPromptData[]>);

  // Resources
  usedHttpHeaders?: IUsedHttpHeader[] | null;
  customResources?: IResourceData[] | ((args: ITransportContext) => Promise<IResourceData[]>) | null;
  /**
   * Standard §11.5 (MAY) — descriptors served by `resources/templates/list`.
   * Each entry is an MCP `ResourceTemplate` (`uriTemplate`, `name`, optional `description`, `mimeType`).
   * Only consumed when `appConfig.mcp.resources.templatesEnabled` is true.
   */
  customResourceTemplates?:
    | IResourceTemplateInfo[]
    | ((args: ITransportContext) => Promise<IResourceTemplateInfo[]>)
    | null;

  /**
   * Standard §8.2 (MAY) — autocompletion provider for `completion/complete`. Opt-in: served only
   * when `appConfig.mcp.completions.enabled` is true AND this provider is set. Receives the ref
   * being completed (a prompt or resource) and the partial argument value; returns candidate
   * values (the SDK caps the response at 100 and sets `hasMore`). Example: suggest valid project
   * ids for a prompt argument named `project`.
   */
  completionProvider?: (params: {
    ref: { type: 'ref/prompt' | 'ref/resource'; name?: string; uri?: string };
    argument: { name: string; value: string };
    context?: Record<string, unknown>;
  }) => Promise<string[]> | string[];

  // Optional custom authentication feature
  customAuthValidator?: CustomAuthValidator;

  // Optional custom authorization handler for Token Generator admin page
  // Called after standard admin auth to perform additional authorization checks
  tokenGenAuthHandler?: TokenGenAuthHandler;

  httpComponents?: {
    apiRouter?: Router | null;
  };

  assets?: {
    logoSvg?: string; // SVG content for logo/favicon
  };
  // Function to get Consul UI address (if consul enabled: consul.service.enable = true)
  // for example: `https://consul.my.ui/ui/dc-${isProd ? 'prod' : 'dev'}/services/${serviceId}/instances`
  getConsulUIAddress?: (serviceId: string) => string;

  // Custom startup diagnostic information displayed at server start
  // Array of [key, value] pairs to be shown in the startup info block
  // Example: [['Admin Auth', 'JWT'], ['Custom param', 'any value']]
  customStartupInfo?: [string, string][];

  // Optional logger settings overrides applied on top of built-in defaults.
  // Only specified fields override defaults — merge is shallow (Object.assign semantics).
  // Example: { level: 'silly', maskValuesRegEx: [] }
  loggerSettings?: Partial<ILoggerSettings>;
}

export type TPromptContentFunction = (
  request: IGetPromptRequest,
  args?: Record<string, string>,
) => string | Promise<string>;
export type IPromptContent = string | TPromptContentFunction;

export interface IGetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

export interface IReadResourceRequest {
  method: 'resources/read';
  params: {
    uri: string;
  };
  id?: string | number; // if you are using RPC with a correlation
}

export interface IToolProperties {
  [x: string]: {
    type: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    [x: string]: any;
  };
}

export interface IToolInputSchema {
  $schema?: string;
  type: 'object';
  properties?: IToolProperties | undefined;
  required?: string[] | undefined;
  additionalProperties?: boolean | Record<string, unknown>;

  [x: string]: unknown;
}

export interface IToolHandlerTextResponse {
  content: {
    type: 'text';
    text: string;
  }[];
  /**
   * MCP `tools/call` result flag. Set to `true` to mark the call as a tool-level
   * error so the LLM sees the failure inside the conversation and can react,
   * instead of throwing a JSON-RPC protocol error which most clients surface as
   * a hard sandbox-level failure.
   *
   * Per MCP spec: errors that originate from the tool SHOULD be reported in the
   * result with `isError: true`. Only "tool not found", "method not supported",
   * and similar protocol issues should throw.
   */
  isError?: boolean;
}

export interface IToolHandlerStructuredResponse<T = any> {
  structuredContent: T;
  /** See {@link IToolHandlerTextResponse.isError}. */
  isError?: boolean;
}

export type TToolHandlerResponse<T = any> = IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>;
