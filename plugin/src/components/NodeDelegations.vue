<template>
  <div v-if="cards.length || runs.length || error" class="abele-node-delegations">
    <NodeDelegationCard
      v-for="item in cards"
      :key="item.node.id + ':' + (item.card.delegationId ?? item.card.title)"
      :card="item.card"
      :node-label="item.node.label"
      :disabled="service.connection(item.node.id).state.value !== 'connected'"
      :registration-id="item.node.id"
      :refresh="() => service.connection(item.node.id).refreshDelegations()"
      @answer="(prompt, choice, value) => answer(item.node.id, prompt, choice, value)"
      @questionnaire="(prompt, answers) => answerQuestionnaire(item.node.id, prompt, answers)"
      @stop="(prompt) => stop(item.node.id, prompt)"
      @open="open(item)"
    />
    <NodeManagerRunCard
      v-for="item in runs"
      :key="item.node.id + item.card.operation"
      :card="item.card"
      :disabled="
        item.card.run.session_id !== 'unsubmitted-command' &&
        service.connection(item.node.id).state.value !== 'connected'
      "
      :registration-id="item.node.id"
      :refresh="
        item.card.run.session_id === 'unsubmitted-command'
          ? undefined
          : () =>
              service
                .connection(item.node.id)
                .manager.status(parentId, item.card.run.session_id, item.card.run.run_id)
                .then(() => service.connection(item.node.id).refreshDelegations())
      "
      :retry="
        item.card.run.state !== 'outcome_unknown' &&
        item.card.run.session_id !== 'unsubmitted-command'
          ? () => retryCommand(item)
          : undefined
      "
      @answer="(prompt, choice, value) => answerRun(item, prompt, choice, value)"
      @cancel="cancel(item)"
    />
    <NodeErrorLine
      v-if="error"
      :error="error"
      :registration-id="errorNode"
      :refresh="errorNode ? () => service.connection(errorNode).refreshDelegations() : undefined"
    />
  </div>
</template>
<script setup lang="ts">
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import { answerOwnerPrompt } from '@/node/promptAnswers'
import NodeManagerRunCard from './NodeManagerRunCard.vue'
import NodeErrorLine from './nodeWork/NodeErrorLine.vue'
import { computed, ref } from 'vue'
import { NodeService } from '@/node/NodeService'
import { ChatService } from '@/ai/ChatService'
import NodeDelegationCard from './NodeDelegationCard.vue'
const props = defineProps<{ parentId: string; include?: string[]; exclude?: string[] }>()
const visible = (key: string) =>
  props.include ? props.include.includes(key) : !props.exclude?.includes(key)
const service = NodeService.getInstance()
const cards = computed(() =>
  service.nodes.value.flatMap((node) => {
    try {
      return (service.connection(node.id).delegationCards.value[props.parentId] ?? [])
        .filter((card) => visible(`task:${card.taskKey}`))
        .map((card) => ({ node, card }))
    } catch {
      return []
    }
  })
)
const error = ref('')
const errorNode = ref('')
async function retryCommand(item: (typeof runs.value)[number]) {
  const connection = service.connection(item.node.id)
  if (item.card.run.state === 'outcome_unknown') return
  await connection.manager.retry(props.parentId, item.card.operation, crypto.randomUUID())
  await connection.refreshDelegations()
}
async function answerQuestionnaire(
  node: string,
  prompt: Prompt,
  answers: QuestionnaireAnswer[] | null
) {
  try {
    await service.connection(node).client.answerQuestionnaire(prompt, answers)
    await service.connection(node).refreshDelegations()
  } catch (err) {
    errorNode.value = node
    error.value = err instanceof Error ? err.message : String(err)
  }
}
const runs = computed(() =>
  service.nodes.value.flatMap((node) => {
    try {
      return (service.connection(node.id).managerCards.value[props.parentId] ?? [])
        .filter((card) => visible(`operation:${card.operation}`))
        .map((card) => ({
          node,
          card,
        }))
    } catch {
      return []
    }
  })
)
async function ownerAction(node: string, action: () => Promise<unknown>) {
  errorNode.value = node
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  await service
    .connection(node)
    .refreshDelegations()
    .catch((e) => {
      error.value = e instanceof Error ? e.message : String(e)
    })
}
const answer = (node: string, prompt: Prompt, choice: 'allow' | 'deny', value?: string) =>
  ownerAction(node, () => {
    const connection = service.connection(node)
    return answerOwnerPrompt(
      connection.client,
      connection.client.target.expected_node_id,
      prompt,
      choice,
      value
    )
  })
const answerRun = (
  item: (typeof runs.value)[number],
  prompt: Prompt,
  choice: 'allow' | 'deny',
  value?: string
) =>
  'context_id' in item.card.run || prompt.session_id === 'unsubmitted-command'
    ? ownerAction(item.node.id, () =>
        service.connection(item.node.id).manager.answer(props.parentId, prompt, choice)
      )
    : answer(item.node.id, prompt, choice, value)
const stop = (node: string, prompt: Prompt) =>
  ownerAction(node, async () => {
    const connection = service.connection(node)
    await connection.delegation.stopByOwner(prompt.session_id)
    await connection.client.interrupt(prompt.session_id, prompt.run_id)
  })
const cancel = (item: (typeof runs.value)[number]) =>
  ownerAction(item.node.id, () =>
    service
      .connection(item.node.id)
      .manager.mutate(
        props.parentId,
        'command.v1.cancel',
        { session_id: item.card.run.session_id, run_id: item.card.run.run_id },
        crypto.randomUUID()
      )
  )
const open = (item: (typeof cards.value)[number]) => {
  const { card, node } = item
  if (!card.nodeId || !card.sessionId) return
  void ChatService.getInstance().openNodeSession({
    kind: 'node-session',
    registrationId: node.id,
    nodeId: card.nodeId,
    sessionId: card.sessionId,
    title: card.title,
  })
}
</script>

<style scoped>
.abele-node-delegations {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}
</style>
