/**
 * 브라우저에는 없는 Node 전용 모듈(node:fs, node:module 등)의 빈 대체물.
 * PGlite는 Node에서 실행될 때만 이 모듈들을 쓰고, 브라우저에서는 이 경로를 타지 않는다.
 */
const unavailable = (name: string) => () => { throw new Error(`브라우저에서는 ${name}을(를) 쓸 수 없습니다`); };

export const createRequire = unavailable('node:module');
const stub = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : unavailable(String(p))) });
export default stub;
