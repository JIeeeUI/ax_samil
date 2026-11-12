import type { RouteLevel } from '../engine/routing.js';
import { ROLES, type Role } from './roles.js';

export type AlertPlanId = 'current' | 'extended';

/** 알림 계획표의 한 행. 코드가 아니라 데이터라서 계획을 교체할 수 있다. */
export interface AlertRow {
  daysBefore: number;
  kind?: 'alert' | 'escalation';
  /** 항상 같은 메시지(messageKey)를 받는 역할 */
  audienceRoles: Role[];
  messageKey: string;
  /** 대표·CEO처럼 "준비된 결정 요청" 또는 "미준비 경고"만 받는 역할 */
  decisionRoles?: Role[];
  /** 역할별로 해당하는 승인 경로(없으면 모든 경로) */
  roleRoutes?: Partial<Record<Role, RouteLevel[]>>;
  onlyForRoutes?: RouteLevel[];
  condition?: 'undecided';
}

export interface AlertPlan {
  id: AlertPlanId;
  label: string;
  version: string;
  /** 계획표 값은 모두 가정이다(명세 5.3 C층) */
  labelKind: 'assumption';
  /** true: 이미 지난 단계도 만든다(기존 동작). false: 계획을 켠 날 이전에 지난 단계는 만들지 않고 "지남"으로만 표시 */
  retroactive: boolean;
  /** 1차 보류가 자기 기한을 넘기면 즉시 경고 */
  holdOverdueWarning: boolean;
  rows: AlertRow[];
}

const WORKERS: Role[] = ['marketing', 'finance', 'contract'];
const NOT_MARKETING: RouteLevel[] = ['CEO_BOARD', 'MASIL_CEO_GROUP_REPORT', 'MASIL_CEO'];
const LEADER_ROUTES = { masil_ceo: NOT_MARKETING, ceo_board: ['CEO_BOARD'] as RouteLevel[] };

export const ALERT_PLANS: Record<AlertPlanId, AlertPlan> = {
  current: {
    id: 'current', label: '기본(D-14·D-7·D-3, D-3 상급자 경고)', version: '2026-11-12.1', labelKind: 'assumption',
    retroactive: true, holdOverdueWarning: false,
    rows: [
      { daysBefore: 14, audienceRoles: ROLES, messageKey: 'remind' },
      { daysBefore: 7, audienceRoles: ROLES, messageKey: 'remind' },
      { daysBefore: 3, audienceRoles: ROLES, messageKey: 'remind' },
      { daysBefore: 3, kind: 'escalation', audienceRoles: ['masil_ceo', 'ceo_board'], messageKey: 'escalation', condition: 'undecided' },
    ],
  },
  extended: {
    id: 'extended', label: '확장(D-30·D-14·D-7·D-3, 대표·CEO에게는 결정 준비가 됐으면 요청, 안 됐으면 경고만)', version: '2026-11-12.1',
    labelKind: 'assumption', retroactive: false, holdOverdueWarning: true,
    rows: [
      { daysBefore: 30, audienceRoles: WORKERS, messageKey: 'prepare_start' },
      { daysBefore: 14, audienceRoles: WORKERS, messageKey: 'remind', decisionRoles: ['masil_ceo'], roleRoutes: { masil_ceo: NOT_MARKETING } },
      { daysBefore: 7, audienceRoles: WORKERS, messageKey: 'remind', decisionRoles: ['masil_ceo', 'ceo_board'], roleRoutes: LEADER_ROUTES },
      { daysBefore: 3, audienceRoles: WORKERS, messageKey: 'final_warning', decisionRoles: ['masil_ceo', 'ceo_board'], roleRoutes: LEADER_ROUTES },
    ],
  },
};

export const MESSAGE_TEXT: Record<string, string> = {
  remind: '결정 기한이 다가옵니다.',
  prepare_start: '결정 준비를 시작하세요(기한까지 30일).',
  final_warning: '최종 경고: 기한이 곧 지납니다.',
  decision_request: '결정에 필요한 서류가 갖춰졌습니다. 결정을 요청합니다.',
  not_ready_warning: '아직 결정 준비가 안 됐는데 기한이 다가옵니다.',
  pending_reminder: '병행 상신한 결정이 아직 남아 있습니다(미결 재알림).',
  escalation: '결정 없이 기한이 지나면 자동 확정(또는 확정 전 집행)됩니다.',
  parallel_request: '1차 검토가 끝나지 않았지만 기한이 임박해 결정을 병행 요청합니다.',
  primary_pending: '1차 검토가 미결입니다. CEO/이사회에 병행 상신했습니다.',
  primary_hold_overdue: '1차 보류가 자기 기한을 넘겼습니다.',
};

/** 이 행에서 누가 어떤 메시지를 받는지. 결정 수신자는 준비 여부에 따라 메시지가 달라진다. */
export function recipientsFor(
  row: AlertRow, route: RouteLevel, ctx: { ready: boolean; parallel: boolean },
): { role: Role; messageKey: string }[] {
  if (row.onlyForRoutes && !row.onlyForRoutes.includes(route)) return [];
  const applies = (role: Role) => !row.roleRoutes?.[role] || row.roleRoutes[role]!.includes(route);
  const out = row.audienceRoles.filter(applies).map((role) => ({ role, messageKey: row.messageKey }));
  for (const role of row.decisionRoles ?? []) {
    if (!applies(role)) continue;
    const messageKey = role === 'ceo_board' && ctx.parallel ? 'pending_reminder' : ctx.ready ? 'decision_request' : 'not_ready_warning';
    out.push({ role, messageKey });
  }
  return out;
}
