import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  asTextContent,
  hostSupportsMcpApps,
  IToolHandlerParams,
  MCP_APPS_RESOURCE_MIME_TYPE,
  TToolHandlerResponse,
} from '../../core/index.js';

import { ITemplateTool } from './tool.js';
import { renderWidgetDocument } from './widget-document.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * `show_widget` — demonstrates the MCP Apps flow end-to-end. Call it when the user asks to see a
 * widget: with the host's "Apps" mode on it returns an interactive UI widget; with it off it returns a
 * short hint to enable Apps mode, which the model must relay verbatim (see the `show_widget` tool
 * prompt). Takes no input.
 */
const definition: Tool = {
  name: 'show_widget',
  title: 'Show demo widget',
  description: `Show a demonstration UI widget. 
Call this whenever the user asks to show or demonstrate a widget (e.g. "show widget", "widget demo").
When the host supports MCP Apps (Agent Tester with the "Apps" toggle on) it renders an interactive widget; 
otherwise it returns a short instruction to enable Apps mode, which you MUST relay to the user verbatim.`,
  inputSchema: {
    $schema: JSON_SCHEMA_2020_12,
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

function handler(params: IToolHandlerParams): TToolHandlerResponse {
  if (!hostSupportsMcpApps(params.clientCapabilities)) {
    return asTextContent('To demonstrate the widget, enable Apps mode');
  }
  const now = new Date().toLocaleString();
  const html = renderWidgetDocument(
    'Demo widget',
    [
      { k: 'Status', v: 'MCP App is working' },
      { k: 'Theme', v: 'adapts to the host (light/dark)' },
      { k: 'Size', v: 'fits the content' },
      { k: 'Time', v: now },
    ],
    'This is an MCP Apps demo in Agent Tester. The widget came from the show_widget tool.',
  );
  return {
    content: [
      { type: 'text', text: 'Widget shown (MCP Apps demo).' },
      {
        type: 'resource',
        resource: {
          uri: 'ui://example/demo-widget.html',
          mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
          text: html,
        },
      },
    ],
  } as unknown as TToolHandlerResponse;
}

export const showWidget: ITemplateTool = { definition, handler };
