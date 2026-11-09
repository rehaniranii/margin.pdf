// Shared by the on-screen preview and the engine: text no wider than its box, about 0.9 em tall.
export const fitSize = (advance: number, width: number, height: number) => Math.min(height * 0.8, width / advance)
export const fits = (advance: number, size: number, width: number, height: number) => advance * size <= width * 1.001 && size * 0.9 <= height * 1.001
