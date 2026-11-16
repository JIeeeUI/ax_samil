/**
 * 시연 스크립트는 시작할 때 데이터를 전부 초기화한다. DATABASE_URL이 설정돼 있으면 그 DB(공유·운영일 수 있음)를 지우게 되므로,
 * 사용자가 DEMO_ALLOW_DB_RESET=yes로 명시적으로 확인하지 않으면 실행을 거부한다. 접속 문자열은 출력하지 않는다.
 */
export function demoDbDecision(env: Record<string, string | undefined>): { allowed: boolean; message?: string } {
  if (!env.DATABASE_URL) return { allowed: true };
  if (env.DEMO_ALLOW_DB_RESET === 'yes') return { allowed: true };
  return {
    allowed: false,
    message: 'DATABASE_URL이 설정돼 있어 시연을 실행하지 않습니다. 시연은 시작할 때 그 DB의 모든 건을 초기화합니다(운영·공유 DB일 수 있음). '
      + '로컬 메모리 DB로 실행하려면 DATABASE_URL을 지우고 다시 실행하세요. 그 DB를 정말 초기화해도 되면 DEMO_ALLOW_DB_RESET=yes를 함께 지정하세요.',
  };
}
