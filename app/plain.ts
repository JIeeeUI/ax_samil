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
