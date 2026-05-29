/**
 * Standard §17.2 — deprecation lifecycle for tools / prompts / resources.
 *
 * Authors declare deprecation in a structured shape (see {@link IDeprecationInfo}) instead of
 * smuggling `[DEPRECATED]` into free-form descriptions. The SDK then:
 *   1. mutates the public `description` so every client (LLM and dashboard alike) sees
 *      `[DEPRECATED until YYYY-MM-DD, use new_name] <orig>`;
 *   2. logs a runtime warning the first time per hour each (kind, name) is invoked
 *      (rate-limit avoids flooding when an automation hammers an old tool);
 *   3. logs an error on registration if the `until` date is already in the past — a signal
 *      that the migration window has lapsed and the entry should be deleted, not shipped.
 */
import chalk from 'chalk';

import { logger as lgr } from '../logger.js';

const logger = lgr.getSubLogger({ name: chalk.bgMagenta('deprecation') });

export interface IDeprecationInfo {
  /** ISO date (YYYY-MM-DD) — when the deprecated feature will be removed. */
  until: string;
  /** Replacement: tool / prompt / resource name or URI. */
  replacedBy?: string;
  /** Free-form migration note shown alongside the warning. */
  note?: string;
}

const DEPRECATED_PREFIX_REGEX = /^\s*\[DEPRECATED[^\]]*]\s*/i;

/**
 * Prepend `[DEPRECATED until <date>, use <replacement>]` to a description, unless one is
 * already present (idempotent — safe to call on every list response).
 */
export function applyDeprecationToDescription(
  description: string | undefined,
  info: IDeprecationInfo | undefined,
): string | undefined {
  if (!info) {
    return description;
  }
  const base = description ?? '';
  if (DEPRECATED_PREFIX_REGEX.test(base)) {
    return base;
  }
  const replacement = info.replacedBy ? `, use ${info.replacedBy}` : '';
  const prefix = `[DEPRECATED until ${info.until}${replacement}] `;
  return `${prefix}${base}`;
}

const lastWarnAt = new Map<string, number>();
const WARN_RATE_LIMIT_MS = 60 * 60 * 1000;

/**
 * Emit a `logger.warn` for the first use within a one-hour window. Returns true when the
 * warning was emitted (useful for tests).
 */
export function warnDeprecatedUsage(
  kind: 'tool' | 'prompt' | 'resource',
  name: string,
  info: IDeprecationInfo | undefined,
): boolean {
  if (!info) {
    return false;
  }
  const key = `${kind}:${name}`;
  const now = Date.now();
  const last = lastWarnAt.get(key) ?? 0;
  if (now - last < WARN_RATE_LIMIT_MS) {
    return false;
  }
  lastWarnAt.set(key, now);
  const suffix = info.replacedBy ? `, use ${info.replacedBy} instead` : '';
  const note = info.note ? ` — ${info.note}` : '';
  logger.warn(`${kind} "${name}" is deprecated until ${info.until}${suffix}${note}`);
  return true;
}

/**
 * Standard §17.2 — at registration, error on past-due deprecations so the operator notices
 * a missed migration window before the entry is exposed to clients.
 */
export function assertDeprecationConsistency(
  kind: 'tool' | 'prompt' | 'resource',
  name: string,
  info: IDeprecationInfo | undefined,
): void {
  if (!info) {
    return;
  }
  const untilDate = new Date(`${info.until}T23:59:59Z`);
  if (Number.isNaN(untilDate.getTime())) {
    logger.error(`${kind} "${name}" deprecation.until is not a valid ISO date: ${info.until}`);
    return;
  }
  if (untilDate.getTime() < Date.now()) {
    logger.error(
      `${kind} "${name}" deprecation.until=${info.until} has lapsed — remove the entry per public contract §17.2`,
    );
  }
}

/**
 * Extract the deprecation block from a tool / prompt / resource definition. Tools store the
 * block in `_meta.deprecated` (standard `_meta` extension path); prompts and resources may use
 * a top-level `deprecated` field.
 */
export function readDeprecation(target: any): IDeprecationInfo | undefined {
  if (!target || typeof target !== 'object') {
    return undefined;
  }
  const direct = (target as { deprecated?: IDeprecationInfo }).deprecated;
  if (direct && typeof direct === 'object' && typeof direct.until === 'string') {
    return direct;
  }
  const fromMeta = (target as { _meta?: { deprecated?: IDeprecationInfo } })._meta?.deprecated;
  if (fromMeta && typeof fromMeta === 'object' && typeof fromMeta.until === 'string') {
    return fromMeta;
  }
  return undefined;
}

// Test-only — drop the rate-limit memory so a unit test can observe both first-call and
// follow-up behaviours within the same suite.
export function _resetDeprecationWarnState(): void {
  lastWarnAt.clear();
}
