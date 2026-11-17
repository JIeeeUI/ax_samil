'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { IntakeService } from '../../src/app/service.js';
import { Repo } from '../../src/store/repo.js';
import { installSnapshot, type DemoSnapshot } from '../../src/demo/snapshot.js';
import { isRole, type Role } from '../../src/workflow/roles.js';
import { openBrowserDb } from './browserDb.js';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** 스냅샷이 바뀌면 이전 브라우저 저장 상태와 섞이지 않도록 이름을 바꾼다. */
const DB_NAME = 'ax-samil-demo-v1';

// ---------- 서비스 ----------
let booting: Promise<IntakeService> | null = null;
let chain: Promise<unknown> = Promise.resolve();
export const storage = { persistent: true };

/** 모든 서비스 호출을 한 줄로 세워 실행한다(브라우저에는 호출별 컨텍스트가 없어 서로 겹치면 안 된다). */
function serialize(svc: IntakeService): IntakeService {
  return new Proxy(svc, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const run = () => (v as (...a: unknown[]) => unknown).apply(target, args);
        const next = chain.then(run, run);
        chain = next.catch(() => undefined);
        return next;
      };
    },
  });
}

export function getService(): Promise<IntakeService> {
  booting ??= (async () => {
    const res = await fetch(`${BASE}/snapshot.json`);
    if (!res.ok) throw new Error(`계산 결과 파일을 불러오지 못했습니다(${res.status})`);
    const room = installSnapshot((await res.json()) as DemoSnapshot);
    const { db, persistent } = await openBrowserDb(DB_NAME);
    storage.persistent = persistent;
    const repo = new Repo(db);
    await repo.migrate();
    const svc = new IntakeService({ repo, room });
    await svc.ensureInitialized();
    return serialize(svc);
  })().catch((e) => { booting = null; throw e; });
  return booting;
}

// ---------- 화면 갱신 ----------
let version = 0;
const listeners = new Set<() => void>();
export function bump(): void { version += 1; listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** 서비스에서 값을 읽는다. 처리(액션)가 끝날 때마다 다시 읽는다. */
export function useLoad<T>(load: (svc: IntakeService) => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null } {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    getService().then(load).then(
      (data) => { if (alive) setState({ data, error: null }); },
      (e: unknown) => { if (alive) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e) })); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps]);
  return state;
}

// ---------- 보는 사람(역할) ----------
const ROLE_KEY = 'ax-samil-demo-role';
const roleListeners = new Set<() => void>();
export function getRole(): Role {
  try {
    const v = window.localStorage.getItem(ROLE_KEY);
    return isRole(v) ? v : 'marketing';
  } catch { return 'marketing'; }
}
export function setRoleValue(r: Role): void {
  try { window.localStorage.setItem(ROLE_KEY, r); } catch { /* 저장을 못 해도 이번 화면에서는 바뀐다 */ }
  roleListeners.forEach((l) => l());
  bump();
}
export function useRole(): Role {
  return useSyncExternalStore((l) => { roleListeners.add(l); return () => { roleListeners.delete(l); }; }, getRole, () => 'marketing' as Role);
}

// ---------- 이동 ----------
let navigator: ((href: string) => void) | null = null;
export function navigate(href: string): void { (navigator ?? ((h) => { window.location.assign(`${BASE}${h}`); }))(href); }

/** 화면 맨 위에서 한 번 두어 액션이 이동할 수 있게 한다. */
export function NavigatorBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  useEffect(() => { navigator = (h) => router.push(h); return () => { navigator = null; }; }, [router]);
  return <>{children}</>;
}

/** 주소의 ?이름=값 (서버 화면의 searchParams 대신) */
export function useQuery(): Record<string, string | undefined> {
  const sp = useSearchParams();
  return Object.fromEntries(sp.entries());
}

export function Loading({ error }: { error: string | null }) {
  if (error) return <p className="flash flash-error" role="alert">불러오지 못했습니다: {error}</p>;
  return <p className="meta" role="status" aria-live="polite">불러오는 중입니다…</p>;
}
