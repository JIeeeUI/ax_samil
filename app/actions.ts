'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { commands, decisionFromForm, type Result } from '../src/app/commands.js';
import { getService } from '../src/app/instance.js';
import { SCENARIOS, type ScenarioId } from '../src/engine/assumptions.js';
import type { ConfigPatch } from '../src/app/service.js';
import { defaultOwnerFor } from '../src/workflow/ownership.js';
import { isRole, type Role } from '../src/workflow/roles.js';
import { RETURN_REASONS, type ReturnReason } from '../src/workflow/schedule.js';
import { currentRole } from './session.js';

const field = (fd: FormData, k: string): string => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
};

/** 같은 사이트 안의 경로만 허용한다. */
const back = (fd: FormData): string => {
  const b = field(fd, 'back');
  return b.startsWith('/') && !b.startsWith('//') ? b : '/';
};

async function done(fd: FormData, r: Result): Promise<never> {
  revalidatePath('/', 'layout');
  const b = back(fd);
  redirect(r.ok ? b : `${b}${b.includes('?') ? '&' : '?'}error=${encodeURIComponent(r.error)}`);
}

const cmd = async () => commands(await getService());
const num = (s: string) => (s === '' ? undefined : Number(s.replace(/,/g, '')));

export async function setRole(fd: FormData) {
  const r = field(fd, 'role');
  if (isRole(r)) (await cookies()).set('role', r, { path: '/', sameSite: 'lax' });
  return done(fd, { ok: true });
}
export async function actConfirmFinance(fd: FormData) { return done(fd, await (await cmd()).confirmFinance(field(fd, 'id'), await currentRole(), field(fd, 'opinion'))); }

/** 재무 반려(보완 요청): 사유(복수)·기타 입력·재무 의견 */
export async function actFinanceReturn(fd: FormData) {
  const reasons = fd.getAll('reasons').filter((v): v is string => typeof v === 'string') as ReturnReason[];
  return done(fd, await (await cmd()).financeReturn(field(fd, 'id'), await currentRole(), { reasons, otherText: field(fd, 'otherText'), opinion: field(fd, 'opinion') }));
}

/** 마케팅의 반려 회신: 조정 / 변경 없음 / 협의 필요 */
export async function actRevisionReply(fd: FormData) {
  const kind = field(fd, 'kind');
  if (kind !== 'adjust' && kind !== 'keep' && kind !== 'consult') return done(fd, { ok: false, error: 'INVALID_ADJUSTMENT: 회신 종류를 고르세요' });
  const date = field(fd, 'settlementDate');
  const amount = num(field(fd, 'amount'));
  return done(fd, await (await cmd()).replyRevision(field(fd, 'id'), await currentRole(), {
    kind, text: field(fd, 'text'), ...(date ? { settlementDate: date } : {}), ...(amount !== undefined ? { amount } : {}),
  }));
}

/** 반려 사유 목록 켜기·끄기(설정) */
export async function actSetReturnReasons(fd: FormData) {
  const returnReasons = Object.fromEntries(RETURN_REASONS.map((k) => [k, fd.get(`rr_${k}`) === 'on']));
  return done(fd, await (await cmd()).setConfig({ returnReasons }));
}
export async function actSubmit(fd: FormData) { return done(fd, await (await cmd()).submit(field(fd, 'id'), await currentRole())); }
export async function actResubmit(fd: FormData) { return done(fd, await (await cmd()).resubmit(field(fd, 'id'), await currentRole())); }
export async function actClose(fd: FormData) { return done(fd, await (await cmd()).close(field(fd, 'id'), await currentRole())); }

export async function actDecide(fd: FormData) {
  const f = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : '']));
  let decision;
  try { decision = decisionFromForm(f); } catch (e) { return done(fd, { ok: false, error: (e as Error).message }); }
  return done(fd, await (await cmd()).decide(field(fd, 'id'), await currentRole(), decision));
}

export async function actReply(fd: FormData) {
  const date = field(fd, 'cashOutflowDate');
  const fee = num(field(fd, 'fee'));
  const values = { ...(date ? { cashOutflowDate: date } : {}), ...(fee !== undefined ? { annualFixedFeeKrw: fee } : {}) };
  const hasValues = Object.keys(values).length > 0;
  return done(fd, await (await cmd()).reply(Number(field(fd, 'requestId')), await currentRole(), field(fd, 'text'), hasValues ? values : undefined, true, field(fd, 'resolved') === '1'));
}

export async function actProposeChange(fd: FormData) {
  return done(fd, await (await cmd()).proposeChange(await currentRole(), num(field(fd, 'fee')) ?? NaN));
}

/** 1차 대표 검토: 상신 / 보류 / 반려 */
export async function actPrimary(fd: FormData) {
  const id = field(fd, 'id');
  const role = await currentRole();
  const c = await cmd();
  const op = field(fd, 'op');
  if (op === 'escalate') return done(fd, await c.primaryEscalate(id, role));
  if (op === 'return') return done(fd, await c.primaryReturn(id, role, field(fd, 'rejectReason')));
  if (op === 'hold') {
    return done(fd, await c.primaryHold(id, role, { needed: field(fd, 'holdNeeded'), ownerRole: (field(fd, 'holdOwner') || defaultOwnerFor(field(fd, 'holdNeeded'))) as Role, dueDate: field(fd, 'holdDue') }));
  }
  return done(fd, { ok: false, error: `INVALID_OP: ${op}` });
}

/** 결재·알림 설정([가정]): 1차/2차 켜기, 긴급 기준, 1차 보류 상한, 알림 계획표 */
export async function actSetConfig(fd: FormData) {
  const patch: ConfigPatch = {};
  if (field(fd, 'twoStage') !== '') patch.twoStage = field(fd, 'twoStage') === 'on';
  if (field(fd, 'urgentDays') !== '') patch.urgentDays = Number(field(fd, 'urgentDays'));
  if (field(fd, 'holdCapDays') !== '') patch.holdCapDays = Number(field(fd, 'holdCapDays'));
  if (field(fd, 'alertPlan') !== '') patch.alertPlan = field(fd, 'alertPlan') as NonNullable<ConfigPatch['alertPlan']>;
  return done(fd, await (await cmd()).setConfig(patch));
}

export async function actAdvanceClock(fd: FormData) { return done(fd, await (await cmd()).advanceClock(field(fd, 'date'))); }
export async function actSetScenario(fd: FormData) {
  const id = field(fd, 'scenario');
  if (!Object.hasOwn(SCENARIOS, id)) return done(fd, { ok: false, error: `UNKNOWN_SCENARIO: ${id}` });
  return done(fd, await (await cmd()).setScenario(id as ScenarioId));
}
export async function actReset(fd: FormData) { return done(fd, await (await cmd()).reset()); }
