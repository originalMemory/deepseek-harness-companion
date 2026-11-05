/** Desktop-only model dimensions and native window placement; bubble text stays at CSS size. */
import type { Rectangle } from 'electron'

/** Renderer stage size in CSS pixels; never a webContents zoom factor. */
export interface PetModelSize { width: number; height: number }

/** Validated alpha bounds and head anchor, normalized within the full model stage. */
export interface PetGeometry {
  bounds: { left: number; top: number; right: number; bottom: number }
  head: { x: number; y: number }
  bubbleHeight: number
}

/** Cropped viewport and full stage position in CSS pixels; the stage may extend outside the viewport. */
export interface PetContentLayout {
  width: number
  height: number
  left: number
  top: number
  body: Rectangle
  bubbleWidth: number
  bubbleLeft: number
  bubbleMaxHeight: number
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }

/**
 * Validate main-world geometry without mixing viewport coordinates with normalized alpha bounds.
 * @param value - Serialized result from the pet page query.
 * @param model - Stage dimensions selected by the shell.
 * @returns Geometry for this stage size, or undefined while the page has no matching rendered frame.
 */
export function readPetGeometry(value: unknown, model: PetModelSize): PetGeometry | undefined {
  if (!record(value) || !finite(value.width) || !finite(value.height)
    || Math.abs(value.width - model.width) > 1 || Math.abs(value.height - model.height) > 1
    || !finite(value.headX) || !finite(value.headY) || value.headX < 0 || value.headX > model.width
    || value.headY < 0 || value.headY > model.height || !finite(value.bubbleHeight)
    || value.bubbleHeight < 0 || value.bubbleHeight > 320 || !record(value.bounds)) return undefined
  const bounds = value.bounds
  if (!finite(bounds.left) || !finite(bounds.top) || !finite(bounds.right) || !finite(bounds.bottom)
    || bounds.left < 0 || bounds.top < 0 || bounds.right > 1 || bounds.bottom > 1
    || bounds.left >= bounds.right || bounds.top >= bounds.bottom) return undefined
  return {
    bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
    head: { x: value.headX / model.width, y: value.headY / model.height }, bubbleHeight: value.bubbleHeight,
  }
}

/**
 * Crop transparent canvas margins around the visible model and an unscaled bubble.
 * @param model - Full rendering stage dimensions; cropping does not resize its framebuffer.
 * @param geometry - Latest rendered contour; omission keeps a temporary full-stage viewport during loading.
 * @param area - Available viewport space in CSS pixels.
 * @returns The visible union with fixed 12px padding, stage offset and bubble limits.
 */
export function petContentLayout(model: PetModelSize, geometry: PetGeometry | undefined, area: Rectangle): PetContentLayout {
  const bubbleWidth = Math.min(340, Math.max(1, area.width - 24))
  if (geometry === undefined) {
    const width = Math.min(area.width, Math.max(360, Math.ceil(model.width)))
    const height = Math.min(area.height, Math.ceil(model.height + 92))
    const left = (width - model.width) / 2, top = height - model.height
    return { width, height, left, top, body: { x: left, y: top, ...model }, bubbleWidth,
      bubbleLeft: (width - bubbleWidth) / 2, bubbleMaxHeight: 320 }
  }
  const bodyLeft = geometry.bounds.left * model.width, bodyTop = geometry.bounds.top * model.height
  const bodyRight = geometry.bounds.right * model.width, bodyBottom = geometry.bounds.bottom * model.height
  const headX = geometry.head.x * model.width, headY = geometry.head.y * model.height
  const bubbleMaxHeight = Math.max(72, Math.min(320, Math.floor(area.height - 24 - (bodyBottom - headY) - 12)))
  const bubbleHeight = Math.min(bubbleMaxHeight, Math.max(72, geometry.bubbleHeight))
  const bubbleLeft = Math.max(bodyRight - (area.width - 24),
    Math.min(headX - bubbleWidth / 2, bodyLeft + area.width - 24 - bubbleWidth))
  let x1 = bodyLeft, y1 = bodyTop, x2 = bodyRight, y2 = bodyBottom
  if (geometry.bubbleHeight > 0) {
    // Keep both elements on narrow displays; the page clamps a bubble near its horizontal edges.
    x1 = Math.min(x1, bubbleLeft)
    x2 = Math.max(x2, bubbleLeft + bubbleWidth)
    y1 = Math.min(y1, headY - 12 - bubbleHeight)
    y2 = Math.max(y2, headY - 12)
  }
  const left = 12 - Math.floor(x1), top = 12 - Math.floor(y1)
  return {
    width: Math.ceil(x2 + left) + 12, height: Math.ceil(y2 + top) + 12, left, top,
    body: { x: bodyLeft + left, y: bodyTop + top, width: bodyRight - bodyLeft, height: bodyBottom - bodyTop },
    bubbleWidth, bubbleLeft: bubbleLeft + left, bubbleMaxHeight,
  }
}

/**
 * Fit a selected model scale while retaining room for a small notification on short displays.
 * @param scale - User preference from 0.5 to 1.5.
 * @param area - Native display work area in DIP, with the pet at its default zoom.
 * @returns Stage dimensions; a short or narrow display can reduce the effective scale.
 */
export function petModelSize(scale: number, area: Rectangle): PetModelSize {
  const fit = Math.max(0.01, Math.min(scale, (area.width - 24) / 360, (area.height - 116) / 520))
  return { width: 360 * fit, height: 520 * fit }
}
