import type { Pool } from 'pg';

/** PostgreSQL 호환 최소 인터페이스. 운영은 pg, 로컬·테스트는 PGlite(메모리). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function openDb(env: { DATABASE_URL?: string; NODE_ENV?: string }): Promise<Db> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool: Pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    return {
      async query<T>(sql: string, params: unknown[] = []) { return (await pool.query(sql, params)).rows as T[]; },
      async exec(sql: string) { await pool.query(sql); },
      close: () => pool.end(),
    };
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL이 없습니다: 운영에서는 메모리 DB로 동작하지 않습니다');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite();
  await lite.waitReady;
  return {
    async query<T>(sql: string, params: unknown[] = []) { return (await lite.query(sql, params)).rows as T[]; },
    async exec(sql: string) { await lite.exec(sql); },
    close: () => lite.close(),
  };
}
