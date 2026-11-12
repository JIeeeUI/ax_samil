'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '할 일', icon: '✅' },
  { href: '/requests', label: '확인 요청', icon: '💬' },
  { href: '/settings', label: '설정', icon: '⚙️' },
];

/** 화면 아래 고정 탭 바 */
export function TabBar() {
  const path = usePathname();
  const active = (h: string) => (h === '/' ? path === '/' || path.startsWith('/cases') : path.startsWith(h));
  return (
    <nav className="tabbar" aria-label="메뉴">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={active(t.href) ? 'on' : ''} aria-current={active(t.href) ? 'page' : undefined}>
          <span aria-hidden>{t.icon}</span>{t.label}
        </Link>
      ))}
    </nav>
  );
}

/** 고르면 바로 바뀌는 역할 선택(시연용) */
export function RoleSwitch({
  role, options, action,
}: { role: string; options: { value: string; label: string }[]; action: (fd: FormData) => Promise<void> }) {
  return (
    <form action={action} className="roleswitch">
      <input type="hidden" name="back" value="/" />
      <label><span>보는 사람</span>
        <select name="role" defaultValue={role} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <noscript><button type="submit">바꾸기</button></noscript>
    </form>
  );
}
