import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedScale, pointToDisplay, regionStyle } from '../src/geometry/page'

test('bounds rendering dimensions and pixels on large or high-DPR pages', () => {
  const factor = boundedScale([20, 30, 10020, 20030], 4, 4)
  assert.ok(10000 * factor <= 4096)
  assert.ok(20000 * factor <= 4096)
  assert.ok(10000 * 20000 * factor ** 2 <= 8_000_001)
  assert.throws(() => boundedScale([0, 0, 0, 10], 1))
  assert.throws(() => boundedScale([0, 0, 10, 10], NaN))
})
test('subtracts page origin before zoom scaling', () => {
  assert.deepEqual(pointToDisplay(40, 60, [20, 30, 620, 830], 2), { x: 40, y: 60 })
})
test('maps regions onto actual rounded raster bounds, independent of CSS zoom and DPR', () => {
  const style = regionStyle([12, 22, 32, 42], { width: 200, height: 400, rasterScale: 2, pixelOrigin: [4, 4] })
  assert.deepEqual(style, { left: '10%', top: '10%', width: '20%', height: '10%' })
  const rounded = regionStyle([10, 20, 30, 40], { width: 301, height: 601, rasterScale: 1.5, pixelOrigin: [0, 0] })
  assert.ok(Math.abs(parseFloat(rounded.left) / 100 * 301 - 15) < 0.0001)
  assert.ok(Math.abs(parseFloat(rounded.top) / 100 * 601 - 30) < 0.0001)
})
