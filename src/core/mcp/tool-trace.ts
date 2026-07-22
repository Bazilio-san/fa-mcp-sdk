import { McpError } from '@modelcontextprotocol/sdk/types.js';

import { debugMcpTool } from '../debug.js';

import { emitTrace, makeCorr } from './debug-trace.js';

export interface IToolTraceContext {
  corr: string;
  startedAt: number;
}

function summarizeArgs(args: unknown): Record<string, number | boolean> {
  return {
    present: args !== undefined,
    isObject: Boolean(args && typeof args === 'object' && !Array.isArray(args)),
    fieldCount: args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args).length : 0,
    itemCount: Array.isArray(args) ? args.length : 0,
  };
}

function summarizeFinalResult(response: any): Record<string, number | boolean> {
  return {
    isError: response?.isError === true,
    contentCount: Array.isArray(response?.content) ? response.content.length : 0,
    hasStructuredContent: Object.prototype.hasOwnProperty.call(response ?? {}, 'structuredContent'),
    hasMetadata: Boolean(response?._meta && typeof response._meta === 'object'),
  };
}

export function beginToolTrace(name: string, args: unknown): IToolTraceContext {
  const context = { corr: makeCorr(), startedAt: Date.now() };
  const summary = summarizeArgs(args);
  if (debugMcpTool.enabled) {
    debugMcpTool(`→ tool/call ${name} ${JSON.stringify(summary)}`);
  }
  emitTrace('mcp:tool', { kind: 'req', name, args: summary, corr: context.corr });
  return context;
}

export function completeToolTrace(context: IToolTraceContext, name: string, finalResult: unknown): void {
  const result = summarizeFinalResult(finalResult);
  const isError = result.isError === true;
  const ms = Date.now() - context.startedAt;
  if (debugMcpTool.enabled) {
    debugMcpTool(`← tool/call ${name} ${JSON.stringify(result)}`);
  }
  emitTrace('mcp:tool', {
    kind: 'res',
    name,
    ms,
    corr: context.corr,
    ok: !isError,
    status: isError ? 'error' : 'success',
    result,
  });
}

export function failToolTrace(context: IToolTraceContext, name: string, error: unknown): void {
  const ms = Date.now() - context.startedAt;
  const errorKind = error instanceof McpError ? 'mcp_error' : error instanceof Error ? 'error' : 'non_error';
  if (debugMcpTool.enabled) {
    debugMcpTool(`✗ tool/call ${name} kind=${errorKind}`);
  }
  emitTrace('mcp:tool', {
    kind: 'err',
    name,
    ms,
    corr: context.corr,
    status: 'error',
    error: errorKind,
  });
}
