/**
 * 화면과 설명 문구에 나오는 금액 표기 한 곳. 만 원 단위, 천 단위 쉼표, 억 단위 표기 없음.
 * 만 원 미만 잔돈은 반올림하고, 10,000원 미만은 "N원"으로 둔다. (표기만 담당하며 금액 비교 로직에는 쓰지 않는다.)
 * 규정 기준 문구("10억 원", "1억 원", "1천만 원")는 규정 원문 용어라 이 함수를 거치지 않는다.
 */
export function formatMan(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 10_000) return `${sign}${a.toLocaleString('ko-KR')}원`;
  return `${sign}${Math.round(a / 10_000).toLocaleString('ko-KR')}만 원`;
}

/** 예측·추정 금액용: "약 546,888만 원" */
export const approxMan = (n: number): string => `약 ${formatMan(n)}`;

/** 실제 기록 시각(ISO)을 한국 시간 "시:분"으로. 업무일(시연 날짜)과는 별개다. 읽을 수 없으면 "—". */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}
