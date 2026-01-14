import { McpServerData } from './types.js';

declare global {
  var __MCP_PROJECT_DATA__: McpServerData;
  var _faMcpSdkRejectionHandler: Boolean;
}

export {}; // Making the file a module
