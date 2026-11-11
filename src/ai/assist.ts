import { THRESHOLDS } from '../engine/assumptions.js';
import { isIsoDate } from '../engine/calendar.js';
import type { IsoDate } from '../engine/types.js';
import type { CaseDetail, ReplyValues } from '../app/service.js';
import { ROLE_LABEL, isRole } from '../workflow/roles.js';
import type { AiProvider } from './provider.js';
import { extractTokens, verifyFacts, type Facts } from './verify.js';

export interface AssistResult { text: string; source: 'ai' | 'template'; note: string }

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const NEEDED_LABEL: Record<string, string> = {
  cash_outflow_date: '고정 피 현금 유출일(지급 일정)',
  payment_schedule: '고정 피 지급 일정',
};
const NEEDED_WHY: Record<string, string> = {
  cash_outflow_date: '하회 구간(covenant) 해당 여부를 판정할 수 없어 승인 경로가 확정되지 않습니다.',
};

/** 엔진이 계산한 값만 모은다. AI 문장은 이 안의 숫자·날짜만 쓸 수 있다. */
export function buildFacts(d: CaseDetail): Facts {
  const text = [...d.reasons, ...d.notes, d.row.하회구간, d.row.판정근거].join(' ');
  const tk = extractTokens(text);
  const nums = [
    d.item.amount, d.item.daysLeft, d.item.nominalRank, d.item.realRank, d.row.과거명목ROAS, d.row.과거실질ROAS,
    d.row.반품률, d.row.채널기준반품률, d.row.요청비중, d.row.기존집행비중, d.row.기안예상GMV, d.row.기안예상명목ROAS,
    d.penalty, THRESHOLDS.perItemKrw, THRESHOLDS.planTotalKrw, THRESHOLDS.contractAnnualKrw, THRESHOLDS.covenantMinKrw,
  ].filter((x): x is number => typeof x === 'number');
  const dates = [
    d.item.deadline, d.item.effectiveDeadline, d.item.settlementDate, d.item.boardDate, ...d.requests.map((r) => r.dueDate),
    ...tk.dates,
  ].filter((x): x is IsoDate => typeof x === 'string' && x !== '');
  return { numbers: [...nums, ...tk.numbers.flatMap((n) => n.values)], dates };
}

function templateSummary(d: CaseDetail): string {
  const i = d.item;
  const parts = [
    `${i.influencer} ${i.id}(${i.kind === 'contract' ? '전속계약' : '기안'}): 요청액 ${won(i.amount)}${i.scale === '풀스케일' ? '(풀스케일 금액이라 표본 금액과 합산하지 않습니다)' : ''}.`,
    `승인 경로는 ${i.routeLabel}입니다. 근거: ${d.reasons.join(' / ')}.`,
    `실효 결정 기한 ${i.effectiveDeadline}(남은 ${i.daysLeft}일).`,
  ];
  if (d.row.과거실질ROAS !== '') {
    parts.push(`과거 실질 ROAS ${d.row.과거실질ROAS}(명목 ${d.row.과거명목ROAS})${i.realRank !== '' ? `, 실질 순위 ${i.realRank}위` : ''}.`);
  }
  parts.push(...d.notes);
  return parts.join(' ');
}

/** AI 호출 → 숫자 대조 → 통과하면 AI 문장, 아니면 템플릿. */
async function guarded(d: CaseDetail, ai: AiProvider | null, prompt: string, template: string): Promise<AssistResult> {
  if (!ai) return { text: template, source: 'template', note: 'AI 미사용' };
  try {
    const out = (await ai.complete(prompt)).trim();
    if (out === '' || !verifyFacts(out, buildFacts(d)).ok) {
      return { text: template, source: 'template', note: 'AI 문장 숫자 불일치: 미반영' };
    }
    return { text: out, source: 'ai', note: '' };
  } catch (e) {
    return { text: template, source: 'template', note: `AI 호출 실패: ${(e as Error).message}` };
  }
}

const RULES = '새로운 숫자나 날짜를 만들지 말고, 승인·거절을 결정하거나 권하지 마세요. 한국어로 답하세요.';

export function summarizeForApproval(d: CaseDetail, ai: AiProvider | null): Promise<AssistResult> {
  const t = templateSummary(d);
  return guarded(d, ai, `결재자가 읽을 3문장 이내 상신 근거 요약을 쓰세요. 아래 사실만 사용합니다. ${RULES}\n사실: ${t}`, t);
}

export function draftInfoRequest(needed: string, d: CaseDetail, ai: AiProvider | null): Promise<AssistResult> {
  const req = d.requests.find((r) => r.needed === needed && r.status === 'requested');
  const owner = req && isRole(req.ownerRole) ? ROLE_LABEL[req.ownerRole] : 'Masil 재무팀';
  const label = NEEDED_LABEL[needed] ?? needed;
  const t = `[확인 요청] ${d.item.influencer}(${d.item.id}) 건의 ${label}을(를) ${owner}에 요청합니다.${req ? ` 회신 기한은 ${req.dueDate}입니다.` : ''} ${NEEDED_WHY[needed] ?? '이 정보가 없으면 판단을 확정할 수 없습니다.'}`;
  return guarded(d, ai, `아래 사실로 확인 요청서 초안을 3문장 이내로 쓰세요. ${RULES}\n사실: ${t}`, t);
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
