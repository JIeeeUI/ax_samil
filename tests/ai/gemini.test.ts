import { summarizeForApproval } from '../../src/ai/assist.js';
import { createProvider, DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODELS } from '../../src/ai/provider.js';
import { IntakeService } from '../../src/app/service.js';
import { loadDataRoom } from '../../src/engine/dataRoom.js';
import { openDb } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';

async function detail() {
  const svc = new IntakeService({ repo: new Repo(await openDb({})), room: loadDataRoom() });
  await svc.reset();
  return svc.getCase('CONTRACT-INF-001');
}

type Seen = { url: string; init: RequestInit };
const geminiBody = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
function mockFetch(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return respond(); }) as unknown as typeof fetch;
  return { f, seen };
}
const KEY = 'test-gemini-key-not-real';

test('1) success: the sentence is used; the key goes in the header, never in the URL; default model is the free flash model', async () => {
  const d = await detail();
  const { f, seen } = mockFetch(() => new Response(geminiBody('전속계약 연 280,000만 원은 10억 원을 넘어 CEO/이사회 상신 대상입니다.'), { status: 200 }));
  const p = createProvider({ GEMINI_API_KEY: KEY }, f)!;
  const r = await summarizeForApproval(d, p, { requested: true });
  expect(r).toMatchObject({ source: 'ai', note: '' });
  expect(r.error).toBeUndefined();
  expect(seen[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
  expect(seen[0].url).not.toContain(KEY);
  expect(seen[0].url).not.toContain('key=');
  expect((seen[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
  expect(JSON.parse(seen[0].init.body as string).contents[0].parts[0].text).toContain('사실');
});

test('1b) GEMINI_MODEL overrides the model; Gemini wins over Anthropic when both keys exist', async () => {
  const { f, seen } = mockFetch(() => new Response(geminiBody('ok'), { status: 200 }));
  const p = createProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-x-test', ANTHROPIC_API_KEY: 'a' }, f)!;
  expect(p.name).toBe('gemini');
  await p.complete('hi');
  expect(seen[0].url).toContain('/models/gemini-x-test:generateContent');
  expect(createProvider({ ANTHROPIC_API_KEY: 'a' }, f)!.name).toBe('anthropic');
  expect(createProvider({}, f)).toBeNull();
});

test('Gemini is only for the approver summary: other features can exclude it', () => {
  const f = (async () => new Response('{}')) as unknown as typeof fetch;
  expect(createProvider({ GEMINI_API_KEY: KEY }, f, ['anthropic'])).toBeNull();
  expect(createProvider({ GEMINI_API_KEY: KEY, ANTHROPIC_API_KEY: 'a' }, f, ['anthropic'])!.name).toBe('anthropic');
});

test('2) no key: falls back to the template and reports no_key when AI was requested', async () => {
  const d = await detail();
  expect(createProvider({}, fetch)).toBeNull();
  const r = await summarizeForApproval(d, null, { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'no_key' });
  expect(r.text).toContain('CEO/이사회');
});

test('3) timeout: falls back with error "timeout"', async () => {
  const d = await detail();
  const { f } = mockFetch(() => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'timeout' });
});

test('4) HTTP error: falls back with error "http_error" and the key is not echoed', async () => {
  const d = await detail();
  const { f } = mockFetch(() => new Response('{"error":"quota"}', { status: 429 }));
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'http_error' });
  expect(JSON.stringify(r)).not.toContain(KEY);
});

test('5) verification failure: an invented number is not used (error "verify_failed")', async () => {
  const d = await detail();
  const { f } = mockFetch(() => new Response(geminiBody('고정 피는 99억 원이며 승인을 권고합니다.'), { status: 200 }));
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'verify_failed', note: 'AI 문장 숫자 불일치: 미반영' });
});

test('an empty Gemini response is an http_error, not a blank sentence', async () => {
  const d = await detail();
  const { f } = mockFetch(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(r).toMatchObject({ source: 'fallback', error: 'http_error' });
});

test('a busy model (503) is retried with the next free flash model and the answer is used', async () => {
  const d = await detail();
  let n = 0;
  const { f, seen } = mockFetch(() => (++n === 1
    ? new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 })
    : new Response(geminiBody('전속계약 연 280,000만 원은 10억 원을 넘어 CEO/이사회 상신 대상입니다.'), { status: 200 })));
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(r).toMatchObject({ source: 'ai', note: '' });
  expect(seen).toHaveLength(2);
  expect(seen[0].url).toContain(`/models/${DEFAULT_GEMINI_MODEL}:`);
  expect(seen[1].url).toContain(`/models/${FALLBACK_GEMINI_MODELS[0]}:`);
  expect(seen[1].url).not.toContain(KEY);
});

test('every model busy: tries each once, then falls back with the status and the tried models in the note', async () => {
  const d = await detail();
  const { f, seen } = mockFetch(() => new Response('{}', { status: 503 }));
  const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
  expect(seen).toHaveLength(1 + FALLBACK_GEMINI_MODELS.length);
  expect(r).toMatchObject({ source: 'fallback', error: 'http_error', status: 503 });
  expect(r.note).toContain('HTTP 503');
  expect(r.note).toContain(FALLBACK_GEMINI_MODELS[0]);
  expect(r.note).not.toContain(KEY);
});

test('a bad key (400/403) and a timeout do not try other models', async () => {
  const d = await detail();
  for (const make of [() => new Response('{}', { status: 403 }), () => { throw new DOMException('t', 'TimeoutError'); }]) {
    const { f, seen } = mockFetch(make);
    const r = await summarizeForApproval(d, createProvider({ GEMINI_API_KEY: KEY }, f), { requested: true });
    expect(seen).toHaveLength(1);
    expect(r.source).toBe('fallback');
  }
});

test('GEMINI_MODEL stays first and is not tried twice', async () => {
  const { f, seen } = mockFetch(() => new Response('{}', { status: 503 }));
  const p = createProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: FALLBACK_GEMINI_MODELS[0] }, f)!;
  await expect(p.complete('hi')).rejects.toThrow();
  const models = seen.map((s) => /models\/([^:]+):/.exec(s.url)![1]);
  expect(models[0]).toBe(FALLBACK_GEMINI_MODELS[0]);
  expect(new Set(models).size).toBe(models.length);
});
