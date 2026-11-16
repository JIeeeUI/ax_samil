/**
 * 2026-11-16-repro.mts의 수정 후 확인판. 같은 5건을 다시 시도하고, 이제 거부·롤백되는지 PASS/FAIL로 출력한다.
 * 실행: 앱 루트에서 `env -u DATABASE_URL npx tsx docs/reviews/2026-11-16-repro-after.mts` (메모리 DB만 사용, 외부 AI 호출 없음)
 */
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { IntakeService } from '../../src/app/service.js';
import { openDb, type Db } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { summarizeForApproval } from '../../src/ai/assist.js';

const base = await openDb({});
// 이력(events) 저장이 실패하도록 주입할 수 있는 Db 감싸개(트랜잭션 안의 문장도 감싼다)
const inject = { failEvents: false };
const wrap = (x: Db): Db => ({
  async query<T>(sql: string, params?: unknown[]) {
    if (inject.failEvents && /^s*insert into events/i.test(sql)) throw new Error('REVIEW_SIMULATED_EVENT_WRITE_FAILURE');
    return x.query<T>(sql, params);
  },
  exec: (sql) => x.exec(sql), close: () => x.close(), transaction: (fn) => x.transaction((tx) => fn(wrap(tx))),
});
const db = wrap(base); const repo = new Repo(db); await repo.migrate();
const svc = new IntakeService({ repo, room: loadDataRoom() }); await svc.reset();
const show = (name: string, ok: boolean, detail: unknown) => console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);

// 1) AI_SEMANTIC
const d = await svc.getCase('CONTRACT-INF-001');
const ai = await summarizeForApproval(d, { name: 'gemini', complete: async () => `과거 실질 ROAS는 ${d.row.과거명목ROAS}입니다. 지급 일정은 모두 확인됐으며 추가 확인은 필요 없습니다.` }, { requested: true });
show('AI_SEMANTIC', ai.source === 'fallback' && ai.error === 'verify_failed' && ai.text.includes('빠진 정보'), { source: ai.source, error: ai.error, note: ai.note });

// 2) INVALID_DATE
await svc.confirmFinance('CONTRACT-INF-001', 'finance'); await svc.submit('CONTRACT-INF-001', 'marketing');
let dateErr = ''; try { await svc.decide('CONTRACT-INF-001', 'ceo_board', { hold: { needed: '추가 검토', ownerRole: 'finance', dueDate: '2026-99-99' } }); } catch (e) { dateErr = String(e); }
const saved = (await repo.listInfoRequests({ caseId: 'CONTRACT-INF-001' })).some((q) => q.dueDate === '2026-99-99');
show('INVALID_DATE', dateErr.includes('HOLD_REQUIRES') && !saved, { error: dateErr, saved });

// 3) EMPTY_RESOLVED
await svc.reset(); await svc.confirmFinance('CONTRACT-INF-001', 'finance');
const req = (await repo.listInfoRequests({ caseId: 'CONTRACT-INF-001', status: 'requested' }))[0];
let replyErr = ''; try { await svc.replyInfoRequest(req.id, { actor: 'finance', text: '', resolved: true, simulated: true }); } catch (e) { replyErr = String(e); }
show('EMPTY_RESOLVED', replyErr.includes('INVALID_REPLY') && (await repo.getInfoRequest(req.id))!.status === 'requested', { error: replyErr });

// 4) NEAR_DEADLINE
await svc.reset(); const list = await svc.listToday(); const p = list.items.find((x) => x.kind === 'plan' && x.daysLeft > 5)!;
await svc.advanceClock(new Date(Date.parse(p.effectiveDeadline + 'T00:00:00Z') - 4 * 86400000).toISOString().slice(0, 10));
const rs = (await svc.getCase(p.id)).returnState;
let opErr = ''; try { await svc.confirmFinance(p.id, 'finance'); } catch (e) { opErr = String(e); }
show('NEAR_DEADLINE', rs.opinionRequired === true && opErr.includes('OPINION_REQUIRED'), { opinionRequired: rs.opinionRequired, notice: rs.opinionNotice, error: opErr });

// 5) PARTIAL_FAILURE
await svc.reset();
inject.failEvents = true;
let partErr = ''; try { await svc.confirmFinance('PLAN-001', 'finance'); } catch (e) { partErr = String(e); }
inject.failEvents = false;
const st = await repo.getState('PLAN-001'); const ev = (await repo.listEvents('PLAN-001')).map((e) => e.action);
show('PARTIAL_FAILURE', partErr.includes('REVIEW_SIMULATED') && st!.status === 'finance_review' && !ev.includes('confirm_finance'), { error: partErr, status: st!.status, events: ev });
await svc.confirmFinance('PLAN-001', 'finance'); // 재시도 성공
show('PARTIAL_FAILURE_RETRY', (await repo.getState('PLAN-001'))!.status === 'routed' && (await repo.listEvents('PLAN-001')).some((e) => e.action === 'confirm_finance'), {});
await base.close();
