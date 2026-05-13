#!/usr/bin/env node
/**
 * Generate JWT token for MCP server authentication.
 *
 * Usage:
 *   node scripts/generate-jwt.js -u <username> -ttl <duration> [-s <service>] [-p <params>]
 *
 * Options:
 *   -u,   --username       Username (required). ENV: JWT_PAYLOAD_USERNAME
 *   -ttl                   Token lifetime: <N>s | <N>m | <N>d | <N>y (required). ENV: JWT_TTL
 *   -s,   --service-name   Service name (optional). ENV: JWT_PAYLOAD_SERVICE_NAME
 *   -p,   --params         Extra payload "key=value;key=value" (optional). ENV: JWT_PAYLOAD_PARAMS
 *
 * The signing secret is read from config: webServer.auth.jwtToken.encryptKey
 * Token format: standard signed JWT (HS256), 3 segments header.payload.signature.
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import configModule from 'config';
import jwt from 'jsonwebtoken';

// ── CLI argument parsing ────────────────────────────────────────────

function getArg(shortFlag, longFlag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === shortFlag || args[i] === longFlag) {
      return args[i + 1] || '';
    }
  }
  return undefined;
}

const username = getArg('-u', '--username') ?? process.env.JWT_PAYLOAD_USERNAME;
const ttlRaw = getArg('-ttl', '-ttl') ?? process.env.JWT_TTL;
const service = getArg('-s', '--service-name') ?? process.env.JWT_PAYLOAD_SERVICE_NAME;
const paramsRaw = getArg('-p', '--params') ?? process.env.JWT_PAYLOAD_PARAMS;

// ── Validation ──────────────────────────────────────────────────────

if (!username || !username.trim()) {
  console.error('Error: username is required (-u / --username or ENV JWT_PAYLOAD_USERNAME)');
  process.exit(1);
}

if (!ttlRaw || !ttlRaw.trim()) {
  console.error('Error: TTL is required (-ttl or ENV JWT_TTL). Format: <N>s | <N>m | <N>d | <N>y');
  process.exit(1);
}

const ttlMatch = /^(\d+)([smdy])$/.exec(ttlRaw.trim());
if (!ttlMatch) {
  console.error(`Error: invalid TTL format "${ttlRaw}". Expected: <N>s | <N>m | <N>d | <N>y`);
  process.exit(1);
}

const ttlValue = parseInt(ttlMatch[1], 10);
const ttlUnit = ttlMatch[2];

if (ttlValue <= 0) {
  console.error('Error: TTL value must be greater than 0');
  process.exit(1);
}

const TTL_MULTIPLIERS = { s: 1, m: 60, d: 86400, y: 31536000 };
const liveTimeSec = ttlValue * TTL_MULTIPLIERS[ttlUnit];

// ── Config ──────────────────────────────────────────────────────────

let encryptKey;
try {
  encryptKey = configModule.get('webServer.auth.jwtToken.encryptKey');
} catch {
  // config key not found
}

if (!encryptKey || String(encryptKey).trim() === '' || encryptKey === '***') {
  console.error('Error: webServer.auth.jwtToken.encryptKey is not configured or has a placeholder value.');
  console.error('Set it in config/local.yaml or via ENV WS_TOKEN_ENCRYPT_KEY');
  process.exit(1);
}

let configuredIssuer = '';
try {
  configuredIssuer = String(configModule.get('webServer.auth.jwtToken.issuer') || '').trim();
} catch {
  // optional field, ignore
}

// ── Auto-detect service name if checkMCPName is enabled ─────────────

let effectiveService = service;

if (!effectiveService || !effectiveService.trim()) {
  let checkMCPName = false;
  try {
    checkMCPName = configModule.get('webServer.auth.jwtToken.checkMCPName');
  } catch {
    // config key not found
  }
  if (checkMCPName) {
    // 1) Try SERVICE_NAME from .env
    if (process.env.SERVICE_NAME && process.env.SERVICE_NAME.trim()) {
      effectiveService = process.env.SERVICE_NAME.trim();
    } else {
      // 2) Fallback to package.json name
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const pkgPath = resolve(__dirname, '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) {
          effectiveService = pkg.name;
        }
      } catch {
        // package.json not found or unreadable
      }
    }
  }
}

// ── Build payload (private claims only) ─────────────────────────────

const privateClaims = {};

// Parse extra params: "key1=value1;key2=value2"
if (paramsRaw && paramsRaw.trim()) {
  const pairs = paramsRaw.trim().split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) {
      console.error(`Error: invalid param format "${pair}". Expected "key=value"`);
      process.exit(1);
    }
    const key = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    if (!key) {
      console.error(`Error: empty key in param "${pair}"`);
      process.exit(1);
    }
    // Skip reserved fields if user accidentally passes them
    if (['user', 'expire', 'iat', 'service', 'sub', 'aud', 'exp', 'iss', 'jti'].includes(key)) {
      continue;
    }
    privateClaims[key] = value;
  }
}

// ── Generate token ──────────────────────────────────────────────────

const normalizedUser = username.trim().toLowerCase();
const signOptions = {
  algorithm: 'HS256',
  subject: normalizedUser,
  expiresIn: liveTimeSec,
  jwtid: crypto.randomUUID(),
};
if (effectiveService && effectiveService.trim()) {
  signOptions.audience = effectiveService.trim();
}
if (configuredIssuer) {
  signOptions.issuer = configuredIssuer;
}

const token = jwt.sign(privateClaims, String(encryptKey), signOptions);

// ── Decode for display (normalized payload, mirrors checkJwtToken) ──

const decoded = jwt.decode(token, { json: true }) || {};
const expireMs = (decoded.exp || 0) * 1000;
const iatIso = decoded.iat ? new Date(decoded.iat * 1000).toISOString() : new Date().toISOString();

const displayPayload = { user: normalizedUser };
if (decoded.aud) {
  displayPayload.service = Array.isArray(decoded.aud) ? decoded.aud[0] : decoded.aud;
}
displayPayload.expire = expireMs;
displayPayload.iat = iatIso;
if (decoded.jti) {
  displayPayload.jti = decoded.jti;
}
if (decoded.iss) {
  displayPayload.iss = decoded.iss;
}
for (const [k, v] of Object.entries(privateClaims)) {
  displayPayload[k] = v;
}

console.log('');
console.log('JWT Token generated successfully');
console.log('─'.repeat(50));
console.log(`  User:      ${displayPayload.user}`);
if (displayPayload.service) {
  console.log(`  Service:   ${displayPayload.service}`);
}
console.log(`  TTL:       ${ttlRaw} (${liveTimeSec} seconds)`);
console.log(`  Expires:   ${new Date(expireMs).toISOString()}`);
console.log(`  JTI:       ${displayPayload.jti || ''}`);
const extraEntries = Object.entries(privateClaims);
if (extraEntries.length) {
  const extra = extraEntries.map(([k, v]) => `${k}=${v}`).join('; ');
  console.log(`  Params:    ${extra}`);
}
console.log('─'.repeat(50));
console.log('');
console.log(token);
console.log('');
console.log('__PAYLOAD_JSON__');
console.log(JSON.stringify({ ...displayPayload, ttl: ttlRaw, expire_iso: new Date(expireMs).toISOString() }));
console.log('__END_PAYLOAD_JSON__');
