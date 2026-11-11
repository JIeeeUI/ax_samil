/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  // 엔진 소스는 NodeNext 방식의 `.js` 확장자 import를 쓰므로 번들러가 `.ts`로 해석하게 한다.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
export default nextConfig;
