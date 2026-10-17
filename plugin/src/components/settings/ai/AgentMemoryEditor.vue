<template>
  <Section :desc="t('settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c')">
    <CardGrid v-if="items.length" stack>
      <Card
        v-for="item in items"
        :key="item.id"
        :title="
          t('settings.ai.AgentMemoryEditor.added_value.29f396e2', { value0: String(item.created) })
        "
      >
        <template #actions>
          <Icon
            icon="trash"
            :tooltip="t('settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d')"
            @click="remove(item.id)"
          />
        </template>

        <Input :model-value="item.text" @update:model-value="edit(item.id, $event)" />
      </Card>
    </CardGrid>

    <EmptyState
      v-else
      :text="t('settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6')"
    />

    <div class="abele-agent-memory__add">
      <Input
        v-model="draft"
        :placeholder="
          t('settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77')
        "
      />
      <Button
        :text="t('settings.ai.AgentMemoryEditor.add.9fd728c6')"
        :tooltip="t('settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8')"
        :disabled="!draft.trim()"
        @click="add"
      />
    </div>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
