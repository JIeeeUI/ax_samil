/** AI 호출 한 가지 기능만 노출한다. 키가 없으면 어댑터를 만들지 않는다(→ 템플릿 대체). */
export interface AiProvider { complete(prompt: string): Promise<string>; readonly name?: 'gemini' | 'anthropic' }

/** 화면이 로딩·오류 상태를 보여 줄 수 있게 실패 종류를 구분한다. */
export type AiErrorCode = 'no_key' | 'timeout' | 'http_error' | 'verify_failed';
export class AiError extends Error {
  constructor(public code: Exclude<AiErrorCode, 'no_key' | 'verify_failed'>, message: string) { super(message); }
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/**
 * Gemini 기본 모델: Google 공식 가격 문서(ai.google.dev/gemini-api/docs/pricing → aistudio.google.com/docs/pricing)에서
 * 무료 사용으로 표시된 flash 계열(2026-11 확인). GEMINI_MODEL 환경변수로 바꿀 수 있다.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const TIMEOUT_MS = 15_000;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** 서버 쪽에서만 호출한다(키는 환경변수에서만 읽고 브라우저로 내려가는 코드에 넣지 않는다). */
export function createProvider(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  /** 허용할 공급자. Gemini는 결재자용 요약의 "AI로 다시 쓰기"에만 쓰므로 다른 기능은 ['anthropic']만 넘긴다. */
  allow: readonly ('gemini' | 'anthropic')[] = ['gemini', 'anthropic'],
): AiProvider | null {
  if (env.GEMINI_API_KEY && allow.includes('gemini')) return geminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, fetchImpl);
  if (env.ANTHROPIC_API_KEY && allow.includes('anthropic')) return anthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? DEFAULT_MODEL, fetchImpl);
  return null;
}

async function send(call: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call();
  } catch (e) {
    if (isTimeout(e)) throw new AiError('timeout', '시간 초과(15초)');
    throw new AiError('http_error', `호출 실패: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AiError('http_error', `HTTP ${res.status}`);
  return res;
}

function geminiProvider(key: string, model: string, fetchImpl: typeof fetch): AiProvider {
  return {
    name: 'gemini',
    async complete(prompt: string): Promise<string> {
      // 키는 헤더(x-goog-api-key)로만 보낸다. URL 쿼리에 넣지 않는다.
      const res = await send(() => fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }));
      let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      try { body = (await res.json()) as typeof body; } catch { throw new AiError('http_error', '응답을 읽을 수 없음'); }
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (text.trim() === '') throw new AiError('http_error', '빈 응답');
      return text;
    },
  };
}

function anthropicProvider(key: string, model: string, fetchImpl: typeof fetch): AiProvider {
  return {
    name: 'anthropic',
    async complete(prompt: string): Promise<string> {
      const res = await send(() => fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }));
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
      if (text.trim() === '') throw new AiError('http_error', '빈 응답');
      return text;
    },
  };
}
