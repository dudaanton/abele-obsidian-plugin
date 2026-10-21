<template>
  <TreeItem
    class="abele-chat-run abele-run"
    :class="`abele-chat-run_${state}`"
    :text="t('node.tools.askedAgent', { agent: String(message.toolParams?.agent ?? '') })"
    :icon="state === 'running' ? 'loader' : 'bot'"
    collapsible
    :collapsed="!open"
    @click="open = !open"
  >
    <template #end>
      <span
        v-if="state !== 'done'"
        class="abele-chat-run__dot"
        :class="`abele-chat-run__dot_${state}`"
        role="img"
        :aria-label="branchState(state)"
      />
    </template>
    <NodeErrorText v-if="error" :error="error" />
    <template v-for="branch in branches" :key="branch.id">
      <p v-if="branches.length > 1" class="abele-node-message-note">{{ branch.item }}</p>
      <template v-for="answer in branch.messages" :key="answer.id">
        <div v-if="answer.role === 'assistant'" class="abele-chat-letter__reply">
          <Markdown :text="answer.content" :resource-opener="openResource" />
        </div>
        <AiChatMessage v-else :message="answer" read-only-history :resource-opener="openResource" />
      </template>
    </template>
  </TreeItem>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { z } from 'zod'
import type { NodeClient } from '@abele/node-client'
import type { ChatMessage } from '@/ai/types'
import { t } from '@/i18n'
import { streamBLabel } from '@/i18n/streamBLabels'
import { foldDelegateHistory } from '@/node/obsidianDelegateHistory'
import TreeItem from './obsidian/TreeItem.vue'
import { callState } from '@/ai/toolRuns'
import AiChatMessage from './AiChatMessage.vue'
import Markdown from './obsidian/Markdown.vue'
import NodeErrorText from './NodeErrorText.vue'
const props = defineProps<{
  client: NodeClient
  invocation: string
  message: ChatMessage
  openResource: (path: string) => void
  revision?: unknown
}>()
const open = ref(false),
  error = ref('')
const state = computed(() => callState(props.message))
const branchState = (state: string) =>
  state === 'done'
    ? t('node.delegation.done')
    : state === 'outcome_unknown'
      ? t('node.delegation.unknown')
      : state === 'aborted'
        ? t('streamBMeta.8b47045eb7')
        : state === 'error'
          ? t('streamB.failed.031a8f')
          : state === 'queued'
            ? t('streamB.queued.661ff4')
            : streamBLabel(state)
const branches = ref<{ id: string; item: string; state: string; messages: ChatMessage[] }[]>([])
let generation = 0
watch(
  () => [open.value, props.invocation, props.revision],
  async () => {
    const current = ++generation
    if (!open.value) return
    try {
      const request = (name: string, params: Record<string, unknown> = {}) =>
        props.client.request('obsidian.tools.v1.delegate.' + name, {
          invocation_id: props.invocation,
          ...params,
        })
      const root = z
        .object({ runs: z.array(z.object({ run_id: z.string() })) })
        .parse(await request('get'))
      const rows: typeof branches.value = []
      for (const run of root.runs) {
        const view = z
          .object({
            branches: z.array(
              z.object({ branch_id: z.string(), item: z.string(), state: z.string() })
            ),
          })
          .parse(await request('get', { run_id: run.run_id }))
        for (const branch of view.branches) {
          const records: unknown[] = []
          let after = 0
          for (;;) {
            const page = z
              .object({
                entries: z.array(z.object({ message: z.unknown() })),
                next_seq: z.number(),
                has_more: z.boolean(),
              })
              .parse(await request('history', { branch_id: branch.branch_id, after_seq: after }))
            records.push(...page.entries.map((row) => row.message))
            if (!page.has_more) break
            if (page.next_seq <= after) throw new Error('Delegate history did not advance')
            after = page.next_seq
          }
          rows.push({
            id: branch.branch_id,
            item: branch.item,
            state: branch.state,
            messages: foldDelegateHistory(records),
          })
        }
      }
      if (current === generation) {
        branches.value = rows
        error.value = ''
      }
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : String(err)
    }
  }
)
</script>
