/**
 * 브라우저용 AsyncLocalStorage 대체물.
 * 서비스의 모든 호출은 runtime.tsx에서 한 줄로 세워 실행하므로(서로 겹치지 않음) 전역 값 하나로 충분하다.
 */
export class AsyncLocalStorage<T> {
  private current: T | undefined;
  getStore(): T | undefined { return this.current; }
  run<R>(store: T, fn: () => R): R {
    const prev = this.current;
    this.current = store;
    let out: R;
    try { out = fn(); } catch (e) { this.current = prev; throw e; }
    if (out instanceof Promise) return out.finally(() => { this.current = prev; }) as R;
    this.current = prev;
    return out;
  }
}
