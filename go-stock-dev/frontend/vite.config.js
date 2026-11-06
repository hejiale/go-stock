import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { TDesignResolver } from '@tdesign-vue-next/auto-import-resolver';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
      vue(),
      AutoImport({
          resolvers: [TDesignResolver({
              library: 'chat'
          })],
      }),
      Components({
          resolvers: [TDesignResolver({
              library: 'chat'
          })],
      }),
  ],
  build: {
      // 默认情况下 Vite 会用 esbuild 对最终 chunk 做降级/压缩。
      // 本项目打包后单个 chunk 超过 1MB，esbuild 会把输入写到
      // %TEMP%\esbuild-xxxx，再由 esbuild 服务进程删除；
      // Windows 上如果安全软件（火绒 / Windows Defender）正在扫描该文件，
      // 删除会失败并报 “The process cannot access the file ...”。
      // 设成 esnext 且关闭压缩可完全跳过这一步（Wails 使用 WebView2，支持 esnext）。
      target: 'esnext',
      minify: false,
  },
})
