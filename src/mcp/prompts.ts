/**
 * MCP Prompts for fin-office SQL Agent
 * Two-level agent description system for LLM agent selection
 */
import { McpServerData } from '../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}

function createPrompts() {
  const { agentBrief, agentPrompt, customPrompts = [] } = getProjectData();
  return [
    {
      name: 'agent_brief',
      description: 'Brief description of the agent to be selected in the agent system',
      arguments: [],
      content: agentBrief,
    },
    {
      name: 'agent_prompt',
      description: 'Detailed prompt of the agent',
      arguments: [],
      content: agentPrompt,
    },
    ...customPrompts,
  ];
}

export const prompts = createPrompts();


export function getPromptsList () {
  return {
    prompts: prompts.map(({ content, ...rest }) => ({ ...rest })),
  };
}

export function getPrompt (name: string) {
  const content = prompts.filter((p) => p.name === name).map((p) => p.content)[0] || null;

  if (!content) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  return {
    messages: [
      {
        role: 'system',
        content: {
          type: 'text',
          text: content,
        },
      },
    ],
  };

}
