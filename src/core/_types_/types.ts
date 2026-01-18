import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Router } from 'express';
import { AuthResult } from '../auth/types.js';

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
  name: string,
  description: string,
  arguments: [],
  content: IPromptContent,
  requireAuth?: boolean,
}

export interface IUsedHttpHeader {
  name: string, // E.g. "Authorization",
  description: string, // E.g. "JWT Token issued on request"
  isOptional?: boolean,
}

export interface IResourceInfo {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
  requireAuth?: boolean;
}

export interface IResourceData extends IResourceInfo {
  content: IResourceContent;
}

export type TResourceContentFunction = (uri: string) => string | Promise<string>;
export type IResourceContent = string | object | TResourceContentFunction;

export interface IResource {
  contents: [
    {
      uri: string,
      mimeType: string,
      text: string | object,
    },
  ],
}

export type IEndpointsOn404 = Record<string, string | string[]>

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
}

export interface ITransportContext {
  transport: TTransportType;
  headers?: Record<string, string>;
  payload?: { user: string; [key: string]: any } | undefined
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
  toolHandler: (params: IToolHandlerParams) => Promise<any>;

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
    // An HTML snippet that appears in the footer of the HOME page and gives information about who to contact for support
    maintainerHtml?: string;
  };
  // Function to get Consul UI address (if consul enabled: consul.service.enable = true)
  // for example: `https://consul.my.ui/ui/dc-${isProd ? 'prod' : 'dev'}/services/${serviceId}/instances`
  getConsulUIAddress?: (serviceId: string) => string,
}


export type TPromptContentFunction = (request: IGetPromptRequest) => string | Promise<string>
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

