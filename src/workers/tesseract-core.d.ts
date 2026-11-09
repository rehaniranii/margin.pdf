declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  const createCore: (options: { locateFile: (file: string) => string }) => Promise<ConstructorParameters<typeof import('../engine/ocr').Ocr>[0]>
  export default createCore
}
