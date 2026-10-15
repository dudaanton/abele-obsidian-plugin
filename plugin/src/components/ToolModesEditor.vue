<template>
  <div class="abele-tool-modes">
    <div v-if="!hideShowAll && !descriptionsOnly" class="abele-tool-modes__toggle">
      <Setting name="Show core tools" desc="Show always-on tools that cannot be disabled.">
        <Checkbox :is-enabled="showAll" @toggle="showAll = !showAll" />
      </Setting>
    </div>

    <!-- Shortcuts only: they set every tool's own dropdown below, which stays to be changed. -->
    <Setting
      v-if="!descriptionsOnly && allTools.length > 1"
      name="All tools"
      desc="Sets every tool below at once. Each can still be changed on its own after."
      class="abele-tool-modes__bulk abele-tool-modes__bulk--all"
    >
      <Button
        v-for="option in modeOptions"
        :key="option.value"
        :text="option.display"
        :accent="sharedMode(allTools) === option.value"
        :tooltip="`Set every tool to ${option.display}`"
        @click="setAll(allTools, option.value)"
      />
    </Setting>

    <template v-for="group in visibleGroups" :key="group.category">
      <!-- A section's head: its name and, offered by section, whether it stands open from the
           first question or opens when the agent asks; under it what it is for, editable. -->
      <div class="abele-tool-modes__head">
        <h4 class="abele-tool-modes__heading">{{ group.category }}</h4>
        <span
          v-if="bySection && !descriptionsOnly && ALWAYS_LOADED_GROUPS.has(group.category)"
          class="abele-tool-modes__opening-fixed"
          >Always open</span
        >
        <Dropdown
          v-else-if="bySection && !descriptionsOnly"
          class="abele-tool-modes__opening"
          :model-value="opening(group.category)"
          :options="OPENING_OPTIONS"
          :aria-label="`When ${group.category} is open`"
          @update:model-value="
            emit('updateOpening', sectionIdOfGroup(group.category), $event as SectionOpening)
          "
        />
      </div>
      <div
        v-if="
          !descriptionsOnly && (sectionText(group.category) || editingSection === group.category)
        "
        class="abele-tool-modes__about"
      >
        <template v-if="editingSection !== group.category">
          <span class="abele-tool-modes__about-text">{{ sectionText(group.category) }}</span>
          <Icon
            icon="pencil"
            size="xs"
            :tooltip="`Change what ${group.category} is said to be for`"
            @click="editingSection = group.category"
          />
        </template>
        <template v-else>
          <Input
            :model-value="sectionText(group.category)"
            as-text-area
            @update:model-value="emitSectionText(group.category, $event)"
          />
          <div class="abele-tool-modes__desc-reset">
            <Button
              v-if="props.sectionDescriptions[sectionIdOfGroup(group.category)]"
              text="Reset to default"
              icon="rotate-ccw"
              tooltip="Use the section's own description again"
              @click="emitSectionText(group.category, '')"
            />
            <Button text="Done" @click="editingSection = null" />
          </div>
        </template>
      </div>
      <!-- The node's tools by what they do, one choice each; the tools themselves on asking. -->
      <template v-if="group.category === NODE_SECTION && !descriptionsOnly">
        <div v-for="action in nodeActions(group)" :key="action.id" class="abele-tool-modes__row">
          <Setting :name="action.label">
            <template #desc>
              {{ action.desc }}
              <Icon
                class="abele-tool-modes__members-toggle"
                :icon="openAction === action.id ? 'chevron-down' : 'chevron-right'"
                size="xs"
                :text-right="`${action.tools.length} tools`"
                :tooltip="
                  openAction === action.id
                    ? 'Hide its tools'
                    : 'Show its tools, each with its own choice'
                "
                @click="openAction = openAction === action.id ? null : action.id"
              />
            </template>
            <Dropdown
              :model-value="sharedMode(action.tools) ?? 'mixed'"
              :options="
                sharedMode(action.tools)
                  ? modeOptions
                  : [...modeOptions, { value: 'mixed', display: 'Mixed' }]
              "
              @update:model-value="
                $event !== 'mixed' && setAll([...action.tools, ...action.carried], $event)
              "
            />
          </Setting>
          <div v-if="openAction === action.id" class="abele-tool-modes__members">
            <Setting v-for="tool in action.tools" :key="tool.name">
              <template #name
                ><code>{{ tool.name }}</code></template
              >
              <Dropdown
                :model-value="getMode(tool.permissionKey ?? tool.name)"
                :options="modeOptions"
                @update:model-value="setMode(tool.permissionKey ?? tool.name, $event as ToolMode)"
              />
            </Setting>
          </div>
        </div>
      </template>

      <Setting
        v-if="!descriptionsOnly && group.category !== NODE_SECTION && optionalOf(group).length > 1"
        name="All in this section"
        class="abele-tool-modes__bulk abele-tool-modes__bulk--section"
        :data-section="group.category"
      >
        <Button
          v-for="option in modeOptions"
          :key="option.value"
          :text="option.display"
          :accent="sharedMode(optionalOf(group)) === option.value"
          :tooltip="`Set every tool in ${group.category} to ${option.display}`"
          @click="setAll(optionalOf(group), option.value)"
        />
      </Setting>

      <!-- An MCP server is given to an agent whole; each tool can then be tuned below. -->
      <Setting
        v-if="group.mcp && !descriptionsOnly"
        name="Use this server"
        desc="Gives every tool of this server, each asking before it runs."
      >
        <Checkbox :is-enabled="serverInUse(group)" @toggle="toggleServer(group)" />
      </Setting>

      <div
        v-for="tool in group.category === NODE_SECTION && !descriptionsOnly ? [] : group.tools"
        :key="tool.name"
        class="abele-tool-modes__row"
      >
        <Setting :name="tool.label">
          <Icon
            v-if="showDescriptions"
            icon="message-square"
            class="abele-tool-modes__desc-btn"
            :class="{ 'abele-tool-modes__desc-btn--active': isDescVisible(tool.name) }"
            @click="toggleDescEdit(tool.name)"
          />
          <span v-if="descriptionsOnly" />
          <span v-else-if="isCore(tool.name)" class="abele-tool-modes__core">always on</span>
          <Dropdown
            v-else
            :model-value="getMode(tool.permissionKey ?? tool.name)"
            :options="modeOptions"
            @update:model-value="setMode(tool.permissionKey ?? tool.name, $event as ToolMode)"
          />
        </Setting>

        <div
          v-if="showDescriptions && isDescVisible(tool.name)"
          class="abele-tool-modes__desc-input"
        >
          <Input
            :model-value="getCustomDescription(tool.name) || getDefaultDescription(tool.name)"
            as-text-area
            @update:model-value="emitDescUpdate(tool.name, $event)"
          />
          <div v-if="hasCustomDescription(tool.name)" class="abele-tool-modes__desc-reset">
            <Button
              text="Reset to default"
              icon="rotate-ccw"
              tooltip="Use the tool's own description again"
              @click="emitDescUpdate(tool.name, '')"
            />
          </div>
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
import Button from './obsidian/Button.vue'
import { getToolRegistry } from '@/ai/tools'
import { CORE_TOOLS } from '@/ai/types'
import { isDefaultDescription } from '@/ai/tools/toolDescriptionOverrides'
import type { ToolMode } from '@/ai/types'
import { isMcpToolName } from '@/ai/mcp/names'
import {
  ALWAYS_LOADED_GROUPS,
  LEGACY_NODE_TOOLS,
  NODE_ACTIONS,
  NODE_GROUP as NODE_SECTION,
  nodeAction,
  sectionDefaultDescription,
  sectionIdOfGroup,
  sectionOpening,
  type SectionOpening,
} from '@/ai/toolSections'

const props = withDefaults(
  defineProps<{
    toolModes: Record<string, ToolMode>
    showDescriptions?: boolean
    toolDescriptions?: Record<string, string>
    hideShowAll?: boolean
    /** Edit only what each tool tells the model, with no per-agent mode dropdowns. */
    descriptionsOnly?: boolean
    /** Tools are offered by section: each section's head says when it is open. */
    bySection?: boolean
    sectionOpening?: Record<string, SectionOpening>
    sectionDescriptions?: Record<string, string>
  }>(),
  {
    bySection: false,
    sectionOpening: () => ({}),
    sectionDescriptions: () => ({}),
    showDescriptions: false,
    toolDescriptions: () => ({}),
    hideShowAll: false,
    descriptionsOnly: false,
  }
)

const emit = defineEmits<{
  (e: 'update', toolName: string, mode: ToolMode): void
  /** Several tools at once, from the shortcuts: one change for the host to save, not one each. */
  (e: 'updateMany', modes: Record<string, ToolMode>): void
  (e: 'updateDescription', toolName: string, description: string): void
  (e: 'updateOpening', section: string, opening: SectionOpening): void
  (e: 'updateSectionDescription', section: string, description: string): void
}>()

const OPENING_OPTIONS = [
  { value: 'always', display: 'Always open' },
  { value: 'on-request', display: 'On request' },
]
const opening = (group: string): SectionOpening =>
  sectionOpening(group, { toolSectionOpening: props.sectionOpening })
const editingSection = ref<string | null>(null)
const sectionText = (group: string) =>
  props.sectionDescriptions[sectionIdOfGroup(group)] || sectionDefaultDescription(group)
/** An own description only when it differs from the default; the same words are none. */
const emitSectionText = (group: string, text: string) =>
  emit(
    'updateSectionDescription',
    sectionIdOfGroup(group),
    text.trim() === sectionDefaultDescription(group) ? '' : text
  )

const openAction = ref<string | null>(null)
/** The node section's tools by action, in the order a person thinks of them: read, edit, worktrees. */
/** The old node names: never listed, set with the Read action, whose work they do. */
const legacyNodeTools = computed<ToolEntry[]>(() =>
  getToolRegistry()
    .filter((t) => LEGACY_NODE_TOOLS.has(t.name))
    .map((t) => ({ name: t.name, permissionKey: t.permissionKey, label: t.label }))
)
const nodeActions = (group: ToolGroup) =>
  NODE_ACTIONS.map((action) => ({
    ...action,
    tools: optionalOf(group).filter((t) => nodeAction(t.name) === action.id),
    carried: legacyNodeTools.value.filter((t) => nodeAction(t.name) === action.id),
  })).filter((a) => a.tools.length)

const showAll = ref(false)
const editingDesc = ref<string | null>(null)

const modeOptions = [
  { value: 'off', display: 'Off' },
  { value: 'ask', display: 'Ask' },
  { value: 'auto', display: 'Auto' },
]

/** What each tool says of itself: shown when there is no override, and the text one is measured against. */
const defaultDescs = computed<Record<string, string>>(() =>
  Object.fromEntries(getToolRegistry().map((tool) => [tool.name, tool.description]))
)

const isCore = (name: string) => CORE_TOOLS.has(name)
const getMode = (name: string): ToolMode => props.toolModes[name] ?? 'off'
const setMode = (name: string, mode: ToolMode) => emit('update', name, mode)

const hasCustomDescription = (name: string) => !!props.toolDescriptions?.[name]
const getCustomDescription = (name: string) => props.toolDescriptions?.[name] || ''
const getDefaultDescription = (name: string) => defaultDescs.value[name] || ''

const isDescVisible = (name: string) => {
  if (hasCustomDescription(name)) return true
  return editingDesc.value === name
}

const toggleDescEdit = (name: string) => {
  editingDesc.value = editingDesc.value === name ? null : name
}

/** An override only when it says something the default does not; otherwise none at all. */
const emitDescUpdate = (name: string, value: string) => {
  const own = isDefaultDescription(name, value, getDefaultDescription(name))
  emit('updateDescription', name, own ? '' : value)
}

interface ToolEntry {
  name: string
  permissionKey?: string
  label: string
}

interface ToolGroup {
  category: string
  tools: ToolEntry[]
  /** The tools of one MCP server. */
  mcp: boolean
}

const serverInUse = (group: ToolGroup) =>
  group.tools.some((t) => getMode(t.permissionKey ?? t.name) !== 'off')

/** On gives every tool at Ask — never Auto by one tap; off takes them all away. */
const toggleServer = (group: ToolGroup) => {
  const mode: ToolMode = serverInUse(group) ? 'off' : 'ask'
  for (const tool of group.tools) setMode(tool.permissionKey ?? tool.name, mode)
}

/** The tools of a group a mode applies to: core tools are always on and have none. */
const optionalOf = (group: ToolGroup) => group.tools.filter((t) => !isCore(t.name))

const allTools = computed(() => [
  ...visibleGroups.value.flatMap(optionalOf),
  ...(props.descriptionsOnly ? [] : legacyNodeTools.value),
])

/** The mode every one of these tools is at, or null when they differ. */
const sharedMode = (tools: ToolEntry[]): ToolMode | null => {
  const modes = new Set(tools.map((t) => getMode(t.permissionKey ?? t.name)))
  return modes.size === 1 ? [...modes][0] : null
}

const setAll = (tools: ToolEntry[], mode: string) => {
  emit(
    'updateMany',
    Object.fromEntries(tools.map((t) => [t.permissionKey ?? t.name, mode as ToolMode]))
  )
}

const visibleGroups = computed<ToolGroup[]>(() => {
  const registry = getToolRegistry()
  const groups = new Map<string, ToolEntry[]>()

  for (const tool of registry) {
    // In descriptions-only mode every tool has a description worth editing, core included.
    if (!props.descriptionsOnly && !showAll.value && isCore(tool.name)) continue
    // Old node names are answered when called but never offered or listed.
    if (LEGACY_NODE_TOOLS.has(tool.name)) continue
    if (!groups.has(tool.category)) groups.set(tool.category, [])
    groups
      .get(tool.category)
      .push({ name: tool.name, permissionKey: tool.permissionKey, label: tool.label })
  }

  return Array.from(groups.entries()).map(([category, tools]) => ({
    category,
    tools,
    mcp: tools.every((t) => isMcpToolName(t.name)),
  }))
})
</script>

<style lang="scss">
.abele-tool-modes .setting-item {
  min-height: 2.4em;
}

// A section's head: the name, and when it is open at the row's end, one hairline above it.
.abele-tool-modes__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-1) var(--size-4-2);
  margin-top: var(--size-4-3);
  padding-top: var(--size-4-4);
  padding-bottom: var(--size-4-1);
  border-top: 1px solid var(--background-modifier-border);

  &:first-child {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
}

h4.abele-tool-modes__heading {
  margin: 0 !important;
}

// Files and Basics are always there: said in the place of the choice, quiet, not a control.
.abele-tool-modes__opening-fixed {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}

// What the section is for: a quiet line under its name, with the glyph that edits it.
.abele-tool-modes__about {
  display: flex;
  align-items: flex-start;
  gap: var(--size-2-2);
  padding-bottom: var(--size-4-2);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);

  > .abele-input,
  > textarea {
    flex: 1 1 auto;
  }
}
.abele-tool-modes__about:has(textarea) {
  flex-direction: column;
  align-items: stretch;
}

// «10 tools» after the action's words: what it holds, pressed open under it.
// Stepped in by the ring's width, so the description's box, which clips, leaves its focus ring
// whole.
.abele-tool-modes__members-toggle {
  display: flex;
  width: fit-content;
  margin: var(--size-2-2) var(--size-2-2) var(--size-2-2);
}

// The tools of one action, stepped in under it as its own detail.
.abele-tool-modes__members {
  padding-inline-start: var(--size-4-6);
}

// Off, Ask and Auto side by side, even on a phone, where Obsidian would stack each button
// full width and three rows per section would bury the tools they set.
.abele-tool-modes__bulk > .setting-item-control {
  flex-wrap: nowrap;
  gap: var(--size-4-2);

  > button {
    flex: 1 1 0;
    min-width: 0;
    width: auto;
    justify-content: center;
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

.abele-tool-modes__desc-reset {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--size-4-1);
}

.abele-tool-modes__desc-input {
  padding: 0 0 var(--size-4-2);

  textarea {
    width: 100% !important;
  }
}
</style>
