/** AI 호출 한 가지 기능만 노출한다. 키가 없으면 어댑터를 만들지 않는다(→ 템플릿 대체). */
export interface AiProvider { complete(prompt: string): Promise<string> }

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function createProvider(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): AiProvider | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return {
    async complete(prompt: string): Promise<string> {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL ?? DEFAULT_MODEL, max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
      if (text.trim() === '') throw new Error('빈 응답');
      return text;
    },
  };
}
