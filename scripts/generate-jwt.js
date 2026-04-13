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
 * The encryptKey is read from config: webServer.auth.jwtToken.encryptKey
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import configModule from 'config';

// ── CLI argument parsing ────────────────────────────────────────────

function getArg (shortFlag, longFlag) {
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

// ── Encryption (mirrors src/core/auth/jwt.ts) ───────────────────────

const ALGORITHM = 'aes-256-ctr';
const KEY = crypto
  .createHash('sha256')
  .update(String(encryptKey))
  .digest('base64')
  .substring(0, 32);

function encrypt (text) {
  const buffer = Buffer.from(text);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encryptedBuf = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
  return encryptedBuf.toString('hex');
}

// ── Auto-detect service name if checkMCPName is enabled ─────────────

let effectiveService = service;

if ((!effectiveService || !effectiveService.trim())) {
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

// ── Build payload ───────────────────────────────────────────────────

const payload = {};
payload.user = username.trim().toLowerCase();

if (effectiveService && effectiveService.trim()) {
  payload.service = effectiveService.trim();
}

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
    payload[key] = value;
  }
}

const expire = Date.now() + (liveTimeSec * 1000);
payload.expire = expire;
payload.iat = new Date().toISOString();

// ── Generate token ──────────────────────────────────────────────────

const token = `${expire}.${encrypt(JSON.stringify(payload))}`;

console.log('');
console.log('JWT Token generated successfully');
console.log('─'.repeat(50));
console.log(`  User:      ${payload.user}`);
if (payload.service) {
  console.log(`  Service:   ${payload.service}`);
}
console.log(`  TTL:       ${ttlRaw} (${liveTimeSec} seconds)`);
console.log(`  Expires:   ${new Date(expire).toISOString()}`);
if (Object.keys(payload).filter((k) => !['user', 'service', 'expire', 'iat'].includes(k)).length) {
  const extra = Object.entries(payload)
    .filter(([k]) => !['user', 'service', 'expire', 'iat'].includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  console.log(`  Params:    ${extra}`);
}
console.log('─'.repeat(50));
console.log('');
console.log(token);
console.log('');
console.log('__PAYLOAD_JSON__');
console.log(JSON.stringify({ ...payload, ttl: ttlRaw, expire_iso: new Date(expire).toISOString() }));
console.log('__END_PAYLOAD_JSON__');
