import { loadDataRoom } from '../engine/dataRoom.js';
import { openDb } from '../store/db.js';
import { Repo } from '../store/repo.js';
import { IntakeService } from './service.js';

const g = globalThis as unknown as { __intakeService?: Promise<IntakeService> };

/** 서버 프로세스당 하나의 서비스(개발 중 HMR로 중복 생성되지 않게 globalThis에 둔다). */
export function getService(): Promise<IntakeService> {
  g.__intakeService ??= (async () => {
    const repo = new Repo(await openDb(process.env));
    await repo.migrate();
    const svc = new IntakeService({ repo, room: loadDataRoom() });
    await svc.ensureInitialized();
    return svc;
  })().catch((e) => {
    g.__intakeService = undefined; // 실패를 캐시하지 않는다(다음 요청에서 다시 시도)
    throw e;
  });
  return g.__intakeService;
}
