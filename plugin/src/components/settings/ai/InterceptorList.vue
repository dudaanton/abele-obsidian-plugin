<template>
  <!-- The interceptors in the order they run: a number, who reads, what it reads, on or off. A
       row opens its settings under it; its menu moves it, and on a desktop it drags. -->
  <div class="abele-interceptors">
    <Setting v-if="headed" heading name="Interceptors" :desc="desc" />
    <div
      v-for="(entry, i) in entries"
      :key="entry.id"
      class="abele-interceptors__entry"
      :class="{
        'is-off': !entry.enabled,
        'is-open': open === entry.id,
        'is-dragged': dragged === i,
        'is-drop-before': dropAt === i && dragged !== null && dragged !== i,
      }"
      :draggable="!narrow"
      @dragstart="dragged = i"
      @dragover.prevent="dropAt = i"
      @drop.prevent="drop(i)"
      @dragend="dragged = dropAt = null"
    >
      <Setting :name="nameOf(entry)" :desc="entry.enabled ? entryFacts(entry).join(' · ') : 'Off'">
        <template #name>
          <span class="abele-interceptors__number" :data-tip="`Runs ${ordinal(i + 1)}`">{{
            i + 1
          }}</span
          ><span
            class="abele-interceptors__name"
            role="button"
            tabindex="0"
            @click="toggleOpen(entry.id)"
            @keydown.enter.prevent="toggleOpen(entry.id)"
            >{{ nameOf(entry) }}</span
          >
        </template>
        <Icon
          v-if="!narrow || open === entry.id"
          :icon="open === entry.id ? 'chevron-up' : 'pencil'"
          size="xs"
          :tooltip="open === entry.id ? 'Close its settings' : 'Edit what it reads and how'"
          @click="toggleOpen(entry.id)"
        />
        <Checkbox
          :is-enabled="entry.enabled"
          :aria-label="entry.enabled ? 'On: runs in its turn' : 'Off: skipped, keeps its place'"
          @toggle="patch(entry.id, { enabled: !entry.enabled })"
        />
        <Icon
          icon="more-horizontal"
          size="xs"
          tooltip="Move or remove"
          @click="(e: MouseEvent) => menu(e, i)"
        />
      </Setting>
      <div v-if="open === entry.id" class="abele-interceptors__settings">
        <InterceptorSettings
          :model-value="keyOf(entry)"
          :options="choicesFor(entry)"
          desc="Who reads: an agent says what it thinks, a script decides."
          :active="true"
          :agent-active="!entry.script"
          :pattern-placeholder="patternPlaceholder"
          :pattern="entry.pattern"
          :reply-only="entry.replyOnly"
          :checks="entry.checks"
          :context-depth="entry.contextDepth"
          @update:model-value="patchEntry(entry.id, (e) => withKey(e, $event))"
          @update:pattern="patch(entry.id, { pattern: $event })"
          @update:reply-only="patch(entry.id, { replyOnly: $event })"
          @update:checks="patch(entry.id, { checks: $event })"
          @update:context-depth="patch(entry.id, { contextDepth: $event })"
        />
      </div>
    </div>
    <div class="abele-interceptors__add">
      <Button
        text="Add interceptor"
        icon="plus"
        :tooltip="
          entries.length
            ? 'Add one at the end; it runs last'
            : 'An agent or a script that reads first'
        "
        @click="add"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * An ordered list of interceptors, for an agent or as a chat's own. Each entry keeps the settings
 * one interceptor had; they run one after another in this order.
 */
import { ref } from 'vue'
import { Menu } from 'obsidian'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Icon from '../../obsidian/Icon.vue'
import Setting from '../../obsidian/Setting.vue'
import InterceptorSettings from './InterceptorSettings.vue'
import { newEntry } from '@/ai/interceptor/entries'
import { entryFacts, keyOf, moveEntry, withKey, type InterceptorEntry } from './interceptorList'

const props = withDefaults(
  defineProps<{
    entries: InterceptorEntry[]
    /** Who can read: agents and scripts, as the single interceptor offered them. */
    choices: { value: string; display: string }[]
    desc?: string
    /** A phone: no dragging, the menu moves. */
    narrow?: boolean
    /** Its own heading; off where a row above already names the list. */
    headed?: boolean
    patternPlaceholder?: string
  }>(),
  {
    headed: true,
    patternPlaceholder: 'Everything',
    desc: 'They run in this order, each given what the one before returned. The agent reads the last one’s text.',
    narrow: false,
  }
)
const emit = defineEmits<{ 'update:entries': [InterceptorEntry[]] }>()

const open = ref<string | null>(null)
const dragged = ref<number | null>(null)
const dropAt = ref<number | null>(null)

// The name alone: whether an agent is a utility one says nothing about its place in the list.
const nameOf = (entry: InterceptorEntry) =>
  props.choices.find((c) => c.value === keyOf(entry))?.display.replace(/ · utility$/, '') ??
  (entry.script ? `Script: ${entry.script} · missing` : entry.agentId ? 'Missing agent' : 'Nobody')
// A script no longer there stays choosable for the entry that names it, said as missing.
const choicesFor = (entry: InterceptorEntry) =>
  entry.script && !props.choices.some((c) => c.value === keyOf(entry))
    ? [...props.choices, { value: keyOf(entry), display: `Script: ${entry.script} · missing` }]
    : props.choices
const ordinal = (n: number) =>
  n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`

function toggleOpen(id: string) {
  open.value = open.value === id ? null : id
}
function patchEntry(id: string, change: (entry: InterceptorEntry) => InterceptorEntry) {
  emit(
    'update:entries',
    props.entries.map((e) => (e.id === id ? change(e) : e))
  )
}
function patch(id: string, change: Partial<InterceptorEntry>) {
  patchEntry(id, (e) => ({ ...e, ...change }))
}
function drop(to: number) {
  if (dragged.value !== null && dragged.value !== to)
    emit('update:entries', moveEntry(props.entries, dragged.value, to))
  dragged.value = dropAt.value = null
}
function menu(e: MouseEvent, i: number) {
  const last = props.entries.length - 1
  new Menu()
    .addItem((item) =>
      item
        .setTitle('Move up')
        .setIcon('arrow-up')
        .setDisabled(i === 0)
        .onClick(() => emit('update:entries', moveEntry(props.entries, i, i - 1)))
    )
    .addItem((item) =>
      item
        .setTitle('Move down')
        .setIcon('arrow-down')
        .setDisabled(i === last)
        .onClick(() => emit('update:entries', moveEntry(props.entries, i, i + 1)))
    )
    .addSeparator()
    .addItem((item) =>
      item
        .setTitle('Remove')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() =>
          emit(
            'update:entries',
            props.entries.filter((_, n) => n !== i)
          )
        )
    )
    .showAtMouseEvent(e)
}
function add() {
  const entry = withKey(newEntry(), props.choices[0]?.value ?? '')
  emit('update:entries', [...props.entries, entry])
  open.value = entry.id
}
</script>

<style lang="scss">
// The order's number in the name's place, quiet, a fixed width so the names line up.
// One measure for the number's column and the facts under the name, whatever their sizes.
.abele-interceptors {
  --abele-interceptor-indent: var(--size-4-6);
}

.abele-interceptors__number {
  display: inline-block;
  min-width: var(--abele-interceptor-indent);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.abele-interceptors__name {
  cursor: var(--cursor);
}

.abele-interceptors__entry.is-off .abele-interceptors__name {
  color: var(--text-muted);
}

.abele-interceptors__entry > .setting-item .setting-item-description {
  padding-inline-start: var(--abele-interceptor-indent);
}

// An entry's settings under it, starting where its name does.
.abele-interceptors__settings {
  padding-inline-start: var(--abele-interceptor-indent);
  padding-bottom: var(--size-4-3);
}

.abele-interceptors__entry.is-dragged {
  opacity: 0.5;
}

.abele-interceptors__entry.is-drop-before {
  box-shadow: 0 calc(-1 * var(--size-2-1)) 0 var(--interactive-accent);
}

.abele-interceptors__add {
  padding-block: var(--size-4-3);
}
</style>
