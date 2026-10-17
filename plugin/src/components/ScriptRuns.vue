<template>
  <Section class="abele-runs" :title="heading">
    <template #lead><DrawerViewSwitch icon="terminal" name="Abele script runs" /></template>
    <template #actions>
      <Icon
        v-if="runs.length"
        icon="eraser"
        tooltip="Clear the runs that have ended"
        @click="clearFinished"
      />
    </template>

    <EmptyState
      v-if="!runs.length"
      icon="scroll-text"
      title="Nothing has run yet"
      text="Each script run this session shows here: what it said as it went and what came of it."
    />

    <div v-else class="abele-runs__list">
      <div
        v-for="run in runs"
        :key="run.id"
        class="abele-runs__run"
        :class="`abele-runs__run_${run.status}`"
      >
        <!-- One row as the file explorer has them: the state as its glyph's colour, the name
             with the whole width, and where it came from, when and how long in a quiet line
             under it; while it runs, what the script last said takes that line. -->
        <div
          class="abele-runs__row"
          role="button"
          tabindex="0"
          :aria-expanded="opened.has(run.id)"
          @click="toggle(run.id)"
          @keydown.enter.prevent="toggle(run.id)"
        >
          <Icon
            class="abele-runs__state"
            :icon="STATUS_ICON[run.status]"
            no-hover
            :class="{ 'abele-runs__spinner': run.status === 'running' }"
            :tooltip="STATUS_WORD[run.status]"
          />
          <span class="abele-runs__text">
            <span class="abele-runs__name">{{ run.name }}</span>
            <span class="abele-runs__meta">
              <template v-if="run.note && run.status === 'running'">{{ run.note }} · </template>
              <template v-else-if="run.source !== 'command'"
                >{{ SOURCE_WORD[run.source] }} ·
              </template>
              <span :title="clock(run.startedAt)">{{ shortClock(run.startedAt) }}</span> ·
              {{ took(run) }}
            </span>
          </span>
        </div>

        <div v-if="opened.has(run.id)" class="abele-runs__detail">
          <!-- Where it came from and with what, as one quiet line of facts. -->
          <div class="abele-runs__facts">
            <span v-if="run.trigger">{{ run.trigger }}</span>
            <span class="abele-runs__path">{{ run.path }}</span>
            <span v-for="[name, value] in paramList(run)" :key="name" class="abele-runs__param"
              >{{ name }}: <span class="abele-runs__param-value">{{ value }}</span></span
            >
          </div>

          <!-- The log is what the script said as it went; the result is what it handed back. -->
          <div v-if="run.log.length" class="abele-runs__log">
            <p v-for="(line, i) in run.log" :key="i" class="abele-runs__line">
              <span class="abele-runs__line-at">{{ clock(line.at) }}</span>
              {{ line.text }}
            </p>
          </div>

          <div v-if="run.error" class="abele-runs__error">{{ run.error }}</div>
          <div v-else-if="finalResult(run)" class="abele-runs__result">{{ finalResult(run) }}</div>

          <!-- What can be done with it, as glyphs in a row; the words are in their tooltips. -->
          <div class="abele-runs__actions">
            <Icon
              v-if="run.status === 'running'"
              class="abele-runs__stop"
              icon="square"
              label="Stop this run"
              @click="stop(run)"
            />
            <!-- An interceptor ran on a message a chat sent; without one there is nothing to run it on. -->
            <template v-else-if="run.source !== 'interceptor'">
              <Icon icon="rotate-ccw" label="Run again with the same values" @click="again(run)" />
              <Icon
                icon="sliders-horizontal"
                label="Run again, asking for the values"
                @click="asNew(run)"
              />
            </template>
            <Icon icon="file-code-2" label="Open the script" @click="openScript(run)" />
            <Icon
              v-if="run.status !== 'running'"
              class="abele-runs__forget"
              icon="x"
              label="Take this run off the list"
              @click="ScriptRuns.getInstance().forget(run.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </Section>
</template>

<script setup lang="ts">
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
/**
 * What has been run this session.
 *
 * Runs live in memory only, so this list is the whole record: it has to say what happened, what
 * the script printed, and offer the two things wanted after reading that — the same run again,
 * or the same script with the values reconsidered.
 */
import { computed, onUnmounted, reactive, ref, toRef, watch } from 'vue'
import { Notice, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Section from './obsidian/Section.vue'
import { ScriptRuns, type ScriptRun } from '@/scripting/ScriptRuns'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptWaitingError } from '@/scripting/ScriptTrust'
import { showFormModal } from '@/scripting/formModal'
import { GlobalStore } from '@/stores/GlobalStore'

const STATUS_ICON: Record<ScriptRun['status'], string> = {
  running: 'loader',
  done: 'check',
  failed: 'alert-triangle',
  stopped: 'square',
}

const STATUS_WORD: Record<ScriptRun['status'], string> = {
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
  stopped: 'Stopped',
}

/** A run started from the command palette needs no badge — that is the ordinary way. */
const SOURCE_WORD: Record<ScriptRun['source'], string> = {
  command: 'command',
  note: 'note',
  link: 'link',
  agent: 'agent',
  script: 'script',
  view: 'view',
  automation: 'automation',
  book: 'book',
  'chat-selection': 'chat selection',
  startup: 'startup',
  interceptor: 'interceptor',
  request: 'request',
}

import { pausedWhileHidden } from '@/helpers/pausedWhileHidden'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const active = toRef(props, 'active')
const store = ScriptRuns.getInstance()
const runs = pausedWhileHidden(active, () => store.runs.value)
const opened = reactive(new Set<string>())

const heading = pausedWhileHidden(active, () => {
  const going = runs.value.filter((run) => run.status === 'running').length
  if (going) return `${going} running`
  return runs.value.length ? `${runs.value.length} run${runs.value.length > 1 ? 's' : ''}` : 'Runs'
})

/**
 * Ticks while something is running, and only then: the elapsed time of a finished run never
 * changes, and a sidebar that redraws every second for nothing is a sidebar left closed.
 */
const now = ref(Date.now())
let ticker: number | null = null
const stopTicker = () => {
  if (ticker !== null) window.clearInterval(ticker)
  ticker = null
}
watch(
  () => active.value && store.runs.value.some((run) => run.status === 'running'),
  (running) => {
    stopTicker()
    if (running) {
      now.value = Date.now()
      ticker = window.setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)
onUnmounted(stopTicker)

const clock = (at: number) => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Hours and minutes for the row; the seconds are under the pointer and in the log. */
const shortClock = (at: number) => clock(at).slice(0, 5)
const took = (run: ScriptRun) => {
  const ms = (run.finishedAt ?? now.value) - run.startedAt
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

const paramList = (run: ScriptRun) => Object.entries(run.params).map(([k, v]) => [k, String(v)])

/**
 * The result without the log repeated inside it.
 *
 * `execute` returns the printed lines followed by whatever the script returned, because that is
 * what a notice and an agent are given. Here the lines are already above, with their times.
 */
const finalResult = (run: ScriptRun) => {
  const printed = run.log.map((line) => line.text).join('\n')
  const result =
    printed && run.result.startsWith(printed) ? run.result.slice(printed.length) : run.result
  return result.trim()
}

const toggle = (id: string) => {
  if (opened.has(id)) opened.delete(id)
  else opened.add(id)
}

const clearFinished = () => {
  store.clearFinished()
  opened.clear()
}

const stop = (run: ScriptRun) => store.stop(run.id)

const openScript = async (run: ScriptRun) => {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(run.path)
  if (!(file instanceof TFile)) {
    new Notice(`Script file is gone: ${run.path}`)
    return
  }
  await app.workspace.getLeaf('tab').openFile(file)
}

const rerunSource = (run: ScriptRun) =>
  run.source === 'agent' || run.source === 'automation' || run.source === 'startup'
    ? 'command'
    : run.source

const start = async (run: ScriptRun, params: Record<string, unknown>) => {
  try {
    const result = await ScriptService.getInstance().execute(run.path, params, {
      formHandler: showFormModal,
      allowApprovalPrompt: true,
      // Run again by hand, an agent's or an automation's run is the person's own.
      source: rerunSource(run),
      book: run.book,
      selection: run.selection,
    })
    if (result.trim()) new Notice(result.length > 500 ? result.slice(0, 500) + '…' : result, 10000)
  } catch (err) {
    // The run row carries the failure; a notice would say it a second time.
    console.debug('[ScriptRuns] run failed', err)
  }
}

const again = (run: ScriptRun) => void start(run, run.params)

/**
 * The same script, with the values open to change: the run that failed because one parameter
 * was wrong is the whole reason to look at this list.
 */
const asNew = async (run: ScriptRun) => {
  // The header supplies the fields, so review must happen before displaying them here too.
  let script
  try {
    script = await ScriptService.getInstance().admit(run.path, rerunSource(run))
  } catch (err) {
    if (!(err instanceof ScriptWaitingError)) {
      new Notice(err instanceof Error ? err.message : String(err))
    }
    console.debug('[ScriptRuns] not run', err)
    return
  }

  if (!script.meta.params.length) return void start(run, {})

  const answers = await showFormModal(
    script.meta.params.map((param) => ({
      name: param.name,
      label: param.description || param.name,
      type: param.type === 'boolean' ? 'boolean' : param.type === 'text' ? 'textarea' : 'text',
      required: param.required,
      default:
        run.params[param.name] !== undefined ? String(run.params[param.name]) : param.default,
    })),
    undefined,
    undefined,
    run.name
  )
  if (!answers) return

  const typed: Record<string, unknown> = {}
  for (const param of script.meta.params) {
    const value = answers[param.name]
    if (param.type === 'boolean') typed[param.name] = value === 'true'
    else if (param.type === 'number') typed[param.name] = Number(value)
    else typed[param.name] = value
  }
  await start(run, typed)
}
</script>

<style lang="scss">
.abele-runs {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
}

.abele-runs__list {
  display: flex;
  flex-direction: column;
}

.abele-runs__row {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--nav-item-padding);
  padding-inline-start: var(--size-4-2);
  border-radius: var(--radius-s);
  color: var(--nav-item-color);
  cursor: var(--cursor);
  min-width: 0;

  &:hover {
    background-color: var(--nav-item-background-hover);
    color: var(--nav-item-color-hover);
  }
}

/* The glyph sits on the name's line, and says the state by its colour. */
.abele-runs__state {
  height: 1lh;
  font-size: var(--nav-item-size);
  line-height: var(--line-height-tight);
  color: var(--text-faint);
}
.abele-runs__run_running .abele-runs__state {
  color: var(--interactive-accent);
}
.abele-runs__run_done .abele-runs__state {
  color: var(--color-green);
}
.abele-runs__run_failed .abele-runs__state {
  color: var(--text-error);
}

.abele-runs__text {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  line-height: var(--line-height-tight);
}
.abele-runs__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--nav-item-size);
}
.abele-runs__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}

/* What a run said and what can be done with it, under it as a folder's children are. */
.abele-runs__detail {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin-inline-start: var(--size-4-4);
  padding: var(--size-4-1) 0 var(--size-4-2) var(--size-4-4);
  border-inline-start: var(--nav-indentation-guide-width) solid var(--nav-indentation-guide-color);
}

.abele-runs__facts {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}

.abele-runs__path {
  color: var(--text-faint);
}

.abele-runs__param-value {
  color: var(--text-normal);
}

// The log reads as text: each line wraps across the whole width, its time a faint word before it.
.abele-runs__log {
  max-height: 16em;
  overflow-y: auto;
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
  user-select: text;
}

.abele-runs__line {
  margin: 0 0 var(--size-2-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.abele-runs__line-at {
  margin-inline-end: var(--size-2-3);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.abele-runs__result,
.abele-runs__error {
  max-height: 12em;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-ui-smaller);
  user-select: text;
}

.abele-runs__error {
  color: var(--text-error);
}

.abele-runs__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  // The first glyph's own box starts at the text's edge, not inside it.
  margin-inline-start: calc(-1 * var(--size-2-3));
}

.abele-runs__stop {
  color: var(--text-error);
}

.abele-runs__forget {
  margin-inline-start: auto;
}

.abele-runs__spinner {
  animation: abele-runs-spin 1s linear infinite;
}

@keyframes abele-runs-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
