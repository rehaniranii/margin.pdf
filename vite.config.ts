import { defineConfig } from 'vite'
import { randomUUID } from 'node:crypto'
import { offlineBuild } from './scripts/build/offline-plugin.ts'
import { SECURITY_HEADERS } from './scripts/build/security.ts'

export default defineConfig(({command}) => {
  const buildId=command==='build'?randomUUID().replaceAll('-',''):'development'
  return {
    define:{__MARGIN_BUILD_ID__:JSON.stringify(buildId)},
    plugins:[offlineBuild(buildId)],
    build: { target: 'esnext' },
    worker: { format: 'es' },
    preview:{headers:SECURITY_HEADERS},
  }
})
