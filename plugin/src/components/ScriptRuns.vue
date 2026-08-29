<template>
  <div class="abele-runs">
    <div class="abele-runs__head">
      <span class="abele-runs__count">{{ heading }}</span>
      <Icon
        v-if="runs.length"
        icon="eraser"
        tooltip="Clear the runs that have ended"
        @click="clearFinished"
      />
    </div>

    <EmptyState v-if="!runs.length" text="Nothing has run yet this session." />

    <div v-else class="abele-runs__list">
      <div
        v-for="run in runs"
        :key="run.id"
        class="abele-runs__run"
        :class="`abele-runs__run_${run.status}`"
      >
        <div class="abele-runs__row" @click="toggle(run.id)">
          <Icon
            :icon="STATUS_ICON[run.status]"
            no-hover
            :class="{ 'abele-runs__spinner': run.status === 'running' }"
            :tooltip="STATUS_WORD[run.status]"
          />
          <span class="abele-runs__name">{{ run.name }}</span>
          <Badge v-if="run.source !== 'command'" :text="SOURCE_WORD[run.source]" />
          <span class="abele-runs__when">{{ clock(run.startedAt) }}</span>
          <span class="abele-runs__took">{{ took(run) }}</span>
          <Icon
            :icon="opened.has(run.id) ? 'chevron-down' : 'chevron-right'"
            :tooltip="opened.has(run.id) ? 'Hide the detail' : 'Show the detail'"
          />
        </div>

        <div v-if="run.note && run.status === 'running'" class="abele-runs__note">
          {{ run.note }}
        </div>

        <div v-if="opened.has(run.id)" class="abele-runs__detail">
          <div class="abele-runs__path">{{ run.path }}</div>

          <div v-if="paramList(run).length" class="abele-runs__params">
            <span v-for="[name, value] in paramList(run)" :key="name" class="abele-runs__param">
              <span class="abele-runs__param-name">{{ name }}</span>
              {{ value }}
            </span>
          </div>

          <!-- The log is what the script said as it went; the result is what it handed back. -->
          <div v-if="run.log.length" class="abele-runs__log">
            <div v-for="(line, i) in run.log" :key="i" class="abele-runs__line">
              <span class="abele-runs__line-at">{{ clock(line.at) }}</span>
              <span class="abele-runs__line-text">{{ line.text }}</span>
            </div>
          </div>

          <div v-if="run.error" class="abele-runs__error">{{ run.error }}</div>
          <div v-else-if="finalResult(run)" class="abele-runs__result">{{ finalResult(run) }}</div>

          <div class="abele-runs__actions">
            <Icon icon="file-code-2" tooltip="Open the script" @click="openScript(run)" />
            <div class="abele-runs__buttons">
              <Button
                v-if="run.status === 'running'"
                text="Stop"
                warning
                tooltip="Stop this run"
                @click="stop(run)"
              />
              <template v-else>
                <Icon
                  icon="x"
                  tooltip="Take this run off the list"
                  @click="ScriptRuns.getInstance().forget(run.id)"
                />
                <Button
                  text="Run again"
                  tooltip="Run it once more with the same values"
                  @click="again(run)"
                />
                <Button
                  text="Run as new"
                  accent
                  tooltip="Ask for the values again, starting from these"
                  @click="asNew(run)"
                />
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * What has been run this session.
 *
 * Runs live in memory only, so this list is the whole record: it has to say what happened, what
 * the script printed, and offer the two things wanted after reading that — the same run again,
 * or the same script with the values reconsidered.
 */
import { computed, onUnmounted, reactive, ref } from 'vue'
import { Notice, TFile } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Badge from './obsidian/Badge.vue'
import EmptyState from './obsidian/EmptyState.vue'
import { ScriptRuns, type ScriptRun } from '@/scripting/ScriptRuns'
import { ScriptService } from '@/scripting/ScriptService'
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
}

const store = ScriptRuns.getInstance()
const runs = computed(() => store.runs.value)
const opened = reactive(new Set<string>())

const heading = computed(() => {
  const going = runs.value.filter((run) => run.status === 'running').length
  if (going) return `${going} running`
  return runs.value.length ? `${runs.value.length} run${runs.value.length > 1 ? 's' : ''}` : 'Runs'
})

/**
 * Ticks while something is running, and only then: the elapsed time of a finished run never
 * changes, and a sidebar that redraws every second for nothing is a sidebar left closed.
 */
const now = ref(Date.now())
const ticker = window.setInterval(() => {
  if (runs.value.some((run) => run.status === 'running')) now.value = Date.now()
}, 1000)
onUnmounted(() => window.clearInterval(ticker))

const clock = (at: number) => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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

const start = async (run: ScriptRun, params: Record<string, unknown>) => {
  try {
    const result = await ScriptService.getInstance().execute(run.path, params, {
      formHandler: showFormModal,
      source: run.source === 'agent' ? 'command' : run.source,
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
  const script = ScriptService.getInstance()
    .getAll()
    .find((candidate) => candidate.path === run.path)
  if (!script) {
    new Notice(`Script is gone: ${run.path}`)
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
    }))
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

.abele-runs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
}

.abele-runs__count {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.abele-runs__list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
}

.abele-runs__run {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  overflow: hidden;
}

/** The status is read from the stripe down the side before any of the words are. */
.abele-runs__run_running {
  border-left: 2px solid var(--interactive-accent);
}

.abele-runs__run_failed {
  border-left: 2px solid var(--text-error);
}

.abele-runs__run_stopped {
  border-left: 2px solid var(--text-faint);
}

.abele-runs__run_done {
  border-left: 2px solid var(--color-green);
}

.abele-runs__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-1) var(--size-4-2);
  cursor: var(--cursor-link);
  min-width: 0;

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}

.abele-runs__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-ui-small);
}

.abele-runs__when,
.abele-runs__took {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-smallest);
  font-variant-numeric: tabular-nums;
}

.abele-runs__note {
  padding: 0 var(--size-4-2) var(--size-4-1) var(--size-4-8);
  color: var(--text-muted);
  font-size: var(--font-smallest);
}

.abele-runs__detail {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--background-secondary);
}

.abele-runs__path {
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  overflow-wrap: anywhere;
}

.abele-runs__params {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}

.abele-runs__param {
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  font-size: var(--font-smallest);
  overflow-wrap: anywhere;
}

.abele-runs__param-name {
  color: var(--text-muted);

  &::after {
    content: ': ';
  }
}

.abele-runs__log {
  display: flex;
  flex-direction: column;
  max-height: 16em;
  overflow-y: auto;
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  user-select: text;
}

.abele-runs__line {
  display: flex;
  gap: var(--size-4-2);
}

.abele-runs__line-at {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.abele-runs__line-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
  gap: var(--size-4-2);
}

.abele-runs__buttons {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  margin-left: auto;
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
