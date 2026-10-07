import { describe, expect, it } from 'vitest'
import {
  ChatLogWriter,
  parseChat,
  parseChatMetadata,
  serializeChat,
  serializeMetadata,
} from '@/ai/ChatLog'
import type { ChatMetadata } from '@/ai/types'

const metadata = (attention: ChatMetadata['attention']): ChatMetadata => ({
  type: 'abele-chat',
  providerId: '',
  modelId: '',
  created: '',
  attention,
})
const file = (attention: ChatMetadata['attention']) =>
  serializeChat({ metadata: metadata(attention), messages: [], internalMessages: [] })

describe('positive attention evidence in the existing log', () => {
  it('cannot un-see an error by appending a stale metadata snapshot', () => {
    const error = { id: 'sample-error', at: 1, text: 'Sample failure' }
    const log =
      file({ errors: [{ ...error, seen: true }] }) +
      serializeMetadata(metadata({ errors: [error] }))
    for (const read of [parseChatMetadata(log), parseChat(log).metadata]) {
      expect(read?.attention?.errors?.[0].seen).toBe(true)
      expect(read?.attention?.resolved).toContain(error.id)
    }
    const parsed = parseChat(log)
    const compacted = serializeChat({ ...parsed, metadata: parsed.metadata! })
    expect(parseChat(compacted).metadata?.attention?.errors?.[0].seen).toBe(true)
  })
  it('retains answered identities after an old waiting question is appended', () => {
    const question = {
      id: 'sample-question',
      at: 1,
      status: 'answered' as const,
      questions: [{ question: 'Which sample?', options: ['One'] }],
      currentIndex: 0,
      answers: ['One'],
    }
    const log =
      file({ question }) +
      serializeMetadata(metadata({ question: { ...question, status: 'waiting', answers: [] } }))
    expect(parseChatMetadata(log)?.attention?.resolved).toContain(question.id)
    expect(parseChat(log).metadata?.attention?.question?.status).toBe('cancelled')
  })
  it('keeps the accepted tool identity when a stale writer omits its phase', () => {
    const log = file({ tools: { 'sample-call': 'executing' } }) + serializeMetadata(metadata({}))
    expect(parseChatMetadata(log)?.attention?.tools?.['sample-call']).toBe('executing')
    const writer = new ChatLogWriter()
    const parsed = parseChat(log)
    writer.adopt(parsed)
    expect(writer.plan({ ...parsed, metadata: parsed.metadata! }).kind).toBe('noop')
  })
})
