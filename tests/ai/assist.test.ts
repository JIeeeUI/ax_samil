import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { IntakeService } from '../../src/app/service.js';
import { createProvider, type AiProvider } from '../../src/ai/provider.js';
import { buildFacts, draftInfoRequest, structureReply, summarizeForApproval } from '../../src/ai/assist.js';
import { verifyFacts } from '../../src/ai/verify.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function detail(id = 'CONTRACT-INF-001') {
  const repo = new Repo(await openDb({}));
  const svc = new IntakeService({ repo, room: loadDataRoom() });
  await svc.reset();
  return svc.getCase(id);
}
const fake = (text: string | Error): AiProvider => ({ complete: async () => { if (text instanceof Error) throw text; return text; } });

test('without a provider the template is used and flagged AI 미사용', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, null);
  expect(r).toMatchObject({ source: 'template', note: 'AI 미사용' });
  expect(r.text).toContain('CEO/이사회');
  expect(verifyFacts(r.text, buildFacts(d)).ok).toBe(true); // 템플릿은 항상 자기 사실과 일치
});

test('an AI sentence with an invented number is not used', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, fake('고정 피는 99억 원이며 승인을 권고합니다.'));
  expect(r.source).toBe('template');
  expect(r.note).toBe('AI 문장 숫자 불일치: 미반영');
});

test('a throwing provider falls back to the template', async () => {
  const r = await summarizeForApproval(await detail(), fake(new Error('timeout')));
  expect(r).toMatchObject({ source: 'template' });
  expect(r.note).toContain('AI 호출 실패');
});

test('a faithful AI sentence is used', async () => {
  const d = await detail();
  const r = await summarizeForApproval(d, fake('전속계약 연 2,800,000,000원은 10억 원을 넘어 CEO/이사회 상신 대상입니다.'));
  expect(r).toMatchObject({ source: 'ai', note: '' });
});

test('info request draft falls back to a template naming role and item', async () => {
  const r = await draftInfoRequest('cash_outflow_date', await detail(), null);
  expect(r.source).toBe('template');
  expect(r.text).toContain('현금 유출일');
});

test('structureReply extracts candidates and grounds AI output in the reply text', async () => {
  expect((await structureReply('지급일은 2026-08-10입니다', null)).candidates).toEqual({ cashOutflowDate: '2026-08-10' });
  expect((await structureReply('아직 미정입니다', null)).candidates).toEqual({});
  const ok = await structureReply('지급일은 2026-08-10입니다', fake('{"cashOutflowDate":"2026-08-10"}'));
  expect(ok).toMatchObject({ source: 'ai', candidates: { cashOutflowDate: '2026-08-10' } });
  const bad = await structureReply('지급일은 2026-08-10입니다', fake('{"cashOutflowDate":"2026-09-09"}'));
  expect(bad.source).toBe('template');
  expect(bad.candidates).toEqual({ cashOutflowDate: '2026-08-10' });
});

test('provider is null without a key and sends the expected request with one', async () => {
  expect(createProvider({})).toBeNull();
  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '안녕' }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = createProvider({ ANTHROPIC_API_KEY: 'test-key' }, fetchImpl)!;
  expect(await p.complete('hi')).toBe('안녕');
  expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
  const h = seen!.init.headers as Record<string, string>;
  expect(h['x-api-key']).toBe('test-key');
  expect(h['anthropic-version']).toBe('2023-06-01');
  expect(JSON.parse(seen!.init.body as string).model).toBe('claude-sonnet-5-5');
});
