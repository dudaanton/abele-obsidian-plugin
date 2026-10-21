<template>
  <div class="abele-tool-modes">
    <div v-if="!hideShowAll && !descriptionsOnly" class="abele-tool-modes__toggle">
      <Setting
        :name="t('settings.components.ToolModesEditor.show_core_tools.bea400e8')"
        :desc="t('settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03')"
      >
        <Checkbox :is-enabled="showAll" @toggle="showAll = !showAll" />
      </Setting>
    </div>

    <!-- Shortcuts only: they set every tool's own dropdown below, which stays to be changed. -->
    <Setting
      v-if="!descriptionsOnly && allTools.length > 1"
      :name="t('settings.components.ToolModesEditor.all_tools.81c151f9')"
      :desc="t('settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce')"
      class="abele-tool-modes__bulk abele-tool-modes__bulk--all"
    >
      <Button
        v-for="option in modeOptions"
        :key="option.value"
        :text="option.display"
        :accent="sharedMode(allTools) === option.value"
        :tooltip="
          t('settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee', {
            value0: String(option.display),
          })
        "
        @click="setAll(allTools, option.value)"
      />
    </Setting>

    <Disclosure
      v-for="group in visibleGroups"
      :key="group.category"
      :label="sectionLabel(group.category)"
      :count="group.tools.length"
      class="abele-tool-modes__group"
      :class="{ 'abele-tool-modes__group_flat': !collapsed }"
      :model-value="expanded[group.category] ?? !collapsed"
      @update:model-value="expanded[group.category] = $event"
    >
      <!-- A section's head: its name and, offered by section, whether it stands open from the
           first question or opens when the agent asks; under it what it is for, editable. -->
      <div class="abele-tool-modes__head">
        <h4 v-if="!collapsed" class="abele-tool-modes__heading">
          {{ sectionLabel(group.category) }}
        </h4>
        <span
          v-if="bySection && !descriptionsOnly && ALWAYS_LOADED_GROUPS.has(group.category)"
          class="abele-tool-modes__opening-fixed"
          >{{ t('settings.components.ToolModesEditor.always_open.67b6ffc1') }}</span
        >
        <Dropdown
          v-else-if="bySection && !descriptionsOnly"
          class="abele-tool-modes__opening"
          :model-value="opening(group.category)"
          :options="OPENING_OPTIONS"
          :aria-label="
            t('settings.components.ToolModesEditor.when_value_is_open.37a2f90a', {
              value0: String(sectionLabel(group.category)),
            })
          "
          @update:model-value="
            emit('updateOpening', sectionIdOfGroup(group.category), $event as SectionOpening)
          "
        />
      </div>
      <div
        v-if="
          !descriptionsOnly && (sectionSaid(group.category) || editingSection === group.category)
        "
        class="abele-tool-modes__about"
      >
        <template v-if="editingSection !== group.category">
          <span class="abele-tool-modes__about-text">{{ sectionSaid(group.category) }}</span>
          <Icon
            icon="pencil"
            size="xs"
            :tooltip="
              t('settings.components.ToolModesEditor.change_what_value_is_said.5508c12f', {
                value0: String(group.category),
              })
            "
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
              :text="t('settings.components.ToolModesEditor.reset_to_default.bc5b45ae')"
              icon="rotate-ccw"
              :tooltip="t('settings.components.ToolModesEditor.use_the_section_s_own.e02f836f')"
              @click="emitSectionText(group.category, '')"
            />
            <Button
              :text="t('settings.components.ToolModesEditor.done.11a6767d')"
              @click="editingSection = null"
            />
          </div>
        </template>
      </div>
      <!-- The node's tools by what they do, one choice each; the tools themselves on asking. -->
      <template v-if="group.category === NODE_SECTION && !descriptionsOnly">
        <div
          v-for="action in nodeActions(group)"
          :key="action.id"
          class="abele-tool-modes__row abele-tool-modes__action"
        >
          <Setting :name="action.label" :desc="action.desc">
            <Dropdown
              :model-value="sharedMode(action.tools) ?? 'mixed'"
              :options="
                sharedMode(action.tools)
                  ? modeOptions
                  : [
                      ...modeOptions,
                      {
                        value: 'mixed',
                        display: t('settings.components.ToolModesEditor.mixed.f340b6d6'),
                      },
                    ]
              "
              :aria-label="mixedSaid(action.tools)"
              @update:model-value="
                $event !== 'mixed' && setAll([...action.tools, ...action.carried], $event)
              "
            />
          </Setting>
          <!-- Under the row, not in its words: on a phone the choice stays right under the
               action's name and what it holds opens below. -->
          <Icon
            class="abele-tool-modes__members-toggle"
            :icon="openAction === action.id ? 'chevron-down' : 'chevron-right'"
            size="xs"
            :text-right="
              t('settings.components.ToolModesEditor.value_tools.a2c9c9bb', {
                value0: String(action.tools.length),
              })
            "
            :tooltip="
              openAction === action.id
                ? t('settings.components.ToolModesEditor.hide_its_tools.52db5aef')
                : t('settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30')
            "
            @click="openAction = openAction === action.id ? null : action.id"
          />
          <div v-if="openAction === action.id" class="abele-tool-modes__members">
            <Setting v-for="tool in action.tools" :key="tool.name" :name="tool.name">
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
        :name="t('settings.components.ToolModesEditor.all_in_this_section.3d4eba9d')"
        class="abele-tool-modes__bulk abele-tool-modes__bulk--section"
        :data-section="group.category"
      >
        <Button
          v-for="option in modeOptions"
          :key="option.value"
          :text="option.display"
          :accent="sharedMode(optionalOf(group)) === option.value"
          :tooltip="
            t('settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a', {
              value0: String(group.category),
              value1: String(option.display),
            })
          "
          @click="setAll(optionalOf(group), option.value)"
        />
      </Setting>

      <!-- An MCP server is given to an agent whole; each tool can then be tuned below. -->
      <Setting
        v-if="group.mcp && !descriptionsOnly"
        :name="t('settings.components.ToolModesEditor.use_this_server.8eb48b42')"
        :desc="t('settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e')"
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
          <span v-else-if="isCore(tool.name)" class="abele-tool-modes__core">{{
            t('settings.components.ToolModesEditor.always_on.f017032a')
          }}</span>
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
              :text="t('settings.components.ToolModesEditor.reset_to_default.bc5b45ae')"
              icon="rotate-ccw"
              :tooltip="t('settings.components.ToolModesEditor.use_the_tool_s_own.520c244d')"
              @click="emitDescUpdate(tool.name, '')"
            />
          </div>
        </div>
      </div>
    </Disclosure>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { settingsLabel, settingsToolLabel } from '@/i18n/settingsLabels'
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Disclosure from './obsidian/Disclosure.vue'
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
  sectionLabel as originalSectionLabel,
  sectionOpening as openingOfSection,
  sectionSummary,
  type SectionOpening,
} from '@/ai/toolSections'

const sectionLabel = (group: string) => settingsLabel(originalSectionLabel(group))

const props = withDefaults(
  defineProps<{
    coreModes?: boolean
    toolModes: Record<string, ToolMode>
    /** Defer mounting group controls until their heading is opened. */
    collapsed?: boolean
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
    collapsed: false,
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
  { value: 'always', display: t('settings.components.ToolModesEditor.always_open.67b6ffc1') },
  { value: 'on-request', display: t('settings.components.ToolModesEditor.on_request.be820103') },
]
const opening = (group: string): SectionOpening =>
  openingOfSection(group, { toolSectionOpening: props.sectionOpening })
const expanded = ref<Record<string, boolean>>({})
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

/** What a person reads under a section's name: the agent's own words if any, else one short line. */
const sectionSaid = (group: string) =>
  props.sectionDescriptions[sectionIdOfGroup(group)] || settingsLabel(sectionSummary(group))
/** For a Mixed action, which of its tools are at which mode: «Auto: a, b · Ask: c». */
const mixedSaid = (tools: ToolEntry[]): string | undefined => {
  if (sharedMode(tools)) return undefined
  const by = new Map<string, string[]>()
  for (const t of tools) {
    const mode = getMode(t.permissionKey ?? t.name)
    by.set(mode, [...(by.get(mode) ?? []), t.name])
  }
  const label = (mode: string) => modeOptions.find((o) => o.value === mode)?.display ?? mode
  return [...by].map(([mode, names]) => `${label(mode)}: ${names.join(', ')}`).join(' · ')
}
const openAction = ref<string | null>(null)
/**
 * Share the catalogue without evaluating dynamic descriptions. Listing permission controls
 * must not scan the vault for skills; descriptions are read only by their editor.
 */
const registry = computed(() => getToolRegistry())
/** The node section's tools by action, in the order a person thinks of them: read, edit, worktrees. */
/** The old node names: never listed, set with the Read action, whose work they do. */
const legacyNodeTools = computed<ToolEntry[]>(() =>
  registry.value
    .filter((t) => LEGACY_NODE_TOOLS.has(t.name))
    .map((t) => ({ name: t.name, permissionKey: t.permissionKey, label: settingsToolLabel(t) }))
)
const nodeActions = (group: ToolGroup) =>
  NODE_ACTIONS.map((action) => ({
    ...action,
    label: settingsLabel(action.label),
    desc: settingsLabel(action.desc),
    tools: optionalOf(group).filter((t) => nodeAction(t.name) === action.id),
    carried: legacyNodeTools.value.filter((t) => nodeAction(t.name) === action.id),
  })).filter((a) => a.tools.length)

const showAll = ref(false)
const editingDesc = ref<string | null>(null)

const modeOptions = [
  { value: 'off', display: t('settings.components.ToolModesEditor.off.ca7981b4') },
  { value: 'ask', display: t('settings.components.ToolModesEditor.ask.b8c209cd') },
  { value: 'auto', display: t('settings.components.ToolModesEditor.auto.02862497') },
]

/** What each tool says of itself: shown when there is no override, and the text one is measured against. */
const defaultDescs = computed<Record<string, string>>(() =>
  Object.fromEntries(registry.value.map((tool) => [tool.name, tool.description]))
)

const isCore = (name: string) => !props.coreModes && CORE_TOOLS.has(name)
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
  setAll(group.tools, mode)
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
  const groups = new Map<string, ToolEntry[]>()

  for (const tool of registry.value) {
    // In descriptions-only mode every tool has a description worth editing, core included.
    if (!props.descriptionsOnly && !showAll.value && isCore(tool.name)) continue
    // Old node names are answered when called but never offered or listed.
    if (LEGACY_NODE_TOOLS.has(tool.name)) continue
    if (!groups.has(tool.category)) groups.set(tool.category, [])
    groups.get(tool.category).push({
      name: tool.name,
      permissionKey: tool.permissionKey,
      label: settingsToolLabel(tool),
    })
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

.abele-tool-modes__group {
  margin-block: var(--size-4-3);
}

.abele-tool-modes__group_flat > .abele-disclosure__control {
  display: none;
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
// On a phone an action reads top to bottom: its name, the choice right under it, then its words;
// the count of its tools opens below the row.
body.is-phone .abele-tool-modes__action > .setting-item {
  flex-direction: column;
  align-items: stretch;
  gap: var(--size-2-3);

  > .setting-item-info {
    display: contents;
  }
  .setting-item-name {
    order: 0;
  }
  > .setting-item-control {
    order: 1;
    width: 100%;
  }
  .setting-item-description {
    order: 2;
  }
}

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
