import type { RouteLevel } from '../engine/routing.js';
import { isIsoDate } from '../engine/calendar.js';
import type { IsoDate } from '../engine/types.js';
import { decisionRole, isRole, type Role } from './roles.js';

export type Status =
  | 'finance_review' | 'routed' | 'submitted' | 'approved' | 'rejected' | 'on_hold' | 'overdue' | 'closed'
  | 'revision' | 'consulting';

export type Action =
  | 'confirm_finance' | 'submit' | 'approve' | 'reject' | 'hold' | 'reply' | 'resubmit' | 'close' | 'expire' | 'primary_return'
  | 'finance_return' | 'adjust' | 'keep' | 'consult' | 'auto_submit';

/** 더 이상 결정할 수 없는 상태 */
export const TERMINAL: ReadonlySet<Status> = new Set<Status>(['approved', 'overdue', 'closed']);

export interface HoldInput { needed: string; ownerRole: Role; dueDate: IsoDate }

type Actor = Role | 'system';
/** 'decision' = 경로가 정한 결재 역할, 배열 = 허용 역할 목록 */
type Allowed = 'decision' | readonly Actor[];

const ANY_ROLE: readonly Actor[] = ['marketing', 'finance', 'contract', 'masil_ceo', 'ceo_board'];

const TABLE: Record<Status, Partial<Record<Action, { to: Status; by: Allowed }>>> = {
  finance_review: {
    confirm_finance: { to: 'routed', by: ['finance'] },
    // 재무 반려(보완 요청): 재무는 반려와 의견만 낼 수 있고 최종 거절은 못 한다 [교육용 가정]
    finance_return: { to: 'revision', by: ['finance'] },
    expire: { to: 'overdue', by: ['system'] },
  },
  revision: {
    adjust: { to: 'finance_review', by: ['marketing'] },
    keep: { to: 'routed', by: ['marketing'] },
    consult: { to: 'consulting', by: ['marketing'] },
    auto_submit: { to: 'submitted', by: ['system'] },
    expire: { to: 'overdue', by: ['system'] },
  },
  consulting: { expire: { to: 'overdue', by: ['system'] } },
  routed: { submit: { to: 'submitted', by: ['marketing', 'finance'] }, expire: { to: 'overdue', by: ['system'] } },
  submitted: {
    approve: { to: 'approved', by: 'decision' },
    reject: { to: 'rejected', by: 'decision' },
    hold: { to: 'on_hold', by: 'decision' },
    // 1차 대표 검토의 반려(설정으로 1차/2차를 켠 CEO/이사회 경로만 서비스가 허용). 거절과 같다.
    primary_return: { to: 'rejected', by: ['masil_ceo'] },
    expire: { to: 'overdue', by: ['system'] },
  },
  on_hold: { reply: { to: 'routed', by: ANY_ROLE }, expire: { to: 'overdue', by: ['system'] } },
  rejected: {
    // 거절 후 재상신·종결은 마케팅만(재무는 재확인 안내만 본다) [교육용 가정]
    // 재상신하면 재무 확인 단계부터 다시 시작한다 [교육용 가정]
    resubmit: { to: 'finance_review', by: ['marketing'] },
    close: { to: 'closed', by: ['marketing'] },
    expire: { to: 'overdue', by: ['system'] },
  },
  approved: {}, overdue: {}, closed: {},
};

/** 보류에는 담당 역할과 오늘 이후의 기한이 반드시 있어야 한다. */
function assertHold(hold: HoldInput | undefined, today: IsoDate | undefined): void {
  const bad = (why: string) => new Error(`HOLD_REQUIRES_OWNER_AND_DUE: ${why}`);
  if (!hold) throw bad('보류 정보 없음');
  if (!hold.needed || hold.needed.trim() === '') throw bad('필요한 정보 없음');
  if (!isRole(hold.ownerRole)) throw bad('담당 역할 없음');
  // 형식만이 아니라 실제 달력 날짜여야 한다(2026-99-99, 2026-02-30 거부).
  if (!isIsoDate(hold.dueDate ?? '')) throw bad('기한이 없거나 실제 달력 날짜가 아님');
  if (today && hold.dueDate < today) throw bad(`기한 ${hold.dueDate}이 오늘 ${today}보다 이전`);
}

export function transition(
  s: { status: Status; routeLevel: RouteLevel },
  action: Action,
  actor: Actor,
  ctx: { today?: IsoDate; hold?: HoldInput } = {},
): Status {
  const rule = TABLE[s.status][action];
  if (!rule) throw new Error(`INVALID_TRANSITION: ${s.status} 상태에서 ${action} 불가`);
  const allowed = rule.by === 'decision' ? [decisionRole(s.routeLevel)] : rule.by;
  if (!allowed.includes(actor)) {
    throw new Error(`ROLE_NOT_ALLOWED: 역할 ${actor}: 상태 ${s.status}에서 ${action} 불가 (허용: ${allowed.join(', ')})`);
  }
  if (action === 'hold') assertHold(ctx.hold, ctx.today);
  return rule.to;
}
