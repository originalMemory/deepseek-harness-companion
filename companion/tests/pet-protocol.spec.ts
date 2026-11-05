import { expect, it } from 'vitest'
import { petIntent } from '../src/pet-protocol.ts'

it.each([
  { type: 'ready', version: 1 }, { type: 'model-ready', version: 1 },
  { type: 'bubble-click' }, { type: 'bubble-click', sessionId: 'other-session' },
  { type: 'bubble-dismiss', reason: 'manual' }, { type: 'bubble-dismiss', reason: 'timeout' },
  ...['drag-start', 'drag-move', 'drag-end'].map(type => ({ type, screenX: -100, screenY: 200 })),
])('copies a supported local intent: %j', data => {
  expect(petIntent(data)).toEqual(data)
  expect(petIntent(data)).not.toBe(data)
})

it.each([
  null, [], 'ready', { type: 'ready', version: 2 }, { type: 'ready', version: 1, extra: true },
  { type: 'bubble-click', sessionId: 's'.repeat(257) }, { type: 'bubble-click', sessionId: 1 },
  { type: 'bubble-dismiss', reason: 'other' }, { type: 'navigate', url: 'https://example.com' },
  { type: 'drag-start', screenX: Infinity, screenY: 0 }, { type: 'drag-move', screenX: 0, screenY: NaN },
  { type: 'drag-end', screenX: 0 }, { type: 'drag-end', screenX: 0, screenY: 0, extra: true },
])('ignores malformed page data: %j', data => { expect(petIntent(data)).toBeUndefined() })
