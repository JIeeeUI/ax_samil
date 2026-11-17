import snapshot from '../../../../public/snapshot.json';
import { CaseView } from './case-view.js';

/** 정적 파일로 굽기 때문에 건 번호를 미리 알려 준다(기안 25건 + 전속계약 1건). */
export function generateStaticParams(): { id: string }[] {
  return [...snapshot.room.budgetPlan.map((p) => ({ id: p.plan_id })), { id: 'CONTRACT-INF-001' }];
}
export const dynamicParams = false;

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseView id={id} />;
}
