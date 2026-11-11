// npm test의 tsc 단계에서 검증된다(vitest 실행 대상 아님).
// 표본 계열을 현금 시뮬레이션(풀스케일)에 넣으면 컴파일 오류가 나야 한다.
import { simulateCash } from '../../src/engine/cash.js';
import { DEFAULT_ASSUMPTIONS } from '../../src/engine/assumptions.js';
import type { DataRoom } from '../../src/engine/types.js';

declare const room: DataRoom;

// @ts-expect-error 표본 계열은 현금 시뮬레이션에 넣을 수 없다
simulateCash(room.sample, DEFAULT_ASSUMPTIONS);

simulateCash(room.full, DEFAULT_ASSUMPTIONS);
