<template>
  <Section
    desc="What this agent was asked to remember. Only this agent sees it: it is added to its
      system prompt, laid out by the memory template in the general AI settings. The agent adds
      items with the remember tool, which can be switched off on the Access tab."
  >
    <CardGrid v-if="items.length" stack>
      <Card v-for="item in items" :key="item.id" :title="`Added ${item.created}`">
        <template #actions>
          <Icon icon="trash" tooltip="Forget this item" @click="remove(item.id)" />
        </template>

        <Input :model-value="item.text" @update:model-value="edit(item.id, $event)" />
      </Card>
    </CardGrid>

    <EmptyState
      v-else
      text="Nothing remembered yet. Ask the agent in a chat to remember something, or add it here."
    />

    <div class="abele-agent-memory__add">
      <Input v-model="draft" placeholder="Something this agent should remember..." />
      <Button
        text="Add"
        tooltip="Add this line to the agent's memory"
        :disabled="!draft.trim()"
        @click="add"
      />
    </div>
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Section from '../../obsidian/Section.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createMemoryItem } from '@/ai/agents/memory'
import type { AgentMemoryItem } from '@/ai/agents/types'

const props = defineProps<{ agentId: string }>()
const emit = defineEmits<{ changed: [] }>()

const registry = AgentRegistry.getInstance()

/** Read through the registry, so an item the agent remembers mid-chat shows up here at once. */
const items = computed<AgentMemoryItem[]>(() => registry.get(props.agentId)?.memory ?? [])

const draft = ref('')

/** Every change replaces the list, which is what makes it one reactive write and one save. */
function write(memory: AgentMemoryItem[]): void {
  registry.update(props.agentId, { memory })
  emit('changed')
}

function edit(id: string, text: string): void {
  write(items.value.map((item) => (item.id === id ? { ...item, text } : item)))
}

function remove(id: string): void {
  write(items.value.filter((item) => item.id !== id))
}

function add(): void {
  if (!draft.value.trim()) return
  write([...items.value, createMemoryItem(draft.value)])
  draft.value = ''
}
</script>

<style lang="scss">
.abele-agent-memory__add {
  display: flex;
  gap: var(--size-4-2);
  align-items: center;
  margin-top: var(--size-4-3);
}
</style>
