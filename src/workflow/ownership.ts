import { isRole, type Role } from './roles.js';

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

/** 확인할 것의 쉬운 이름(점검 결과의 "빠진 정보"에 쓴다) */
export const NEEDED_KO: Readonly<Record<string, string>> = {
  cash_outflow_date: '돈이 나가는 날(현금 유출일)',
  payment_schedule: '고정 비용 지급 일정',
  performance_fee_terms: '성과 피 조건(포함하면 연 10억 원을 넘는지)',
  contract_text: '계약 원문',
  notice_receipt_proof: '통보 수령 증빙',
  expected_gmv_basis: '예상 GMV 근거',
};
export const neededKo = (needed: string): string => (Object.hasOwn(NEEDED_KO, needed) ? NEEDED_KO[needed] : needed);

/** 무엇을 확인하느냐에 맞는 기본 담당. 목록에 없으면 재무. */
export function defaultOwnerFor(needed: string): Role {
  return Object.hasOwn(OWNER_BY_NEEDED, needed) ? OWNER_BY_NEEDED[needed] : 'finance';
}

/** 회신 입력은 담당 역할과 결재 역할(대표·CEO/이사회, 대신 입력)만 할 수 있다. */
export function canReply(actor: string, ownerRole: string): boolean {
  return isRole(actor) && (actor === ownerRole || actor === 'masil_ceo' || actor === 'ceo_board');
}

/** 회신으로 받을 수 있는 값은 요청 주제에 묶인다. 고정 피는 회신이 아니라 계약 조건 변경으로만 바뀐다. */
const REPLY_KEYS: Readonly<Record<string, readonly string[]>> = {
  cash_outflow_date: ['cashOutflowDate'],
  payment_schedule: ['cashOutflowDate'],
};
export function replyKeysFor(needed: string): readonly string[] {
  return Object.hasOwn(REPLY_KEYS, needed) ? REPLY_KEYS[needed] : [];
}

/** 계약 조건 변경(에이전시 제안 입력)은 계약 담당과 결재 역할만 한다. */
export const canChangeContract = (actor: string): boolean => actor === 'contract' || actor === 'masil_ceo' || actor === 'ceo_board';
