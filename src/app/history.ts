import { formatClock } from '../format.js';
import type { EventRow } from '../store/repo.js';
import { decisionRole, isRole, type Role } from '../workflow/roles.js';

/** 팀(부서) 이름과 담당자 표시명. 시연에는 실제 사람 이름이 없어 담당자 표시명은 역할의 담당자로 둔다. */
const TEAM: Record<Role, string> = { marketing: '마케팅팀', finance: '재무팀', contract: '계약 담당', masil_ceo: 'Masil 대표', ceo_board: 'CEO/이사회' };
const PERSON: Record<Role, string> = { marketing: '마케팅 담당자', finance: '재무 담당자', contract: '계약 담당자', masil_ceo: 'Masil 대표', ceo_board: 'CEO/이사회' };

export interface HistoryParty { role: string; team: string; name: string }
export interface HistoryRecipient { role: Role; team: string; person: string; /** "재무팀(재무 담당자)" 형태 */ label: string }
export interface HistoryEntry {
  id: number; action: string; businessDate: string;
  /** 실제 기록 시각 "시:분"(Asia/Seoul). 업무일(시연 날짜)과 별개다. */
  time: string;
  from: HistoryParty;
  /** 받는 부서(담당자). 받는 쪽이 없는 기록은 null(화면에서 "—") */
  to: HistoryRecipient | null;
  simulated: boolean;
}

const recipient = (r: Role): HistoryRecipient => ({
  role: r, team: TEAM[r], person: PERSON[r], label: PERSON[r] === TEAM[r] ? TEAM[r] : `${TEAM[r]}(${PERSON[r]})`,
});

/**
 * 처리 기록 한 줄에서 "받는 부서"를 정한다. [교육용 가정: W02 흐름의 부서 순서 기준]
 * 표에 없는 기록(단순 확인·자동 처리)은 받는 쪽이 없다.
 */
function recipientRole(e: EventRow, actor: string): Role | null {
  const route = (e.snapshot as { route?: string } | null)?.route;
  const decider = route ? decisionRole(route as Parameters<typeof decisionRole>[0]) : null;
  const detail = (e.detail ?? {}) as { ownerRole?: string };
  switch (e.action) {
    case 'confirm_finance': return 'marketing'; // 재무 확인이 끝나 상신 담당에게
    case 'submit': return decider;
    case 'resubmit': case 'adjust': case 'keep': case 'consult': case 'propose_change': return 'finance';
    case 'finance_return': return 'marketing';
    case 'approve': case 'reject': case 'primary_return': return 'marketing'; // 결과를 상대방에 통보하는 쪽
    case 'hold': case 'primary_hold': return isRole(detail.ownerRole) ? detail.ownerRole : null;
    case 'reply': case 'reply_pending': return decider;
    case 'primary_escalate': case 'parallel_escalate': return 'ceo_board';
    case 'revision_unanswered': return decider;
    case 'notice_created': case 'notice_missed': return 'marketing'; // 통보를 보내야 하는 쪽
    case 'notice_sent': return 'contract';
    default: return null;
  }
}

export function historyEntry(e: EventRow): HistoryEntry {
  const actor = e.actor_role;
  const from: HistoryParty = actor === 'system'
    ? { role: 'system', team: '자동 처리', name: '자동 처리' }
    : isRole(actor) ? { role: actor, team: TEAM[actor], name: PERSON[actor] } : { role: actor, team: actor, name: actor };
  const r = recipientRole(e, actor);
  return {
    id: e.id, action: e.action, businessDate: e.business_date, time: formatClock(e.real_time), from,
    to: r ? recipient(r) : null, simulated: e.simulated,
  };
}
