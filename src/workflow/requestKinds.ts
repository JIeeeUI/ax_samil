import type { Role } from './roles.js';

/**
 * 확인 요청 종류별 한 정의: 코드, 쉬운 이름, 담당 역할, 필수 입력값, 설명·근거, AI용 라벨.
 * 담당 = 정보를 가진 부서 [교육용 가정]. 근거: W02 흐름도 레인(마케팅=갱신 통보 접수·상대방 통보, 재무=성과·비용표 취합,
 * 계약 담당=계약조건·기한 확인·통보·회신 기록 보관), 통보서 수신처(마케팅본부/재무팀), 회의록(기안 상신=마케팅팀, 현금 대조·전결 범위 확인=재무팀).
 * 원본은 보류 이후의 담당을 정하지 않았다(W02 문서 질문 미해결).
 * 이름이 화면별로 조금 다른 이유(점검 줄/건 화면/확인 요청 화면/AI 초안)는 기존 문구를 그대로 두기 위해서다.
 */
export interface RequestKind {
  code: string;
  owner: Role;
  /** 점검 결과 "빠진 정보"에 쓰는 이름 */
  check: string;
  /** 건 화면 목록의 쉬운 이름(없으면 check) */
  plain?: string;
  /** 확인 요청 화면의 이름(없으면 plain) */
  page?: string;
  /** AI 초안 라벨(없으면 check) */
  ai?: string;
  /** 완료하려면 반드시 필요한 구조화 값(없으면 본문만 있으면 된다) */
  requires: 'cashOutflowDate' | null;
  /** 회신에 담을 수 있는 구조화 값(필수는 아니어도 받는다: 예 지급 일정 요청에 날짜) */
  accepts: 'cashOutflowDate' | null;
  /** 이 정보가 없으면 무엇이 안 되는지(AI 초안·안내 근거) */
  why?: string;
}

export const REQUEST_KINDS: Readonly<Record<string, RequestKind>> = {
  cash_outflow_date: {
    code: 'cash_outflow_date', owner: 'finance', check: '돈이 나가는 날(현금 유출일)', plain: '고정 비용이 실제로 나가는 날짜',
    ai: '고정 피 현금 유출일(지급 일정)', requires: 'cashOutflowDate', accepts: 'cashOutflowDate',
    why: '하회 구간(covenant) 해당 여부를 판정할 수 없어 승인 경로가 확정되지 않습니다.',
  },
  payment_schedule: {
    code: 'payment_schedule', owner: 'finance', check: '고정 비용 지급 일정', ai: '고정 피 지급 일정', requires: null, accepts: 'cashOutflowDate',
  },
  performance_fee_terms: {
    code: 'performance_fee_terms', owner: 'contract', check: '성과 피 조건(포함하면 연 10억 원을 넘는지)',
    page: '성과 피(GMV 연동) 조건 — 포함하면 연 10억 원을 넘는지', ai: '성과 피(GMV 연동) 조건', requires: null, accepts: null,
    why: '성과 피를 포함하면 연 10억 원을 넘을 수 있어 승인 경로가 잠정입니다.',
  },
  contract_text: { code: 'contract_text', owner: 'contract', check: '계약 원문', requires: null, accepts: null },
  notice_receipt_proof: { code: 'notice_receipt_proof', owner: 'contract', check: '통보 수령 증빙', requires: null, accepts: null },
  expected_gmv_basis: { code: 'expected_gmv_basis', owner: 'marketing', check: '예상 GMV 근거', requires: null, accepts: null },
};

/** 코드로 종류를 찾는다. 자유 문장(보류 때 직접 입력한 항목)이거나 프로토타입 키면 null. */
export function kindOf(code: string): RequestKind | null {
  return Object.hasOwn(REQUEST_KINDS, code) ? REQUEST_KINDS[code] : null;
}

export type LabelStyle = 'check' | 'plain' | 'page' | 'ai';
/** 화면별 이름. 정의에 없는 코드(자유 문장)는 그대로 돌려준다. */
export function requestLabel(code: string, style: LabelStyle): string {
  const k = kindOf(code);
  if (!k) return code;
  switch (style) {
    case 'check': return k.check;
    case 'plain': return k.plain ?? k.check;
    case 'page': return k.page ?? k.plain ?? k.check;
    case 'ai': return k.ai ?? k.check;
  }
}

export const ownerOfKind = (code: string): Role => kindOf(code)?.owner ?? 'finance';
export const acceptedValueOf = (code: string): RequestKind['accepts'] => kindOf(code)?.accepts ?? null;
export const requiredValueOf = (code: string): RequestKind['requires'] => kindOf(code)?.requires ?? null;
export const whyOf = (code: string): string | null => kindOf(code)?.why ?? null;
