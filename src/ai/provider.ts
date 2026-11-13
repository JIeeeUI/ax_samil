/** AI 호출 한 가지 기능만 노출한다. 키가 없으면 어댑터를 만들지 않는다(→ 템플릿 대체). */
export interface AiProvider { complete(prompt: string): Promise<string>; readonly name?: 'gemini' | 'anthropic' }

/** 화면이 로딩·오류 상태를 보여 줄 수 있게 실패 종류를 구분한다. */
export type AiErrorCode = 'no_key' | 'timeout' | 'http_error' | 'verify_failed';
export class AiError extends Error {
  constructor(public code: Exclude<AiErrorCode, 'no_key' | 'verify_failed'>, message: string, public status?: number) { super(message); }
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/**
 * Gemini 기본 모델: Google 공식 가격 문서(ai.google.dev/gemini-api/docs/pricing → aistudio.google.com/docs/pricing)에서
 * 무료 사용으로 표시된 flash 계열(2026-11 확인). GEMINI_MODEL 환경변수로 바꿀 수 있다.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'; // 사용자 결정: 가장 빠른 무료 flash 계열(3.8-flash는 답이 9~18초로 느렸다)
/** 기본 모델이 바쁘거나(503·429) 없을 때(404) 차례로 시도하는 무료 flash 계열(가격 문서 기준, 2026-11 확인). */
export const FALLBACK_GEMINI_MODELS: readonly string[] = ['gemini-3.8-flash', 'gemini-3.6-flash'];
/** 다른 모델로 바꿔 볼 만한 일시적 오류 */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 404]);
const TIMEOUT_MS = 15_000;
/** Gemini 모델은 답하는 데 9~18초 걸리는 일이 실제로 있어(서버 로그 확인) 15초에서 자주 끊겼다. 그래서 Gemini만 30초로 둔다. */
const GEMINI_TIMEOUT_MS = 30_000;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** 서버 쪽에서만 호출한다(키는 환경변수에서만 읽고 브라우저로 내려가는 코드에 넣지 않는다). */
export function createProvider(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
  /** 허용할 공급자. Gemini는 결재자용 요약의 "AI로 다시 쓰기"에만 쓰므로 다른 기능은 ['anthropic']만 넘긴다. */
  allow: readonly ('gemini' | 'anthropic')[] = ['gemini', 'anthropic'],
): AiProvider | null {
  if (env.GEMINI_API_KEY && allow.includes('gemini')) return geminiProvider(env.GEMINI_API_KEY, [...new Set([env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS])], fetchImpl);
  if (env.ANTHROPIC_API_KEY && allow.includes('anthropic')) return anthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? DEFAULT_MODEL, fetchImpl);
  return null;
}

async function send(call: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call();
  } catch (e) {
    if (isTimeout(e)) throw new AiError('timeout', '시간 초과');
    throw new AiError('http_error', `호출 실패: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AiError('http_error', `HTTP ${res.status}`, res.status);
  return res;
}

/** 모델을 차례로 시도한다. 시간 초과·키 오류(400/403)는 다른 모델로 바꿔도 소용없어 바로 멈춘다. */
function geminiProvider(key: string, models: string[], fetchImpl: typeof fetch): AiProvider {
  return {
    name: 'gemini',
    async complete(prompt: string): Promise<string> {
      const tried: string[] = [];
      for (const model of models) {
        tried.push(model);
        try {
          return await callGemini(key, model, prompt, fetchImpl);
        } catch (e) {
          const retryable = e instanceof AiError && e.code === 'http_error' && e.status !== undefined && RETRY_STATUS.has(e.status);
          if (!retryable || model === models[models.length - 1]) {
            if (e instanceof AiError && e.status !== undefined) throw new AiError(e.code, `${e.message} (시도한 모델: ${tried.join(', ')})`, e.status);
            throw e;
          }
        }
      }
      throw new AiError('http_error', '시도할 모델이 없습니다');
    },
  };
}

async function callGemini(key: string, model: string, prompt: string, fetchImpl: typeof fetch): Promise<string> {
  // 키는 헤더(x-goog-api-key)로만 보낸다. URL 쿼리에 넣지 않는다.
  const res = await send(() => fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  }));
  let body: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  try { body = (await res.json()) as typeof body; } catch { throw new AiError('http_error', '응답을 읽을 수 없음'); }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (text.trim() === '') throw new AiError('http_error', '빈 응답');
  return text;
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
