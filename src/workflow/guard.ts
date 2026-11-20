import { THRESHOLDS } from '../engine/assumptions.js';
import { addDays } from '../engine/calendar.js';
import type { Case } from '../engine/cases.js';
import type { IsoDate } from '../engine/types.js';
import type { Status } from './status.js';

export type Stage = 'D-14' | 'D-7' | 'D-3' | 'overdue';

/** 알림 단계별 시작일: 기한−14/−7/−3일, 기한 경과는 기한+1일 (달력일). */
export function stagesDue(today: IsoDate, effectiveDeadline: IsoDate): Stage[] {
  const [d14, d7, d3] = THRESHOLDS.alertDays;
  const starts: [Stage, IsoDate][] = [
    ['D-14', addDays(effectiveDeadline, -d14)],
    ['D-7', addDays(effectiveDeadline, -d7)],
    ['D-3', addDays(effectiveDeadline, -d3)],
    ['overdue', addDays(effectiveDeadline, 1)],
  ];
  return starts.filter(([, start]) => start <= today).map(([stage]) => stage);
}

/** D-3 이후 결재자에게 제시하는 선택지 (조건 변경 통보 / 해지 통보 / 상신 후 승인) */
export const ESCALATION_OPTIONS = ['change_terms_notice', 'termination_notice', 'submit_then_approve'] as const;

/** 건 종류별 선택지: 조건 변경·해지 통보는 계약에만 의미가 있다. 캠페인 기안은 상신 후 승인만 고를 수 있다. */
export function escalationOptionsFor(kind: 'contract' | 'plan'): readonly (typeof ESCALATION_OPTIONS)[number][] {
  return kind === 'contract' ? ESCALATION_OPTIONS : ['submit_then_approve'];
}

const UNDECIDED: ReadonlySet<Status> = new Set<Status>(['finance_review', 'routed', 'submitted', 'on_hold', 'revision', 'consulting']);

/** 결정 전 상태면 D-3 이후 상위 결재자에게 올린다. */
export const needsEscalation = (status: Status): boolean => UNDECIDED.has(status);

export interface LinkWarning { influencerId: string; message: string }

/** 같은 인플루언서의 기안만 부결되고 전속계약이 미결정이면 경고한다. */
export function linkWarnings(cases: Case[], statuses: Map<string, Status>): LinkWarning[] {
  const out: LinkWarning[] = [];
  for (const group of new Set(cases.map((c) => c.linkGroup))) {
    const mine = cases.filter((c) => c.linkGroup === group);
    const contract = mine.find((c) => c.kind === 'contract');
    if (!contract || !needsEscalation(statuses.get(contract.id) ?? 'finance_review')) continue;
    const rejected = mine.filter((c) => c.kind === 'plan' && statuses.get(c.id) === 'rejected');
    if (rejected.length > 0) {
      out.push({
        influencerId: group,
        message: `기안만 부결, 계약은 자동 갱신: ${rejected.map((c) => c.id).join(', ')} 부결 후 전속계약(${contract.id})이 미결정입니다. 통보 기한 ${contract.effectiveDeadline}을 넘기면 동일 조건으로 갱신됩니다.`,
      });
    }
  }
  return out;
}
