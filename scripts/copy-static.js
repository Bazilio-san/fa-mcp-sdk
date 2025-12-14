import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const staticDirs = [
  {
    src: 'src/core/web/static',
    dest: 'dist/core/web/static',
  },
];

for (const { src, dest } of staticDirs) {
  const srcPath = join(rootDir, src);
  const destPath = join(rootDir, dest);

  if (existsSync(srcPath)) {
    // Ensure destination directory exists
    mkdirSync(dirname(destPath), { recursive: true });

    // Copy directory recursively
    cpSync(srcPath, destPath, { recursive: true });
    console.log(`Copied: ${src} -> ${dest}`);
  } else {
    console.warn(`Warning: Source not found: ${src}`);
  }
}

console.log('Static files copy completed.');
