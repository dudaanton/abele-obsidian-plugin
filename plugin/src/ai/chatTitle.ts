import { AbeleConfig } from '@/services/AbeleConfig'
import { OpenAIClient } from './client/OpenAIClient'
import type { Message, ModelConfig } from './client'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from './types'

/** The same opening-exchange title for local and node conversations. */
export async function generateChatTitle(
  messages: ChatMessage[],
  model: ModelConfig,
  signal: AbortSignal
): Promise<string> {
  const config = AbeleConfig.getInstance().ai
  const client = new OpenAIClient()

  const msgs = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, 6)
    .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
    .join('\n')

  const titlePrompt = (
    config.prompts?.titleGeneration || DEFAULT_AI_SETTINGS.prompts.titleGeneration
  ).replace('{{messages}}', msgs)
  const titleSystem = config.prompts?.titleSystem || DEFAULT_AI_SETTINGS.prompts.titleSystem

  const titleMessages: Message[] = [{ role: 'user', content: titlePrompt, timestamp: Date.now() }]

  let title = ''
  for await (const event of client.stream(model, titleSystem, titleMessages, [], { signal })) {
    if (event.type === 'text_delta') title += event.delta
  }

  title = title
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 60)

  return title
}
