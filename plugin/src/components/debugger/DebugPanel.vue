<template>
  <div class="abele-debug-panel" :class="`abele-debug-panel_${session.status}`">
    <div class="nav-header">
      <div class="nav-buttons-container">
        <Icon
          v-for="b in buttons"
          :key="b.action"
          class="nav-action-button"
          :icon="b.icon"
          :tooltip="b.tooltip"
          :disabled="b.disabled"
          @click="emit('command', b.action)"
        />
      </div>
    </div>

    <!-- What runs and where it stands: a dot for the state, the place as a link to the line. -->
    <div class="abele-debug-panel__program">
      <StatusDot
        :tone="tone"
        :label="stateLabel"
        :pulse="session.status === 'running' || session.status === 'starting'"
      />
      <span class="abele-debug-panel__name">{{ session.program }}</span>
      <a
        v-if="top && session.status !== 'exited'"
        class="abele-debug-panel__where"
        role="button"
        tabindex="0"
        @click="emit('reveal', top.file, top.line)"
        @keydown.enter="emit('reveal', top.file, top.line)"
        >{{ fileName(top.file) }}:{{ top.line }}</a
      >
      <Icon
        class="abele-debug-panel__mode"
        :class="{ 'is-active': modeKnown && session.mode === 'allow' }"
        :icon="
          !modeKnown ? 'circle-help' : session.mode === 'allow' ? 'shield-off' : 'shield-check'
        "
        :tooltip="modeTooltip"
        :disabled="!modeKnown || locked || session.status === 'exited'"
        :active="modeKnown && session.mode === 'allow'"
        @click="emit('mode', session.mode === 'allow' ? 'ask' : 'allow')"
      />
    </div>

    <div v-if="session.status === 'lost'" class="abele-debug-panel__notice" role="status">
      <span>As of {{ session.seen }}</span>
      <Icon icon="rotate-cw" size="xs" tooltip="Try to reconnect" @click="emit('retry')" />
    </div>

    <div class="abele-debug-panel__groups" :class="{ 'abele-debug-panel__groups_stale': stale }">
      <TreeItem
        class="abele-debug-panel__group"
        text="Variables"
        :flair="frameName"
        collapsible
        :collapsed="folded.has('variables')"
        @click="toggle('variables')"
      >
        <DebugValues
          v-if="live"
          :values="session.variables"
          :folded="folded"
          :disabled="locked"
          @toggle="toggle"
          @inspect="emit('inspect', $event)"
          @open="(n, v, t) => emit('open-value', n, v, t)"
        />
        <div v-else class="abele-debug-panel__empty">{{ notPaused }}</div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        text="Call stack"
        :flair="live ? String(session.frames.length) : undefined"
        collapsible
        :collapsed="folded.has('stack')"
        @click="toggle('stack')"
      >
        <template v-if="live">
          <TreeItem
            v-for="(f, i) in session.frames"
            :key="i"
            :text="f.name"
            :note="`${fileName(f.file)}:${f.line}`"
            :active="i === session.frame"
            @click="!locked && emit('frame', i)"
          />
        </template>
        <div v-else class="abele-debug-panel__empty">{{ notPaused }}</div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        text="Breakpoints"
        :flair="String(session.breakpoints.length)"
        collapsible
        :collapsed="folded.has('breakpoints')"
        @click="toggle('breakpoints')"
      >
        <TreeItem
          v-for="b in session.breakpoints"
          :key="`${b.file}:${b.line}`"
          :text="`${fileName(b.file)}:${b.line}`"
          @click="emit('reveal', b.file, b.line)"
        >
          <template #end><BreakpointMark :breakpoint="b" /></template>
          <template #actions>
            <Icon
              icon="x"
              size="xs"
              tooltip="Remove"
              :disabled="locked"
              @click.stop="emit('breakpoint', b.file, b.line)"
            />
          </template>
        </TreeItem>
        <div v-if="!session.breakpoints.length" class="abele-debug-panel__empty">
          Press the margin of a line to stop there.
        </div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        text="Watch"
        :flair="session.watches.length ? String(session.watches.length) : undefined"
        collapsible
        :collapsed="folded.has('watch')"
        @click="toggle('watch')"
      >
        <!-- A watch whose value is longer than its row opens whole by the row, like a variable. -->
        <TreeItem
          v-for="w in session.watches"
          :key="w.expression"
          :text="w.expression"
          @click="openWatch(w)"
        >
          <template #end>
            <span
              class="abele-debug-panel__value"
              :class="{ 'abele-debug-panel__value_error': w.error }"
              >{{ live ? (w.error ?? w.value ?? '') : '' }}</span
            >
          </template>
          <template #actions>
            <Icon
              icon="x"
              tooltip="Remove"
              :disabled="locked"
              @click.stop="emit('unwatch', w.expression)"
            />
          </template>
        </TreeItem>
        <div class="abele-debug-panel__add">
          <Input
            v-model="expression"
            :disabled="locked"
            placeholder="Add an expression"
            aria-label="Expression to watch"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter.prevent="watchIt"
          />
        </div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        text="Output"
        collapsible
        :collapsed="folded.has('output')"
        @click="toggle('output')"
      >
        <pre class="abele-debug-panel__output">{{ session.output || ' ' }}</pre>
      </TreeItem>
    </div>
  </div>
</template>

<script setup lang="ts">
// The debugger's own view, a tab of the right sidebar like Backlinks or Outline: the controls in
// its header, a line saying what runs and where it stands, and the folding groups a debugger has —
// variables, call stack, breakpoints, watched expressions, output. The source is the file's own
// tab in the main area; what the chat agent does goes into the chat. State is said by a dot and
// by what is enabled; the words are in the tooltips.
import { computed, reactive, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import BreakpointMark from './BreakpointMark.vue'
import DebugValues from './DebugValues.vue'
import type { DebugSession, DebugWatch } from './types'
import { wholeValue } from './valueFormat'

const props = withDefaults(
  defineProps<{
    session: DebugSession
    restartAvailable?: boolean
    modeAvailable?: boolean
    modeUnavailableReason?: string
    busy?: boolean
  }>(),
  { restartAvailable: false, modeAvailable: false, modeUnavailableReason: '', busy: false }
)
const locked = computed(() => props.session.status === 'lost' || props.busy)
const modeKnown = computed(
  () => props.modeAvailable && props.session.mode !== 'unknown' && props.session.status !== 'lost'
)
const modeTooltip = computed(() =>
  !modeKnown.value
    ? `Agent mode: Unknown · ${props.modeUnavailableReason || (props.session.status === 'lost' ? 'A fresh live grant observation is required after reconnect' : 'No authoritative live agent grant is bound')}`
    : props.session.mode === 'allow'
      ? 'The agent acts without asking, in this session · press to make it ask'
      : 'The agent asks before each action · press to let it act freely in this session'
)

const emit = defineEmits<{
  (e: 'command', action: string): void
  (e: 'mode', mode: 'ask' | 'allow'): void
  (e: 'reveal', file: string, line: number): void
  (e: 'frame', index: number): void
  (e: 'breakpoint', file: string, line: number): void
  (e: 'watch', expression: string): void
  (e: 'unwatch', expression: string): void
  (e: 'retry'): void
  (e: 'inspect', handle: string): void
  /** A value too long for its row, to be read whole in a tab of its own. */
  (e: 'open-value', name: string, value: string, type?: string): void
}>()

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const paused = computed(() => props.session.status === 'paused')
// The last values stay readable while the node is away, faded.
const live = computed(() => paused.value || props.session.status === 'lost')
function openWatch(w: DebugWatch) {
  const value = wholeValue(w.value ?? '', w.full)
  if (live.value && !w.error && value !== undefined) emit('open-value', w.expression, value)
}
const stale = computed(() => props.session.status === 'lost')
const top = computed(() => props.session.frames[props.session.frame] ?? props.session.frames[0])
const frameName = computed(() => (live.value ? top.value?.name : undefined))
const notPaused = computed(() =>
  props.session.status === 'exited' ? 'The program has ended.' : 'Values show while it is paused.'
)

const tones: Record<DebugSession['status'], 'green' | 'orange' | 'red' | 'faint'> = {
  starting: 'orange',
  running: 'green',
  paused: 'orange',
  exited: 'faint',
  lost: 'red',
}
const tone = computed(() => tones[props.session.status])
const stateLabel = computed(() => {
  const s = props.session
  return s.status === 'paused'
    ? `Paused${s.reason ? ` on ${s.reason}` : ''}`
    : s.status === 'running'
      ? 'Running'
      : s.status === 'starting'
        ? 'Starting…'
        : s.status === 'exited'
          ? s.exitCode === undefined
            ? 'Ended · Exit code unknown'
            : `Ended with code ${s.exitCode}`
          : `No connection to the node · as of ${s.seen ?? 'a while ago'}`
})

// Controls in the order every debugger keeps them, with their keys in the tooltip.
const buttons = computed(() => {
  const s = props.session.status
  const can = s === 'paused' && !locked.value
  const on = !locked.value && (s === 'paused' || s === 'running' || s === 'starting')
  return [
    s === 'running'
      ? { action: 'pause', icon: 'pause', tooltip: 'Pause (F6)', disabled: locked.value }
      : { action: 'continue', icon: 'play', tooltip: 'Continue (F5)', disabled: !can },
    { action: 'step-over', icon: 'redo-dot', tooltip: 'Step over (F10)', disabled: !can },
    { action: 'step-into', icon: 'arrow-down-to-dot', tooltip: 'Step into (F11)', disabled: !can },
    {
      action: 'step-out',
      icon: 'arrow-up-from-dot',
      tooltip: 'Step out (Shift+F11)',
      disabled: !can,
    },
    {
      action: 'restart',
      icon: 'rotate-ccw',
      tooltip: props.restartAvailable ? 'Restart' : 'Restart is not available on this node',
      disabled: locked.value || !props.restartAvailable,
    },
    { action: 'stop', icon: 'square', tooltip: 'Stop (Shift+F5)', disabled: !on },
  ]
})

const folded = reactive(new Set<string>(['output']))
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))
// The output opens by itself when the program ends: that is what is left to read.
watch(
  () => props.session.status,
  (s) => s === 'exited' && folded.delete('output'),
  { immediate: true }
)

const expression = ref('')
function watchIt() {
  const e = expression.value.trim()
  if (e && !locked.value) emit('watch', e)
  expression.value = ''
}
</script>

<style lang="scss">
.abele-debug-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.abele-debug-panel__program {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3) var(--size-4-1);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}
.abele-debug-panel__name {
  min-width: 0;
  overflow: hidden;
  font-weight: var(--font-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-panel__where {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-decoration: none;
  cursor: var(--cursor);

  &:hover {
    color: var(--text-accent);
  }
}
.abele-debug-panel__mode {
  margin-inline-start: auto;
}
.abele-debug-panel__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin: 0 var(--size-4-2) var(--size-4-1);
  padding: var(--size-4-1) var(--size-4-1) var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-debug-panel .abele-tree-item__inner {
  flex: 1;
  flex-wrap: wrap;
}
.abele-debug-panel .tree-item-flair-outer {
  flex-shrink: 1;
  min-width: 0;
  max-width: 50%;
}
.abele-debug-panel .tree-item-flair {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.abele-debug-panel__notice > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-debug-panel__groups {
  padding: 0 var(--size-4-2) var(--size-4-4);
}
.abele-debug-panel__groups_stale {
  opacity: 0.65;
}
.abele-debug-panel__groups_stale .tree-item-self {
  color: var(--text-muted);
}
// The weight through the row's own variable: set straight on the row, the hover took it back to
// normal and the heading jumped under the pointer.
.abele-debug-panel__group > .tree-item-self {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  --abele-tree-item-weight: var(--font-semibold);
}
.abele-debug-panel__empty {
  padding: var(--size-4-1) var(--size-4-3) var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-debug-panel__value {
  max-width: 12em;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-panel__value_error {
  color: var(--text-error);
}
.abele-debug-panel__add {
  padding: var(--size-4-1) var(--size-4-2) var(--size-4-2) var(--size-4-5);

  input {
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
  }
}
.abele-debug-panel__output {
  max-height: 16em;
  margin: 0 0 var(--size-4-2) var(--size-4-5);
  padding: var(--size-4-2);
  overflow: auto;
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  white-space: pre-wrap;
}
</style>
