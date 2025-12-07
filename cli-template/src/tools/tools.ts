import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { IToolInputSchema, IToolProperties } from '../index-to-remove.js';

/**
 * Template tools configuration for MCP Server
 * Define your tools according to your server's functionality
 */


const getGenericInputSchema = (
  queryDescription?: string,
  additionalProperties?: IToolProperties,
): IToolInputSchema => {
  const properties = {
    query: {
      type: 'string',
      description: queryDescription || 'Input query or text',
    },
    ...additionalProperties,
  };

  return {
    type: 'object',
    properties,
    required: ['query'],
  };
};

const getSearchInputSchema = (): IToolInputSchema => {
  return {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (1-100, default: 20)',
        minimum: 1,
        maximum: 100,
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity threshold (0-1)',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['query'],
  };
};

// Template tools - customize according to your needs
export const tools: Tool[] = [
  {
    name: 'example_tool',
    description: 'Example tool that processes text input. Replace with your actual tools.',
    inputSchema: getGenericInputSchema('Text to process'),
  },
  {
    name: 'example_search',
    description: 'Example search tool with pagination and filtering. Template for search-based tools.',
    inputSchema: getSearchInputSchema(),
  },
  // TODO: Add your actual tools here
  // {
  //   name: 'your_tool_name',
  //   description: 'Description of what your tool does',
  //   inputSchema: getGenericInputSchema('Your query description', {
  //     // additional parameters
  //     param1: {
  //       type: 'string',
  //       description: 'Description of param1',
  //     },
  //   }),
  // },
];

// Helper to get tool by name
export const getToolByName = (name: string): Tool | undefined => {
  return tools.find(tool => tool.name === name);
};

// Helper to get all tool names
export const getToolNames = (): string[] => {
  return tools.map(tool => tool.name);
};
