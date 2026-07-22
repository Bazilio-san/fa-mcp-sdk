/**
 * MCP Prompts for fin-office SQL Agent
 * Two-level agent description system for LLM agent selection
 */
import { IGetPromptRequest, ITransportContext, IPromptContent, IPromptData } from '../_types_/types.js';
import { getProjectData } from '../bootstrap/init-config.js';
import { debugMcpPrompt } from '../debug.js';
import { readDeprecation, warnDeprecatedUsage } from './deprecation.js';
import { emitTrace, safeTraceDescriptorName, traceDigest } from './debug-trace.js';
import { assertRequiredScopes, assertResolvedRequiredScopes } from './required-scopes.js';

async function getPrompts(args: ITransportContext): Promise<IPromptData[]> {
  const projectData = getProjectData();
  if (!projectData) {
    console.error('Error: Project data not initialized. Make sure initMcpServer() has been called.');
    return [];
  }

  const { agentBrief, agentPrompt, toolPrompt, customPrompts, defaultReadScopes } = projectData;

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
  assertResolvedRequiredScopes(resolvedCustomPrompts, 'prompt');

  const prompts: IPromptData[] = [
    {
      name: 'agent_brief',
      title: 'Agent brief',
      description: 'Brief description of the agent to be selected in the agent system',
      arguments: [],
      content: agentBrief,
      requireAuth: true,
    },
    {
      name: 'agent_prompt',
      title: 'Agent prompt',
      description:
        'Full project-supplied operating instructions for this agent. Read before planning or using its tools, ' +
        'especially when current workflow and response policies matter. HTTP access requires authentication and ' +
        'configured read scopes. Resolved from active project data on each request and returned as a text/Markdown ' +
        'prompt message.',
      arguments: [],
      content: agentPrompt,
      requireAuth: true,
    },
    ...(toolPrompt
      ? [
          {
            name: 'tool_prompt',
            title: 'Tool prompt',
            description: 'Tool-specific prompt. Requires the "tool" argument (the MCP tool name).',
            arguments: [
              {
                name: 'tool',
                description: 'Name of the MCP tool to get the prompt for.',
                required: true,
              },
            ],
            content: toolPrompt,
            requireAuth: true,
          } satisfies IPromptData,
        ]
      : []),
    ...resolvedCustomPrompts,
  ];
  if (!Array.isArray(defaultReadScopes) || defaultReadScopes.length === 0) {
    return prompts;
  }
  return prompts.map((prompt) =>
    Array.isArray(prompt.requiredScopes) ? prompt : { ...prompt, requiredScopes: [...defaultReadScopes] },
  );
}

export async function getPromptsList(args: ITransportContext) {
  const startedAt = Date.now();
  let count: number | undefined;
  let succeeded = false;
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt('→ prompts/list');
  }
  emitTrace('mcp:prompt', { kind: 'list-req' });
  try {
    const prompts = await getPrompts(args);
    const result = { prompts: prompts.map(({ content, ...rest }) => ({ ...rest })) };
    count = result.prompts.length;
    succeeded = true;
    return result;
  } finally {
    const ms = Date.now() - startedAt;
    if (debugMcpPrompt.enabled) {
      debugMcpPrompt(succeeded ? `← prompts/list count=${count ?? 0}` : `✗ prompts/list failed durationMs=${ms}`);
    }
    emitTrace('mcp:prompt', {
      kind: succeeded ? 'list-res' : 'list-err',
      name: '*',
      status: succeeded ? 'success' : 'error',
      ...(count === undefined ? {} : { count }),
      ms,
    });
  }
}

export const getPrompt = async (request: IGetPromptRequest, args: ITransportContext): Promise<any> => {
  const { name } = request.params;
  const nameHash = traceDigest(name);
  const startedAt = Date.now();
  let completionName = 'unknown';
  let completionNameHash = 'unknown';
  let succeeded = false;
  if (debugMcpPrompt.enabled) {
    debugMcpPrompt(`→ prompts/get nameHash=${nameHash}`);
  }
  emitTrace('mcp:prompt', { kind: 'get-req', nameHash });
  try {
    const prompts = await getPrompts(args);

    // Check if prompts are available
    if (!prompts || prompts.length === 0) {
      throw new Error('No prompts available. Project data may not be properly initialized.');
    }

    const prompt = prompts.find((candidate) => candidate.name === name);
    if (!prompt) {
      throw new Error('Unknown prompt');
    }
    assertRequiredScopes(prompt.requiredScopes, args, 'prompt');
    warnDeprecatedUsage('prompt', prompt.name, readDeprecation(prompt));
    // Dynamic providers control descriptor names. Log only strict machine identifiers; keep
    // human/PII-like names opaque while retaining a digest for correlation.
    completionNameHash = traceDigest(prompt.name);
    completionName = safeTraceDescriptorName(prompt.name) ?? 'opaque_descriptor';
    let { content }: { content: IPromptContent | null } = prompt;
    if (typeof content === 'function') {
      content = await content(request, request.params?.arguments);
    }
    if (!content) {
      throw new Error('Unknown prompt');
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
    succeeded = true;
    return result;
  } finally {
    const ms = Date.now() - startedAt;
    if (debugMcpPrompt.enabled) {
      debugMcpPrompt(
        succeeded
          ? `← prompts/get name=${completionName} descriptorHash=${completionNameHash} nameHash=${nameHash}`
          : `✗ prompts/get name=${completionName} descriptorHash=${completionNameHash} ` +
              `nameHash=${nameHash} durationMs=${ms}`,
      );
    }
    emitTrace('mcp:prompt', {
      kind: succeeded ? 'get-res' : 'get-err',
      name: completionName,
      descriptorHash: completionNameHash,
      nameHash,
      status: succeeded ? 'success' : 'error',
      ms,
    });
  }
};
