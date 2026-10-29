<template>
  <div class="abele-debug-panel" :class="`abele-debug-panel_${session.status}`">
    <div class="abele-debug-panel__toolbar">
      <div class="abele-debug-panel__buttons">
        <DrawerViewSwitch icon="bug-play" :name="t('streamC.1a03bd2fd107c453')" />
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
      <span class="abele-debug-panel__state">{{ stateLabel }}</span>
      <a
        v-if="top?.file && session.status !== 'exited'"
        class="abele-debug-panel__where"
        role="button"
        tabindex="0"
        @click="emit('reveal', top.file, top.line)"
        @keydown.enter="emit('reveal', top.file, top.line)"
        >{{ fileName(top.file) }}:{{ top.line }}</a
      >
      <Icon
        v-if="modeAvailable"
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

    <div v-if="session.unavailable" class="abele-debug-panel__notice" role="status">
      <span>{{ t('debug.sessionEnded') }}</span>
      <Icon
        icon="play"
        size="xs"
        :tooltip="t('debug.newRun')"
        :disabled="busy"
        @click="emit('command', 'restart')"
      />
    </div>
    <div v-else-if="session.status === 'lost'" class="abele-debug-panel__notice" role="status">
      <span>{{ t('streamC.43157504da6a73f8') }} {{ session.seen }}</span>
      <Icon
        icon="rotate-cw"
        size="xs"
        :tooltip="t('streamC.aedae4aa865fe618')"
        @click="emit('retry')"
      />
    </div>

    <slot name="approvals" />
    <div class="abele-debug-panel__groups" :class="{ 'abele-debug-panel__groups_stale': stale }">
      <!-- While a run is recorded: how long, how many steps, where the browser's requests come
           from and where it all goes on disk. -->
      <TreeItem
        v-if="recording"
        class="abele-debug-panel__group"
        :text="t('streamC.80e8dd1a5a05f707')"
        :flair="t('streamC.traceSteps', { elapsed: recording.elapsed, count: recording.steps })"
        collapsible
        :collapsed="folded.has('recording')"
        @click="toggle('recording')"
      >
        <template #end>
          <StatusDot tone="red" :label="t('streamC.dc5a9ac750e65ff2')" pulse />
        </template>
        <TreeItem
          class="abele-debug-panel__browser"
          :icon="recording.browser.state === 'none' ? 'file-code' : 'globe'"
          :text="browserBrief"
          @click="(e: MouseEvent) => emit('browser-menu', e)"
        >
          <template #end>
            <StatusDot
              :tone="
                recording.browser.state === 'none'
                  ? 'red'
                  : recording.browser.state === 'connected'
                    ? 'green'
                    : 'faint'
              "
              :label="browserLabel"
            />
          </template>
        </TreeItem>
        <TreeItem
          class="abele-debug-panel__folder"
          icon="folder"
          :text="folderName(recording.folder)"
          :label="recording.folder"
          @click="emit('show-folder')"
        />
      </TreeItem>

      <TreeItem
        v-if="!quietWhileRunning"
        class="abele-debug-panel__group"
        :text="t('streamC.02db55bac5e3f7ce')"
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
        v-if="!quietWhileRunning"
        class="abele-debug-panel__group"
        :text="t('streamC.76b3f5f3a3f28b4a')"
        :flair="live ? String(session.frames.length) : undefined"
        collapsible
        :collapsed="folded.has('stack')"
        @click="toggle('stack')"
      >
        <DebugCallStack
          v-if="live"
          :frames="session.frames"
          :selected="session.frame"
          :disabled="locked"
          @select="emit('frame', $event)"
        />
        <div v-else class="abele-debug-panel__empty">{{ notPaused }}</div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        :text="t('streamC.aa40ffb1ed16f9a3')"
        :flair="String(session.breakpoints.length)"
        collapsible
        :collapsed="folded.has('breakpoints')"
        @click="toggle('breakpoints')"
      >
        <template #actions>
          <Icon
            icon="trash-2"
            size="xs"
            :tooltip="t('debug.removeBreakpoints')"
            :disabled="locked || !session.breakpoints.length"
            @click.stop="emit('remove-breakpoints')"
          />
        </template>
        <TreeItem
          v-for="filter in ['caught', 'uncaught']"
          :key="filter"
          :text="filter === 'caught' ? t('debug.caughtExceptions') : t('debug.uncaughtExceptions')"
        >
          <template #end>
            <Checkbox
              :is-enabled="exceptionFilters.includes(filter)"
              :disabled="locked || !exceptionsAvailable"
              :aria-label="
                filter === 'caught' ? t('debug.caughtExceptions') : t('debug.uncaughtExceptions')
              "
              @toggle="
                emit(
                  'exceptions',
                  exceptionFilters.includes(filter)
                    ? exceptionFilters.filter((f) => f !== filter)
                    : [...exceptionFilters, filter]
                )
              "
            />
          </template>
        </TreeItem>
        <TreeItem
          v-for="b in session.breakpoints"
          :key="`${b.file}:${b.line}`"
          :text="`${fileName(b.file)}:${b.line}`"
          :note="b.kind === 'record' ? b.note : b.condition"
          @click="emit('reveal', b.file, b.line)"
          @contextmenu.prevent="(e: MouseEvent) => emit('breakpoint-menu', b.file, b.line, e)"
        >
          <template #end>
            <span
              v-if="b.kind === 'record' && b.hits !== undefined"
              ref="hitEls"
              class="abele-debug-panel__hits"
              :class="{ 'abele-debug-panel__hits_none': !b.hits }"
              :aria-label="
                b.hits
                  ? t('streamC.f9dbc568ce816459', { v1: String(b.hits) })
                  : t('streamC.1bc63e16126e96be')
              "
              >{{ b.hits }}</span
            >
            <BreakpointMark :breakpoint="b" />
          </template>
          <template #actions>
            <Icon
              icon="ellipsis"
              size="xs"
              :tooltip="t('debug.breakpointOptions')"
              :disabled="locked"
              @click.stop="(e: MouseEvent) => emit('breakpoint-menu', b.file, b.line, e)"
            />
            <Icon
              icon="x"
              size="xs"
              :tooltip="t('settings.nodes.remove')"
              :disabled="locked"
              @click.stop="emit('breakpoint', b.file, b.line)"
            />
          </template>
        </TreeItem>
        <div v-if="!session.breakpoints.length" class="abele-debug-panel__empty">
          {{ t('streamC.21ff3a0299b90733') }}
        </div>
      </TreeItem>

      <TreeItem
        v-if="runs"
        class="abele-debug-panel__group"
        :text="t('settings.LinksSettings.runs.848f54e8')"
        :flair="runs.length ? String(runs.length) : undefined"
        collapsible
        :collapsed="folded.has('runs')"
        @click="toggle('runs')"
      >
        <TreeItem
          v-for="r in runs"
          :key="r.id"
          :text="r.name"
          :note="t('streamC.runSteps', { count: r.steps, length: r.length })"
          :active="r.id === openRun"
          @click="emit('open-run', r.id)"
          @contextmenu.prevent="(e: MouseEvent) => emit('run-menu', r.id, e)"
        >
          <template v-if="r.cut" #end>
            <Icon icon="scissors" size="xs" :tooltip="t('streamC.5544ebbc16c05bb6')" no-hover />
          </template>
        </TreeItem>
        <div v-if="!runs.length" class="abele-debug-panel__empty">
          {{ t('streamC.82111bf7467cde35') }}
        </div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        :text="t('streamC.a71e757324467ccf')"
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
              :title="w.error || undefined"
              >{{
                w.error
                  ? nodeErrorWords(w.error)
                  : w.value === undefined
                    ? ''
                    : !live || w.stale
                      ? t('debug.watchLastValue', { value: w.value })
                      : w.value
              }}</span
            >
          </template>
          <template #actions>
            <Icon
              icon="x"
              :tooltip="t('settings.nodes.remove')"
              :disabled="locked"
              @click.stop="emit('unwatch', w.expression)"
            />
          </template>
        </TreeItem>
        <div class="abele-debug-panel__add">
          <Input
            v-model="expression"
            :disabled="locked"
            :placeholder="t('streamC.8d8a5eb1f4b81294')"
            :aria-label="t('streamC.c1eb7391442f78be')"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter.prevent="watchIt"
          />
        </div>
      </TreeItem>

      <TreeItem
        class="abele-debug-panel__group"
        :text="t('streamC.b2439bcb8dee14b6')"
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
import { nodeErrorWords } from '@/node/errorWords'
import { formatFrameName } from './stackFormat'
import { t } from '@/i18n'

import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
// The debugger's own view, a tab of the right sidebar like Backlinks or Outline: the controls in
// its header, a line saying what runs and where it stands, and the folding groups a debugger has —
// variables, call stack, breakpoints, watched expressions, output. The source is the file's own
// tab in the main area; what the chat agent does goes into the chat. State is said by a dot and
// by what is enabled; the words are in the tooltips.
import { computed, reactive, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import BreakpointMark from './BreakpointMark.vue'
import DebugValues from './DebugValues.vue'
import DebugCallStack from './DebugCallStack.vue'
import type { DebugSession, DebugWatch } from './types'
import { wholeValue } from './valueFormat'
import type { TraceRecording, TraceRunSummary } from './trace/types'

const props = withDefaults(
  defineProps<{
    session: DebugSession
    exceptionFilters?: string[]
    exceptionsAvailable?: boolean
    restartAvailable?: boolean
    reattachAvailable?: boolean
    modeAvailable?: boolean
    modeUnavailableReason?: string
    busy?: boolean
    /** A run being recorded now. */
    recording?: TraceRecording
    /** The runs recorded in this project; none where recording is not offered. */
    runs?: TraceRunSummary[]
    /** The run open in a tab. */
    openRun?: string
  }>(),
  {
    restartAvailable: false,
    exceptionFilters: () => [],
    exceptionsAvailable: false,
    reattachAvailable: false,
    modeAvailable: false,
    modeUnavailableReason: '',
    busy: false,
    recording: undefined,
    runs: undefined,
    openRun: undefined,
  }
)
const locked = computed(
  () => props.session.status === 'lost' || props.session.unavailable || props.busy
)
const modeKnown = computed(
  () => props.modeAvailable && props.session.mode !== 'unknown' && props.session.status !== 'lost'
)
const modeTooltip = computed(() =>
  !modeKnown.value
    ? t('streamC.0de847c5e3425c01', {
        v1: String(
          props.modeUnavailableReason ||
            (props.session.status === 'lost'
              ? t('streamC.36b97f36792426ca')
              : t('streamC.c48c1dd09c60a40f'))
        ),
      })
    : props.session.mode === 'allow'
      ? t('streamC.46d88842acfd2359')
      : t('streamC.b242e821c9e52446')
)

const emit = defineEmits<{
  (e: 'command', action: string): void
  (e: 'mode', mode: 'ask' | 'allow'): void
  (e: 'reveal', file: string, line: number): void
  (e: 'frame', index: number): void
  (e: 'breakpoint', file: string, line: number): void
  (e: 'breakpoint-menu', file: string, line: number, event: MouseEvent): void
  (e: 'remove-breakpoints'): void
  (e: 'exceptions', filters: string[]): void
  (e: 'watch', expression: string): void
  (e: 'unwatch', expression: string): void
  (e: 'retry'): void
  (e: 'inspect', handle: string): void
  /** A value too long for its row, to be read whole in a tab of its own. */
  (e: 'open-value', name: string, value: string, type?: string): void
  /** Where the browser's requests come from, a menu at the row. */
  (e: 'browser-menu', event: MouseEvent): void
  (e: 'show-folder'): void
  (e: 'open-run', id: string): void
  (e: 'run-menu', id: string, event: MouseEvent): void
}>()

const browserBrief = computed(() => {
  const b = props.recording?.browser
  if (!b) return ''
  if (b.via === 'har') return t('streamC.865beacb015d6057')
  if (b.state === 'none') return props.session.program
  if (b.state === 'lost') return t('streamC.51e1357de85bd272')
  return b.tab ?? ''
})
const browserLabel = computed(() => {
  const b = props.recording?.browser
  if (!b) return ''
  if (b.state === 'none') return t('streamC.80e8dd1a5a05f707')
  const via =
    b.via === 'agent'
      ? t('streamC.3a986c7151b3317a')
      : b.via === 'har'
        ? t('streamC.fcf402c1746854df')
        : t('streamC.fd81bd7ad10c77d4')
  const hosts = b.hosts.length
    ? t('streamC.967370e7eb4e94ac', { v1: String(b.hosts.join(' and ')) })
    : ''
  return b.state === 'connected'
    ? t('streamC.2fab8d8b0adc03a2', { v1: String(via), v2: String(hosts) })
    : b.state === 'lost'
      ? t('streamC.560094df9e0997e8')
      : t('streamC.2433325c377e5062')
})

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const paused = computed(() => props.session.status === 'paused')
// The last values stay readable while the node is away, faded.
const live = computed(() => paused.value || props.session.status === 'lost')
function openWatch(w: DebugWatch) {
  const value = wholeValue(w.value ?? '', w.full)
  if (!w.error && value !== undefined) emit('open-value', w.expression, value)
}
const stale = computed(() => props.session.status === 'lost')
const top = computed(() => props.session.frames[props.session.frame] ?? props.session.frames[0])
const frameName = computed(() =>
  live.value && top.value ? formatFrameName(top.value.name).name : undefined
)
const notPaused = computed(() =>
  props.session.status === 'exited'
    ? props.session.attached && props.session.detached
      ? t('streamC.f0b3986f4f53b9bb')
      : t('streamC.382d66ab8003cc96')
    : t('streamC.805240eb7f8a5941')
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
    ? s.reason === 'entry'
      ? t('debug.pausedAtStart')
      : s.reason
        ? /^paused\b/i.test(s.reason)
          ? s.reason
          : t('streamC.4e9fcd27b044c57c', { v1: s.reason })
        : t('streamC.e159b06187d369a0')
    : s.status === 'running'
      ? t('streamC.f4ccae29e1bb0c20')
      : s.status === 'starting'
        ? t('streamC.bbe5fc3b9ef39f99')
        : s.status === 'exited'
          ? s.detached && s.attached
            ? t('streamC.4fc04649a9497a39')
            : s.exitCode === undefined
              ? t('streamC.a35ec6a4c0b7f680')
              : t('streamC.c0d03c6c706a16bc', { v1: String(s.exitCode) })
          : t('streamC.24b289c6dcaf78b5', { v1: String(s.seen ?? t('streamC.ccf9d42ad6750fd2')) })
})

// Where runs are recorded the program mostly goes on, or has not started: groups that only fill
// on a pause wait until there is one, rather than saying twice that there is nothing in them.
const quietWhileRunning = computed(() => !!props.runs && !live.value)

// Controls in the order every debugger keeps them, with their keys in the tooltip.
const buttons = computed(() => {
  const s = props.session.status
  const can = s === 'paused' && !locked.value
  const on = !locked.value && (s === 'paused' || s === 'running' || s === 'starting')
  return [
    s === 'running'
      ? {
          action: 'pause',
          icon: 'pause',
          tooltip: t('streamC.3899d9bf569a5bed'),
          disabled: locked.value,
        }
      : {
          action: 'continue',
          icon: 'play',
          tooltip: t('streamC.fbb23744fc07b4a9'),
          disabled: !can,
        },
    {
      action: 'step-over',
      icon: 'redo-dot',
      tooltip: t('streamC.fa7df5e6e7b985d9'),
      disabled: !can,
    },
    {
      action: 'step-into',
      icon: 'arrow-down-to-dot',
      tooltip: t('streamC.fabd7ebbebab66b8'),
      disabled: !can,
    },
    {
      action: 'step-out',
      icon: 'arrow-up-from-dot',
      tooltip: t('streamC.b7fc4f16b2465d09'),
      disabled: !can,
    },
    ...(props.reattachAvailable && !props.session.unavailable && (s === 'exited' || s === 'lost')
      ? [
          {
            action: 'reattach',
            icon: 'plug',
            tooltip: t('streamC.66133ae321df032b'),
            disabled: props.busy,
          },
        ]
      : []),
    ...(!props.session.unavailable
      ? [
          {
            action: 'restart',
            icon: 'rotate-ccw',
            tooltip: props.restartAvailable
              ? t('streamC.68c3954004c42f92')
              : props.session.attached
                ? t('streamC.2622f7acff07e917')
                : t('streamC.ae94325219e7dc49'),
            disabled: props.busy || !props.restartAvailable,
          },
        ]
      : []),
    // A program the node did not start is never stopped from here: the debugger lets go of it.
    props.session.attached
      ? {
          action: 'stop',
          icon: 'unplug',
          tooltip: t('streamC.530f5fac5dfd000f'),
          disabled: !on,
        }
      : { action: 'stop', icon: 'square', tooltip: t('streamC.801be36befade292'), disabled: !on },
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

// The counts by the record points say in their tooltips what they count.
const hitEls = ref<HTMLElement[]>([])
watch(hitEls, (els) => els.forEach((el) => setTooltip(el, el.getAttribute('aria-label') ?? '')), {
  deep: true,
  flush: 'post',
})

const expression = ref('')
function watchIt() {
  const e = expression.value.trim()
  if (e && !locked.value) emit('watch', e)
  expression.value = ''
}
/** The runs folder by its own name; the whole path is the row's tooltip. */
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
</script>

<style lang="scss">
.abele-debug-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
// The native phone drawer is narrower than a full row of debugger controls.
.abele-debug-panel > .abele-debug-panel__toolbar {
  flex: 0 0 auto;
  padding: var(--size-4-2) var(--size-4-3);
  height: auto;
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--background-secondary);
}
.abele-debug-panel__buttons {
  display: flex;
  position: static;
  height: auto;
  gap: var(--size-4-1);
  min-width: 0;
  flex-wrap: wrap;
}
.abele-debug-panel__program {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3) var(--size-4-1);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}
.abele-debug-panel__state {
  color: var(--text-muted);
  overflow-wrap: anywhere;
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
// A row with no glyph has nothing to hold its place: an empty one took a line of its own above
// a long name.
.abele-debug-panel .abele-tree-item__glyph:empty {
  display: none;
}
.abele-debug-panel .tree-item-flair-outer {
  gap: var(--size-4-2);
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
.abele-debug-panel__internals > .tree-item-self {
  color: var(--text-faint);
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
  min-width: 0;
  display: block;
}
.abele-debug-panel .abele-tree-item__end {
  min-width: 0;
  max-width: 100%;
}
// A path or a tab's title: one line beside its glyph, cut at the end.
.abele-debug-panel .abele-debug-panel__browser .abele-tree-item__inner,
.abele-debug-panel .abele-debug-panel__folder .abele-tree-item__inner {
  flex-wrap: nowrap;
}
.abele-debug-panel__browser .abele-tree-item__text,
.abele-debug-panel__folder .abele-tree-item__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-panel__folder .abele-tree-item__text {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
// How many times a record point fired: a count in the row, faint when it never did.
.abele-debug-panel__hits {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-debug-panel__hits_none {
  color: var(--text-faint);
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
