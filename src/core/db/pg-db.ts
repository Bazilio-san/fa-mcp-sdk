// noinspection UnnecessaryLocalVariableJS

import { getInsertSqlPg, getMergeSqlPg, IQueryPgArgs, queryPg, getPoolPg, TDBRecord, TRecordSet } from 'af-db-ts';
import { IPoolClientPg } from 'af-db-ts/src/@types/i-pg.js';
import { QueryResult, QueryResultRow } from 'pg';
import pgvector from 'pgvector/pg';

import { appConfig } from '../bootstrap/init-config.js';
import { logger } from '../logger.js';

export interface IQueryPgArgsCOptional extends Omit<IQueryPgArgs, 'connectionId'> {
  connectionId?: string
}

const connectionId = 'main';

export const queryMAIN = async <R extends QueryResultRow = any> (
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
  const res = await queryPg<R>(arg as IQueryPgArgs);
  return res;
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

export const execMAIN = async (
  arg: string | IQueryPgArgsCOptional,
): Promise<number | undefined> => {
  if (typeof arg === 'string') {
    arg = { sqlText: arg, connectionId } as IQueryPgArgs;
  } else {
    arg.connectionId = connectionId;
  }
  const res = await queryPg(arg as IQueryPgArgs);
  // If a batch of SQL statements is executed, recordset is returned
  return Array.isArray(res) ? res.reduce((accum, item) => accum + (item?.rowCount ?? 0), 0) : res?.rowCount ?? undefined;
};

export const queryRsMAIN = async <R extends QueryResultRow = any> (
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

export const oneRowMAIN = async <R extends QueryResultRow = any> (
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

export const getInsertSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  excludeFromInsert?: string[],
  addOutputInserted?: boolean,
  isErrorOnConflict?: boolean,
  keepSerialFields?: boolean,
}): Promise<string> => getInsertSqlPg({ ...arg, connectionId });

export const getMergeSqlMAIN = async <U extends TDBRecord = TDBRecord> (arg: {
  commonSchemaAndTable: string,
  recordset: TRecordSet<U>,
  /**
   * The fields of the conflictFields array will be specified in the ON CONFLICT(<conflictFields>)
   * If conflictFields is NOT PASSED, the ON CONFLICT part will list the fields included in the Primary Key.
   */
  conflictFields?: string[],
  /**
   * omitFields: These fields will be excluded from both the INSERT part and the UPDATE part.
   * Unless the updateFields array is passed, omitFields is not affected
   */
  omitFields?: string[],
  /**
   * If an array of updateFields is specified, then these fields will participate in the DO UPDATE part
   * Subtract fields in fieldsExcludedFromUpdatePart
   * If updateFields is NOT SPECIFIED, then all the fields will be present in the UPDATE part,
   * minus auto-incremental, RO, omitFields and fieldsExcludedFromUpdatePart
   */
  updateFields?: string[],
  fieldsExcludedFromUpdatePart?: string[],
  noUpdateIfNull?: boolean,
  mergeCorrection?: (_sql: string) => string,
  returning?: string, // '*' | ' "anyFieldName1", "anyFieldName2"'
}): Promise<string> => getMergeSqlPg({ ...arg, connectionId });

export const mergeByBatch = async <U extends TDBRecord = TDBRecord> (arg: {
  recordset: TRecordSet<U>,
  getMergeSqlFn: Function
  batchSize?: number
}) => {
  const {
    recordset,
    getMergeSqlFn,
    batchSize = 999,
  } = arg;
  const results: any[] = [];
  while (recordset.length) {
    const batch = recordset.splice(0, batchSize);
    const mergeSql = await getMergeSqlFn(batch) as string;
    const result = await queryMAIN(mergeSql);
    results.push(result);
  }
  return results;
};
