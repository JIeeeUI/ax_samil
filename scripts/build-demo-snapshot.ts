/**
 * 정적 시연판용 계산 결과 스냅샷을 만든다. 대회 원본 데이터(DATA_DIR)를 읽어 계산하고,
 * 원본 행이 아닌 결과만 demo/public/snapshot.json에 쓴다.
 * 사용: npm run demo:snapshot
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildSnapshot } from '../src/demo/snapshot.js';
import { loadDataRoom } from '../src/engine/dataRoom.js';

const out = 'demo/public/snapshot.json';
const snap = buildSnapshot(loadDataRoom());
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap), 'utf8');
console.log(`${out}: 성과 ${Object.keys(snap.campaigns).length}종, 현금 ${Object.keys(snap.cash).length}종, 기안 ${snap.room.budgetPlan.length}건`);
