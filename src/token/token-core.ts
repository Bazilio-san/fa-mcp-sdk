// noinspection UnnecessaryLocalVariableJS
import crypto from 'crypto';
import { appConfig } from '../bootstrap/init-config.js';
import { ICheckTokenResult, ITokenPayload } from './i-token.js';
import { logger as lgr } from '../logger.js';
import { isObject, trim } from '../utils/utils.js';
import chalk from 'chalk';

const logger = lgr.getSubLogger({ name: chalk.cyan('token-auth') });

const { permanentServerTokens: pt, tokenEncryptKey } = appConfig.webServer.auth;

const permanentServerTokensSet: Set<string> = new Set(Array.isArray(pt) ? pt : [pt]);

const ALGORITHM = 'aes-256-ctr';
const KEY = crypto
  .createHash('sha256')
  .update(String(tokenEncryptKey))
  .digest('base64')
  .substring(0, 32);

export const tokenRE = /^(\d{13,})\.([\da-fA-F]{32,})$/;

/**
 * Encrypts the transmitted text with a symmetric key taken from the config
 */
export const encrypt = (text: string): string => {
  const buffer = Buffer.from(text);
  // Create an initialization vector
  const iv = crypto.randomBytes(16);
  // Create a new cipher using the algorithm, key, and iv
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  // Create the new (encrypted) buffer
  const encryptedBuf = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
  return encryptedBuf.toString('hex');
};

/**
 * Decrypts the transmitted text with a symmetric key taken from the config
 */
export const decrypt = (encryptedStr: string) => {
  const encryptedByf = Buffer.from(encryptedStr, 'hex');
  // Get the iv: the first 16 bytes
  const iv2 = encryptedByf.subarray(0, 16);
  // Get the rest
  const restBuf = encryptedByf.subarray(16);
  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv2);
  // Actually decrypt it
  const decryptedBuf = Buffer.concat([decipher.update(restBuf), decipher.final()]);
  return decryptedBuf.toString();
};

/**
 * Creates a token by encrypting the username and expiration time.
 * To determine the expiration time in the JB form script, at the beginning of the token
 * deprecation timestamp is added
 */
export const generateToken = (user: string, liveTimeSec: number, payload?: any): string => {
  user = trim(user).toLowerCase();
  if (!user) {
    throw new Error('generateToken: Username is empty');
  }
  const expire = Date.now() + (liveTimeSec * 1000);
  payload = isObject(payload) ? payload : {};
  payload.user = user;
  payload.expire = expire;
  // Add the required serviceName parameter from appConfig
  payload.serviceName = appConfig.name;
  return `${expire}.${encrypt(JSON.stringify(payload))}`;
};


/**
 * Checks the validity of the token:
 * - Token to be decrypted
 * - the obsolescence time must not be expired
 * - If a user is transferred, it must match
 */
export const checkToken = (token: string, expectedUser?: string): ICheckTokenResult => {
  token = (token || '').trim();
  if (!token) {
    return {
      errorReason: 'Token not passed',
    };
  }

  if (permanentServerTokensSet.has(token)) {
    return {
      inTokenType: 'permanent',
    };
  }

  const [, expirePartStr, encryptedPayload] = tokenRE.exec(token) || [];

  if (!expirePartStr || !encryptedPayload) {
    return {
      inTokenType: 'permanent',
      errorReason: 'The token is not a JWT and is not on the list of registered server tokens',
    };
  }

  let payloadStr: string = '';
  try {
    payloadStr = decrypt(encryptedPayload);
  } catch (err: Error | any) {
    logger.error(err);
    return {
      errorReason: `Error decrypting JWT token :: ${err.message}`,
    };
  }
  let payload: ITokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (err: Error | any) {
    logger.error(err);
    return {
      inTokenType: 'JWT',
      errorReason: `Error deserializing payload of JWT token :: ${err.message}`,
    };
  }

  expectedUser = trim(expectedUser).toLowerCase();
  if (expectedUser && payload.user !== expectedUser ) {
    return {
      isTokenDecrypted: true,
      inTokenType: 'JWT',
      errorReason: `JWT Token: user not match :: Expected  '${expectedUser}' / obtained from the token: '${payload.user}'`,
    };
  }

  let expire = Number(expirePartStr) || 0;

  const expiredOn = Date.now() - expire;
  if (expiredOn > 0) {
    // Token deprecated
    return {
      isTokenDecrypted: true,
      inTokenType: 'JWT',
      errorReason: `JWT Token expired :: on ${expiredOn} mc`,
    };
  }
  // OK!
  return { inTokenType: 'JWT', payload };
};
