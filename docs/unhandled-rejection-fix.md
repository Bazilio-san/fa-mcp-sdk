# Unhandled Rejection Handling Fix

## Problem

When using `fa-mcp-sdk` as an npm package in external applications, you might encounter `PromiseRejectionHandledWarning` messages during error testing:

```
(node:50596) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 10)
(Use `node --trace-warnings ...` to show where the warning was created)
```

This typically occurs when:
- Testing error scenarios that are expected to fail
- Using try-catch blocks to handle MCP errors
- The application imports `fa-mcp-sdk` as a dependency

## Solution

The fix is now automatically applied when importing `McpSseClient`. The global unhandled rejection handler silently handles MCP-related errors while preserving warnings for other types of errors.

### Usage

No changes needed to your existing code! Simply import and use as normal:

```javascript
import { McpSseClient } from "fa-mcp-sdk";

// Create client normally
const client = new McpSseClient("http://localhost:3000");

// Error testing works without warnings
try {
  const response = await client.callTool('some_tool', {});
  console.log('Success:', response);
} catch (error) {
  // MCP errors are caught here without PromiseRejectionHandledWarning
  console.log('Expected error:', error.message);
}
```

### What Changed

1. **Automatic Handler Setup**: Global unhandled rejection handler is automatically installed when the module is imported
2. **Selective Filtering**: Only MCP-related errors (those containing "MCP Error:") are silently handled
3. **Normal Error Preservation**: Non-MCP errors still trigger normal warnings
4. **Backward Compatibility**: Existing code continues to work unchanged

### Migration

If you were using `McpSseClient.createWithErrorHandler()`, you can now use the constructor directly:

```javascript
// Old way (still works for backward compatibility)
const client = McpSseClient.createWithErrorHandler(baseUrl);

// New way (recommended)
const client = new McpSseClient(baseUrl);
```

Both approaches work the same way now since the global handler is automatic.

### Technical Details

The fix works by:
1. Setting up a global `unhandledRejection` event handler on module import
2. Filtering rejections to only silence MCP-related errors
3. Using `.then()` instead of `.catch()` for synchronous error handling
4. Preserving method information for better debugging

This prevents the asynchronous rejection handling that was causing the warnings.