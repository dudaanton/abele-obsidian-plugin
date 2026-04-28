<template>
  <div class="abele-tool-modes">
    <div v-if="!hideShowAll" class="abele-tool-modes__toggle">
      <Setting name="Show core tools" desc="Show always-on tools that cannot be disabled.">
        <Checkbox :is-enabled="showAll" @toggle="showAll = !showAll" />
      </Setting>
    </div>

    <template v-for="group in visibleGroups" :key="group.category">
      <h4 class="abele-tool-modes__heading">{{ group.category }}</h4>

      <div v-for="tool in group.tools" :key="tool.name">
        <Setting :name="tool.label">
          <Icon
            v-if="showDescriptions"
            icon="message-square"
            class="abele-tool-modes__desc-btn"
            :class="{ 'abele-tool-modes__desc-btn--active': isDescVisible(tool.name) }"
            @click="toggleDescEdit(tool.name)"
          />
          <span v-if="isCore(tool.name)" class="abele-tool-modes__core">always on</span>
          <Dropdown
            v-else
            :model-value="getMode(tool.name)"
            :options="modeOptions"
            @update:model-value="setMode(tool.name, $event as ToolMode)"
          />
        </Setting>

        <div
          v-if="showDescriptions && isDescVisible(tool.name)"
          class="abele-tool-modes__desc-input"
        >
          <Input
            :model-value="getCustomDescription(tool.name)"
            as-text-area
            :placeholder="getDefaultDescription(tool.name)"
            @update:model-value="emitDescUpdate(tool.name, $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Dropdown from './obsidian/Dropdown.vue'
import Input from './obsidian/Input.vue'
import Icon from './obsidian/Icon.vue'
import { getToolRegistry } from '@/ai/tools'
import { CORE_TOOLS, DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ToolMode } from '@/ai/types'

const props = withDefaults(
  defineProps<{
    toolModes: Record<string, ToolMode>
    showDescriptions?: boolean
    toolDescriptions?: Record<string, string>
    hideShowAll?: boolean
  }>(),
  {
    showDescriptions: false,
    toolDescriptions: () => ({}),
    hideShowAll: false,
  }
)

const emit = defineEmits<{
  (e: 'update', toolName: string, mode: ToolMode): void
  (e: 'updateDescription', toolName: string, description: string): void
}>()

const showAll = ref(false)
const editingDesc = ref<string | null>(null)

const modeOptions = [
  { value: 'off', display: 'Off' },
  { value: 'ask', display: 'Ask' },
  { value: 'auto', display: 'Auto' },
]

const defaultDescs = DEFAULT_AI_SETTINGS.prompts.toolDescriptions as Record<string, string>

const isCore = (name: string) => CORE_TOOLS.has(name)
const getMode = (name: string): ToolMode => props.toolModes[name] ?? 'off'
const setMode = (name: string, mode: ToolMode) => emit('update', name, mode)

const hasCustomDescription = (name: string) => !!props.toolDescriptions?.[name]
const getCustomDescription = (name: string) => props.toolDescriptions?.[name] || ''
const getDefaultDescription = (name: string) => defaultDescs[name] || ''

const isDescVisible = (name: string) => {
  if (hasCustomDescription(name)) return true
  return editingDesc.value === name
}

const toggleDescEdit = (name: string) => {
  editingDesc.value = editingDesc.value === name ? null : name
}

const emitDescUpdate = (name: string, value: string) => {
  emit('updateDescription', name, value)
}

interface ToolEntry {
  name: string
  label: string
}

interface ToolGroup {
  category: string
  tools: ToolEntry[]
}

const visibleGroups = computed<ToolGroup[]>(() => {
  const registry = getToolRegistry()
  const groups = new Map<string, ToolEntry[]>()

  for (const tool of registry) {
    if (!showAll.value && isCore(tool.name)) continue
    if (!groups.has(tool.category)) groups.set(tool.category, [])
    groups.get(tool.category)!.push({ name: tool.name, label: tool.label })
  }

  return Array.from(groups.entries()).map(([category, tools]) => ({ category, tools }))
})
</script>

<style lang="scss">
.abele-tool-modes .setting-item {
  min-height: 2.4em;
}

h4.abele-tool-modes__heading {
  margin: var(--size-4-3) 0 0 !important;
  padding-top: var(--size-4-4);
  padding-bottom: var(--size-4-1);
  border-top: 1px solid var(--background-modifier-border);

  &:first-child {
    margin-top: 0 !important;
    padding-top: 0;
    border-top: none;
  }
}

.abele-tool-modes__core {
  font-size: var(--font-smallest);
  color: var(--text-faint);
  font-style: italic;
}

.abele-tool-modes__desc-btn {
  cursor: pointer;
  color: var(--text-faint);

  &:hover,
  &--active {
    color: var(--text-accent);
  }
}

.abele-tool-modes__desc-input {
  padding: 0 0 var(--size-4-2);

  textarea {
    width: 100% !important;
  }
}
</style>
