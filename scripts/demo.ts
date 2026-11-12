/**
 * 시연 3건 재현. 사용: npm run demo -- normal|change|shortage|all
 * 로컬 메모리 DB(PGlite)에서 실행하며 시나리오마다 처음부터 초기화한다. 원본 데이터룸은 읽기만 한다.
 * DATABASE_URL이 있으면 그 DB를 초기화하므로 운영 DB에는 쓰지 마세요.
 */
import { runScenario, type ScenarioName } from '../src/app/demo.js';
import { IntakeService } from '../src/app/service.js';
import { loadDataRoom } from '../src/engine/dataRoom.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

const NAMES: ScenarioName[] = ['normal', 'change', 'shortage'];
const arg = process.argv[2] ?? 'all';
const todo = arg === 'all' ? NAMES : NAMES.filter((n) => n === arg);
if (todo.length === 0) {
  console.error(`알 수 없는 시나리오: ${arg}. 사용 가능: ${NAMES.join(', ')}, all`);
  process.exit(2);
}

const { DATABASE_URL } = process.env;
if (DATABASE_URL) console.warn('경고: DATABASE_URL이 설정되어 있어 해당 DB를 초기화합니다.');
const db = await openDb({ DATABASE_URL, NODE_ENV: 'development' });
const svc = new IntakeService({ repo: new Repo(db), room: loadDataRoom() });
await svc.reset();
for (const n of todo) {
  const rep = await runScenario(svc, n);
  console.log(`\n=== ${n} ===`);
  rep.lines.forEach((l) => console.log(`- ${l}`));
  console.log('확인 값:', JSON.stringify(rep.facts, null, 2));
}
await db.close();
