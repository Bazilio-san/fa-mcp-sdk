import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Router } from 'express';

export interface IPromptData {
  name: string,
  description: string,
  arguments: [],
  content: IPromptContent,
}

export interface IRequiredHttpHeader {
  name: string, // E.g. "Authorization",
  description: string, // E.g. "JWT Token issued on request"
}

export interface IResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export type TResourceContentFunction = (uri: string) => string | Promise<string>;
export type IResourceContent = string | object | TResourceContentFunction;

export interface IResourceData {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
  content: IResourceContent;
}

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

export interface ISwaggerData {
  swaggerSpecs: any;
  swaggerUi: any;
}

/**
 * All data that needs to be passed to initialize the MCP server
 */
export interface McpServerData {
  // MCP components
  tools: Tool[];
  toolHandler: (params: { name: string; arguments?: any }) => Promise<any>;

  // Prompts
  agentBrief: string;
  agentPrompt: string;
  customPrompts?: IPromptData[];

  // Resources
  requiredHttpHeaders?: IRequiredHttpHeader[] | null;
  customResources?: IResourceData[] | null;

  httpComponents?: {
    apiRouter?: Router | null;
    endpointsOn404?: IEndpointsOn404;
    swagger?: ISwaggerData | null;
  };

  assets?: {
    favicon?: string; // SVG content
    // An HTML snippet that appears in the footer of the About page and gives information about who to contact for support
    maintainerHtml?: string;
  };
  // Function to get Consul UI address (if consul enabled: consul.service.noRegOnStart = false)
  // for example: `https://consul.my.ui/ui/dc-${isProd ? 'prod' : 'dev'}/services/${serviceId}/instances`
  getConsulUIAddress?: (serviceId: string) => string,
}


export interface IGetPromptRequest {
  id?: string | number; // if an RPC identifier is used
  method: 'prompts/get' | 'prompts/content';
  params: IGetPromptParams;
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
}
