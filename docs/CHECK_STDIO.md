# Checking the MCP Server Functionality in STDIO Mode

To verify the MCP server functionality in STDIO mode, you need to send JSON-RPC messages through standard input. Below is the sequence of commands for testing:

## 1) Starting the Server in STDIO Mode

```shell
yarn dev:stdio
```

or

```shell
yarn cb
MCP_TRANSPORT_TYPE=stdio node dist/src/start.js
```

## 2) Sending Commands Manually

Send each command one by one (each command on a new line, press Enter after each).

### 1. Initializing the Connection

```json
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}
```

### 2. Getting the List of Available Tools

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
```

The expected response should contain the `execute_sql_query` tool.

### 3. Testing SQL Queries

#### Simple SELECT Query:

```shell
{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "SELECT 1 as test_column, 'Hello' as message"}}}
```

#### CTE Query:

```shell
{"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "WITH test AS (SELECT 1 as id, 'Test' as name) SELECT * FROM test"}}}
```

#### Query with PostgreSQL Functions:

```shell
{"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "SELECT CURRENT_DATE as today, CURRENT_TIMESTAMP as now, 1+2+3 as calculation"}}}
```

### 4. Testing Security Validation (Should Return an Error)

#### INSERT Query (Forbidden):

```shell
{"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "INSERT INTO test VALUES (1)"}}}
```

#### UPDATE Query (Forbidden):

```shell
{"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "UPDATE test SET id = 1"}}}
```

## 3) Automated Testing

### Create a File `test-commands.txt`

```shell
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "clientInfo": {"name": "test", "version": "1.0.0"}}}
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "execute_sql_query", "arguments": {"sql": "SELECT 1 as test_number, '"'"'Hello World'"'"' as test_string"}}}' > test-commands.txt
```

### Send Commands to the Server

```shell
cat test-commands.txt | yarn dev:stdio
```

## 4) Using Ready-Made Tests

### Simple Test:

```shell
yarn test:mcp-simple
```

### Full Test Suite:

```shell
yarn test:mcp
```
