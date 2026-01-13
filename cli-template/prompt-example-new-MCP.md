# Goal
Write the code for MCP server tools that implement retrieving the current cross-rate for a specified pair of currencies.

## Instructions

### Currency Cross-Rate API

#### Available Currencies
Currency codes (ISO 4217 code Alpha-3): ALL, ARS, AUD, BGN, BRL, BYN, CAD, CHF, CLP, CNY, CZK, DKK, EUR, GBP, HKD, HRK, HUF, IDR, INR, ISK, JOD, JPY, KRW, KZT, LAK, LKR, MKD, MMK, MXN, MYR, NOK, NPR, NZD, PHP, PLN, RON, RSD, RUB, SEK, SGD, THB, TRY, TWD, UAH, USD, VND, ZAR

#### Endpoint

```http request
GET http://<appConfig.accessPoints.currencyService.host>:<appConfig.accessPoints.currencyService.port>/currency-service/?rate=<QUOTE_CURRENCY><BASE_CURRENCY>
Authorization: Bearer <appConfig.accessPoints.currencyService.token>
```

Example:

```http request
GET http://smart-trade-ml.com:5002/currency-service/?rate=THBRUB
Authorization: Bearer <appConfig.accessPoints.currencyService.token>
```

Response:

```json
{"symbol": "THBRUB", "rate": 2.424167346170733}
```

Possible error codes: 400, 401, 404, 502

### Addition to config/default.yaml

```yaml
accessPoints:
  currencyService:
    host: smart-trade-ml.com
    port: 5002
    token: '***' 
```


### Create config/local.yaml

Create a file config/local.yaml with the following content:

```yaml
accessPoints:
  currencyService:
    token: '88888888-4444-4444-4444-bbbbbbbbbbbb' 
```


### Code Style
Write code concisely. Avoid unnecessary logging.
Follow DRY and KISS principles.

### Use the fa-mcp-sdk agent
Follow the recommendations in the file FA-MCP-SDK-DOC/00-FA-MCP-SDK-index.md

# Task

1) Instead of the test tool 'example_tool', add a tool to get the current currency cross-rate.
   Tool parameters:
- quoteCurrency - Currency code (ISO 4217 code Alpha-3) - required parameter
- baseCurrency - Currency code (ISO 4217 code Alpha-3) - optional parameter, default is USD

2) Copy the file __misc/asset/logo.svg to src/asset

3) Instead of the test resource 'custom-resource://resource1', add a resource to get the list of available currencies

4) Instead of the test examples in tests/mcp/test-cases.js, write tests for our case

5) Formulate the prompt AGENT_BRIEF in src/prompts/agent-brief.ts and AGENT_PROMPT in src/prompts/agent-prompt.ts

6) Instead of the endpoint /api/example (/example) in the file src/api/router.ts, create the endpoint get-curr-rate as a proxy to http://<appConfig.accessPoints.currencyService.host>:<appConfig.accessPoints.currencyService.port>/currency-service/?rate=<QUOTE_CURRENCY><BASE_CURRENCY>
