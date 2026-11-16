import type { TodayItem } from '../src/app/service.js';
import { formatMan } from '../src/format.js';
import { requestLabel } from '../src/workflow/requestKinds.js';
import { decisionRole, ROLE_LABEL, type Role } from '../src/workflow/roles.js';
import { TERMINAL } from '../src/workflow/status.js';

/** 영어 이슈 코드를 처음 보는 사람도 읽을 수 있는 말로 바꾼다. */
export const ISSUE_PLAIN: Record<string, { text: string; serious: boolean }> = {
  LOSS: { text: '광고비를 빼면 손해', serious: true },
  ALLOCATION_INVERSION: { text: '성과는 낮은데 예산 요청은 큼', serious: true },
  RETURN_RATE_ISSUE: { text: '반품이 기준보다 많이 높음', serious: true },
  RETURN_RATE_WARN: { text: '반품이 기준보다 조금 높음', serious: false },
  DISCOUNT_ABOVE_AVG: { text: '쿠폰 할인이 평균보다 큼', serious: false },
  SAMPLE_TOO_SMALL: { text: '주문 수가 적어 판단 보류', serious: false },
  EXECUTION_BEFORE_DEADLINE: { text: '확정되기 전에 집행이 시작됨', serious: true },
  CONTRACT_OUTFLOW_UNKNOWN: { text: '돈이 나가는 날짜를 아직 모름', serious: true },
};

export const issuePlain = (code: string) => ISSUE_PLAIN[code] ?? { text: code, serious: false };

/** 경로를 한 문장으로. */
export const WHO_DECIDES: Record<string, string> = {
  CEO_BOARD: 'CEO/이사회',
  MASIL_CEO_GROUP_REPORT: 'Masil 대표 (그룹 보고 필요)',
  MASIL_CEO: 'Masil 대표',
  MARKETING: '마케팅팀',
};

export const STATUS_PLAIN: Record<string, string> = {
  finance_review: '재무팀 확인 전', routed: '상신 전', submitted: '결정 기다리는 중', approved: '승인됨',
  rejected: '거절됨', on_hold: '추가 확인 중', revision: '재무가 보완을 요청함', consulting: '협의 중', overdue: '기한이 지나 자동 확정됨', closed: '종결됨',
};

export interface NextStep { kind: 'mine' | 'waiting' | 'done'; text: string }

/** 이 건에서 지금 이 역할이 할 일이 있는지, 없으면 누구를 기다리는지. */
export function nextStep(item: TodayItem, role: Role): NextStep {
  const s = item.status;
  const decider = decisionRole(item.routeLevel);
  if (TERMINAL.has(s) || s === 'closed') return { kind: 'done', text: STATUS_PLAIN[s] };
  if (s === 'finance_review') {
    return role === 'finance' ? { kind: 'mine', text: '재무 확인을 해 주십시오' } : { kind: 'waiting', text: `${ROLE_LABEL.finance}의 확인을 기다리는 중` };
  }
  if (s === 'routed') {
    return role === 'marketing' || role === 'finance'
      ? { kind: 'mine', text: '결재자에게 올려 주십시오(상신)' } : { kind: 'waiting', text: '마케팅·재무팀이 상신하기를 기다리는 중' };
  }
  if (s === 'submitted') {
    if (item.primaryPending) {
      // 1차/2차 결재: 1차 대표 검토가 끝나기 전에는 대표가 할 일, CEO/이사회는 기다리는 중
      return role === 'masil_ceo' ? { kind: 'mine', text: '1차 검토를 해 주십시오(상신·보류·반려)' }
        : { kind: 'waiting', text: `${ROLE_LABEL.masil_ceo}의 1차 검토를 기다리는 중` };
    }
    return role === decider ? { kind: 'mine', text: '승인·거절·보류 중에서 결정해 주십시오' } : { kind: 'waiting', text: `${ROLE_LABEL[decider]}의 결정을 기다리는 중` };
  }
  if (s === 'on_hold') {
    // 열린 확인 요청의 담당 역할만 "내 차례". 결재자는 대신 입력할 수 있지만 내 차례는 아니다.
    if (item.openRequestOwners.includes(role)) return { kind: 'mine', text: '확인 요청에 회신해 주십시오' };
    const names = item.openRequestOwners.map((r) => ROLE_LABEL[r]).join('·') || '담당 부서';
    const proxy = role === 'masil_ceo' || role === 'ceo_board' ? ' (결재자는 대신 입력할 수도 있습니다)' : '';
    return { kind: 'waiting', text: `${names}의 회신을 기다리는 중${proxy}` };
  }
  if (s === 'revision') {
    return role === 'marketing' ? { kind: 'mine', text: '재무의 보완 요청에 답해 주십시오(조정·변경 없음·협의 필요)' }
      : { kind: 'waiting', text: `${ROLE_LABEL.marketing}의 보완 답변을 기다리는 중` };
  }
  if (s === 'consulting') return { kind: 'waiting', text: '재무·마케팅이 협의하는 중(결과 입력 대기)' };
  if (s === 'rejected') {
    if (role === 'marketing') return { kind: 'mine', text: '다시 올릴지(재상신) 끝낼지(종결) 정해 주십시오' };
    return role === 'finance'
      ? { kind: 'waiting', text: '다시 올리기 전에 재확인할 내용을 살펴봐 주십시오(재상신·종결은 마케팅이 합니다)' }
      : { kind: 'waiting', text: `${ROLE_LABEL.marketing}의 후속 처리를 기다리는 중` };
  }
  return { kind: 'waiting', text: STATUS_PLAIN[s] };
}

/** 목록용 짧은 표기. 상태(진행 단계)와 재무 확인(점검 결과)을 따로 보여 준다. */
export const STATUS_SHORT: Record<string, string> = {
  finance_review: '재무 확인 중', routed: '상신 전', submitted: '결정 대기', approved: '승인', rejected: '거절', on_hold: '확인 요청 중',
  revision: '보완 요청', consulting: '협의 중', overdue: '기한 경과', closed: '종결',
};
export const CHECK_SHORT: Record<string, { text: string; tone: 'ok' | 'bad' | '' }> = {
  finance_pending: { text: '대기', tone: '' }, waiting_info: { text: '정보 필요', tone: 'bad' },
  ready: { text: '정상', tone: 'ok' }, submitted: { text: '정상', tone: 'ok' },
};

export const CHECK_LABEL: Record<string, string> = { waiting_info: '확인 대기', finance_pending: '재무 확인 대기', ready: '상신 준비 완료', submitted: '상신함' };

export const daysLeftText = (n: number) => (n < 0 ? `${-n}일 지남` : n === 0 ? '오늘까지' : `${n}일 남음`);

/** 2026-07-17 → 7월 17일 */
export const koDate = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/** 2,800,000,000 → 280,000만 원, 18,962,703 → 1,896만 원 (공용 표기 함수) */
export const shortWon = formatMan;

export const FLOW_STEPS = ['재무 확인', '상신', '결정', '완료'] as const;
/** 진행 단계(0~3) */
export const flowIndex = (status: string): number =>
  status === 'finance_review' || status === 'revision' || status === 'consulting' ? 0 : status === 'routed' ? 1 : status === 'approved' || status === 'closed' || status === 'overdue' ? 3 : 2;

/** 확인 요청의 '필요한 정보' 이름(코드 값이면 쉬운 말로, 이미 문장이면 그대로) */
export const NEEDED_PLAIN: Record<string, string> = Object.fromEntries(['cash_outflow_date', 'payment_schedule', 'performance_fee_terms'].map((c) => [c, requestLabel(c, 'plain')]));
export const neededLabel = (needed: string) => requestLabel(needed, 'plain');

/** 카드 안에서 한 줄에 들어가도록 줄인 '누가 결정하나' 이름 */
export const WHO_SHORT: Record<string, string> = {
  CEO_BOARD: 'CEO/이사회',
  MASIL_CEO_GROUP_REPORT: '대표 + 그룹 보고',
  MASIL_CEO: 'Masil 대표',
  MARKETING: '마케팅 전결',
};

/** 이 건이 지금 누구(무엇)를 기다리고 있는지 짧은 이름. 끝난 건이면 null. */
export function waitingOn(item: TodayItem): string | null {
  const s = item.status;
  if (TERMINAL.has(s) || s === 'closed') return null;
  switch (s) {
    case 'finance_review': return '재무 확인';
    case 'routed': return '상신';
    case 'submitted': return item.primaryPending ? `${ROLE_LABEL.masil_ceo}의 1차 검토` : `${ROLE_LABEL[decisionRole(item.routeLevel)]}의 결정`;
    case 'on_hold': return '확인 요청 회신';
    case 'revision': return '마케팅의 보완 답변';
    case 'consulting': return '재무·마케팅 협의';
    case 'rejected': return '마케팅의 후속 처리(재상신·종결)';
    default: return STATUS_PLAIN[s] ?? s;
  }
}

/** "내 차례"가 없을 때 보여 줄 한 문장: 무엇을 몇 건 기다리는지와 다음에 어떻게 되는지. */
export function noTurnNotice(items: TodayItem[]): string | null {
  const counts = new Map<string, number>();
  for (const i of items) {
    const w = waitingOn(i);
    if (w) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} 대기 ${n}건`);
  return `지금 내 차례인 건이 없습니다. 현재 ${parts.join(' · ')}입니다. 처리되면 내 차례에 표시됩니다.`;
}

/** 업무 용어 짧은 풀이 */
export const GLOSSARY: [string, string][] = [
  ['상신', '결재할 사람에게 안건을 올려 결정을 요청하는 일입니다. 올린 뒤에는 되돌릴 수 없습니다.'],
  ['기안', '결정을 요청하는 안건 문서입니다. 이 화면에서는 캠페인 확대 요청이 기안입니다.'],
  ['실효 결정 기한', '계약 확정일과 돈이 먼저 나가는 날 중 이른 날입니다. 이 날까지 결정해야 합니다.'],
  ['명목 ROAS', '광고비 대비 매출입니다(쿠폰·반품 등 다른 비용은 빼지 않습니다).'],
  ['실질 ROAS', '쿠폰·반품·광고비 등 들어간 비용을 모두 뺀 뒤의 효과입니다. 0보다 작으면 손해입니다.'],
  ['LC-0001', '현금이 들어오는 시점을 정하는 결제 조건 항목입니다(통보서 90일, 재무 가정 45일). 이 값에 따라 현금 부족 구간이 달라집니다.'],
  ['현금 부족 구간', '회사 현금이 지켜야 하는 최소 금액 밑으로 내려가는 기간입니다. 이 기간에 돈이 나가는 건은 CEO/이사회가 결정합니다.'],
];
