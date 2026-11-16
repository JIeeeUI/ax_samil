/**
 * 업무용 말투로 바꾼다('~해요' → '~합니다').
 * 화면 파일의 고정 문구는 한 번 일괄 변환했고, 서비스(src/)에서 오는 문장은 화면에 그릴 때 이 함수를 거친다.
 */
const RULES: [RegExp, string][] = [
  [/하시겠어요/g, '하시겠습니까'],
  [/([가-힣])세요(?![가-힣])/g, '$1십시오'],
  [/눌러요(?![가-힣])/g, '누릅니다'],
  [/달라요(?![가-힣])/g, '다릅니다'],
  [/같아요(?![가-힣])/g, '같습니다'],
  [/하나요(?![가-힣])/g, '합니까'],
  [/인가요(?![가-힣])/g, '입니까'],
  [/([가-힣])나요(?![가-힣])/g, '$1습니까'],
  [/([가-힣])(?:어|아)요(?![가-힣])/g, '$1습니다'],
  [/봐요(?![가-힣])/g, '봅니다'],
  [/해요(?![가-힣])/g, '합니다'],
  [/돼요(?![가-힣])/g, '됩니다'],
  [/이에요(?![가-힣])/g, '입니다'],
  [/예요(?![가-힣])/g, '입니다'],
];

export function formal(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}

/** 서버가 돌려주는 오류 문구('CODE: 설명')를 사용자에게 보이는 쉬운 한국어 한 문장으로 바꾼다. 영문 코드 접두어는 숨긴다. */
export function friendlyError(raw: string): string {
  // 개발용 필드 이름(예: 값(cashOutflowDate))은 쉬운 말로 바꾸거나 숨긴다.
  const noDev = friendlyCore(raw).replace(/값\(cashOutflowDate\)을/g, '날짜를').replace(/\s?\([a-z]+[A-Z][A-Za-z]*\)/g, '');
  return koDates(noDev);
}

/** 2026-07-17 → 7월 17일 (오류 문구 안의 날짜를 화면의 다른 날짜 표기와 맞춘다) */
const koDates = (t: string) => t.replace(/20\d\d-(\d\d)-(\d\d)/g, (_, m: string, d: string) => `${Number(m)}월 ${Number(d)}일`);

function friendlyCore(raw: string): string {
  const m = raw.match(/^([A-Z][A-Z0-9_]{2,}):\s*([\s\S]*)$/);
  const code = m ? m[1] : '';
  const rest = (m ? m[2] : raw).trim();
  const stale = /방금 다른 요청으로/.test(rest);
  switch (code) {
    case 'INVALID_TRANSITION':
      return stale ? '방금 다른 곳에서 먼저 처리되었습니다. 화면을 새로 고쳐 최신 상태를 확인하십시오.' : '지금 단계에서는 할 수 없는 작업입니다.';
    case 'ROLE_NOT_ALLOWED':
      return /^역할 /.test(rest) ? '지금 선택한 역할로는 이 작업을 할 수 없습니다. 위쪽에서 역할을 바꿔 다시 시도하십시오.' : formal(rest.replace(/\([^)]*\)\s*$/, '').trim());
    case 'HOLD_REQUIRES_OWNER_AND_DUE':
      return '보류하려면 확인할 내용과 담당, 그리고 오늘 이후의 실제 날짜인 기한을 입력해야 합니다.';
    case 'CASE_CLOSED':
      return '이미 끝난 건이라 반영할 수 없습니다.';
    case 'UNKNOWN_CASE': case 'UNKNOWN_REQUEST': case 'UNKNOWN_SCENARIO':
      return '찾을 수 없는 항목입니다. 목록에서 다시 선택하십시오.';
    case 'INVALID_DECISION': case 'NOT_INITIALIZED': case 'INVALID_CONFIG': case 'CLOCK_BACKWARDS': case 'INVALID_DATE':
      return rest && !/^[\w${}().\-\s]+$/.test(rest) ? formal(rest) : '입력한 내용을 처리할 수 없습니다. 값을 확인한 뒤 다시 시도하십시오.';
    default:
      return formal(rest || raw);
  }
}
