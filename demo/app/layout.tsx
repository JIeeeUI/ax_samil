import type { ReactNode } from 'react';
import '../../app/globals.css';
import { NavigatorBridge } from '../lib/runtime.js';

export const metadata = { title: '인플루언서 제안 접수·판정' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 서체는 Pretendard 한 가지. 불러오지 못하면 시스템 한글 서체로 대체된다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body><NavigatorBridge>{children}</NavigatorBridge></body>
    </html>
  );
}
