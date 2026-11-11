import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: '인플루언서 제안 접수·판정' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
