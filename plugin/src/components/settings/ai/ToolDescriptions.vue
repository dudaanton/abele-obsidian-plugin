<template>
  <!-- The tools as the chat's own tree: a group a branch with its count, a tool a row, a dot on
       one whose words were changed, and its words in a window of their own. -->
  <div class="abele-tool-descriptions" role="tree">
    <TreeItem
      v-for="group in groups"
      :key="group.category"
      :text="group.category"
      :flair="
        changedIn(group)
          ? `${changedIn(group)} of ${group.tools.length}`
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
            label="Changed from the plugin's own words"
          />
        </template>
        <template #actions>
          <Icon icon="pencil" size="xs" :tooltip="`Change what ${tool.label} tells the model`" />
        </template>
      </TreeItem>
    </TreeItem>

    <ObsidianModal v-if="editing" :title="editing.label" @close="editing = null">
      <p class="abele-tool-descriptions__about">What this tool tells the model about itself.</p>
      <Input
        v-model="draft"
        as-text-area
        class="abele-tool-descriptions__text"
        :rows="12"
        :placeholder="defaults[editing.name]"
        :aria-label="`What ${editing.label} tells the model`"
      />
      <template #footer>
        <Button
          text="Use the default"
          tooltip="Go back to the plugin's own words"
          :disabled="!draft"
          @click="draft = ''"
        />
        <Button text="Cancel" tooltip="Close this and change nothing" @click="editing = null" />
        <Button text="Save" tooltip="Use these words from now on" accent @click="save" />
      </template>
    </ObsidianModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import { getToolRegistry } from '@/ai/tools'
import { isDefaultDescription } from '@/ai/tools/toolDescriptionOverrides'

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
  for (const tool of getToolRegistry()) {
    const list = byCategory.get(tool.category) ?? []
    list.push({ name: tool.name, label: tool.label })
    byCategory.set(tool.category, list)
  }
  return [...byCategory].map(([category, tools]) => ({ category, tools }))
})

const defaults = computed<Record<string, string>>(() =>
  Object.fromEntries(getToolRegistry().map((tool) => [tool.name, tool.description]))
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
