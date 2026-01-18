/**
 * MCP Prompts for fin-office SQL Agent
 * Two-level agent description system for LLM agent selection
 */
import { IGetPromptRequest, ITransportContext, IPromptContent, IPromptData } from '../_types_/types.js';
import { getProjectData } from '../bootstrap/init-config.js';

async function getPrompts (args: ITransportContext): Promise<IPromptData[]> {
  const projectData = getProjectData();
  if (!projectData) {
    console.error('Error: Project data not initialized. Make sure initMcpServer() has been called.');
    return [];
  }

  const { agentBrief, agentPrompt, customPrompts } = projectData;

  // Validate that required prompts are available
  if (!agentBrief || !agentPrompt) {
    console.error('Error: Required prompts (agentBrief, agentPrompt) are missing from project data');
    return [];
  }

  // Resolve customPrompts - can be array or async function
  let resolvedCustomPrompts: IPromptData[] = [];
  if (customPrompts) {
    if (typeof customPrompts === 'function') {
      resolvedCustomPrompts = await customPrompts(args);
    } else {
      resolvedCustomPrompts = customPrompts;
    }
  }

  return [
    {
      name: 'agent_brief',
      description: 'Brief description of the agent to be selected in the agent system',
      arguments: [],
      content: agentBrief,
      requireAuth: false,
    },
    {
      name: 'agent_prompt',
      description: 'Detailed prompt of the agent',
      arguments: [],
      content: agentPrompt,
      requireAuth: false,
    },
    ...resolvedCustomPrompts,
  ];
}

export async function getPromptsList (args: ITransportContext) {
  const prompts = await getPrompts(args);
  return {
    prompts: prompts.map(({ content, ...rest }) => ({ ...rest })),
  };
}

export const getPrompt = async (request: IGetPromptRequest, args: ITransportContext): Promise<any> => {
  const { name } = request.params;
  const prompts = await getPrompts(args);

  // Check if prompts are available
  if (!prompts || prompts.length === 0) {
    throw new Error('No prompts available. Project data may not be properly initialized.');
  }

  let content: IPromptContent | null = prompts.filter((p) => p.name === name).map((p) => p.content)[0] || null;
  if (typeof content === 'function') {
    content = await content(request);
  }
  if (!content) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  return {
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };
};
