import { parsePipeCsv } from '../../src/engine/csv.js';

test('parses pipe CSV with BOM, CRLF and NONE', () => {
  const rows = parsePipeCsv('﻿a|b|c\r\n1|NONE|x\r\n2|3|y\r\n');
  expect(rows).toEqual([
    { a: '1', b: null, c: 'x' },
    { a: '2', b: '3', c: 'y' },
  ]);
});

test('accepts LF line endings and no trailing newline', () => {
  expect(parsePipeCsv('a|b\n1|2')).toEqual([{ a: '1', b: '2' }]);
});
