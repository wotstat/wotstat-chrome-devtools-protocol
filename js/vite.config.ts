import { defineConfig } from 'vite';
import path from 'path';

function virtualExternal(spec = 'virtual:model', target = '../libs/model.js') {
  return {
    name: 'virtual-external-model',
    enforce: 'pre',
    resolveId(source: string) {
      if (source === spec) {
        // Keep the exact specifier in the bundle and mark it external
        return { id: target, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    virtualExternal('gameface:common', '../libs/common.js'),
    virtualExternal('gameface:debug', '../libs/debug.js'),
    virtualExternal('gameface:media', '../libs/media.js'),
    virtualExternal('gameface:model', '../libs/model.js'),
    virtualExternal('gameface:sound', '../libs/sound.js'),
    virtualExternal('gameface:views', '../libs/views.js')
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'index.html'),
      formats: ['es'],
      fileName: (r) => 'index.js',
    },
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      external: (id) => /(^|[\\/])libs[\\/].*\.js$/.test(id),

      output: {
        inlineDynamicImports: true,
        preserveModules: false,
      },
    },
    target: 'esnext',
    minify: false,
  },
});