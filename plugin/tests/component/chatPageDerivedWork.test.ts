import { readFileSync } from 'node:fs'
import { computed, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import { chatBlocks } from '@/ai/toolRuns'
import { nodeCardPlacement } from '@/node/cardPlacement'
import type { ChatMessage } from '@/ai/types'

it('does not rescan history for card ownership when only the visible page changes', () => {
  // Execute the actual screen's computed expression with isolated reactive inputs.
  const source = readFileSync('src/components/AiChat.vue', 'utf8')
  const expression = source.split('const nodePlacements = ')[1].split('\nconst runChoice')[0]
  const messages = ref<ChatMessage[]>([
    {
      id: 'first',
      role: 'tool-call',
      toolName: 'node_delegate',
      toolParams: { task_key: 'sample' },
    },
    ...Array.from({ length: 1800 }, (_, i) => ({
      id: `row-${i}`,
      role: 'assistant',
      content: 'Text',
    })),
  ] as ChatMessage[])
  const start = ref(0)
  const blocks = computed(() => chatBlocks(messages.value.slice(start.value, start.value + 90)))
  const fullBlocks = computed(() => chatBlocks(messages.value))
  const placement = vi.fn(nodeCardPlacement)
  const evaluate = new Function(
    'computed',
    'session',
    'nodeCardPlacement',
    'blocks',
    'messages',
    'fullBlocks',
    `return ${expression}`
  )
  const result = evaluate(computed, ref({}), placement, blocks, messages, fullBlocks)
  const first = result.value
  expect(first.first).toEqual(['task:sample'])
  for (start.value = 30; start.value < 300; start.value += 30) expect(result.value).toBe(first)
  expect(placement).toHaveBeenCalledTimes(1)
  messages.value[0].toolParams = { task_key: 'changed' }
  expect(result.value.first).toEqual(['task:changed'])
  expect(placement).toHaveBeenCalledTimes(2)
})
