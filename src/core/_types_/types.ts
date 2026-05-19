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

export interface IPromptData {
  name: string;
  description: string;
  arguments: [];
  content: IPromptContent;
  requireAuth?: boolean;
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
  requireAuth?: boolean;
  /**
   * Optional `_meta` block surfaced on `resources/list` and `resources/read`.
   * For MCP Apps resources (`ui://...`) populate `_meta.ui` with
   * {@link IUiResourceMeta}. Other extensions may add their own keys here.
   */
  _meta?: { ui?: IUiResourceMeta; [key: string]: unknown };
}

export interface IResourceData extends IResourceInfo {
  content: IResourceContent;
}

export type TResourceContentFunction = (uri: string) => string | Promise<string>;
export type IResourceContent = string | object | TResourceContentFunction;

export interface IResource {
  contents: [
    {
      uri: string;
      mimeType: string;
      text: string | object;
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
  customPrompts?: IPromptData[] | ((args: ITransportContext) => Promise<IPromptData[]>);

  // Resources
  usedHttpHeaders?: IUsedHttpHeader[] | null;
  customResources?: IResourceData[] | ((args: ITransportContext) => Promise<IResourceData[]>) | null;

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

export type TPromptContentFunction = (request: IGetPromptRequest) => string | Promise<string>;
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
  type: 'object';
  properties?: IToolProperties | undefined;
  required?: string[] | undefined;

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
