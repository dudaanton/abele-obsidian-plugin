import { z } from 'zod'
import { t } from '@/i18n'
import type { ChatMessage } from '@/ai/types'
import type { Prompt } from '@abele/node-client'
const Diff = z.object({ old: z.string(), new: z.string() })
const Preview = z.object({
  tool_name: z.string().optional(),
  path: z.string().optional(),
  content: z.string().optional(),
  device: z.string().optional(),
  diff: Diff.optional(),
  error: z.string().optional(),
})
const Call = z.object({
  invocation_id: z.string(),
  tool_name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  preview: Preview.optional(),
  state: z.string().optional(),
  result: z.unknown().optional(),
})
export function obsidianPromptCall(prompt: Prompt): ChatMessage | null {
  const parsed = Call.safeParse(prompt.input)
  if (
    !parsed.success ||
    prompt.run_id !== `obsidian:${parsed.data.invocation_id}` ||
    prompt.tool_name !== parsed.data.tool_name
  )
    return null
  return obsidianCallMessage({ ...parsed.data, state: 'awaiting_approval' }, 0)
}
export function obsidianCallMessage(raw: unknown, timestamp: number): ChatMessage | null {
  const parsed = Call.safeParse(raw)
  if (!parsed.success) return null
  const i = parsed.data
  const done = ['succeeded', 'failed', 'outcome_unknown', 'cancelled', 'denied'].includes(
    i.state ?? ''
  )
  const result = z
    .object({
      content: z.array(z.object({ type: z.literal('text'), text: z.string() })).optional(),
      details: z.object({ path: z.string().optional(), diff: Diff.optional() }).optional(),
    })
    .safeParse(i.result)
  return {
    id: `obsidian:${i.invocation_id}`,
    role: 'tool-call',
    content: '',
    timestamp,
    toolCallId: i.invocation_id,
    toolName: i.preview?.tool_name ?? i.tool_name,
    toolParams: i.arguments,
    toolStatus:
      i.state === 'awaiting_approval'
        ? 'pending'
        : ['failed', 'outcome_unknown', 'cancelled', 'denied'].includes(i.state ?? '')
          ? 'rejected'
          : 'approved',
    toolDiff: result.success ? (result.data.details?.diff ?? i.preview?.diff) : i.preview?.diff,
    toolPath: result.success ? (result.data.details?.path ?? i.preview?.path) : i.preview?.path,
    toolDevice: ['executing', 'succeeded', 'failed', 'outcome_unknown'].includes(i.state ?? '')
      ? i.preview?.device
      : undefined,
    toolResult: done
      ? result.success && result.data.content
        ? result.data.content.map((part) => part.text).join('\n')
        : i.state === 'outcome_unknown'
          ? t('node.tools.unknown')
          : i.state
      : undefined,
    toolTitle:
      i.state === 'awaiting_client'
        ? t('node.tools.waiting')
        : i.state === 'executing'
          ? t('node.tools.executing')
          : undefined,
  }
}
