import { serializeChat } from '@/ai/ChatLog'

/** Entirely synthetic transcripts; the larger records exercise startup without private data. */
export function syntheticChats(count = 300) {
  return Array.from({ length: count }, (_, i) => ({
    path: `SyntheticChats/sample-${i}.abchat`,
    content: serializeChat({
      metadata: {
        type: 'abele-chat',
        providerId: '',
        modelId: '',
        created: '',
        title: `Synthetic conversation ${i}`,
        attention:
          i % 10 === 0
            ? { errors: [{ id: `failure-${i}`, at: i, text: 'Synthetic failure' }] }
            : {},
      },
      messages: Array.from({ length: i % 10 === 0 ? 1600 : 10 }, (_, j) => ({
        id: `message-${j}`,
        role: 'assistant' as const,
        content: 'Synthetic content. '.repeat(100),
        timestamp: j,
      })),
      internalMessages: [],
    }),
  }))
}
