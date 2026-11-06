# Issuing JWTs over HTTP for MCP servers built with `fa-mcp-sdk`

This guide applies to any MCP server built with `fa-mcp-sdk` that permits local JWT issuance through
`POST /gen-jwt`. It does not depend on the server's business domain or require access to its source code.

## In one glance

- The `POST /gen-jwt` route issues a JWT, which is a signed credential with a limited lifetime.
- Issuance requires the MCP address, an existing server credential, a subject name, and a token lifetime.
- The procedure verifies the new token through the same route before copying it to the clipboard.
- The route is disabled by default and works only in a mode that can sign tokens locally.

## How it works

- The existing credential acts like a pass presented at an office that issues new passes.
  - Provide the complete `Authorization` header, including the `Bearer` or `Basic` scheme.
  - Do not place its value directly in the command text or documentation.
- The request accepts two required fields.
  - `username` is the selected subject name for the new token.
  - `ttl` is the time to live expressed as a number followed by `s`, `m`, `d`, or `y`.
- The request also accepts two optional fields.
  - `service` is the MCP service name that becomes the token audience.
  - `params` contains additional claims as an object or a `key=value;key=value` string.
- The response contains the token and calculated lifetime details.
  - `token` is the new JWT without the `Bearer ` prefix.
  - `user` is the lower-cased subject name.
  - `expire` is the exact expiration time.
  - `ttlSeconds` is the lifetime in seconds.

### Server prerequisites

Enable authentication and the issuance route in the target MCP configuration. JWT key configuration depends on the
selected mode and is described in the [authentication guide](04-authentication.md#jwt-modes-since-sdk-070).

```yaml
webServer:
  auth:
    enabled: true
  genJwtApiEnable: true
```

Restart the MCP after changing the configuration because the route is registered during startup. The `remoteJwks`
mode verifies tokens from an external identity provider and therefore cannot issue them through this route.

### Issue and verify a token

Run PowerShell from any directory. Replace only the four values at the start of the example; the address must point
to the server root without a trailing `/mcp`.

```powershell
$mcpBaseUrl = 'https://mcp.example.corp'
$username = 'service-account'
$ttl = '30d'
$serviceName = 'mcp-service-name'

if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') {
  throw 'Token issuance is prohibited when TLS certificate verification is disabled.'
}

$issuerSecure = Read-Host 'Complete existing Authorization header' -AsSecureString
$issuerAuthorization = $null
$newAuthorization = $null
$issued = $null
$requestBody = $null

try {
  $issuerAuthorization = [PSCredential]::new('unused', $issuerSecure).GetNetworkCredential().Password
  if ($issuerAuthorization -notmatch '^(Bearer|Basic) \S+$') {
    throw 'The Authorization header must start with Bearer or Basic and contain no spaces inside the credential.'
  }

  $request = @{
    username = $username
    ttl      = $ttl
  }
  if (-not [string]::IsNullOrWhiteSpace($serviceName)) {
    $request.service = $serviceName
  }
  $requestBody = $request | ConvertTo-Json -Depth 4

  $generationUri = "$($mcpBaseUrl.TrimEnd('/'))/gen-jwt"
  $issued = Invoke-RestMethod `
    -Method Post `
    -Uri $generationUri `
    -Headers @{ Authorization = $issuerAuthorization } `
    -ContentType 'application/json' `
    -Body $requestBody

  if ($issued.success -ne $true -or [string]::IsNullOrWhiteSpace($issued.token)) {
    throw 'The server did not return an issued token.'
  }

  $newAuthorization = "Bearer $($issued.token)"
  $probeStatus = 0
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri $generationUri `
      -Headers @{ Authorization = $newAuthorization } `
      -ContentType 'application/json' `
      -Body '{}' | Out-Null
  } catch {
    $probeStatus = [int]$_.Exception.Response.StatusCode
  }

  if ($probeStatus -ne 400) {
    throw "The new token failed verification: expected status 400, received $probeStatus."
  }

  $newAuthorization | Set-Clipboard
  $issued | Select-Object success, user, expire, ttlSeconds
} finally {
  Remove-Variable issuerSecure, issuerAuthorization, newAuthorization, issued, requestBody -ErrorAction SilentlyContinue
}
```

After success, the clipboard contains the ready-to-use `Bearer <JWT>` value. Store it only in the protected secret
location defined by the consuming project, and restart the consumer if it reads configuration only during startup.

| Result | Meaning | Action |
|---|---|---|
| `200` and `success: true` | A new token was issued | Verify it before installation |
| `400` with `username is required` during verification | The new token was accepted and the empty body was rejected | The token may be installed |
| `400` during issuance | A request field is invalid | Correct the request body |
| `401` or `403` | The existing or new credential was rejected | Keep the previous credential |
| `404` | The route is disabled or the root address is incorrect | Check the MCP configuration and address |
| `501` | The current mode cannot sign tokens locally | Obtain a token from the external identity provider |
| Certificate error | The remote server's identity cannot be verified | Stop and repair certificate trust |

### Worked examples

**Example 1 — a 30-day token.**\
With `ttl = 30d`, the server returns `ttlSeconds = 2,592,000` because
`30 × 86,400 = 2,592,000`; `expire` contains the exact expiration date.

**Example 2 — one-service audience.**\
With `service = mcp-orders`, the token audience is `mcp-orders`. A server that checks its MCP name rejects the
token when it is used for another service.

**Example 3 — invalid issuer credential.**\
The server returns `401` or `403` and omits `token`, so the previous credential remains unchanged.

Worth flagging: the route requires an ordinary valid credential but no separate issuance permission. Therefore, an
issued JWT can also call `POST /gen-jwt` until it expires; protect it as strictly as the issuer credential and do
not expose the route outside a trusted network boundary.

## Under the hood

The route is registered only when `webServer.genJwtApiEnable` is enabled
[`/src/core/web/server-http.ts:329`](../../src/core/web/server-http.ts#L329). Its default value is `false`
[`/config/default.yaml:554`](../../config/default.yaml#L554).

The handler validates `username` and `ttl`, converts the lifetime to seconds, accepts optional `service` and
`params`, and then calls `generateToken()`
[`/src/core/web/server-http.ts:351`](../../src/core/web/server-http.ts#L351). Token issuance selects its
implementation according to the configured JWT mode
[`/src/core/auth/jwt.ts:72`](../../src/core/auth/jwt.ts#L72).

The `canLocallyIssueJwt()` function determines whether local signing is available
[`/src/core/auth/key-resolver.ts:61`](../../src/core/auth/key-resolver.ts#L61). The `remoteJwks` mode returns
`501` because the private key belongs to an external identity provider rather than the MCP server.

### Code references

- Route registration and request handling:
  [`/src/core/web/server-http.ts:329`](../../src/core/web/server-http.ts#L329)
- Token issuance:
  [`/src/core/auth/jwt.ts:72`](../../src/core/auth/jwt.ts#L72)
- Local-signing capability:
  [`/src/core/auth/key-resolver.ts:61`](../../src/core/auth/key-resolver.ts#L61)
- Disabled default:
  [`/config/default.yaml:554`](../../config/default.yaml#L554)
