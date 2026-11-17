import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../src/store/db.js';

/**
 * 브라우저 안에서 도는 PostgreSQL(PGlite). 이 브라우저의 IndexedDB에 저장해 새로고침해도 상태가 남는다.
 * IndexedDB를 쓸 수 없으면(비공개 창 등) 메모리로 대신하고 그 사실을 알려 준다.
 */
export async function openBrowserDb(name: string): Promise<{ db: Db; persistent: boolean }> {
  let lite: PGlite;
  let persistent = true;
  try {
    lite = new PGlite(`idb://${name}`);
    await lite.waitReady;
  } catch {
    lite = new PGlite();
    await lite.waitReady;
    persistent = false;
  }
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) { return (await lite.query(sql, params)).rows as T[]; },
    async exec(sql: string) { await lite.exec(sql); },
    close: () => lite.close(),
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
  return { db, persistent };
}
