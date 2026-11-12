import type { TodayItem } from '../src/app/service.js';
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
  rejected: '거절됨', on_hold: '추가 확인 중', overdue: '기한이 지나 자동 확정됨', closed: '종결됨',
};

export interface NextStep { kind: 'mine' | 'waiting' | 'done'; text: string }

/** 이 건에서 지금 이 역할이 할 일이 있는지, 없으면 누구를 기다리는지. */
export function nextStep(item: TodayItem, role: Role): NextStep {
  const s = item.status;
  const decider = decisionRole(item.routeLevel);
  if (TERMINAL.has(s) || s === 'closed') return { kind: 'done', text: STATUS_PLAIN[s] };
  if (s === 'finance_review') {
    return role === 'finance' ? { kind: 'mine', text: '재무 확인을 해 주세요' } : { kind: 'waiting', text: `${ROLE_LABEL.finance}의 확인을 기다리는 중` };
  }
  if (s === 'routed') {
    return role === 'marketing' || role === 'finance'
      ? { kind: 'mine', text: '결재자에게 올려 주세요(상신)' } : { kind: 'waiting', text: '마케팅·재무팀이 상신하기를 기다리는 중' };
  }
  if (s === 'submitted') {
    if (item.primaryPending) {
      // 1차/2차 결재: 1차 대표 검토가 끝나기 전에는 대표가 할 일, CEO/이사회는 기다리는 중
      return role === 'masil_ceo' ? { kind: 'mine', text: '1차 검토를 해 주세요(상신·보류·반려)' }
        : { kind: 'waiting', text: `${ROLE_LABEL.masil_ceo}의 1차 검토를 기다리는 중` };
    }
    return role === decider ? { kind: 'mine', text: '승인·거절·보류 중에서 결정해 주세요' } : { kind: 'waiting', text: `${ROLE_LABEL[decider]}의 결정을 기다리는 중` };
  }
  if (s === 'on_hold') return { kind: 'waiting', text: '확인 요청에 회신이 오기를 기다리는 중' };
  if (s === 'rejected') {
    return role === 'marketing' || role === 'finance'
      ? { kind: 'mine', text: '다시 올릴지(재상신) 끝낼지(종결) 정해 주세요' } : { kind: 'waiting', text: '마케팅·재무팀의 후속 처리를 기다리는 중' };
  }
  return { kind: 'waiting', text: STATUS_PLAIN[s] };
}

export const daysLeftText = (n: number) => (n < 0 ? `${-n}일 지남` : n === 0 ? '오늘까지' : `${n}일 남음`);

/** 2026-07-17 → 7월 17일 */
export const koDate = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/** 2,800,000,000 → 28억 원, 18,962,703 → 1,896만 원 */
export function shortWon(n: number): string {
  if (n >= 100_000_000) {
    const v = n / 100_000_000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}억 원`;
  }
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만 원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

export const FLOW_STEPS = ['재무 확인', '상신', '결정', '완료'] as const;
/** 진행 단계(0~3) */
export const flowIndex = (status: string): number =>
  status === 'finance_review' ? 0 : status === 'routed' ? 1 : status === 'approved' || status === 'closed' || status === 'overdue' ? 3 : 2;

/** 확인 요청의 '필요한 정보' 이름(코드 값이면 쉬운 말로, 이미 문장이면 그대로) */
export const NEEDED_PLAIN: Record<string, string> = {
  cash_outflow_date: '고정 비용이 실제로 나가는 날짜',
  payment_schedule: '고정 비용 지급 일정',
  performance_fee_terms: '성과 피 조건(포함하면 연 10억 원을 넘는지)',
};
export const neededLabel = (needed: string) => NEEDED_PLAIN[needed] ?? needed;
