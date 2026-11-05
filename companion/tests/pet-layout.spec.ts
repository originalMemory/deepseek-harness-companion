import { expect, it } from 'vitest'
import { petContentLayout, petModelSize, readPetGeometry, type PetGeometry } from '../src/pet-layout.ts'

const area = { x: 1440, y: 1150, width: 2560, height: 1410 }

const geometry: PetGeometry = {
  bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 }, head: { x: 0.5, y: 0.085 }, bubbleHeight: 0,
}

it.each([0.5, 1, 1.5])('crops the actual contour with fixed margins at scale %s', scale => {
  const model = petModelSize(scale, area)
  expect(model).toEqual({ width: 360 * scale, height: 520 * scale })
  const view = petContentLayout(model, geometry, area)
  for (const margin of [view.body.x, view.body.y, view.width - view.body.x - view.body.width, view.height - view.body.y - view.body.height]) {
    expect(margin).toBeGreaterThanOrEqual(12)
    expect(margin).toBeLessThan(14)
  }
  expect(view.width).toBeLessThan(model.width)
  expect(view.height).toBeLessThan(model.height)
})

it.each([0.5, 1, 1.5])('keeps a 340px bubble and fixed union margins at scale %s', scale => {
  const model = petModelSize(scale, area)
  const view = petContentLayout(model, { ...geometry, bubbleHeight: 72 }, area)
  const headX = geometry.head.x * model.width + view.left
  const headY = geometry.head.y * model.height + view.top
  expect(view.bubbleWidth).toBe(340)
  expect(headX - 170).toBeGreaterThanOrEqual(12)
  expect(headX - 170).toBeLessThan(14)
  expect(view.width - headX - 170).toBeGreaterThanOrEqual(12)
  expect(view.width - headX - 170).toBeLessThan(14)
  expect(headY - 12 - 72).toBeGreaterThanOrEqual(12)
  expect(headY - 12 - 72).toBeLessThan(14)
})

it('fits smaller displays without clipping the stage or losing notification space', () => {
  const small = { x: 0, y: 30, width: 320, height: 600 }
  const model = petModelSize(1.5, small)
  expect(model.width).toBeLessThanOrEqual(small.width)
  expect(model.height + 92).toBeLessThanOrEqual(small.height)
  const view = petContentLayout(model, { ...geometry, bubbleHeight: 320 }, small)
  expect(view.width).toBeLessThanOrEqual(small.width)
  expect(view.height).toBeLessThanOrEqual(small.height)
  expect(view.bubbleMaxHeight).toBeLessThan(320)
  expect(view.bubbleMaxHeight).toBeGreaterThanOrEqual(72)
})

it('rejects missing, stale, non-finite and out-of-range page geometry', () => {
  const model = { width: 360, height: 520 }
  const valid = { ...model, bounds: geometry.bounds, headX: 180, headY: 44, bubbleHeight: 72 }
  expect(readPetGeometry(valid, model)).toEqual({ ...geometry, head: { x: 0.5, y: 44 / 520 }, bubbleHeight: 72 })
  for (const invalid of [null, {}, { ...valid, width: 180 }, { ...valid, width: NaN }, { ...valid, headY: Infinity },
    { ...valid, bubbleHeight: 321 }, { ...valid, bounds: { ...geometry.bounds, left: -0.1 } },
    { ...valid, bounds: { ...geometry.bounds, left: 0.9 } }, { ...valid, bounds: null }]) {
    expect(readPetGeometry(invalid, model)).toBeUndefined()
  }
})
