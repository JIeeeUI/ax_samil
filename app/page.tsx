import { DEFAULT_ASSUMPTIONS } from '../src/engine/assumptions.js';
import { loadDataRoom } from '../src/engine/dataRoom.js';
import { buildIntake } from '../src/engine/intake.js';

export const dynamic = 'force-dynamic';

export default function Home() {
  const rows = buildIntake(loadDataRoom(), DEFAULT_ASSUMPTIONS);
  return <main><h1>인플루언서 제안 접수·판정</h1><p>접수표 {rows.length}건</p></main>;
}
