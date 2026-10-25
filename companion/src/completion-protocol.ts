/** Read-only observation of the page's existing Gateway mux; no requests or credentials are replayed. */

type ObservedSessionId = string & { readonly __observedSessionId: unique symbol }

function sessionId(value: unknown): value is ObservedSessionId { return typeof value === 'string' && value.length > 0 }

/** One observed end, with a success reason only when the durable turn event supplied it. */
export interface CompletionNotice {
  readonly sessionId: ObservedSessionId
  readonly turn: number
  readonly outcome: 'completed' | 'error' | 'aborted' | 'ended'
  readonly preview: string
}

type Stream = { kind: 'control' } | { kind: 'follow'; sessionId: ObservedSessionId }
interface Progress { turn: number; open: boolean; settled: number; preview: string; controlEnded: boolean }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(text: string): Record<string, unknown> | undefined {
  if (text.length > 8 * 1024 * 1024) return undefined
  try { const value: unknown = JSON.parse(text); return record(value) ? value : undefined } catch (_error) {
    // Malformed or unrelated WebSocket messages cannot produce a notification.
    return undefined
  }
}

/**
 * Bound plain notification text without splitting a Unicode character.
 * @param value - Assistant text, possibly containing Markdown.
 * @returns A single line of at most 240 UTF-8 bytes, matching the nanobot preview budget.
 */
export function notificationPreview(value: string): string {
  const text = value.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/```[^\n]*\n?|`|\*\*|~~/gu, '').replace(/^\s{0,3}(?:#{1,6}|>|[-+])\s+/gmu, '').replace(/\s+/gu, ' ').trim()
  if (Buffer.byteLength(text, 'utf8') <= 240) return text
  let result = ''
  for (const character of text) {
    if (Buffer.byteLength(result + character + '...', 'utf8') > 240) break
    result += character
  }
  return result + '...'
}

/** Tracks only admitted socket streams and live transitions; snapshots never emit completion reminders. */
export class CompletionProtocol {
  private readonly sockets = new Map<string, Map<string, Stream>>()
  private readonly progress = new Map<ObservedSessionId, Progress>()

  /**
   * @param origin - Operator-selected HTTP(S) server origin.
   * @param notify - Receives each observed session/turn at most once within the retained 256-session window.
   */
  constructor(private readonly origin: string, private readonly notify: (notice: CompletionNotice) => void) {}

  /**
   * Admit the original or paired remote mux, excluding tokens from retained state.
   * @param id - Chromium-owned request identity.
   * @param address - Observed socket URL; query parameters are not retained.
   */
  created(id: string, address: string): void {
    let url: URL
    try { url = new URL(address) } catch (_error) { return /* Invalid socket URLs are not observable Gateway channels. */ }
    const origin = url.protocol === 'wss:' ? `https://${url.host}` : url.protocol === 'ws:' ? `http://${url.host}` : ''
    if (origin === this.origin && ['/api/remote.mux', '/remote/api/remote.mux'].includes(url.pathname)) {
      this.sockets.set(id, new Map())
    }
  }

  /**
   * Observe stream subscription/cancellation without sending anything to the server.
   * @param id - Chromium socket identity.
   * @param text - One client WebSocket text message.
   */
  sent(id: string, text: string): void {
    const streams = this.sockets.get(id)
    const message = parse(text)
    if (streams === undefined || message === undefined || typeof message.streamId !== 'string') return
    if (message.type === 'cancel') { streams.delete(message.streamId); this.finishPending(); return }
    if (message.type !== 'open') return
    if (message.endpoint === 'session/control') streams.set(message.streamId, { kind: 'control' })
    if (message.endpoint !== 'session/follow' || !record(message.payload) || !record(message.payload.args)
      || !record(message.payload.args.request) || !record(message.payload.args.request.address)) return
    const address = message.payload.args.request.address
    if (address.kind === 'session' && sessionId(address.sessionId)) {
      streams.set(message.streamId, { kind: 'follow', sessionId: address.sessionId })
    }
  }

  /**
   * Decode only live control changes and durable journal events; historical records are ignored.
   * @param id - Chromium socket identity.
   * @param text - One server WebSocket text message.
   */
  received(id: string, text: string): void {
    const message = parse(text)
    if (message === undefined || typeof message.streamId !== 'string') return
    const streams = this.sockets.get(id)
    const stream = streams?.get(message.streamId)
    if (stream === undefined) return
    if (message.type === 'end' || message.type === 'error') { streams?.delete(message.streamId); this.finishPending(); return }
    if (message.type !== 'item' || !record(message.value)) return
    const value = message.value
    if (stream.kind === 'control') {
      if (value.type === 'baseline' && record(value.value) && record(value.value.projections)) {
        for (const [sessionId, baseline] of Object.entries(value.value.projections)) {
          if (record(baseline) && record(baseline.values)) this.boundary(sessionId, baseline.values.turnBoundary, true)
        }
      } else if (value.type === 'projection' && value.key === 'turnBoundary' && typeof value.sessionId === 'string') {
        this.boundary(value.sessionId, value.value, false)
      }
      return
    }
    if (value.type === 'snapshot') {
      if (record(value.projections) && record(value.projections.values)) {
        this.boundary(stream.sessionId, value.projections.values.turnBoundary, true)
      }
      return
    }
    if (value.type !== 'event' || !record(value.event) || !record(value.event.data)) return
    const event = value.event
    const data = value.event.data
    if (!Number.isSafeInteger(data.turn) || typeof data.turn !== 'number' || data.turn < 1) return
    const progress = this.state(stream.sessionId, data.turn)
    if (data.turn !== progress.turn) return
    if (event.type === 'turn/start') progress.open = data.turn > progress.settled
    if (event.type === 'assistant/message' && record(data.message) && Array.isArray(data.message.content)) {
      progress.preview = notificationPreview(data.message.content.filter((block: unknown) =>
        record(block) && block.type === 'text' && typeof block.text === 'string')
        .map((block: { text: string }) => block.text).join(' '))
    }
    if (event.type === 'turn/end' && progress.open && record(data.reason) && typeof data.reason.kind === 'string') {
      const kind = data.reason.kind
      this.settle(stream.sessionId, progress, kind === 'completed' || kind === 'error' || kind === 'aborted' ? kind : 'ended')
    }
  }

  /** @param id - Closed socket identity; transport closure itself never counts as task completion. */
  closed(id: string): void { this.sockets.delete(id); this.finishPending() }

  /** Drop generation-owned sockets and in-progress previews on navigation or debugger detachment. */
  reset(): void {
    this.sockets.clear()
    for (const state of this.progress.values()) { state.open = false; state.preview = ''; state.controlEnded = false }
  }

  private state(id: ObservedSessionId, turn: number): Progress {
    let state = this.progress.get(id)
    if (state === undefined) {
      state = { turn, open: false, settled: 0, preview: '', controlEnded: false }
      this.progress.set(id, state)
      if (this.progress.size > 256) this.progress.delete(this.progress.keys().next().value!)
    } else if (turn > state.turn) { state.turn = turn; state.open = false; state.preview = ''; state.controlEnded = false }
    return state
  }

  private boundary(id: string, value: unknown, baseline: boolean): void {
    if (!sessionId(id) || !record(value) || typeof value.lastTurn !== 'number' || !Number.isSafeInteger(value.lastTurn) || value.lastTurn < 1
      || (value.openTurnStartSeq !== null && (typeof value.openTurnStartSeq !== 'number'
        || !Number.isSafeInteger(value.openTurnStartSeq) || value.openTurnStartSeq < 0))) return
    const state = this.state(id, value.lastTurn)
    if (state.turn !== value.lastTurn) return
    const open = value.openTurnStartSeq !== null
    if (baseline) {
      if (!open) state.settled = Math.max(state.settled, state.turn)
      state.open = open && state.turn > state.settled
      state.controlEnded = false
    } else if (open) state.open = state.turn > state.settled
    else if (state.open) {
      state.controlEnded = true
      this.finishPending()
    }
  }

  private finishPending(): void {
    const followed = new Set<ObservedSessionId>()
    for (const streams of this.sockets.values()) {
      for (const stream of streams.values()) if (stream.kind === 'follow') followed.add(stream.sessionId)
    }
    for (const [id, state] of this.progress) {
      if (state.controlEnded && !followed.has(id)) this.settle(id, state, 'ended')
    }
  }

  private settle(id: ObservedSessionId, state: Progress, outcome: CompletionNotice['outcome']): void {
    if (state.turn <= state.settled) return
    state.open = false
    state.controlEnded = false
    state.settled = state.turn
    this.notify({ sessionId: id, turn: state.turn, outcome, preview: state.preview })
    state.preview = ''
  }
}
