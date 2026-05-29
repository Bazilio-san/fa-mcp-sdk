// noinspection UnnecessaryLocalVariableJS

import { getInsertSqlPg, getMergeSqlPg, IQueryPgArgs, queryPg, getPoolPg, TDBRecord, TRecordSet } from 'af-db-ts';
import { IPoolClientPg } from 'af-db-ts/src/@types/i-pg.js';
import { QueryResult, QueryResultRow } from 'pg';
import pgvector from 'pgvector/pg';

import { appConfig } from '../bootstrap/init-config.js';
import { UpstreamUnavailableError } from '../errors/specific-errors.js';
import { logger } from '../logger.js';

export interface IQueryPgArgsCOptional extends Omit<IQueryPgArgs, 'connectionId'> {
  connectionId?: string;
}

const connectionId = 'main';

/**
 * Network-level errno codes and PostgreSQL SQLSTATE classes that mean "the database is
 * unreachable" rather than "the query was bad". Class 08 = connection_exception; 57P0x =
 * server shutting down / not accepting connections; 53300 = too_many_connections.
 */
const UPSTREAM_ERRNO = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ECONNRESET', 'EPIPE']);
const UPSTREAM_SQLSTATE = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

/**
 * Map a raw driver/network error to {@link UpstreamUnavailableError} (JSON-RPC -32006 / HTTP 503)
 * when it signals an unreachable database, so downstream MCP servers get the correct retryable
 * status instead of a generic -32603 / 500. Non-connection errors (bad SQL, constraint violations)
 * pass through unchanged.
 */
export const mapDbError = (err: any): Error => {
  if (err instanceof UpstreamUnavailableError) {
    return err;
  }
  const code = err?.code != null ? String(err.code) : '';
  const msg = String(err?.message ?? '');
  const looksUnreachable =
    UPSTREAM_ERRNO.has(code) ||
    UPSTREAM_SQLSTATE.has(code) ||
    /Connection terminated|timeout exceeded when trying to connect|terminating connection|no pg_hba/i.test(msg);
  if (looksUnreachable) {
    return new UpstreamUnavailableError(`Database "${connectionId}" unavailable`, { dependency: 'postgres' });
  }
  return err instanceof Error ? err : new Error(msg || 'Unknown database error');
};

export const queryMAIN = async <R extends QueryResultRow = any>(
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<QueryResult<R> | undefined> => {
  if (typeof arg === 'string') {
    arg = { sqlText: arg, connectionId, sqlValues, throwError } as IQueryPgArgs;
  }
  arg.connectionId = connectionId;
  if (appConfig.db.postgres!.dbs[connectionId]?.usedExtensions?.includes('pgvector')) {
    arg.registerTypesFunctions = [pgvector.registerType];
  }
  try {
    const res = await queryPg<R>(arg as IQueryPgArgs);
    return res;
  } catch (err) {
    throw mapDbError(err);
  }
};

export const getMainDBConnectionStatus = async (): Promise<string> => {
  if (!appConfig.isMainDBUsed) {
    return 'db_not_used';
  }
  try {
    const pool = await getPoolPg({ connectionId, throwError: true });
    const isDbConnected = (pool._clients || []).some((client: IPoolClientPg) => client?._connected);
    return isDbConnected ? 'connected' : 'disconnected';
  } catch {
    return 'error';
  }
};

export const checkMainDB = async () => {
  try {
    // noinspection SqlResolve
    await queryMAIN('SELECT 1 FROM pg_catalog.pg_class LIMIT 1', undefined, true);
  } catch {
    // In test mode, don't exit or log errors
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    logger.error(`DB ${connectionId} not available`);
    process.exit(1);
  }
};

export const execMAIN = async (arg: string | IQueryPgArgsCOptional): Promise<number | undefined> => {
  if (typeof arg === 'string') {
    arg = { sqlText: arg, connectionId } as IQueryPgArgs;
  } else {
    arg.connectionId = connectionId;
  }
  let res;
  try {
    res = await queryPg(arg as IQueryPgArgs);
  } catch (err) {
    throw mapDbError(err);
  }
  // If a batch of SQL statements is executed, recordset is returned
  return Array.isArray(res)
    ? res.reduce((accum, item) => accum + (item?.rowCount ?? 0), 0)
    : (res?.rowCount ?? undefined);
};

export const queryRsMAIN = async <R extends QueryResultRow = any>(
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R[] | undefined> => {
  if (typeof arg === 'string') {
    arg = { sqlText: arg, connectionId, sqlValues, throwError } as IQueryPgArgs;
  } else {
    arg.connectionId = connectionId;
  }
  const res = await queryMAIN<R>(arg);
  return res?.rows;
};

export const oneRowMAIN = async <R extends QueryResultRow = any>(
  arg: string | IQueryPgArgsCOptional,
  sqlValues?: any[],
  throwError = false,
): Promise<R | undefined> => {
  if (typeof arg === 'string') {
    arg = { sqlText: arg, connectionId, sqlValues, throwError } as IQueryPgArgs;
  } else {
    arg.connectionId = connectionId;
  }
  const res = await queryMAIN<R>(arg);
  return res?.rows?.[0];
};

export const getInsertSqlMAIN = async <U extends TDBRecord = TDBRecord>(arg: {
  commonSchemaAndTable: string;
  recordset: TRecordSet<U>;
  excludeFromInsert?: string[];
  addOutputInserted?: boolean;
  isErrorOnConflict?: boolean;
  keepSerialFields?: boolean;
}): Promise<string> => getInsertSqlPg({ ...arg, connectionId });

export const getMergeSqlMAIN = async <U extends TDBRecord = TDBRecord>(arg: {
  commonSchemaAndTable: string;
  recordset: TRecordSet<U>;
  /**
   * The fields of the conflictFields array will be specified in the ON CONFLICT(<conflictFields>)
   * If conflictFields is NOT PASSED, the ON CONFLICT part will list the fields included in the Primary Key.
   */
  conflictFields?: string[];
  /**
   * omitFields: These fields will be excluded from both the INSERT part and the UPDATE part.
   * Unless the updateFields array is passed, omitFields is not affected
   */
  omitFields?: string[];
  /**
   * If an array of updateFields is specified, then these fields will participate in the DO UPDATE part
   * Subtract fields in fieldsExcludedFromUpdatePart
   * If updateFields is NOT SPECIFIED, then all the fields will be present in the UPDATE part,
   * minus auto-incremental, RO, omitFields and fieldsExcludedFromUpdatePart
   */
  updateFields?: string[];
  fieldsExcludedFromUpdatePart?: string[];
  noUpdateIfNull?: boolean;
  mergeCorrection?: (_sql: string) => string;
  returning?: string; // '*' | ' "anyFieldName1", "anyFieldName2"'
}): Promise<string> => getMergeSqlPg({ ...arg, connectionId });

export const mergeByBatch = async <U extends TDBRecord = TDBRecord>(arg: {
  recordset: TRecordSet<U>;
  getMergeSqlFn: Function;
  batchSize?: number;
}) => {
  const { recordset, getMergeSqlFn, batchSize = 999 } = arg;
  const results: any[] = [];
  while (recordset.length) {
    const batch = recordset.splice(0, batchSize);
    const mergeSql = (await getMergeSqlFn(batch)) as string;
    const result = await queryMAIN(mergeSql);
    results.push(result);
  }
  return results;
};
