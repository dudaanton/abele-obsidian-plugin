<template>
  <!-- The tools as the chat's own tree: a group a branch with its count, a tool a row, a dot on
       one whose words were changed, and its words in a window of their own. -->
  <div class="abele-tool-descriptions" role="tree">
    <TreeItem
      v-for="group in groups"
      :key="group.category"
      :text="group.label"
      :flair="
        changedIn(group)
          ? t('settings.ai.ToolDescriptions.value_of_value.ca6c5e5f', {
              value0: String(changedIn(group)),
              value1: String(group.tools.length),
            })
          : String(group.tools.length)
      "
      collapsible
      :collapsed="!open.has(group.category)"
      @click="fold(group.category)"
    >
      <TreeItem
        v-for="tool in group.tools"
        :key="tool.name"
        :text="tool.label"
        class="abele-tool-descriptions__tool"
        @click="edit(tool)"
      >
        <template #end>
          <StatusDot
            v-if="descriptions[tool.name]"
            tone="accent"
            :label="t('settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab')"
          />
        </template>
        <template #actions>
          <Icon
            icon="pencil"
            size="xs"
            :tooltip="
              t('settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d', {
                value0: String(tool.label),
              })
            "
          />
        </template>
      </TreeItem>
    </TreeItem>

    <ObsidianModal v-if="editing" :title="editing.label" @close="editing = null">
      <p class="abele-tool-descriptions__about">
        {{ t('settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7') }}
      </p>
      <Input
        v-model="draft"
        as-text-area
        class="abele-tool-descriptions__text"
        :rows="12"
        :placeholder="defaults[editing.name]"
        :aria-label="
          t('settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7', {
            value0: String(editing.label),
          })
        "
      />
      <template #footer>
        <Button
          :text="t('settings.ai.ToolDescriptions.use_the_default.76f7faf5')"
          :tooltip="t('settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb')"
          :disabled="!draft"
          @click="draft = ''"
        />
        <Button
          :text="t('settings.ai.ToolDescriptions.cancel.19766ed6')"
          :tooltip="t('settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492')"
          @click="editing = null"
        />
        <Button
          :text="t('settings.ai.ToolDescriptions.save.1509f561')"
          :tooltip="t('settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d')"
          accent
          @click="save"
        />
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { settingsLabel, settingsToolLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import { getSectionToolRegistry, getToolRegistry } from '@/ai/tools'
import { isDefaultDescription } from '@/ai/tools/toolDescriptionOverrides'
import { LEGACY_NODE_TOOLS } from '@/ai/toolSections'

const props = defineProps<{
  /** The words changed so far, by tool name. */
  descriptions: Record<string, string>
}>()

const emit = defineEmits<{
  /** A tool's words; empty means its own again. */
  update: [toolName: string, description: string]
}>()

interface Tool {
  name: string
  label: string
}

const groups = computed(() => {
  const byCategory = new Map<string, Tool[]>()
  // A section's own entry heads its group: its words are what the agent reads before opening it.
  for (const tool of [...getSectionToolRegistry(), ...getToolRegistry()]) {
    // Old node names are answered when called but never offered, so they have nothing to say.
    if (LEGACY_NODE_TOOLS.has(tool.name)) continue
    const list = byCategory.get(tool.category) ?? []
    list.push({ name: tool.name, label: settingsToolLabel(tool) })
    byCategory.set(tool.category, list)
  }
  return [...byCategory].map(([category, tools]) => ({
    category,
    label: settingsLabel(category),
    tools,
  }))
})

const defaults = computed<Record<string, string>>(() =>
  Object.fromEntries(
    [...getSectionToolRegistry(), ...getToolRegistry()].map((tool) => [tool.name, tool.description])
  )
)

const changedIn = (group: { tools: Tool[] }) =>
  group.tools.filter((tool) => props.descriptions[tool.name]).length

const open = ref(new Set<string>())
const fold = (category: string) => {
  const next = new Set(open.value)
  if (!next.delete(category)) next.add(category)
  open.value = next
}

const editing = ref<Tool | null>(null)
const draft = ref('')
const edit = (tool: Tool) => {
  draft.value = props.descriptions[tool.name] || ''
  editing.value = tool
}

/** An override only when it says something the default does not; otherwise none at all. */
const save = () => {
  const tool = editing.value
  if (!tool) return
  const own =
    !draft.value || isDefaultDescription(tool.name, draft.value, defaults.value[tool.name] || '')
  emit('update', tool.name, own ? '' : draft.value)
  editing.value = null
}
</script>

<style lang="scss">
// No glyphs in this tree: a name starts right after its arrow.
.abele-tool-descriptions .abele-tree-item__glyph:empty {
  display: none;
}

.abele-tool-descriptions__about {
  margin-top: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-tool-descriptions__text {
  width: 100%;
}

.abele-tool-descriptions__text textarea.abele-obsidian-input__base {
  width: 100%;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}
</style>
