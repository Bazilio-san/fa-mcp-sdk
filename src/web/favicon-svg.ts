import { NextFunction, Request, Response, RequestHandler } from 'express';
import crypto from 'crypto';
import { config } from '../bootstrap/init-config.js';
import { McpServerData } from '../types.js';

function getProjectData(): McpServerData {
  return (global as any).__MCP_PROJECT_DATA__;
}

const ONE_YEAR_MS = 60 * 60 * 24 * 365 * 1000; // 1 year

const etagS = (entity: string): string => {
  // compute hash of entity
  const hash = crypto
    .createHash('sha1')
    .update(entity, 'utf8')
    .digest('base64')
    .substring(0, 27);
  return `"${Buffer.byteLength(entity, 'utf8').toString(16)}-${hash}"`;
};

export const getFaviconSvg = (): string => {
  const { assets } = getProjectData();
  let svg: string = assets?.favicon || '<svg><!-- No favicon provided --></svg>';
  return svg.replace('fill="currentColor"', `fill="${config.uiColor.primary}"`);
};


/**
 * Serves the favicon located by the given `path`.
 */
export const faviconSvg = (): RequestHandler => {
  let svg: string = getFaviconSvg();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!/\/favicon.svg$/.test(req.path)) {
      next();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = req.method === 'OPTIONS' ? 200 : 405;
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }

    res.setHeader('Cache-Control', `public, max-age=${Math.floor(ONE_YEAR_MS / 1000)}`);
    res.setHeader('ETag', etagS(svg));
    res.setHeader('Content-Length', svg.length);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.statusCode = 200;
    res.end(svg, 'utf-8');
  };
};
