import type { Role } from './roles.js';

/**
 * 확인 요청의 담당 = 정보를 가진 부서. [교육용 가정]
 * 근거: W02 흐름도 레인(마케팅=갱신 통보 접수·상대방 통보, 재무=성과·비용표 취합, 계약 담당=계약조건·기한 확인·통보·회신 기록 보관),
 * 통보서 수신처(마케팅본부/재무팀), 회의록(기안 상신=마케팅팀, 현금 대조·전결 범위 확인=재무팀).
 * 원본은 보류 이후의 담당을 정하지 않았다(W02 문서 질문 미해결).
 */
export const OWNER_BY_NEEDED: Readonly<Record<string, Role>> = {
  cash_outflow_date: 'finance',
  payment_schedule: 'finance',
  performance_fee_terms: 'contract',
  contract_text: 'contract',
  notice_receipt_proof: 'contract',
  expected_gmv_basis: 'marketing',
};

/** 무엇을 확인하느냐에 맞는 기본 담당. 목록에 없으면 재무. */
export function defaultOwnerFor(needed: string): Role {
  return Object.hasOwn(OWNER_BY_NEEDED, needed) ? OWNER_BY_NEEDED[needed] : 'finance';
}

/** 회신 입력은 담당 역할과 결재 역할(대표·CEO/이사회, 대신 입력)만 할 수 있다. */
export function canReply(actor: string, ownerRole: string): boolean {
  return actor === ownerRole || actor === 'masil_ceo' || actor === 'ceo_board';
}
