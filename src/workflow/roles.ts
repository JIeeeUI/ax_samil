import type { RouteLevel } from '../engine/routing.js';

export type Role = 'marketing' | 'finance' | 'contract' | 'masil_ceo' | 'ceo_board';

export const ROLE_LABEL: Record<Role, string> = {
  marketing: '마케팅 담당',
  finance: 'Masil 재무팀',
  contract: '계약 담당',
  masil_ceo: 'Masil 대표',
  ceo_board: 'CEO/이사회',
};

export const ROLES = Object.keys(ROLE_LABEL) as Role[];

export const isRole = (v: unknown): v is Role => typeof v === 'string' && v in ROLE_LABEL;

/** 승인 경로별로 최종 결정을 내리는 역할 */
export function decisionRole(level: RouteLevel): Role {
  switch (level) {
    case 'CEO_BOARD': return 'ceo_board';
    case 'MASIL_CEO_GROUP_REPORT':
    case 'MASIL_CEO': return 'masil_ceo';
    case 'MARKETING': return 'marketing';
  }
}
