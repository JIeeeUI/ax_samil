'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '할 일' },
  { href: '/requests', label: '확인 요청' },
  { href: '/settings', label: '설정' },
];

/** 글자만 있는 메뉴: PC는 왼쪽 좁은 열, 모바일은 아래 탭 */
export function TabBar() {
  const path = usePathname();
  const active = (h: string) => (h === '/' ? path === '/' || path.startsWith('/cases') : path.startsWith(h));
  return (
    <nav className="tabbar" aria-label="메뉴">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={active(t.href) ? 'on' : ''} aria-current={active(t.href) ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** 역할 선택(시연용). 고른 뒤 '바꾸기'를 눌러야 적용되고, 지금 보던 화면으로 돌아온다. */
export function RoleSwitch({
  role, options, action,
}: { role: string; options: { value: string; label: string }[]; action: (fd: FormData) => Promise<void> }) {
  const path = usePathname();
  return (
    <form action={action} className="roleswitch">
      <input type="hidden" name="back" value={path} />
      <label><span>보는 사람</span>
        {/* key: 정적 데모는 미리 그린 화면(마케팅)에 저장된 역할이 나중에 읽혀, 비제어 select가 따라가지 못한다 */}
        <select name="role" key={role} defaultValue={role}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <button type="submit" className="secondary small">바꾸기</button>
    </form>
  );
}
