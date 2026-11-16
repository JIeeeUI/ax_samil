import { describe, expect, it } from 'vitest';
import { friendlyError } from '../../app/formal.js';
import { noTurnNotice, waitingOn } from '../../app/plain.js';
import type { TodayItem } from '../../src/app/service.js';

const item = (status: string, extra: Partial<TodayItem> = {}) => ({ status, routeLevel: 'CEO_BOARD', primaryPending: false, ...extra }) as unknown as TodayItem;

describe('friendlyError', () => {
  it('hides code prefixes and English codes', () => {
    expect(friendlyError('OPINION_REQUIRED: 재무 의견을 입력해야 합니다')).toBe('재무 의견을 입력해야 합니다');
    expect(friendlyError('INVALID_REPLY: 회신 내용을 입력해야 합니다')).not.toMatch(/INVALID_REPLY/);
  });
  it('explains hold due errors in one plain sentence and keeps no ISO dates', () => {
    const m = friendlyError('HOLD_REQUIRES_OWNER_AND_DUE: 기한 2026-06-01이 오늘 2026-07-01보다 이전');
    expect(m).toContain('오늘 이후');
    expect(m).not.toMatch(/HOLD_|2026-/);
  });
  it('turns stale-state and role errors into plain sentences', () => {
    expect(friendlyError('INVALID_TRANSITION: PLAN-001: 방금 다른 요청으로 처리되었습니다')).toContain('먼저 처리');
    expect(friendlyError('ROLE_NOT_ALLOWED: 역할 marketing: 상태 submitted에서 approve 불가 (허용: ceo_board)')).not.toMatch(/marketing|submitted/);
    expect(friendlyError('UNKNOWN_CASE: X')).toContain('찾을 수 없는');
  });
  it('converts dates in other messages to the on-screen style', () => {
    expect(friendlyError('PRIMARY_HOLD_LIMIT: 1차 보류 기한은 2026-07-10을 넘을 수 없습니다')).toContain('7월 10일');
  });
});

describe('no-turn notice', () => {
  it('says what the open cases are waiting for, with counts', () => {
    const n = noTurnNotice([item('finance_review'), item('finance_review'), item('submitted'), item('approved')]);
    expect(n).toContain('재무 확인 대기 2건');
    expect(n).toContain('CEO/이사회의 결정 대기 1건');
    expect(n).toContain('내 차례에 표시');
  });
  it('is null when every case is finished', () => {
    expect(noTurnNotice([item('approved'), item('closed')])).toBeNull();
    expect(waitingOn(item('closed'))).toBeNull();
  });
});

describe('friendlyError developer terms', () => {
  it('replaces the cashOutflowDate field name with a plain word', () => {
    const m = friendlyError('INVALID_REPLY: "돈이 나가는 날(현금 유출일)" 요청은 값(cashOutflowDate)을 입력해야 완료할 수 있습니다');
    expect(m).toContain('날짜를 입력해야');
    expect(m).not.toMatch(/cashOutflowDate|INVALID_REPLY/);
  });
});
