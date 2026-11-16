import type { Pool } from 'pg';

/** PostgreSQL 호환 최소 인터페이스. 운영은 pg, 로컬·테스트는 PGlite(메모리). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /**
   * 한 트랜잭션으로 묶어 실행한다. fn이 예외를 던지면 안에서 한 모든 쓰기를 되돌리고 예외를 다시 던진다.
   * fn에 넘어오는 Db는 같은 연결(같은 트랜잭션)이다. 이미 트랜잭션 안이면 바깥 트랜잭션에 합류한다.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export async function openDb(env: { DATABASE_URL?: string; NODE_ENV?: string }): Promise<Db> {
  if (env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool: Pool = new pg.Pool({ connectionString: env.DATABASE_URL });
    return {
      async query<T>(sql: string, params: unknown[] = []) { return (await pool.query(sql, params)).rows as T[]; },
      async exec(sql: string) { await pool.query(sql); },
      close: () => pool.end(),
      async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
        // 같은 연결(클라이언트)에서 BEGIN/COMMIT. 풀에서 문장마다 다른 연결을 쓰면 트랜잭션이 아니다.
        const client = await pool.connect();
        const tx: Db = {
          async query<T2>(sql: string, params: unknown[] = []) { return (await client.query(sql, params)).rows as T2[]; },
          async exec(sql: string) { await client.query(sql); },
          close: async () => {},
          transaction: (inner) => inner(tx),
        };
        try {
          await client.query('begin');
          const out = await fn(tx);
          await client.query('commit');
          return out;
        } catch (e) {
          try { await client.query('rollback'); } catch { /* 연결이 이미 끊긴 경우 */ }
          throw e;
        } finally {
          client.release();
        }
      },
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
    // PGlite는 연결이 하나라 트랜잭션이 끝날 때까지 다른 문장은 기다린다(동시 처리가 자연스럽게 순서대로 된다).
    transaction: <T>(fn: (tx: Db) => Promise<T>): Promise<T> => lite.transaction(async (raw) => {
      const tx: Db = {
        async query<T2>(sql: string, params: unknown[] = []) { return (await raw.query(sql, params)).rows as T2[]; },
        async exec(sql: string) { await raw.exec(sql); },
        close: async () => {},
        transaction: (inner) => inner(tx),
      };
      return fn(tx);
    }),
  };
}
