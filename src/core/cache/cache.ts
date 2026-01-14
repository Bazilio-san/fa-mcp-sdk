// noinspection ES6PreferShortImport

/**
 * Caching system for API responses and computed data
 */

import NodeCache from 'node-cache';
import { logger as lgr } from '../logger.js';

import chalk from 'chalk';
import { addErrorMessage, toError } from '../errors/errors.js';
import { appConfig } from '../bootstrap/init-config.js';

const logger = lgr.getSubLogger({ name: chalk.green('cache') });

const DEFAULT_TTL_SECONDS = appConfig.cache.ttlSeconds || 300;
const DEFAULT_MAX_ITEMS = appConfig.cache.maxItems || 1000;
const DEFAULT_CHECK_PERIOD = 120;

interface CacheManagerConstructorOptions {
  ttlSeconds?: number;
  maxItems?: number;
  checkPeriod?: number;
  verbose?: boolean;
}

/**
 * Enhanced cache manager with TTL support and statistics
 */
export class CacheManager {
  private cache: NodeCache;
  private defaultTtl: number;
  private verbose: boolean;
  private stats: {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
  };

  constructor (options?: CacheManagerConstructorOptions) {
    const {
      ttlSeconds = DEFAULT_TTL_SECONDS,
      maxItems = DEFAULT_MAX_ITEMS,
      checkPeriod = DEFAULT_CHECK_PERIOD,
      verbose = false,
    } = options || {};

    this.defaultTtl = ttlSeconds;
    this.verbose = verbose;
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      maxKeys: maxItems,
      checkperiod: checkPeriod,
      useClones: false, // For better performance
      deleteOnExpire: true,
    });

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    };

    // Set up event listeners
    this.setupEventListeners();

    logger.info(`Cache manager initialized: ttl: ${ttlSeconds} s | max items: ${maxItems} | check period: ${checkPeriod}`);
  }

  /**
   * Setup cache event listeners for monitoring
   */
  private setupEventListeners (): void {
    if (this.verbose) {
      this.cache.on('set', (key, value) => {
        logger.debug(`Cache set: key: ${key} | hasValue: ${!!value}`);
      });

      this.cache.on('del', (key, value) => {
        logger.debug(`Cache delete: key: ${key} | hasValue: ${!!value}`);
      });

      this.cache.on('expired', (key, value) => {
        logger.debug(`Cache expired: key: ${key} | hasValue: ${!!value}`);
      });

      this.cache.on('flush', () => {
        logger.debug('Cache flushed');
      });
    }
  }

  /**
   * Get value from cache
   */
  get<T> (key: string): T | undefined {
    const value = this.cache.get<T>(key);

    if (value !== undefined) {
      this.stats.hits++;
      if (this.verbose) {
        logger.debug(`Cache hit: key: ${key}`);
      }
      return value;
    } else {
      this.stats.misses++;
      if (this.verbose) {
        logger.debug(`Cache miss: key: ${key}`);
      }
      return undefined;
    }
  }

  /**
   * Set value in cache with optional TTL
   */
  set<T> (key: string, value: T, ttlSeconds?: number): boolean {
    const ttl = ttlSeconds || this.defaultTtl;
    const success = this.cache.set(key, value, ttl);

    if (success) {
      this.stats.sets++;
      if (this.verbose) {
        logger.debug(`Cache set successful: key: ${key} | ttl: ${ttl}`);
      }
    } else {
      logger.warn(`Cache set failed: key: ${key} | ttl: ${ttl}`);
    }

    return success;
  }

  /**
   * Delete value from cache
   */
  del (key: string): number {
    const deleted = this.cache.del(key);
    this.stats.deletes += deleted;
    if (this.verbose) {
      logger.debug(`Cache delete: key: ${key} | deleted: ${deleted}`);
    }
    return deleted;
  }

  /**
   * Check if key exists in cache
   */
  has (key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Get value and delete key from cache (single use)
   */
  take<T> (key: string): T | undefined {
    const value = this.cache.take<T>(key);
    if (value !== undefined) {
      this.stats.hits++;
      this.stats.deletes++;
      if (this.verbose) {
        logger.debug(`Cache take: key: ${key}`);
      }
    } else {
      this.stats.misses++;
    }
    return value;
  }

  /**
   * Get multiple values from cache
   */
  mget<T> (keys: string[]): Record<string, T> {
    try {
      const result = this.cache.mget<T>(keys);
      // Update stats for mget
      const foundKeys = Object.keys(result).length;
      this.stats.hits += foundKeys;
      this.stats.misses += keys.length - foundKeys;
      return result;
    } catch (error) {
      logger.error(`Cache mget error: keys: ${JSON.stringify(keys)}`, toError(error));
      this.stats.misses += keys.length;
      return {};
    }
  }

  /**
   * Set multiple values in cache
   */
  mset<T> (obj: Array<{ key: string; val: T; ttl?: number }>): boolean {
    try {
      const success = this.cache.mset(obj);
      if (success) {
        this.stats.sets += obj.length;
      }
      return success;
    } catch (error) {
      logger.error('Cache mset error', toError(error));
      return false;
    }
  }

  /**
   * Get or set pattern - execute function if key doesn't exist
   */
  async getOrSet<T> (key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    // Try to get from cache first (outside try-catch to separate cache errors from factory errors)
    try {
      const cached = this.get<T>(key);
      if (cached !== undefined) {
        return cached;
      }
    } catch (error) {
      // Cache read error - log but continue to factory
      logger.error(`Cache get error during getOrSet: key: ${key}`, toError(error));
    }

    // Execute factory function
    logger.debug(`Cache miss - executing factory function: key: ${key}`);
    let value: T;

    try {
      value = await factory();
    } catch (error) {
      addErrorMessage(error, `Factory function error in getOrSet: key: ${key}`);
      throw error;
    }

    // Store result in cache (errors here are non-critical)
    try {
      this.set(key, value, ttlSeconds);
    } catch (error) {
      // Cache write error - log but return value anyway
      logger.error(`Cache set error during getOrSet: key: ${key}`, toError(error));
    }

    return value;
  }

  /**
   * Get cache statistics
   */
  getStats () {
    const cacheStats = this.cache.getStats();

    return {
      ...this.stats,
      keys: cacheStats.keys,
      ksize: cacheStats.ksize,
      vsize: cacheStats.vsize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  /**
   * Get all keys in cache
   */
  keys (): string[] {
    return this.cache.keys();
  }

  /**
   * Clear all cache entries
   */
  flush (): void {
    this.cache.flushAll();
    this.resetStats();
    logger.info('Cache flushed');
  }

  /**
   * Reset cache statistics
   */
  private resetStats (): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    };
  }

  /**
   * Get cache entries with metadata
   */
  getEntries<T> (): Array<{ key: string; value: T; ttl: number }> {
    const keys = this.cache.keys();
    const entries: Array<{ key: string; value: T; ttl: number }> = [];

    for (const key of keys) {
      const value = this.cache.get<T>(key);
      const ttl = this.cache.getTtl(key);

      if (value !== undefined) {
        entries.push({
          key,
          value,
          ttl: ttl ? (ttl - Date.now()) / 1000 : 0,
        });
      }
    }

    return entries;
  }

  /**
   * Set TTL for existing key (wrapper for native ttl method)
   */
  ttl (key: string, ttlSeconds: number): boolean {
    return this.cache.ttl(key, ttlSeconds);
  }

  /**
   * Get TTL for key (wrapper for native getTtl method)
   */
  getTtl (key: string): number | undefined {
    const ttl = this.cache.getTtl(key);
    return ttl ? Math.floor((ttl - Date.now()) / 1000) : (ttl === 0 ? 0 : undefined);
  }


  /**
   * Close cache and cleanup resources
   */
  close (): void {
    this.cache.close();
    logger.info('Cache manager closed');
  }
}

/**
 * Global cache instance
 */
let globalCache: CacheManager | null = null;

/**
 * Get or create global cache instance
 */
export function getCache (options?: CacheManagerConstructorOptions): CacheManager {
  if (!globalCache) {
    globalCache = new CacheManager(options);
  }
  return globalCache;
}
