import { cookies } from 'next/headers';
import { isRole, type Role } from '../src/workflow/roles.js';

/** 로그인 대신 쿠키로 역할을 전환한다(명세 1장). */
export async function currentRole(): Promise<Role> {
  const v = (await cookies()).get('role')?.value;
  return isRole(v) ? v : 'marketing';
}
