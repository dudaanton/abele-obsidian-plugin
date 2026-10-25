<template>
  <!-- Which tools this chat may use, as a tree: a group of tools, its tools under it. Each says
       its mode with a glyph at the row's end — asks first, runs on its own, off — and the glyph
       opens the choice. A group's glyph sets all its tools at once. -->
  <div class="abele-chat-tools">
    <div class="abele-chat-tools__head">
      <Search
        v-model="query"
        class="abele-chat-tools__field"
        :label="t('chat.searchTools')"
        :placeholder="t('chat.searchToolsHint')"
        :autofocus="autofocus !== false"
      />
      <!-- Every tool at once, the same menu as a group's. -->
      <Icon
        :icon="sharedMode(optional).icon"
        class="abele-chat-tools__all"
        aria-haspopup="menu"
        :label="t('chat.allTools', { mode: sharedMode(optional).said })"
        @click="(e: MouseEvent) => modeMenu(e, optional)"
      />
      <AgentOverrideNotice v-if="!floor" field="toolModes" compact />
    </div>

    <div class="abele-chat-tools__tree" role="tree" :aria-label="t('chat.tools')">
      <TreeItem
        v-for="group in shown"
        :key="group.category"
        :text="groupLabel(group)"
        :data-tool-group="group.category"
        :flair="String(group.tools.length)"
        :icon="group.mcp ? 'plug' : undefined"
        collapsible
        :collapsed="!query && !open.has(group.category)"
        @click="toggle(group.category)"
      >
        <template #end>
          <Icon
            v-if="optionalOf(group).length"
            :icon="sharedMode(optionalOf(group)).icon"
            size="xs"
            aria-haspopup="menu"
            :label="`${groupLabel(group)}: ${sharedMode(optionalOf(group)).said}`"
            @click.stop="(e: MouseEvent) => modeMenu(e, optionalOf(group))"
            @keydown.stop
          />
        </template>
        <TreeItem
          v-for="tool in optionalOf(group)"
          :key="tool.name"
          :text="tool.label"
          plain
          class="abele-chat-tools__tool"
          :class="{ 'abele-chat-tools__tool_off': modeOf(tool) === 'off' }"
        >
          <template #end>
            <Icon
              v-if="raisedBy?.[tool.key]"
              icon="folder"
              size="xs"
              :interactive="false"
              :tooltip="t('chatTree.fromFolder', { name: raisedBy[tool.key] })"
            />
            <Icon
              :icon="MODE[modeOf(tool)].icon"
              size="xs"
              aria-haspopup="menu"
              :label="`${tool.label}: ${MODE[modeOf(tool)].said}`"
              @click="(e: MouseEvent) => modeMenu(e, [tool])"
              @keydown.stop
            />
          </template>
        </TreeItem>
        <!-- Tools that are always there take no choice: one quiet branch, open to see which. -->
        <TreeItem
          v-if="coreOf(group).length"
          :text="t('chat.alwaysOn')"
          :flair="String(coreOf(group).length)"
          collapsible
          :collapsed="!coreOpen.has(group.category)"
          class="abele-chat-tools__core"
          @click="toggleCore(group.category)"
        >
          <TreeItem
            v-for="tool in coreOf(group)"
            :key="tool.name"
            :text="tool.label"
            plain
            class="abele-chat-tools__tool"
          />
        </TreeItem>
      </TreeItem>
      <EmptyState v-if="!shown.length" variant="no-matches" :text="t('chat.noTools')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { settingsLabel, settingsToolLabel } from '@/i18n/settingsLabels'
import { computed, reactive, ref } from 'vue'
import { Menu, setTooltip } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Search from './obsidian/Search.vue'
import TreeItem from './obsidian/TreeItem.vue'
import EmptyState from './obsidian/EmptyState.vue'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import { getToolRegistry, type ToolInfo } from '@/ai/tools'
import { CORE_TOOLS, type ToolMode } from '@/ai/types'
import { isMcpToolName } from '@/ai/mcp/names'
import { below } from '@/chats/chatTree'

const props = defineProps<{
  toolModes: Record<string, ToolMode>
  floor?: Record<string, ToolMode>
  raisedBy?: Record<string, string>
  autofocus?: boolean
  registry?: ToolInfo[]
  /** Node-hosted core tools have the same per-tool choice as every other node tool. */
  coreModes?: boolean
}>()
const emit = defineEmits<{
  /** Several tools at once — a group, or all of them: one change for the host to save. */
  updateMany: [modes: Record<string, ToolMode>]
}>()

/** A mode as a glyph, and the words for its tooltip and its menu item. */
const MODE = {
  ask: { icon: 'shield-question', said: t('chat.asksFirst'), item: t('chat.askFirst') },
  auto: { icon: 'zap', said: t('chat.runsAlone'), item: t('chat.runAlone') },
  off: { icon: 'circle-off', said: t('chat.offState'), item: t('chat.off') },
  mixed: { icon: 'shield-ellipsis', said: t('chat.mixed'), item: '' },
} as const

interface Tool {
  name: string
  key: string
  label: string
}
interface Group {
  category: string
  tools: Tool[]
  mcp: boolean
}

const groupLabel = (group: Group) => (group.mcp ? group.category : settingsLabel(group.category))
const query = ref('')

const groups = computed<Group[]>(() => {
  const byCategory = new Map<string, Tool[]>()
  for (const tool of props.registry ?? getToolRegistry()) {
    if (['Nodes', 'Node files', 'Node repositories'].includes(tool.category ?? '')) continue
    const list = byCategory.get(tool.category) ?? []
    list.push({
      name: tool.name,
      key: tool.permissionKey ?? tool.name,
      label: settingsToolLabel(tool),
    })
    byCategory.set(tool.category, list)
  }
  return [...byCategory].map(([category, tools]) => ({
    category,
    tools,
    mcp: tools.every((t) => isMcpToolName(t.name)),
  }))
})

/** What the search leaves: a group that matches by name keeps all its tools. */
const shown = computed<Group[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return groups.value
  return groups.value
    .map((group) =>
      groupLabel(group).toLowerCase().includes(q) || group.category.toLowerCase().includes(q)
        ? group
        : { ...group, tools: group.tools.filter((t) => t.label.toLowerCase().includes(q)) }
    )
    .filter((group) => group.tools.length)
})

const isCore = (tool: Tool) => !props.coreModes && CORE_TOOLS.has(tool.name)
const optionalOf = (group: Group) => group.tools.filter((t) => !isCore(t))
const coreOf = (group: Group) => group.tools.filter(isCore)
const optional = computed(() => shown.value.flatMap(optionalOf))

const modeOf = (tool: Tool): ToolMode => props.toolModes[tool.key] ?? 'off'
/** The mode all these tools are at, or null when they differ. */
const shared = (tools: Tool[]): ToolMode | null => {
  const modes = new Set(tools.map(modeOf))
  return modes.size === 1 ? [...modes][0] : null
}

/** The three modes, the current one ticked; for one tool, a group, or all of them. */
const sharedMode = (tools: Tool[]) => MODE[shared(tools) ?? 'mixed']

const modeMenu = (event: MouseEvent, tools: Tool[]) => {
  const current = shared(tools)
  const menu = new Menu()
  if (props.floor && Object.keys(props.floor).length)
    menu.addItem((item) => item.setTitle(t('chatTree.additive')).setIsLabel(true))
  for (const mode of ['ask', 'auto', 'off'] as const)
    menu.addItem((item) =>
      item
        .setTitle(MODE[mode].item)
        .setIcon(MODE[mode].icon)
        .setChecked(current === mode)
        .setDisabled(!!props.floor && tools.every((tool) => below(mode, props.floor?.[tool.key])))
        .onClick(() =>
          emit(
            'updateMany',
            Object.fromEntries(
              tools.map((tool) => [
                tool.key,
                below(mode, props.floor?.[tool.key]) ? props.floor![tool.key] : mode,
              ])
            )
          )
        )
    )
  menu.showAtMouseEvent(event)
  for (const item of activeDocument.querySelectorAll<HTMLElement>('.menu .menu-item.is-disabled'))
    setTooltip(item, t('chatTree.defaultFloor'))
}

/** Groups open by hand; a search opens every group it leaves. */
const open = reactive(new Set<string>())
const coreOpen = reactive(new Set<string>())
const toggleCore = (category: string) => {
  if (coreOpen.has(category)) coreOpen.delete(category)
  else coreOpen.add(category)
}
const toggle = (category: string) => {
  if (open.has(category)) open.delete(category)
  else open.add(category)
}
</script>

<style lang="scss">
.abele-chat-tools {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-height: 0;
}
.abele-chat-tools__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}
.abele-chat-tools__field {
  flex: 1 1 auto;
}
// The count and the mode glyph at a group's end stand apart, as two codes.
.abele-chat-tools .tree-item-flair-outer {
  gap: var(--size-4-2);
}
// A tool that is off reads faint, so what the agent may use stands out in a long list.
.abele-chat-tools__tool_off .abele-tree-item__text {
  color: var(--text-faint);
}
.abele-chat-tools__core > .tree-item-self {
  color: var(--text-muted);
}
</style>
