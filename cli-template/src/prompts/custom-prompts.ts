import { IPromptData } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  {
    name: 'custom_prompt',
    description: 'Custom prompt',
    arguments: [],
    content: (request) => {
      return `Custom prompt content ${request.method}`;
    },
  },
];
