// MySQL connection pool. Cached on `global` so warm serverless invocations
// reuse the same pool instead of opening a fresh connection every call
// (which would quickly exhaust your MySQL server's max_connections under
// concurrent Vercel invocations). Each query still checks out/returns a
// single connection from the pool, same effective behavior as the
// original db.py's per-call `get_conn()` context manager.

import mysql from 'mysql2/promise';
import { config } from './config';

declare global {
  // eslint-disable-next-line no-var
  var _mysqlPool: mysql.Pool | undefined;
}

export function getPool(): mysql.Pool {
  if (!global._mysqlPool) {
    global._mysqlPool = mysql.createPool({
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: config.mysqlUser,
      password: config.mysqlPassword,
      database: config.mysqlDatabase,
      waitForConnections: true,
      connectionLimit: 5, // keep modest — many serverless instances may run concurrently
      queueLimit: 0,
      dateStrings: true, // return DATE/DATETIME as strings, e.g. "2026-08-10"
    });
  }
  return global._mysqlPool;
}
