import { IntakeService } from '../../src/app/service.js';
import { draftInfoRequest, summarizeForApproval } from '../../src/ai/assist.js';
import { createProvider, type AiProvider } from '../../src/ai/provider.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function detail(id = 'CONTRACT-INF-001') {
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  await svc.reset();
  return svc.getCase(id);
}
const fake = (text: string): AiProvider => ({ complete: async () => text });
const GOOD = '{{건}}은(는) 요청액이 {{요청액}}이고 {{승인경로}} 대상입니다. 근거는 {{근거}}입니다. 결정 기한은 {{결정기한}}입니다. {{성과}}. {{빠진정보}}.';

test('R1: the review repro — nominal ROAS passed off as real, and "everything confirmed" — is rejected', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, fake(`과거 실질 ROAS는 ${d.row.과거명목ROAS}입니다. 지급 일정은 모두 확인됐으며 추가 확인은 필요 없습니다.`), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'verify_failed' });
  expect(r.text).not.toContain('모두 확인');
  expect(r.text).toContain('빠진 정보'); // 서버가 조립한 기본 문장은 빠진 정보를 그대로 말한다
});

test('R1: numbers written by the AI are never accepted, even when they equal engine values', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, fake(`${GOOD} 실질 ROAS는 -0.2입니다.`), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'verify_failed' });
  expect(r.unmatched!.join(' ')).toContain('-0.2');
});

test('R1: reassuring or deciding phrases are rejected even without any number', async () => {
  const d = await detail();
  for (const bad of ['지급 일정은 모두 확인되었습니다.', '추가 확인이 필요 없습니다.', '문제 없으니 승인하시기 바랍니다.', '승인을 권합니다.', '확인이 완료되었습니다.']) {
    const r = await summarizeForApproval(d, fake(`${GOOD} ${bad}`), { requested: true });
    expect(r, bad).toMatchObject({ source: 'fallback', error: 'verify_failed' });
  }
});

test('R1: every required fact slot must be present and unknown slots are refused', async () => {
  const d = await detail();
  const noMissing = await summarizeForApproval(d, fake('{{건}} {{요청액}} {{승인경로}} {{근거}} {{결정기한}} {{성과}}'), { requested: true });
  expect(noMissing).toMatchObject({ source: 'fallback', error: 'verify_failed' });
  expect(noMissing.unmatched!.join(' ')).toContain('빠진정보');
  const unknown = await summarizeForApproval(d, fake(`${GOOD} {{마음대로}}`), { requested: true });
  expect(unknown).toMatchObject({ source: 'fallback', error: 'verify_failed' });
});

test('R1: a good AI sentence is assembled by the server — facts come from the server, not the model', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, fake(GOOD), { requested: true });
  expect(r).toMatchObject({ source: 'ai', note: '' });
  expect(r.error).toBeUndefined();
  expect(r.text).toContain('280,000만 원');
  expect(r.text).toContain('CEO/이사회');
  expect(r.text).toContain('2026-07-17');
  expect(r.text).toContain('실질 ROAS -0.2');
  expect(r.text).toContain('돈이 나가는 날'); // 빠진 정보가 서버 사실로 고정되어 들어간다
  expect(r.text).not.toContain('{{');
});

test('R1: a plan with nothing missing says so from the server fact', async () => {
  const d = await detail('PLAN-019');
  const r = await summarizeForApproval(d, fake(GOOD), { requested: true });
  expect(r.source).toBe('ai');
  expect(r.text).toContain('빠진 정보 없음');
});

test('R1: the info-request draft uses the same slot rule', async () => {
  const d = await detail();
  const ok = await draftInfoRequest('cash_outflow_date', d, fake('{{건}}에 대해 {{항목}}을(를) {{담당}}에서 확인해 주십시오. {{기한}}. {{이유}}'), { requested: true });
  expect(ok.source).toBe('ai');
  expect(ok.text).toContain('현금 유출일');
  const bad = await draftInfoRequest('cash_outflow_date', d, fake('{{건}} {{항목}} {{담당}} {{기한}} {{이유}} 모두 확인됨'), { requested: true });
  expect(bad).toMatchObject({ source: 'fallback', error: 'verify_failed' });
  const digits = await draftInfoRequest('cash_outflow_date', d, fake('{{건}} {{항목}} {{담당}} {{기한}} {{이유}} 7월 30일까지'), { requested: true });
  expect(digits).toMatchObject({ source: 'fallback', error: 'verify_failed' });
});

test('R1: one overall time limit covers all model retries', async () => {
  // 첫 모델은 250ms 뒤 503, 두 번째 모델은 응답하지 않는다: 전체 한도(400ms)에서 끊겨야 한다
  let n = 0;
  const f = (async (_url: string, init: RequestInit) => {
    n += 1;
    if (n === 1) { await new Promise((r) => setTimeout(r, 250)); return new Response('{}', { status: 503 }); }
    return new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    });
  }) as unknown as typeof fetch;
  const p = createProvider({ GEMINI_API_KEY: 'k' }, f, ['gemini'], { totalMs: 400 })!;
  const t0 = Date.now();
  await expect(p.complete('hi')).rejects.toMatchObject({ code: 'timeout' });
  const took = Date.now() - t0;
  expect(took).toBeGreaterThanOrEqual(350);
  expect(took).toBeLessThan(900);
  expect(n).toBe(2);
});

test('R1: the default total limit fits the "up to 30 seconds" message on the screen', async () => {
  const { GEMINI_TOTAL_MS } = await import('../../src/ai/provider.js');
  expect(GEMINI_TOTAL_MS).toBeLessThanOrEqual(30_000);
  expect(GEMINI_TOTAL_MS).toBeGreaterThanOrEqual(20_000);
});
