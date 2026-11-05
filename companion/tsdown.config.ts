import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { preload: 'preload/index.ts', 'pet-preload': 'preload/pet.ts' },
  outDir: 'lib', format: 'cjs', platform: 'node', target: 'es2024',
  clean: false, dts: false,
  deps: { neverBundle: ['electron'] },
})
