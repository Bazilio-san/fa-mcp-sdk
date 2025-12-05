import { IPromptData, IGetPromptRequest } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  {
    name: 'custom_prompt',
    description: 'Custom prompt',
    arguments: [],
    content: (request: IGetPromptRequest) => {
      return `Custom prompt content ${request.method}`;
    },
  },
];
