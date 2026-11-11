import type { AssumptionSet } from './assumptions.js';
import { daysBetween } from './calendar.js';
import { buildCases, planTotal, alertStage } from './cases.js';
import { outflowInBreach, simulateCash } from './cash.js';
import { channelReturnBenchmark, evaluateIssues } from './issues.js';
import { computeCampaignPerformance, computeInfluencerPerformance } from './performance.js';
import { ROUTE_LABEL, routeCase } from './routing.js';
import type { DataRoom, IsoDate } from './types.js';

export interface IntakeRow {
  제안ID: string;
  종류: '기안' | '전속계약';
  인플루언서: string;
  캠페인: string;
  요청액: number;
  금액규모: '표본' | '풀스케일';
  확정기한: IsoDate;
  집행예정일: IsoDate | '';
  실효결정기한: IsoDate;
  남은일수: number;
  알림단계: string;
  기안예상GMV: number | '';
  기안예상명목ROAS: number | '';
  과거명목ROAS: number | '';
  과거실질ROAS: number | '';
  반품률: number | '';
  채널기준반품률: number | '';
  명목순위: number | '';
  실질순위: number | '';
  요청비중: number | '';
  기존집행비중: number | '';
  하회구간: string;
  하회구간해당: '예' | '아니오' | '미확인';
  승인경로: string;
  판정근거: string;
  필요정보: string;
  이슈: string;
  가정세트: string;
}

const r2 = (x: number | null): number | '' => (x === null ? '' : Math.round(x * 100) / 100);
const r3 = (x: number | null): number | '' => (x === null ? '' : Math.round(x * 1000) / 1000);

/** 값이 있는 항목만 내림차순 순위를 매긴다(계산 불가는 순위 없음). */
function rankDesc<T>(items: T[], key: (t: T) => number | null, id: (t: T) => string): Map<string, number> {
  const sorted = items.filter((t) => key(t) !== null).sort((a, b) => key(b)! - key(a)!);
  return new Map(sorted.map((t, i) => [id(t), i + 1]));
}

/** 제안 접수표: 기안 25건 + 전속계약 1건, 실효결정기한 오름차순. */
export function buildIntake(room: DataRoom, a: AssumptionSet, today: IsoDate = a.asOf): IntakeRow[] {
  const camps = computeCampaignPerformance(room, a);
  const infs = computeInfluencerPerformance(room, a);
  const cases = buildCases(room);
  const cash = simulateCash(room.full, a);
  const total = planTotal(cases);
  const bench = channelReturnBenchmark(room);
  const issues = evaluateIssues({ campaigns: camps, influencers: infs, cases, channelBenchmark: bench });

  const campById = new Map(camps.map((c) => [c.campaignId, c]));
  const infById = new Map(infs.map((i) => [i.influencerId, i]));
  const campNominalRank = rankDesc(camps, (c) => c.nominalRoas, (c) => c.campaignId);
  const campRealRank = rankDesc(camps, (c) => c.realRoas, (c) => c.campaignId);
  const infNominalRank = rankDesc(infs, (i) => i.nominalRoas, (i) => i.influencerId);
  const window = cash.breaches.length === 0 ? '없음' : cash.breaches.map((b) => `${b.start}~${b.end}`).join(', ');

  const rows = cases.map((k): IntakeRow => {
    const inf = infById.get(k.influencerId)!;
    const camp = k.campaignId ? campById.get(k.campaignId)! : null;
    const route = routeCase(k, { breaches: cash.breaches, planTotal: total });
    const codes = issues
      .filter((i) => i.targetId === k.id || i.targetId === k.influencerId || (camp && i.targetId === camp.campaignId))
      .map((i) => i.code);
    const benchPct = camp ? bench[camp.salesChannelType] : undefined;
    return {
      제안ID: k.id,
      종류: k.kind === 'plan' ? '기안' : '전속계약',
      인플루언서: inf.name,
      캠페인: k.campaignId ?? '',
      요청액: k.amount,
      금액규모: k.amountScale === 'sample' ? '표본' : '풀스케일',
      확정기한: k.deadline,
      집행예정일: k.settlementDate ?? '',
      실효결정기한: k.effectiveDeadline,
      남은일수: daysBetween(today, k.effectiveDeadline),
      알림단계: alertStage(today, k.effectiveDeadline) ?? '',
      기안예상GMV: k.expectedGmv ?? '',
      기안예상명목ROAS: k.expectedGmv === null || k.amount === 0 ? '' : r2(k.expectedGmv / k.amount),
      과거명목ROAS: r2(camp ? camp.nominalRoas : inf.nominalRoas),
      과거실질ROAS: r2(camp ? camp.realRoas : inf.realRoas),
      반품률: camp ? r3(camp.returnRate) : '',
      채널기준반품률: benchPct === undefined ? '' : r3(benchPct / 100),
      명목순위: (camp ? campNominalRank.get(camp.campaignId) : infNominalRank.get(inf.influencerId)) ?? '',
      실질순위: (camp ? campRealRank.get(camp.campaignId) : inf.realRank) ?? '',
      요청비중: r3(inf.requestShare),
      기존집행비중: r3(inf.spendShare),
      하회구간: window,
      하회구간해당: k.cashOutflowDate === null ? '미확인' : outflowInBreach(k.cashOutflowDate, cash.breaches) ? '예' : '아니오',
      승인경로: ROUTE_LABEL[route.level],
      판정근거: route.reasons.join(' / '),
      필요정보: route.needsInfo.join(';'),
      이슈: [...new Set(codes)].join(';'),
      가정세트: `${a.id}@${a.version}`,
    };
  });
  return rows.sort((x, y) => x.실효결정기한.localeCompare(y.실효결정기한) || x.제안ID.localeCompare(y.제안ID));
}

const esc = (v: string | number): string => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM + 쉼표 + CRLF. */
export function toCsv(rows: IntakeRow[]): string {
  if (rows.length === 0) return '﻿';
  const header = Object.keys(rows[0]) as (keyof IntakeRow)[];
  const lines = [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
