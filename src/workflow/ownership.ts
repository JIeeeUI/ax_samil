import { ownerOfKind, acceptedValueOf, requestLabel, REQUEST_KINDS } from './requestKinds.js';
import { isRole, type Role } from './roles.js';

/** 확인 요청의 담당·이름·필수 입력은 requestKinds.ts의 한 정의를 쓴다. 아래는 기존 이름을 유지하는 얇은 조회 함수다. */
export const OWNER_BY_NEEDED: Readonly<Record<string, Role>> = Object.fromEntries(Object.values(REQUEST_KINDS).map((k) => [k.code, k.owner]));

/** 확인할 것의 쉬운 이름(점검 결과의 "빠진 정보"에 쓴다) */
export const neededKo = (needed: string): string => requestLabel(needed, 'check');

/** 무엇을 확인하느냐에 맞는 기본 담당. 목록에 없으면 재무. */
export const defaultOwnerFor = ownerOfKind;

/** 회신 입력은 담당 역할과 결재 역할(대표·CEO/이사회, 대신 입력)만 할 수 있다. */
export function canReply(actor: string, ownerRole: string): boolean {
  return isRole(actor) && (actor === ownerRole || actor === 'masil_ceo' || actor === 'ceo_board');
}

/** 회신으로 받을 수 있는 값은 요청 주제에 묶인다. 고정 피는 회신이 아니라 계약 조건 변경으로만 바뀐다. */
export function replyKeysFor(needed: string): readonly string[] {
  const r = acceptedValueOf(needed);
  return r ? [r] : [];
}

/** 계약 조건 변경(에이전시 제안 입력)은 계약 담당과 결재 역할만 한다. */
export const canChangeContract = (actor: string): boolean => actor === 'contract' || actor === 'masil_ceo' || actor === 'ceo_board';
