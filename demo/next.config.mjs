import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// GitHub Pages 프로젝트 주소(https://<계정>.github.io/ax_samil/)에 맞춘다. 다른 곳에 올리면 DEMO_BASE_PATH로 바꾼다.
const basePath = process.env.DEMO_BASE_PATH ?? '/ax_samil';

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  // ../app, ../src의 기존 화면 부품·서비스를 그대로 가져다 쓴다.
  experimental: { externalDir: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  webpack(config, { webpack }) {
    // 엔진 소스는 NodeNext 방식의 `.js` 확장자 import를 쓴다.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    // 서비스가 쓰는 서버 전용 모듈을 브라우저용 대체물로 바꾼다.
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:async_hooks$/, path.join(here, 'lib/als.ts')));
    // PGlite가 Node에서만 쓰는 모듈은 빈 대체물로 막는다(브라우저에서는 타지 않는 경로).
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:(?!async_hooks$)/, path.join(here, 'lib/empty.ts')));
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    return config;
  },
};
