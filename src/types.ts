import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Router } from 'express';

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
  customPrompts?: any[];

  customResources?: any[];

  httpComponents?: {
    apiRouter?: Router;
    customEndpoints?: Record<string, string[]>;
    swagger?: {
      swaggerSpecs: any;
      swaggerUi: any;
    };
  };

  assets?: {
    favicon?: string; // SVG content
  };

  customConfig?: Record<string, any>;
}
