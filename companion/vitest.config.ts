/** Companion tests run without the parent workspace or its Host artifacts. */
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.spec.ts'], maxWorkers: 2 } })
