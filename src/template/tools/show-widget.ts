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
  description:
    'Show a demonstration UI widget. Call this whenever the user asks to show or demonstrate a ' +
    'widget (e.g. "покажи виджет", "show widget", "демо виджета"). When the host supports MCP Apps ' +
    '(Agent Tester with the "Apps" toggle on) it renders an interactive widget; otherwise it returns ' +
    'a short instruction to enable Apps mode, which you MUST relay to the user verbatim.',
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
    return asTextContent('Для демонстрации виджета включите режим Apps');
  }
  const now = new Date().toLocaleString();
  const html = renderWidgetDocument(
    'Демонстрационный виджет',
    [
      { k: 'Статус', v: 'MCP App работает' },
      { k: 'Тема', v: 'подстраивается под хост (светлая/тёмная)' },
      { k: 'Размер', v: 'подгоняется под содержимое' },
      { k: 'Время', v: now },
    ],
    'Это демонстрация MCP Apps в Agent Tester. Виджет пришёл из инструмента show_widget.',
  );
  return {
    content: [
      { type: 'text', text: 'Виджет показан (демонстрация MCP Apps).' },
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
