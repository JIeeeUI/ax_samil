import type { ReactNode } from 'react';
import type { ScenarioId } from '../src/engine/assumptions.js';
import type { Status } from '../src/workflow/status.js';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export const STATUS_LABEL: Record<Status, string> = {
  finance_review: '재무 확인 대기', routed: '경로 판정됨(상신 대기)', submitted: '상신됨(결정 대기)', approved: '승인',
  rejected: '거절', on_hold: '보류(확인 요청 중)', overdue: '기한 경과(자동 확정)', closed: '종결',
  revision: '재무 반려(마케팅 보완 중)', consulting: '협의 중',
};

export const SCENARIO_LABEL: Record<ScenarioId, string> = {
  baseline: '기본 (연체 AR·AP 기준일 처리, LC-0001 90일)', arOverdueExcluded: '연체 AR 제외', apOverdueExcluded: '연체 AP 제외',
  bothOverdueExcluded: '연체 AR·AP 모두 제외', lc45: 'LC-0001 45일 (민감도 점검)',
};

export const LABEL_KO = { confirmed: '확정', benchmark: '벤치마크', assumption: '가정' } as const;

export const ACTION_LABEL: Record<string, string> = {
  received: '접수', calculated: '자동 계산', confirm_finance: '재무 확인·경로 판정', submit: '상신', approve: '승인',
  reject: '거절', hold: '보류', reply: '회신 반영', reply_pending: '회신(값 없음, 보류 유지)', resubmit: '재상신', close: '종결',
  expire: '기한 경과', scenario_change: '시나리오 변경 재판정', propose_change: '계약 조건 변경 제안',
  finance_return: '재무 반려(보완 요청)', revision_adjust: '마케팅 조정', adjust: '마케팅 조정(집행일·요청액)', keep: '마케팅: 변경 없음', consult: '마케팅: 협의 필요',
  notice_created: '에이전시 통보 작업 생성', notice_sent: '에이전시 통보 발송(모의)', notice_recorded: '통보·수령 기록(모의)', notice_void: '통보 작업 취소',
  revision_unanswered: '미응답(결재자에게 자동 전달)',
};

export const ESCALATION_LABEL: Record<string, string> = {
  change_terms_notice: '조건 변경 통보', termination_notice: '해지 통보', submit_then_approve: '상신 후 승인',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'red' | 'amber' | 'green' | 'blue' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function routeTone(level: string): 'red' | 'amber' | 'blue' | 'green' {
  return level === 'CEO_BOARD' ? 'red' : level.startsWith('MASIL_CEO') ? 'amber' : 'green';
}

export function Flash({ error }: { error?: string }) {
  return error ? <div role="alert" className="flash flash-error">오류: {error}</div> : null;
}

export function stageTone(stage: string): 'red' | 'amber' | 'blue' | 'gray' {
  return stage === 'D-3' || stage === 'overdue' ? 'red' : stage === 'D-7' ? 'amber' : stage === 'D-14' ? 'blue' : 'gray';
}

export const pct = (x: number | ''): string => (x === '' ? '-' : `${(x * 100).toFixed(1)}%`);
