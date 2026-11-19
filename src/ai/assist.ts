import { THRESHOLDS } from '../engine/assumptions.js';
import { daysLeftText, formatMan } from '../format.js';
import { isIsoDate } from '../engine/calendar.js';
import type { IsoDate } from '../engine/types.js';
import type { CaseDetail, ReplyValues } from '../app/service.js';
import { requestLabel, whyOf } from '../workflow/requestKinds.js';
import { ROLE_LABEL, isRole } from '../workflow/roles.js';
import { AiError, type AiErrorCode, type AiProvider } from './provider.js';
import { extractTokens, verifyFacts, type Facts } from './verify.js';

/**
 * 결과 모양: text(화면에 쓸 문장), source('ai' | 'fallback' = 템플릿 대체), note(사람이 읽는 설명),
 * error(대체된 이유: no_key | timeout | http_error | verify_failed, AI를 요청하지 않았으면 없음).
 */
export interface AssistResult { text: string; source: 'ai' | 'fallback'; note: string; error?: AiErrorCode; /** 숫자 검사에 걸린 값(verify_failed일 때) */ unmatched?: string[]; /** 구글 등 서버가 돌려준 HTTP 상태(있을 때만) */ status?: number }
export interface AssistOptions { /** 사용자가 AI 사용을 요청했는지(요청했는데 키가 없으면 no_key) */ requested?: boolean }

const won = formatMan;

/** 엔진이 계산한 값만 모은다. AI 문장은 이 안의 숫자·날짜만 쓸 수 있다. */
export function buildFacts(d: CaseDetail): Facts {
  const text = [...d.reasons, ...d.notes, d.row.하회구간, d.row.판정근거].join(' ');
  const tk = extractTokens(text);
  const nums = [
    d.item.amount, d.item.daysLeft, d.item.nominalRank, d.item.realRank, d.row.과거명목ROAS, d.row.과거실질ROAS,
    d.row.반품률, d.row.채널기준반품률, d.row.요청비중, d.row.기존집행비중, d.row.기안예상GMV, d.row.기안예상명목ROAS,
    // 화면·문구에는 만 원 단위로 반올림한 금액이 나오므로 같은 값도 사실로 인정한다.
    Math.round(d.item.amount / 10_000) * 10_000, d.penalty === null ? null : Math.round(d.penalty / 10_000) * 10_000,
    d.penalty, THRESHOLDS.perItemKrw, THRESHOLDS.planTotalKrw, THRESHOLDS.contractAnnualKrw, THRESHOLDS.covenantMinKrw,
  ].filter((x): x is number => typeof x === 'number');
  const dates = [
    d.item.deadline, d.item.effectiveDeadline, d.item.settlementDate, d.item.boardDate, ...d.requests.map((r) => r.dueDate),
    ...tk.dates,
  ].filter((x): x is IsoDate => typeof x === 'string' && x !== '');
  return { numbers: [...nums, ...tk.numbers.flatMap((n) => n.values)], dates };
}

/**
 * 사실 자리표시자 방식. 수치·승인 경로·기한·빠진 정보는 서버가 정한 문자열이고, AI는 그 자리표시자({{요청액}} 등)를 넣어
 * 문장의 표현만 쓴다. 서버가 자리표시자를 사실로 바꿔 최종 문장을 조립한다.
 * 그래서 AI가 숫자를 바꾸거나(명목 ROAS를 실질로 쓰기), 빠진 정보가 있는데 "모두 확인됨"이라고 쓸 수 없다:
 *  - 자리표시자 밖에 숫자·날짜가 있으면 버린다(허용 목록으로 맞는 숫자를 가려내는 방식이 아니다).
 *  - 필수 사실 자리표시자가 하나라도 없으면 버린다(빠진 정보 포함).
 *  - 확인 완료·문제 없음·승인 권고처럼 사실을 단정하거나 결정을 권하는 표현은 버린다.
 */
export interface SlotSpec { values: Record<string, string>; required: string[]; /** 문장 뒤에 서버가 그대로 붙이는 참고 문구 */ tail: string }

const SLOT_RE = /\{\{([^{}]+)\}\}/g;
const NUMERAL_RE = /[0-9０-９]|[일이삼사오육칠팔구]\s?[십백천만억]|[십백천만억]\s?원/g;
/** 확인 완료·문제 없음·결정 권고 등 사실을 단정하는 표현. AI 문장에서는 쓸 수 없다(서버 사실만 말해야 한다). */
const ASSERT_RE = /모두\s*확인|확인(이|은|을)?\s*(모두\s*)?(완료|끝났|됐|되었|됨)|확인됐|확인되었|추가\s*확인(은|이)?\s*(필요\s*(없|하지\s*않)|불필요)|확인할\s*(것|필요|사항)(이|은)?\s*없|빠진\s*정보(가|는|은)?\s*없|누락(이|은)?\s*없|(문제|이상|위험|걱정)(이|은)?\s*(전혀\s*)?없|안전합니다|승인(을|은)?\s*(권|추천|하시|해도|하세요|하십시오|바랍니다)|거절(을|은)?\s*(권|추천|하시|하세요|하십시오|바랍니다)|승인해야|거절해야/;

export function checkSlotText(out: string, spec: SlotSpec): string[] {
  const problems: string[] = [];
  const found = [...out.matchAll(SLOT_RE)].map((m) => m[1].trim());
  for (const k of found) if (!Object.hasOwn(spec.values, k)) problems.push(`알 수 없는 자리표시자 {{${k}}}`);
  for (const k of spec.required) if (!found.includes(k)) problems.push(`필수 사실 누락: ${k}`);
  const prose = out.replace(SLOT_RE, ' ');
  for (const m of prose.match(NUMERAL_RE) ?? []) problems.push(`직접 쓴 숫자: ${m}`);
  const digits = prose.match(/[-+]?\d[\d,.]*/g);
  if (digits) problems.push(...digits.slice(0, 3).map((d) => `숫자 ${d}`));
  const bad = prose.match(ASSERT_RE);
  if (bad) problems.push(`단정·권고 표현: ${bad[0]}`);
  if (out.length > 800) problems.push('너무 긴 문장');
  return [...new Set(problems)];
}

export const assembleSlotText = (out: string, spec: SlotSpec): string =>
  (out.replace(SLOT_RE, (_m, k: string) => spec.values[k.trim()]) + (spec.tail ? ` ${spec.tail}` : '')).replace(/\s+/g, ' ').trim();

/** AI 호출 → 자리표시자 규칙 검사 → 통과하면 서버가 사실을 넣어 조립한 문장, 아니면 템플릿. */
async function guarded(ai: AiProvider | null, spec: SlotSpec, instruction: string, template: string, requested = false): Promise<AssistResult> {
  if (!ai) return { text: template, source: 'fallback', note: 'AI 미사용', ...(requested ? { error: 'no_key' as const } : {}) };
  try {
    const out = (await ai.complete(slotPrompt(instruction, spec))).trim();
    const problems = out === '' ? ['빈 응답'] : checkSlotText(out, spec);
    if (problems.length > 0) {
      const shown = problems.slice(0, 5).join(', ');
      return { text: template, source: 'fallback', note: `AI 문장 사실 검증 실패: 미반영 (사유: ${shown})`, error: 'verify_failed', unmatched: problems };
    }
    return { text: assembleSlotText(out, spec), source: 'ai', note: '' };
  } catch (e) {
    return { text: template, source: 'fallback', note: `AI 호출 실패: ${(e as Error).message}`, error: e instanceof AiError ? e.code : 'http_error', ...(e instanceof AiError && e.status !== undefined ? { status: e.status } : {}) };
  }
}

function slotPrompt(instruction: string, spec: SlotSpec): string {
  const list = Object.entries(spec.values).map(([k, v]) => `{{${k}}} = ${v}`).join('\n');
  return `${instruction}
규칙: 사실은 아래 자리표시자로만 쓰세요. 자리표시자는 서버가 사실로 바꿔 넣으니 값을 풀어 쓰지 말고 {{이름}} 그대로 넣으세요.
필수 자리표시자(모두 한 번 이상): ${spec.required.map((k) => `{{${k}}}`).join(', ')}
숫자·날짜·금액을 직접 쓰지 마세요(쓰면 문장이 버려집니다). 승인·거절을 권하거나 결정하지 말고, 확인이 끝났다·문제없다·추가 확인이 필요 없다고 단정하지 마세요. 한국어 3~4문장으로 답하세요.
자리표시자와 현재 값(참고):
${list}`;
}

/** 빠진 정보 문장: 점검 결과 ④줄(서버 사실)에서 가져온다. */
const missingText = (d: CaseDetail): string => d.check.lines[3].replace(/^④\s*/, '').split(' — ')[0];

function summarySpec(d: CaseDetail): SlotSpec {
  const i = d.item;
  const values: Record<string, string> = {
    건: `${i.influencer} ${i.id}(${i.kind === 'contract' ? '전속계약' : '기안'})`,
    요청액: won(i.amount),
    승인경로: i.routeLabel,
    근거: d.reasons.join(' / '),
    결정기한: `${i.effectiveDeadline}(${daysLeftText(i.daysLeft)})`,
    빠진정보: missingText(d),
  };
  const required = ['건', '요청액', '승인경로', '근거', '결정기한', '빠진정보'];
  if (d.row.과거실질ROAS !== '') {
    values.성과 = `과거 실질 ROAS ${d.row.과거실질ROAS}(명목 ${d.row.과거명목ROAS})${i.realRank !== '' ? `, 실질 순위 ${i.realRank}위` : ''}`;
    required.push('성과');
  }
  return { values, required, tail: [...(i.scale === '풀스케일' ? ['풀스케일 금액이라 표본 금액과 합산하지 않습니다.'] : []), ...d.notes].join(' ') };
}

function templateSummary(d: CaseDetail): string {
  const i = d.item;
  const parts = [
    `${i.influencer} ${i.id}(${i.kind === 'contract' ? '전속계약' : '기안'}): 요청액 ${won(i.amount)}${i.scale === '풀스케일' ? '(풀스케일 금액이라 표본 금액과 합산하지 않습니다)' : ''}.`,
    `승인 경로는 ${i.routeLabel}입니다. 근거: ${d.reasons.join(' / ')}.`,
    `실효 결정 기한 ${i.effectiveDeadline}(${daysLeftText(i.daysLeft)}).`,
  ];
  if (d.row.과거실질ROAS !== '') {
    parts.push(`과거 실질 ROAS ${d.row.과거실질ROAS}(명목 ${d.row.과거명목ROAS})${i.realRank !== '' ? `, 실질 순위 ${i.realRank}위` : ''}.`);
  }
  parts.push(`${missingText(d)}.`);
  parts.push(...d.notes);
  return parts.join(' ');
}

export function summarizeForApproval(d: CaseDetail, ai: AiProvider | null, opts: AssistOptions = {}): Promise<AssistResult> {
  return guarded(ai, summarySpec(d), '결재자가 읽을 3~4문장 상신 근거 요약의 표현만 쓰세요.', templateSummary(d), opts.requested);
}

export function draftInfoRequest(needed: string, d: CaseDetail, ai: AiProvider | null, opts: AssistOptions = {}): Promise<AssistResult> {
  const req = d.requests.find((r) => r.needed === needed && r.status === 'requested');
  const owner = req && isRole(req.ownerRole) ? ROLE_LABEL[req.ownerRole] : 'Masil 재무팀';
  const label = requestLabel(needed, 'ai');
  const why = whyOf(needed) ?? '이 정보가 없으면 판단을 확정할 수 없습니다.';
  const t = `[확인 요청] ${d.item.influencer}(${d.item.id}) 건의 확인 요청 — ${label}. 담당: ${owner}.${req ? ` 회신 기한은 ${req.dueDate}입니다.` : ''} ${why}`;
  const values: Record<string, string> = { 건: `${d.item.influencer}(${d.item.id}) 건`, 항목: label, 담당: owner, 이유: why, 기한: '회신 기한은 요청이 만들어질 때 정해집니다' };
  const required = ['건', '항목', '담당', '이유'];
  if (req) { values.기한 = `회신 기한은 ${req.dueDate}`; required.push('기한'); }
  return guarded(ai, { values, required, tail: '' }, '확인 요청서 초안의 표현만 쓰세요.', t, opts.requested);
}

function templateCandidates(text: string): ReplyValues {
  const out: ReplyValues = {};
  const date = (text.match(/\d{4}-\d{2}-\d{2}/g) ?? []).find(isIsoDate);
  if (date) out.cashOutflowDate = date;
  const fee = text.match(/(?:고정\s*피|연)\s*(\d[\d,]*(?:\.\d+)?)\s*(억|만)?\s*원/);
  if (fee) {
    const v = Math.round(parseFloat(fee[1].replace(/,/g, '')) * (fee[2] === '억' ? 1e8 : fee[2] === '만' ? 1e4 : 1));
    if (v > 0) out.annualFixedFeeKrw = v;
  }
  return out;
}

/** 비정형 회신을 입력 필드 후보로 바꾼다. 후보일 뿐이며 사람이 확인해야 반영된다. */
export async function structureReply(
  text: string, ai: AiProvider | null,
): Promise<{ candidates: ReplyValues; source: 'ai' | 'template'; note: string }> {
  const fallback = templateCandidates(text);
  if (!ai) return { candidates: fallback, source: 'template', note: 'AI 미사용' };
  try {
    const out = await ai.complete(
      `다음 회신에서 값만 JSON으로 추출하세요. 키: cashOutflowDate(YYYY-MM-DD), annualFixedFeeKrw(원, 정수). 없으면 생략하고 JSON 외 글자는 쓰지 마세요.\n회신: ${text}`);
    const raw = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as ReplyValues;
    const grounded = extractTokens(text);
    const c: ReplyValues = {};
    if (raw.cashOutflowDate !== undefined) {
      if (!isIsoDate(raw.cashOutflowDate) || !grounded.dates.includes(raw.cashOutflowDate)) throw new Error('grounding');
      c.cashOutflowDate = raw.cashOutflowDate;
    }
    if (raw.annualFixedFeeKrw !== undefined) {
      const v = raw.annualFixedFeeKrw;
      if (!Number.isInteger(v) || v <= 0 || !grounded.numbers.some((n) => n.values.some((x) => Math.abs(x - v) <= 0.005 * v))) {
        throw new Error('grounding');
      }
      c.annualFixedFeeKrw = v;
    }
    return { candidates: c, source: 'ai', note: '' };
  } catch {
    return { candidates: fallback, source: 'template', note: 'AI 응답 불일치: 미반영' };
  }
}
