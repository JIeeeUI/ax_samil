/**
 * 제안 접수표 CSV 생성.
 * 사용: npm run intake -- --scenario <baseline|arOverdueExcluded|apOverdueExcluded|bothOverdueExcluded|lc45> --today 2026-07-01 --out outputs/intake_baseline.csv
 * 원본 데이터룸은 읽기만 하고, 결과는 --out 경로에만 쓴다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { SCENARIOS, type ScenarioId } from '../src/engine/assumptions.js';
import { loadDataRoom } from '../src/engine/dataRoom.js';
import { buildIntake, toCsv } from '../src/engine/intake.js';

const { values } = parseArgs({
  options: { scenario: { type: 'string', default: 'baseline' }, today: { type: 'string' }, out: { type: 'string' } },
});

const id = values.scenario as ScenarioId;
const a = SCENARIOS[id];
if (!a) {
  console.error(`알 수 없는 시나리오: ${id}. 사용 가능: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(2);
}
const today = values.today ?? a.asOf;
const out = values.out ?? `outputs/intake_${id}.csv`;

const rows = buildIntake(loadDataRoom(), a, today);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toCsv(rows), 'utf8');
console.log(`${out}: ${rows.length}건 (시나리오 ${id}, 업무 기준일 ${today})`);
