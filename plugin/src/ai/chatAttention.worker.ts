import { parseChatAttention } from './ChatLog'

/** Only the attention projection leaves this worker, never message bodies or tool results. */
self.onmessage = async (event: MessageEvent<{ id: number; content: string }>) => {
  const { id, content } = event.data
  try {
    const snapshot = await parseChatAttention(content, () => Promise.resolve())
    self.postMessage({ id, snapshot })
  } catch {
    self.postMessage({ id, error: 'Conversation could not be checked' })
  }
}
