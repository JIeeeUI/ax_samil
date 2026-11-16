import { spawnSync } from 'node:child_process';
import { demoDbDecision } from '../../src/app/demoGuard.js';

test('the demo refuses to touch a configured database unless explicitly confirmed', () => {
  expect(demoDbDecision({})).toEqual({ allowed: true });
  expect(demoDbDecision({ DATABASE_URL: '' })).toEqual({ allowed: true });
  const refused = demoDbDecision({ DATABASE_URL: 'postgres://u:p@host/db' });
  expect(refused.allowed).toBe(false);
  expect(refused.message).toContain('DEMO_ALLOW_DB_RESET=yes');
  expect(refused.message).not.toContain('postgres://'); // 접속 문자열을 출력하지 않는다
  expect(demoDbDecision({ DATABASE_URL: 'postgres://x', DEMO_ALLOW_DB_RESET: 'yes' }).allowed).toBe(true);
  expect(demoDbDecision({ DATABASE_URL: 'postgres://x', DEMO_ALLOW_DB_RESET: 'true' }).allowed).toBe(false); // 정확히 yes만
});

test('the demo script exits with code 2 before connecting when DATABASE_URL is set without confirmation', () => {
  const r = spawnSync('npx', ['tsx', 'scripts/demo.ts', 'all'], {
    encoding: 'utf8', shell: true, env: { ...process.env, DATABASE_URL: 'postgres://nobody:secret@127.0.0.1:1/none', DEMO_ALLOW_DB_RESET: '' },
  });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('DEMO_ALLOW_DB_RESET=yes');
  expect(r.stderr).not.toContain('secret');
  expect(r.stdout).not.toContain('=== normal ===');
}, 60_000);
