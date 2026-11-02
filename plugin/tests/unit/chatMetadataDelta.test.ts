import { expect, it, vi } from 'vitest'
import {
  ChatLogWriter,
  parseChat,
  parseChatMetadata,
  parseChatAttention,
  serializeChat,
  serializeMetadata,
} from '@/ai/ChatLog'
import type { ChatSnapshot } from '@/ai/ChatLog'
import { MetadataRecordReader, applyMetadataRecord } from '@/ai/chatMetadataRecord'

it('rejects non-JSON whitespace rather than accepting a damaged metadata record', () => {
  const reader = new MetadataRecordReader()
  expect(() => reader.read('{\u00a0"title":"invalid"}')).toThrow()
  expect(reader.read('{"title":"valid"}')).toEqual({ title: 'valid' })
})

it('rejects malformed deltas without mutating the committed metadata', () => {
  const previous = sample().metadata
  const saved = JSON.stringify(previous)
  for (const delta of [
    true,
    { set: {}, remove: 'title' },
    { set: [], remove: [] },
    { set: { attention: { set: { resolved: 'bad' }, remove: [] } }, remove: [] },
  ]) {
    expect(() => applyMetadataRecord({ v: 2, k: 'meta', delta }, previous)).toThrow()
    expect(JSON.stringify(previous)).toBe(saved)
  }
  expect(() => applyMetadataRecord({ delta: { set: {}, remove: [] } }, null)).toThrow()
})

it('skips damaged deltas in all readers and keeps later complete records', async () => {
  const snapshot = sample()
  const changed = { ...snapshot.metadata, title: 'Changed' }
  for (const delta of [
    null,
    false,
    { set: {}, remove: 'title' },
    { set: { attention: null }, remove: [] },
  ]) {
    const log =
      serializeChat(snapshot) +
      JSON.stringify({ v: 2, k: 'meta-delta', delta }) +
      '\n' +
      serializeMetadata(changed, snapshot.metadata)
    const parsed = parseChat(log)
    expect(parsed.damaged).toBe(1)
    expect(parsed.metadata?.title).toBe('Changed')
    expect(parseChatMetadata(log)?.title).toBe('Changed')
    expect((await parseChatAttention(log, async () => {})).damaged).toBe(1)
  }
})

it('recovers a metadata delta glued to a torn record', () => {
  const snapshot = sample()
  const log =
    serializeChat(snapshot) +
    '{"k":"msg","broken":' +
    serializeMetadata({ ...snapshot.metadata, title: 'Recovered' }, snapshot.metadata)
  expect(parseChat(log).metadata?.title).toBe('Recovered')
})

it('round-trips unknown own keys without invoking prototype setters', () => {
  const previous = sample().metadata
  const current = { ...previous, ...JSON.parse('{"__proto__":{"invented":true}}') }
  const record = JSON.parse(serializeMetadata(current, previous))
  expect(Object.hasOwn(record.delta.set, '__proto__')).toBe(true)
  const result = applyMetadataRecord(record, previous)
  expect(Object.hasOwn(result, '__proto__')).toBe(true)
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
})

function sample(): ChatSnapshot {
  return {
    metadata: {
      type: 'abele-chat',
      title: 'Invented',
      summary: 'Invented summary. '.repeat(2000),
      attention: { resolved: Array.from({ length: 2000 }, (_, i) => `invented-${i}`) },
    },
    messages: [],
    internalMessages: [],
  }
}

it('appends changed metadata without copying unchanged fields or the resolved ledger', async () => {
  const snapshot = sample()
  let log = serializeChat(snapshot)
  const writer = new ChatLogWriter()
  writer.adopt(parseChat(log))
  snapshot.metadata = {
    ...snapshot.metadata,
    activeLeafId: 'invented-leaf',
    summary: undefined,
    attention: {
      ...snapshot.metadata.attention,
      resolved: [...snapshot.metadata.attention!.resolved!, 'invented-new'],
    },
  }
  const plan = writer.plan(snapshot)
  expect(plan.kind).toBe('append')
  if (plan.kind !== 'append') throw new Error('Expected append')
  expect(plan.data.length).toBeLessThan(500)
  log += plan.data
  writer.commit(snapshot, plan)
  expect(writer.plan(snapshot).kind).toBe('noop')
  for (const metadata of [
    parseChat(log).metadata,
    parseChatMetadata(log),
    (await parseChatAttention(log, async () => {})).metadata,
  ]) {
    expect(metadata?.summary).toBeUndefined()
    expect(metadata?.title).toBe('Invented')
    expect(metadata?.activeLeafId).toBe('invented-leaf')
    expect(metadata?.attention?.resolved).toEqual(snapshot.metadata.attention?.resolved)
  }
  expect(writer.matches(parseChat(log))).toBe(true)
})

it('parses repeated legacy metadata values once, retaining terminal decisions', () => {
  const snapshot = sample()
  let log = serializeChat(snapshot)
  for (let i = 0; i < 30; i++)
    log += serializeMetadata({ ...snapshot.metadata, activeLeafId: `leaf-${i}` })
  const parse = JSON.parse
  let parsedBytes = 0
  const spy = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
    parsedBytes += String(text).length
    return parse(text, reviver)
  })
  try {
    const result = parseChat(log)
    expect(result.metadata?.activeLeafId).toBe('leaf-29')
    expect(result.metadata?.attention?.resolved).toHaveLength(2000)
    expect(parsedBytes).toBeLessThan(log.length / 4)
  } finally {
    spy.mockRestore()
  }
})
