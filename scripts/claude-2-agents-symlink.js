#!/usr/bin/env node

/**
 * Связывает навыки Codex и Claude Code на любой операционной системе.
 *
 * Устройство:
 *
 *   .agents/skills/          основное хранилище навыков: настоящие файлы (Codex читает его сам)
 *   .claude/skills -> ../.agents/skills   (ссылка, через которую навыки видит Claude Code)
 *
 * Корень проекта определяется по расположению сценария (scripts/..), поэтому результат не зависит
 * от рабочей папки. Параметр --repo <путь> задаёт корень явно.
 *
 * Связываются только совместимые сущности. Не связываются:
 *   - .claude/agents    — агенты Codex хранятся в .codex/agents/*.toml;
 *   - .claude/commands  — команды переносятся в навыки;
 *   - .claude/settings  — у Codex свои .codex/config.toml и hooks.json;
 *   - .mcp.json         — серверы MCP Codex описываются в .codex/config.toml.
 *
 * Использование: node scripts/claude-2-agents-symlink.js [setup|remove|status] [--dry-run] [--force]
 *                [--repo <путь>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FCP = path.join(DEFAULT_REPO_ROOT, 'scripts/fcp.js');

function mutate(args, dryRun) {
  if (dryRun) {
    log(`[пробный прогон] fcp ${args.join(' ')}`);
  } else {
    execFileSync(process.execPath, [FCP, ...args], { stdio: 'pipe' });
  }
}

// Проверяем всё дерево до переноса: различающиеся файлы требуют ручного объединения.
function planMerge(source, destination, operations) {
  const target = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (!target) {
    operations.push(['--move', destination, source]);
    return;
  }
  const original = fs.lstatSync(source);
  if (original.isDirectory() && target.isDirectory()) {
    for (const name of fs.readdirSync(source)) {
      planMerge(path.join(source, name), path.join(destination, name), operations);
    }
  } else if (!(original.isFile() && target.isFile() && fs.readFileSync(source).equals(fs.readFileSync(destination)))) {
    throw new Error(`Конфликт при переносе навыков: ${source} и ${destination}. Объедините их вручную.`);
  }
  operations.push(['--rm', source]);
}

function migrateSkills(repoRoot, options) {
  const canonical = path.join(repoRoot, '.agents/skills');
  const legacy = path.join(repoRoot, '.claude/skills');
  const source = pathInfo(canonical);
  const old = pathInfo(legacy);
  const operations = [];
  if (source.isSymbolicLink) {
    if (!old.exists || old.isSymbolicLink || !sameResolvedPath(canonical, legacy)) {
      throw new Error(`Основной каталог ${canonical} является посторонней ссылкой. Перенос остановлен.`);
    }
    operations.push(['--rm', canonical], ['--move', canonical, legacy]);
  } else if (old.exists && !old.isSymbolicLink) {
    if (!fs.lstatSync(legacy).isDirectory()) {
      throw new Error(`Ожидался каталог навыков: ${legacy}`);
    }
    planMerge(legacy, canonical, operations);
  }
  for (const operation of operations) {
    mutate(operation, options.dryRun);
  }
  return operations.length > 0;
}

const LINK_MAPPINGS = [
  {
    name: 'skills',
    source: '.agents/skills',
    link: '.claude/skills',
  },
  {
    name: 'qwen',
    source: '.agents/skills',
    link: '.qwen/skills',
  },
];

function parseArgs(argv) {
  const result = {
    mode: 'setup',
    repo: DEFAULT_REPO_ROOT,
    dryRun: false,
    force: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--remove') {
      result.mode = 'remove';
    } else if (arg === '--status') {
      result.mode = 'status';
    } else if (arg === '--repo') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('После --repo требуется путь.');
      }
      result.repo = path.resolve(value);
      i += 1;
    } else if (arg.startsWith('--repo=')) {
      result.repo = path.resolve(arg.slice('--repo='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Неизвестный параметр: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0]) {
    const mode = positional[0];
    if (!['setup', 'remove', 'status'].includes(mode)) {
      throw new Error(`Неизвестный режим: ${mode}. Допустимы setup, remove и status.`);
    }
    result.mode = mode;
  }

  return result;
}

function log(message) {
  process.stdout.write(`${message}${os.EOL}`);
}

function warn(message) {
  process.stderr.write(`ПРЕДУПРЕЖДЕНИЕ: ${message}${os.EOL}`);
}

function pathInfo(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    return {
      exists: true,
      isSymbolicLink: stat.isSymbolicLink(),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, isSymbolicLink: false };
    }
    throw error;
  }
}

function realpathSafe(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return null;
  }
}

function normalizeForCompare(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameResolvedPath(a, b) {
  const realA = realpathSafe(a) || path.resolve(a);
  const realB = realpathSafe(b) || path.resolve(b);

  return normalizeForCompare(realA) === normalizeForCompare(realB);
}

function readLinkTargetAbsolute(linkPath) {
  const raw = fs.readlinkSync(linkPath);
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(path.dirname(linkPath), raw);
}

function currentTarget(linkPath) {
  try {
    return readLinkTargetAbsolute(linkPath);
  } catch {
    return 'неизвестно';
  }
}

function ensureDir(dirPath, dryRun) {
  if (pathInfo(dirPath).exists) {
    if (!fs.statSync(dirPath).isDirectory()) {
      throw new Error(`Ожидался каталог: ${dirPath}`);
    }
    return;
  }

  if (dryRun) {
    log(`[пробный прогон] создать каталог ${dirPath}`);
    return;
  }

  fs.mkdirSync(dirPath, { recursive: true });
}

// В Windows создаётся точка соединения каталогов (junction): для неё не нужны права администратора.
function createDirectoryLink(sourcePath, linkPath, dryRun) {
  const parentDir = path.dirname(linkPath);
  ensureDir(parentDir, dryRun);

  const targetForLink =
    process.platform === 'win32' ? path.resolve(sourcePath) : path.relative(parentDir, sourcePath) || '.';

  if (dryRun) {
    log(`[пробный прогон] ссылка ${linkPath} -> ${targetForLink}`);
    return;
  }

  mutate(['--link', linkPath, sourcePath], false);
}

function setupMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  ensureDir(sourcePath, options.dryRun);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Готово: создана ссылка ${mapping.link} -> ${mapping.source}`);
    return;
  }

  if (link.isSymbolicLink) {
    if (sameResolvedPath(linkPath, sourcePath)) {
      if (normalizeForCompare(readLinkTargetAbsolute(linkPath)) !== normalizeForCompare(sourcePath)) {
        mutate(['--rm', linkPath], options.dryRun);
        createDirectoryLink(sourcePath, linkPath, options.dryRun);
      }
      log(`Готово: ${mapping.link} уже указывает на ${mapping.source}`);
      return;
    }

    if (!options.force) {
      throw new Error(
        `${mapping.link} уже является ссылкой, но указывает не на ${mapping.source}. Для замены добавьте --force. Текущая цель: ${currentTarget(linkPath)}`,
      );
    }

    if (options.dryRun) {
      log(`[пробный прогон] удалить прежнюю ссылку ${linkPath}`);
    } else {
      mutate(['--rm', linkPath], false);
    }

    createDirectoryLink(sourcePath, linkPath, options.dryRun);
    log(`Готово: ссылка ${mapping.link} заменена и указывает на ${mapping.source}`);
    return;
  }

  throw new Error(
    `${mapping.link} уже существует и не является ссылкой. Настоящие файлы и каталоги не перезаписываются: сначала перенесите их вручную.`,
  );
}

function removeMapping(repoRoot, mapping, options) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const link = pathInfo(linkPath);

  if (!link.exists) {
    log(`Готово: ${mapping.link} отсутствует`);
    return;
  }

  if (!link.isSymbolicLink) {
    warn(`${mapping.link} существует, но не является ссылкой. Пропускаю.`);
    return;
  }

  if (!sameResolvedPath(linkPath, sourcePath) && !options.force) {
    warn(
      `${mapping.link} является ссылкой, но указывает не на ${mapping.source}. Для удаления добавьте --force. Текущая цель: ${currentTarget(linkPath)}`,
    );
    return;
  }

  if (options.dryRun) {
    log(`[пробный прогон] удалить ссылку ${linkPath}`);
    return;
  }

  mutate(['--rm', linkPath], false);
  log(`Готово: ссылка ${mapping.link} удалена`);
}

function statusMapping(repoRoot, mapping) {
  const sourcePath = path.resolve(repoRoot, mapping.source);
  const linkPath = path.resolve(repoRoot, mapping.link);

  const source = pathInfo(sourcePath);
  const link = pathInfo(linkPath);

  log(`\n[${mapping.name}]`);
  log(`источник: ${mapping.source} ${source.exists ? 'существует' : 'отсутствует'}`);
  log(`ссылка:   ${mapping.link} ${link.exists ? 'существует' : 'отсутствует'}`);

  if (link.exists && link.isSymbolicLink) {
    const ok = source.exists && sameResolvedPath(linkPath, sourcePath);
    log(`цель:     ${currentTarget(linkPath)}`);
    log(`состояние: ${ok ? 'ссылка верна' : 'ссылка указывает не туда'}`);
    return;
  }

  if (link.exists && !link.isSymbolicLink) {
    log('состояние: на месте ссылки лежит настоящий каталог или файл');
    return;
  }

  log('состояние: ссылка не создана');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.repo);

  if (!pathInfo(repoRoot).exists) {
    throw new Error(`Каталог проекта не существует: ${repoRoot}`);
  }

  log(`проект: ${repoRoot}`);
  log(`режим: ${options.mode}${options.dryRun ? ', пробный прогон' : ''}${options.force ? ', с заменой' : ''}`);

  if (options.mode === 'setup' && migrateSkills(repoRoot, options) && options.dryRun) {
    log('[пробный прогон] после переноса будут созданы ссылки .claude/skills и .qwen/skills -> .agents/skills');
    return;
  }

  for (const mapping of LINK_MAPPINGS) {
    if (options.mode === 'setup') {
      setupMapping(repoRoot, mapping, options);
    } else if (options.mode === 'remove') {
      removeMapping(repoRoot, mapping, options);
    } else if (options.mode === 'status') {
      statusMapping(repoRoot, mapping);
    }
  }

  log('');
  log('Связываются только навыки: это единственная сущность, одинаково понятная Codex и Claude Code.');
  log(
    'Не связывайте напрямую .claude/agents, .claude/commands, настройки, обработчики событий и описание серверов MCP.',
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`ОШИБКА: ${error.message}${os.EOL}`);
  process.exit(1);
}
