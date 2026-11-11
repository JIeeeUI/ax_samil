/**
 * 원본 데이터룸의 파이프(|) 구분 CSV 파서.
 * 원본 규칙: UTF-8, 첫 행 헤더, 값 안에 파이프·따옴표 없음, 해당 없음은 'NONE'.
 */
export function parsePipeCsv(text: string): Record<string, string | null>[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('|');
  return lines.slice(1).map((line) => {
    const cells = line.split('|');
    const row: Record<string, string | null> = {};
    header.forEach((h, i) => {
      const v = cells[i] ?? '';
      row[h] = v === 'NONE' ? null : v;
    });
    return row;
  });
}
