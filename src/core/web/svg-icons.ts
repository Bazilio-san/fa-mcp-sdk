/**
 * SVG Icons endpoint with color substitution
 * Serves SVG files from static folder with currentColor replaced by primary color
 */

import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../bootstrap/init-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ONE_YEAR_MS = 60 * 60 * 24 * 365 * 1000; // 1 year

// Cache for loaded SVG files
const svgCache = new Map<string, string>();

const etagS = (entity: string): string => {
  const hash = crypto
    .createHash('sha1')
    .update(entity, 'utf8')
    .digest('base64')
    .substring(0, 27);
  return `"${Buffer.byteLength(entity, 'utf8').toString(16)}-${hash}"`;
};

const loadSvg = (relativePath: string): string | null => {
  const cacheKey = `${relativePath}:${config.uiColor.primary}`;

  if (svgCache.has(cacheKey)) {
    return svgCache.get(cacheKey)!;
  }

  const fullPath = join(__dirname, 'static', relativePath);

  if (!existsSync(fullPath)) {
    return null;
  }

  try {
    let svg = readFileSync(fullPath, 'utf-8');
    // Replace all occurrences of currentColor with primary color
    svg = svg.replace(/currentColor/g, config.uiColor.primary);
    svgCache.set(cacheKey, svg);
    return svg;
  } catch {
    return null;
  }
};

const handleSvgRequest = (svgPath: string, res: Response): void => {
  if (!svgPath || !svgPath.endsWith('.svg')) {
    res.status(400).json({ error: 'Invalid SVG path' });
    return;
  }

  // Security: prevent path traversal
  if (svgPath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const svg = loadSvg(svgPath);

  if (!svg) {
    res.status(404).json({ error: 'SVG not found' });
    return;
  }

  res.setHeader('Cache-Control', `public, max-age=${Math.floor(ONE_YEAR_MS / 1000)}`);
  res.setHeader('ETag', etagS(svg));
  res.setHeader('Content-Length', Buffer.byteLength(svg, 'utf-8'));
  res.setHeader('Content-Type', 'image/svg+xml');
  res.status(200).end(svg, 'utf-8');
};

export const createSvgRouter = (): Router => {
  const router = Router();

  // Handle /svg/:folder/:file.svg paths
  router.get('/:folder/:file', (req: Request, res: Response) => {
    const svgPath = `${req.params.folder}/${req.params.file}`;
    handleSvgRequest(svgPath, res);
  });

  // Handle /svg/:file.svg paths (root level)
  router.get('/:file', (req: Request, res: Response) => {
    handleSvgRequest(String(req.params.file || ''), res);
  });

  return router;
};
