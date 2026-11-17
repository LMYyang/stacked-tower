import { defineConfig } from 'vitest/config'

// 纯 JS 核心逻辑测试，不加载 uni 插件（uni 插件会找 src/manifest.json，且在 vitest 下会失败）
export default defineConfig({
  plugins: [],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
