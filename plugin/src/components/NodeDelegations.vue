<template>
  <div v-if="cards.length" class="abele-node-delegations">
    <NodeDelegationCard
      v-for="item in cards"
      :key="item.node.id + ':' + (item.card.delegationId ?? item.card.title)"
      :card="item.card"
      :node-label="item.node.label"
      @open="open(item)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { NodeService } from '@/node/NodeService'
import { ChatService } from '@/ai/ChatService'
import NodeDelegationCard from './NodeDelegationCard.vue'
const props = defineProps<{ parentId: string }>()
const service = NodeService.getInstance()
const cards = computed(() =>
  service.nodes.value.flatMap((node) => {
    try {
      return (service.connection(node.id).delegationCards.value[props.parentId] ?? []).map(
        (card) => ({ node, card })
      )
    } catch {
      return []
    }
  })
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
