import { expect, it, vi } from 'vitest'
import { CompletionProtocol, notificationPreview } from '../src/completion-protocol.ts'

function setup(path = '/remote/api/remote.mux') {
  const notify = vi.fn()
  const protocol = new CompletionProtocol('https://nas.example.com', notify)
  protocol.created('socket', `wss://nas.example.com${path}?device=not-retained`)
  const open = (streamId: string, endpoint: string, request = {}) => {
    protocol.sent('socket', JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: { request } } }))
  }
  const item = (streamId: string, value: unknown) => {
    protocol.received('socket', JSON.stringify({ type: 'item', streamId, value }))
  }
  const event = (type: string, data: unknown) => { item('follow', { type: 'event', event: { type, seq: 42, data } }) }
  const boundary = (lastTurn: number, openTurnStartSeq: number | null) => ({ lastTurn, openTurnStartSeq })
  const projection = (sessionId: string, turn: number, open: number | null) => {
    item('control', { type: 'projection', sessionId, key: 'turnBoundary', value: boundary(turn, open) })
  }
  open('control', 'session/control')
  open('follow', 'session/follow', { address: { kind: 'session', sessionId: 'session-1' } })
  return { notify, protocol, open, item, event, boundary, projection }
}

it.each(['/api/remote.mux', '/remote/api/remote.mux'])('observes one durable successful turn on %s and excludes reasoning', (path) => {
  const s = setup(path)
  s.event('turn/start', { turn: 1 })
  s.event('assistant/message', { turn: 1, message: { content: [
    { type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: '**Done**: [report](https://example.com)' },
  ] } })
  s.projection('session-1', 1, null)
  expect(s.notify).not.toHaveBeenCalled()
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  s.projection('session-1', 1, null)
  expect(s.notify).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-1', turn: 1, outcome: 'completed', preview: 'Done: report' })
})

it('reports background control-stream transitions without claiming they succeeded', () => {
  const s = setup()
  s.projection('background', 2, 10)
  s.projection('background', 2, null)
  s.projection('background', 2, null)
  expect(s.notify).toHaveBeenCalledExactlyOnceWith({ sessionId: 'background', turn: 2, outcome: 'ended', preview: '' })
})

it('uses the neutral end only if the detailed follow stream fails after control reported the end', () => {
  const s = setup()
  s.projection('session-1', 1, 3)
  s.projection('session-1', 1, null)
  expect(s.notify).not.toHaveBeenCalled()
  s.protocol.received('socket', JSON.stringify({ type: 'error', streamId: 'follow', error: { code: 'offline' } }))
  expect(s.notify.mock.lastCall![0].outcome).toBe('ended')
})

it.each(['error', 'aborted', 'blocked', 'max-tokens'])('retains the available terminal meaning for %s', (kind) => {
  const s = setup()
  s.event('turn/start', { turn: 1 })
  s.event('turn/end', { turn: 1, reason: { kind } })
  expect(s.notify.mock.calls[0]![0].outcome).toBe(kind === 'error' || kind === 'aborted' ? kind : 'ended')
})

it('does not replay snapshot history or closed control baselines', () => {
  const s = setup()
  s.item('follow', { type: 'snapshot', records: [{ type: 'event', event: {
    type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } },
  } }], projections: { values: { turnBoundary: s.boundary(3, null) } } })
  s.item('control', { type: 'baseline', value: { projections: {
    'session-1': { values: { turnBoundary: s.boundary(3, null) } },
  } } })
  s.event('turn/end', { turn: 3, reason: { kind: 'completed' } })
  expect(s.notify).not.toHaveBeenCalled()
  s.event('turn/start', { turn: 4 })
  s.event('turn/end', { turn: 4, reason: { kind: 'completed' } })
  expect(s.notify).toHaveBeenCalledOnce()
})

it('can finish a turn already running in the opening baseline', () => {
  const s = setup()
  s.item('control', { type: 'baseline', value: { projections: {
    active: { values: { turnBoundary: s.boundary(5, 8) } },
  } } })
  s.projection('active', 5, null)
  expect(s.notify).toHaveBeenCalledOnce()
})

it('deduplicates streams, disconnects and reconnect snapshots without reusing old previews', () => {
  const s = setup()
  s.event('turn/start', { turn: 1 })
  s.event('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'old reply' }] } })
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  s.protocol.closed('socket')
  s.protocol.created('socket', 'wss://nas.example.com/remote/api/remote.mux')
  s.open('follow', 'session/follow', { address: { kind: 'session', sessionId: 'session-1' } })
  s.item('follow', { type: 'snapshot', projections: { values: { turnBoundary: s.boundary(1, null) } } })
  s.event('turn/start', { turn: 1 })
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(s.notify).toHaveBeenCalledOnce()
  s.event('turn/start', { turn: 2 })
  s.event('turn/end', { turn: 2, reason: { kind: 'completed' } })
  expect(s.notify.mock.lastCall![0].preview).toBe('')
  expect(s.notify).toHaveBeenCalledTimes(2)
})

it('does not count a dropped socket or removed subscription as completion', () => {
  const s = setup()
  s.event('turn/start', { turn: 1 })
  s.protocol.sent('socket', JSON.stringify({ type: 'cancel', streamId: 'follow' }))
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  s.protocol.closed('socket')
  expect(s.notify).not.toHaveBeenCalled()
})

it.each(['wss://other.example.com/api/remote.mux', 'wss://nas.example.com/pet/ws', 'https://nas.example.com/api/remote.mux'])('rejects unrelated sockets: %s', (address) => {
  const notify = vi.fn()
  const protocol = new CompletionProtocol('https://nas.example.com', notify)
  protocol.created('socket', address)
  protocol.sent('socket', JSON.stringify({ type: 'open', streamId: 'control', endpoint: 'session/control' }))
  for (const openTurnStartSeq of [10, null]) protocol.received('socket', JSON.stringify({ type: 'item', streamId: 'control',
    value: { type: 'projection', sessionId: 's', key: 'turnBoundary', value: { lastTurn: 1, openTurnStartSeq } },
  }))
  expect(notify).not.toHaveBeenCalled()
})

it('ignores malformed and unknown data without inspecting other logical streams', () => {
  const s = setup()
  for (const text of ['invalid', 'null', '[]', '{"type":"item"}', '{"streamId":"unknown","type":"item","value":{}}']) {
    s.protocol.received('socket', text)
    s.protocol.sent('socket', text)
  }
  for (const value of [null, {}, { lastTurn: -1, openTurnStartSeq: null }, { lastTurn: 1, openTurnStartSeq: 'x' }]) {
    s.item('control', { type: 'projection', key: 'turnBoundary', sessionId: 's', value })
  }
  expect(s.notify).not.toHaveBeenCalled()
})

it('drops generation state on navigation and suppresses an older turn after newer work', () => {
  const s = setup()
  s.event('turn/start', { turn: 3 })
  s.event('turn/end', { turn: 2, reason: { kind: 'completed' } })
  s.protocol.reset()
  s.event('turn/end', { turn: 3, reason: { kind: 'completed' } })
  expect(s.notify).not.toHaveBeenCalled()
})

it('bounds a Markdown-free Unicode preview to nanobot’s 240-byte budget', () => {
  expect(notificationPreview('**完成**：查看 [报告](https://example.com) `report.md`')).toBe('完成：查看 报告 report.md')
  const preview = notificationPreview('鲸'.repeat(200))
  expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(240)
  expect(preview).toMatch(/^鲸+\.\.\.$/u)
})

it('publishes live running counts, handles parallel turns and returns to unknown on disconnect', () => {
  const changes = vi.fn()
  const protocol = new CompletionProtocol('https://nas.example.com', vi.fn(), changes)
  protocol.created('s', 'wss://nas.example.com/api/remote.mux')
  protocol.sent('s', JSON.stringify({ type: 'open', streamId: 'c', endpoint: 'session/control' }))
  const item = (value: unknown) => { protocol.received('s', JSON.stringify({ type: 'item', streamId: 'c', value })) }
  item({ type: 'baseline', value: { projections: {} } })
  const update = (sessionId: string, openTurnStartSeq: number | null) => {
    item({ type: 'projection', sessionId, key: 'turnBoundary', value: { lastTurn: 1, openTurnStartSeq } })
  }
  update('a', 0)
  update('b', 4)
  update('a', null)
  update('b', null)
  protocol.closed('s')
  expect(changes.mock.calls.map(call => call[0])).toEqual([0, 1, 2, 1, 0, undefined])
})
