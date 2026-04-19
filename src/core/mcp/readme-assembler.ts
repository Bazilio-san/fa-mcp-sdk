/**
 * Assemble an extended README for the `doc://readme` MCP resource.
 *
 * Reads the project's README.md, finds every link pointing into `readme-docs/`, appends those
 * satellite Markdown files at the end (each separated by `\n\n---\n\n`), and rewrites the in-text
 * links to `See "<heading>" below` so the assembled document reads naturally.
 *
 * This is what the MCP registry's RAG index consumes via `doc://readme` — so the whole
 * documentation must be delivered as one searchable markdown blob.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const SATELLITE_DIR_NAME = 'readme-docs';

const SEPARATOR = '\n\n---\n\n';

const slugify = (heading: string): string => heading
  .toLowerCase()
  .replace(/[`*_~]/g, '')
  .replace(/[^\w\s-]/g, '')
  .trim()
  .replace(/\s+/g, '-');

const collectHeadings = (md: string): Map<string, string> => {
  const map = new Map<string, string>();
  const re = /^#{1,6}\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;

  while ((m = re.exec(md)) !== null) {
    const text = (m[1] ?? '').trim();
    const slug = slugify(text);
    if (!map.has(slug)) {map.set(slug, text);}
  }
  return map;
};

const getH1 = (md: string): string | null => {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m && m[1] ? m[1].trim() : null;
};

/**
 * Build the extended README.
 *
 * @param projectRoot - Absolute path to the project root (where README.md lives).
 * @returns The README content with satellites inlined. Empty string if README.md is missing.
 *          If `readme-docs/` is missing, returns the main README as-is.
 */
export const assembleReadmeWithSatellites = (projectRoot: string): string => {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!fs.existsSync(readmePath)) {return '';}

  let main = fs.readFileSync(readmePath, 'utf-8');

  const satelliteDir = path.join(projectRoot, SATELLITE_DIR_NAME);
  if (!fs.existsSync(satelliteDir) || !fs.statSync(satelliteDir).isDirectory()) {
    return main;
  }

  // filename → { content, headings (slug → text) }; insertion order preserved.
  const loaded = new Map<string, { content: string; headings: Map<string, string> }>();

  // [text](./readme-docs/foo.md)         — no anchor
  // [text](readme-docs/foo.md#bar)       — relative, with anchor
  // [text](./readme-docs/foo.md#bar)     — full form
  const linkRegex = new RegExp(
    `\\[([^\\]]+)\\]\\(\\.?\\/?${SATELLITE_DIR_NAME}\\/([^)#\\s]+\\.md)(#[^)\\s]*)?\\)`,
    'g',
  );

  main = main.replace(linkRegex, (match, _text: string, filename: string, anchor?: string) => {
    const filePath = path.join(satelliteDir, filename);
    if (!fs.existsSync(filePath)) {return match;} // leave broken links untouched

    let entry = loaded.get(filename);
    if (!entry) {
      const content = fs.readFileSync(filePath, 'utf-8');
      entry = { content, headings: collectHeadings(content) };
      loaded.set(filename, entry);
    }

    let heading: string | undefined;
    if (anchor) {
      const slug = anchor.slice(1); // strip leading '#'
      heading = entry.headings.get(slug);
    }
    if (!heading) {
      heading = getH1(entry.content) || filename.replace(/\.md$/, '');
    }

    return `See "${heading}" below`;
  });

  if (loaded.size === 0) {return main;}

  const appended = Array.from(loaded.values()).map((e) => e.content).join(SEPARATOR);
  return `${main}${SEPARATOR}${appended}`;
};
