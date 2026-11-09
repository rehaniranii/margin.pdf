import { defineConfig } from 'vite'
import { randomUUID } from 'node:crypto'
import { offlineBuild } from './scripts/build/offline-plugin.ts'
import { SECURITY_HEADERS } from './scripts/build/security.ts'

const assetFileNames = (asset: { names?: string[] }) => /\.(gz|br)$/.test(asset.names?.[0] ?? '') ? 'assets/[name]-[hash].bin' : 'assets/[name]-[hash][extname]'

export default defineConfig(({command}) => {
  const buildId=command==='build'?randomUUID().replaceAll('-',''):'development'
  return {
    define:{__MARGIN_BUILD_ID__:JSON.stringify(buildId)},
    plugins:[offlineBuild(buildId)],
    build: {
      target: 'esnext',
      // Servers send .gz files with Content-Encoding: gzip, so the browser receives different bytes
      // than the offline manifest hashed. Ship precompressed data (OCR language file) as .bin instead.
      rollupOptions: { output: { assetFileNames } },
    },
    // Workers are bundled separately; the OCR worker is the one that imports the language data.
    worker: { format: 'es', rollupOptions: { output: { assetFileNames } } },
    preview:{headers:SECURITY_HEADERS},
  }
})
