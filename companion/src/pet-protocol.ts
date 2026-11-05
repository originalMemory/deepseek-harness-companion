/** Strict, data-only intents emitted by the remote pet page. */
export type PetIntent =
  | { type: 'ready' | 'model-ready'; version: 1 }
  | { type: 'bubble-click'; sessionId?: string }
  | { type: 'bubble-dismiss'; reason: 'manual' | 'timeout' }
  | { type: 'drag-start' | 'drag-move' | 'drag-end'; screenX: number; screenY: number }

/**
 * Copy supported page intents without retaining remote objects or extra fields.
 * @param value - Untrusted DOM or IPC payload.
 * @returns Valid intent, or undefined for unsupported fields or values.
 */
export function petIntent(value: unknown): PetIntent | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  const only = (...allowed: string[]): boolean => keys.every(key => allowed.includes(key))
  switch (data.type) {
    case 'ready': case 'model-ready':
      return only('type', 'version') && data.version === 1 ? { type: data.type, version: 1 } : undefined
    case 'bubble-click':
      if (!only('type', 'sessionId')) return undefined
      if (!('sessionId' in data)) return { type: 'bubble-click' }
      return typeof data.sessionId === 'string' && data.sessionId.length <= 256
        ? { type: 'bubble-click', sessionId: data.sessionId } : undefined
    case 'bubble-dismiss':
      return only('type', 'reason') && (data.reason === 'manual' || data.reason === 'timeout')
        ? { type: 'bubble-dismiss', reason: data.reason } : undefined
    case 'drag-start': case 'drag-move': case 'drag-end':
      return only('type', 'screenX', 'screenY') && typeof data.screenX === 'number' && Number.isFinite(data.screenX)
        && typeof data.screenY === 'number' && Number.isFinite(data.screenY)
        ? { type: data.type, screenX: data.screenX, screenY: data.screenY } : undefined
    default: return undefined
  }
}
