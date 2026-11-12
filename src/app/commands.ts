import type { ScenarioId } from '../engine/assumptions.js';
import type { IsoDate } from '../engine/types.js';
import type { Role } from '../workflow/roles.js';
import { defaultOwnerFor } from '../workflow/ownership.js';
import type { HoldInput } from '../workflow/status.js';
import type { Actor, ConfigPatch, Decision, IntakeService, ReplyValues } from './service.js';

export type Result = { ok: true } | { ok: false; error: string };

/** 서비스 예외를 화면에 보여 줄 오류 메시지로 바꾼다(상태는 서비스가 바꾸지 않은 채로 남는다). */
export async function attempt(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 폼 값(문자열 맵)을 결정으로 바꾼다. 보류의 담당·기한 검증은 서비스(상태 기계)가 한다. */
export function decisionFromForm(f: Record<string, string | undefined>): Decision {
  if (f.decision === 'approve') return 'approve';
  if (f.decision === 'reject') return { reject: { reason: f.rejectReason ?? '' } };
  if (f.decision === 'hold') {
    return { hold: { needed: f.holdNeeded ?? '', ownerRole: ((f.holdOwner ?? '') || defaultOwnerFor(f.holdNeeded ?? '')) as Role, dueDate: f.holdDue ?? '' } };
  }
  throw new Error(`INVALID_DECISION: ${String(f.decision)}`);
}

export function commands(svc: IntakeService) {
  return {
    confirmFinance: (id: string, role: Actor, opinion?: string) => attempt(() => svc.confirmFinance(id, role, { opinion })),
    financeReturn: (id: string, role: Actor, input: Parameters<IntakeService['financeReturn']>[2]) => attempt(() => svc.financeReturn(id, role, input)),
    replyRevision: (id: string, role: Actor, input: Parameters<IntakeService['replyRevision']>[2]) => attempt(() => svc.replyRevision(id, role, input)),
    sendNotice: (id: string, role: Actor, input: Parameters<IntakeService['sendNotice']>[2]) => attempt(() => svc.sendNotice(id, role, input)),
    recordNotice: (id: string, role: Actor, input: Parameters<IntakeService['recordNotice']>[2]) => attempt(() => svc.recordNotice(id, role, input)),
    submit: (id: string, role: Actor) => attempt(() => svc.submit(id, role)),
    decide: (id: string, role: Actor, d: Decision) => attempt(() => svc.decide(id, role, d)),
    resubmit: (id: string, role: Actor) => attempt(() => svc.resubmit(id, role)),
    close: (id: string, role: Actor) => attempt(() => svc.close(id, role)),
    reply: (requestId: number, actor: Actor, text: string, values: ReplyValues | undefined, simulated: boolean, resolved = false) =>
      attempt(() => svc.replyInfoRequest(requestId, { actor, text, values, simulated, resolved })),
    proposeChange: (actor: Actor, fee: number) => attempt(() => svc.proposeContractChange({ actor, annualFixedFeeKrw: fee })),
    primaryEscalate: (id: string, role: Actor) => attempt(() => svc.primaryEscalate(id, role)),
    primaryHold: (id: string, role: Actor, hold: HoldInput) => attempt(() => svc.primaryHold(id, role, hold)),
    primaryReturn: (id: string, role: Actor, reason: string) => attempt(() => svc.primaryReturn(id, role, reason)),
    setConfig: (patch: ConfigPatch) => attempt(() => svc.setConfig(patch)),
    advanceClock: (to: IsoDate) => attempt(() => svc.advanceClock(to)),
    setScenario: (id: ScenarioId) => attempt(() => svc.setScenario(id)),
    reset: () => attempt(() => svc.reset()),
  };
}
