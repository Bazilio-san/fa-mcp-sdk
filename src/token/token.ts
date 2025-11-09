// noinspection UnnecessaryLocalVariableJS
import { NextFunction, Request, Response } from 'express';
import { cyan, lBlue, magenta, red, reset } from 'af-color';
import { checkToken } from './token-core.js';
import { debugTokenAuth } from '../debug.js';
import { appConfig } from '../bootstrap/init-config.js';

const { enabled } = appConfig.webServer.auth;

const getTokenFromHttpHeader = (req: Request): { user: string, token: string } => {
  const { authorization = '', user = '' } = req.headers;
  const token = authorization.replace(/^Bearer */, '');
  return { user: String(user).toLowerCase(), token };
};

const SHOW_HEADERS_SET = new Set(['user', 'authorization', 'x-real-ip', 'x-mode', 'host']);

export const debugAuth = (req: Request, code: number, message: string): { code: number, message: string } => {
  if (debugTokenAuth.enabled) {
    let headersStr: string = '';
    if (req.headers) {
      headersStr = Object.entries(req.headers).map(([k, v]) => {
        if (SHOW_HEADERS_SET.has(k.toLowerCase())) {
          return `${cyan}${k}${lBlue}: ${magenta}${v}${reset}`;
        }
        return undefined;
      }).filter(Boolean).join(', ');
    }
    debugTokenAuth(`${red}Unauthorized ${lBlue}${code}${red} ${message}${reset} Headers: ${headersStr || '-'}`);
  }
  return { code, message };
};


/**
 * Checks token authorization.
 * If everything is OK, it will return undefined.
 * Otherwise, it will return the object with an error
 */
export const getAuthByTokenError = (req: Request): { code: number, message: string } | undefined => {
  if (!enabled) {
    return undefined;
  }
  const { token, user } = getTokenFromHttpHeader(req);
  if (!token) {
    return debugAuth(req, 400, 'Missing authorization header');
  }
  const checkResult = checkToken(token, user);
  if (checkResult.errorReason) {
    return debugAuth(req, 401, checkResult.errorReason);
  }
  return undefined;
};

export const authByToken = (req: Request, res: Response) => {
  const authError = getAuthByTokenError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return false;
  }
  return true;
};

export const authTokenMW = (req: Request, res: Response, next: NextFunction) => {
  const authError = getAuthByTokenError(req);
  if (authError) {
    res.status(authError.code).send(authError.message);
    return;
  }
  next();
};
