/**
 * MCP Prompts for fin-office SQL Agent
 * Two-level agent description system for LLM agent selection
 */
import { IGetPromptRequest, ITransportContext, IPromptContent, IPromptData } from '../_types_/types.js';
import { getProjectData } from '../bootstrap/init-config.js';
import { debugMcpPrompt } from '../debug.js';
import { emitTrace } from './debug-trace.js';

async function getPrompts(args: ITransportContext): Promise<IPromptData[]> {
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

export async function getPromptsList(args: ITransportContext) {
  const startedAt = Date.now();
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt('→ prompts/list');
  }
  emitTrace('mcp:prompt', { kind: 'list-req' });
  const prompts = await getPrompts(args);
  const result = { prompts: prompts.map(({ content, ...rest }) => ({ ...rest })) };
  const ms = Date.now() - startedAt;
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt(`← prompts/list (${result.prompts.length})\n${JSON.stringify(result, null, 2)}`);
  }
  emitTrace('mcp:prompt', { kind: 'list-res', count: result.prompts.length, ms });
  return result;
}

export const getPrompt = async (request: IGetPromptRequest, args: ITransportContext): Promise<any> => {
  const { name } = request.params;
  const startedAt = Date.now();
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt(`→ prompts/get ${name}\n${JSON.stringify(request.params ?? {}, null, 2)}`);
  }
  emitTrace('mcp:prompt', { kind: 'get-req', name });
  const prompts = await getPrompts(args);

  // Check if prompts are available
  if (!prompts || prompts.length === 0) {
    emitTrace('mcp:prompt', { kind: 'get-err', name, ms: Date.now() - startedAt, error: 'no-prompts' });
    throw new Error('No prompts available. Project data may not be properly initialized.');
  }

  let content: IPromptContent | null = prompts.filter((p) => p.name === name).map((p) => p.content)[0] || null;
  if (typeof content === 'function') {
    content = await content(request, request.params?.arguments);
  }
  if (!content) {
    emitTrace('mcp:prompt', { kind: 'get-err', name, ms: Date.now() - startedAt, error: 'unknown-prompt' });
    throw new Error(`Unknown prompt: ${name}`);
  }

  const result = {
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
  const ms = Date.now() - startedAt;
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt(`← prompts/get ${name}\n${content}`);
  }
  emitTrace('mcp:prompt', { kind: 'get-res', name, ms });
  return result;
};
