<template>
  <!-- A saved request in its tab of the main area, read as Postman reads one: the method and the
       address on one line with Send, what the address comes to in this environment under it, the
       parts of the request as folds, and the answer below. -->
  <div class="abele-http-request" :class="{ 'abele-http-request_phone': phone }">
    <div class="abele-http-request__layout">
      <div class="abele-http-request__top">
        <div class="abele-http-request__line">
          <Dropdown
            class="abele-http-request__method"
            :class="`abele-http-method_${request.method.toLowerCase()}`"
            :options="METHODS.map((m) => ({ value: m, display: m }))"
            :model-value="request.method"
            aria-label="Method"
            @update:model-value="
              (m: string) => emit('change', { ...request, method: m as HttpMethod })
            "
          />
          <input
            type="text"
            class="abele-http-request__url"
            :value="request.url"
            aria-label="Address"
            spellcheck="false"
            @change="emit('change', { ...request, url: ($event.target as HTMLInputElement).value })"
            @keydown.enter.prevent="send"
          />
          <Icon
            v-if="recording"
            class="abele-http-request__into"
            :class="{ 'abele-http-request__into_on': intoRecording }"
            icon="circle-dot"
            :active="intoRecording"
            role="switch"
            :aria-checked="intoRecording"
            :tooltip="
              intoRecording
                ? `Goes into the recording of ${recording}; click to send it on its own`
                : `Sent on its own; click to send it into the recording of ${recording}`
            "
            @click="emit('into-recording', !intoRecording)"
          />
          <!-- Only while a program is recorded: whether this send goes into the recording, so its
           answer and the code's steps it caused stand in one run. Otherwise there is no such
           choice and nothing about recording shows. -->
          <Button
            class="abele-http-request__send"
            accent
            :text="outcome?.kind === 'sending' ? 'Sending…' : 'Send'"
            :loading="outcome?.kind === 'sending'"
            :disabled="!!blocked || outcome?.kind === 'sending'"
            :tooltip="
              blocked ??
              `Send it in ${environment}${recording && intoRecording ? ', into the recording' : ''} (Enter)`
            "
            @click="send"
          />
        </div>
        <!-- What it goes to: the address with this environment's values put in, a key by its name. -->
        <div class="abele-http-request__resolved">
          <Icon icon="layers" size="xs" no-hover />
          <span class="abele-http-request__env">{{ environment }}</span>
          <code
            class="abele-http-request__to"
            :class="{ 'abele-http-request__to_missing': unknownVar }"
            >{{ resolved }}</code
          >
        </div>
      </div>

      <div class="abele-http-request__parts">
        <section v-for="part in parts" :key="part.id" class="abele-http-request__part">
          <FoldHeading
            :text="part.label"
            :count="part.count"
            collapsible
            :collapsed="folded.has(part.id)"
            @toggle="toggle(part.id)"
          />
          <template v-if="!folded.has(part.id)">
            <RequestPairs
              v-if="part.id === 'params' || part.id === 'headers'"
              :pairs="part.id === 'params' ? request.params : request.headers"
              :label="part.label"
              :adding="part.id === 'params' ? 'Add a parameter' : 'Add a header'"
              @change="(i, p) => changePair(part.id, i, p)"
              @remove="(i) => removePair(part.id, i)"
              @add="(p) => addPair(part.id, p)"
            />
            <div v-else-if="part.id === 'body'" class="abele-http-request__body">
              <textarea
                :value="request.body?.text ?? ''"
                aria-label="Body"
                spellcheck="false"
                :rows="Math.min(8, Math.max(3, (request.body?.text ?? '').split('\n').length))"
                placeholder="No body"
                @change="
                  emit('change', {
                    ...request,
                    body: {
                      format: request.body?.format ?? 'json',
                      text: ($event.target as HTMLTextAreaElement).value,
                    },
                  })
                "
              />
            </div>
            <div v-else-if="part.id === 'scripts'" class="abele-http-request__rows">
              <TreeItem
                v-for="when in ['before', 'after'] as const"
                :key="when"
                flush
                icon="file-code"
                :text="request.scripts[when] ?? 'None'"
                :note="when === 'before' ? 'Before it goes' : 'After it comes back'"
                :disabled="!request.scripts[when]"
                @click="request.scripts[when] && emit('open-script', request.scripts[when]!)"
              />
            </div>
            <div v-else class="abele-http-request__rows">
              <TreeItem
                v-for="(check, i) in request.checks"
                :key="i"
                flush
                plain
                :text="check.text"
              >
                <template #end>
                  <ResultMark
                    v-if="check.passed !== undefined"
                    :state="check.passed ? 'done' : 'error'"
                    :text="check.passed ? 'Held the last time' : 'Failed the last time'"
                  />
                </template>
              </TreeItem>
            </div>
          </template>
        </section>
      </div>

      <!-- The answer, as DevTools reads a request: a line of facts, then the body and the headers. -->
      <div class="abele-http-request__answer" aria-live="polite">
        <template v-if="outcome?.kind === 'answered'">
          <div class="abele-http-request__facts">
            <span
              class="abele-http-request__status"
              :class="`abele-http-request__status_${statusTone(outcome.response.status)}`"
              >{{ outcome.response.status }}</span
            >
            <span>{{ outcome.response.reason }}</span>
            <span class="abele-http-request__fact">{{ outcome.response.ms }} ms</span>
            <span class="abele-http-request__fact">{{ bytes(outcome.response.bytes) }}</span>
            <span v-if="shownAt" class="abele-http-request__fact">{{ shownAt }}</span>
            <a
              v-if="outcome.response.steps"
              class="abele-http-request__steps"
              role="button"
              tabindex="0"
              @click="emit('open-run')"
              @keydown.enter="emit('open-run')"
              ><Icon icon="list-video" size="xs" no-hover />{{
                stepsInCode(outcome.response.steps)
              }}</a
            >
          </div>
          <Tabs v-model="answerTab" level="secondary" :tabs="answerTabs" />
          <div v-if="answerTab === 'body' && compareWith" class="abele-http-request__compare">
            <div class="abele-http-request__compare-head">
              <span>Compared with the answer of {{ compareWith.at }}</span>
              <Icon
                icon="x"
                size="xs"
                tooltip="Stop comparing"
                @click="emit('compare', undefined)"
              />
            </div>
            <Diff
              :text-left="compareWith.body ?? ''"
              :text-right="outcome.response.body"
              layout="unified"
              :label-before="compareWith.at"
              label-after="This answer"
              empty-text="The same body."
            />
          </div>
          <DebugValueView
            v-else-if="answerTab === 'body'"
            class="abele-http-request__body-view"
            name="Body"
            :value="outcome.response.body"
          />
          <div v-else-if="answerTab === 'headers'" class="abele-http-request__rows">
            <TreeItem v-for="h in outcome.response.headers" :key="h.key" flush plain :text="h.key">
              <template #end
                ><code class="abele-http-request__header-value">{{ h.value }}</code></template
              >
            </TreeItem>
          </div>
          <div v-else-if="answerTab === 'history'" class="abele-http-request__rows">
            <TreeItem
              v-for="h in history"
              :key="h.id"
              flush
              :text="h.at"
              :note="h.environment"
              :active="h.id === (shownSend ?? history[0]?.id)"
              @click="emit('show-send', h.id)"
            >
              <template #end>
                <Icon
                  v-if="h.intoRun"
                  icon="circle-dot"
                  size="xs"
                  no-hover
                  class="abele-http-request__in-run"
                  tooltip="Sent into a recording: a step of its run"
                />
                <span class="abele-http-request__fact">{{
                  h.ms !== undefined ? `${h.ms} ms` : ''
                }}</span>
                <span
                  class="abele-http-request__status"
                  :class="`abele-http-request__status_${h.failed ? 'error' : statusTone(h.status ?? 0)}`"
                  >{{ h.failed ? '—' : h.status }}</span
                >
              </template>
              <template #actions>
                <Icon
                  icon="git-compare"
                  size="xs"
                  tooltip="Compare with the answer shown"
                  :disabled="h.failed || h.id === (shownSend ?? history[0]?.id)"
                  @click.stop="emit('compare', h.id)"
                />
              </template>
            </TreeItem>
          </div>
          <div v-else class="abele-http-request__rows">
            <TreeItem
              v-for="(c, i) in outcome.response.checks ?? []"
              :key="i"
              flush
              plain
              :text="c.text"
            >
              <template #end>
                <ResultMark
                  :state="c.passed ? 'done' : 'error'"
                  :text="c.passed ? 'Held' : 'Failed'"
                />
              </template>
            </TreeItem>
          </div>
        </template>
        <div
          v-else-if="outcome?.kind === 'failed'"
          class="abele-http-request__notice abele-http-request__notice_error"
          role="status"
        >
          <Icon icon="circle-x" size="xs" no-hover />
          <span>{{ outcome.reason }}</span>
        </div>
        <div
          v-else-if="outcome?.kind === 'unknown'"
          class="abele-http-request__notice abele-http-request__notice_warning"
          role="status"
        >
          <Icon icon="circle-help" size="xs" no-hover />
          <span>{{
            outcome.reason ??
            `No answer in ${outcome.after}. It may have gone through; it is not sent again by itself.`
          }}</span>
        </div>
        <div
          v-else-if="outcome?.kind === 'sending'"
          class="abele-http-request__notice"
          role="status"
        >
          <StatusDot tone="accent" label="Sending" pulse />
          <span>Waiting for the answer…</span>
        </div>
        <!-- Nothing sent and it cannot go as it is: why, where the answer would be, with the way
             to put it right when that is a key this device lacks. -->
        <div
          v-else-if="blocked"
          class="abele-http-request__notice abele-http-request__notice_error"
          role="status"
        >
          <Icon icon="key-round" size="xs" no-hover />
          <span>{{ blocked }}</span>
          <Button
            v-if="missingKey"
            class="abele-http-request__open-keys"
            text="Open keys"
            @click="emit('open-keys')"
          />
        </div>
        <EmptyState v-else text="Send it to see the answer here." />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Every part of a request is a fold, so a long body or a dozen headers never push the answer
// out of sight; what is folded is remembered for the tab. A value that cannot be sent as it is
// (a key the plugin does not have, a variable with no value) keeps Send off and says why in the
// tooltip; the address under the line shows it in red.
import { computed, reactive, ref, watch } from 'vue'
import { Platform } from 'obsidian'
import Button from '../../obsidian/Button.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import FoldHeading from '../../obsidian/FoldHeading.vue'
import Icon from '../../obsidian/Icon.vue'
import ResultMark from '../../obsidian/ResultMark.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import Tabs from '../../obsidian/Tabs.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import Diff from '../../Diff.vue'
import DebugValueView from '../DebugValueView.vue'
import { bytes } from '../trace/format'
import RequestPairs from './RequestPairs.vue'
import type {
  HttpEnvironment,
  HttpMethod,
  HttpOutcome,
  HttpPair,
  HttpRequest,
  HttpSend,
} from './types'

const props = withDefaults(
  defineProps<{
    request: HttpRequest
    environment: string
    /** The environment's values, to show what the address comes to. */
    vars?: HttpEnvironment['vars']
    outcome?: HttpOutcome
    /** Every sending of it, the latest first. */
    history?: HttpSend[]
    /** The sending whose answer is shown, when not the latest. */
    shownSend?: string
    /** An earlier sending the answer shown is compared with. */
    compareWith?: HttpSend
    /** The program being recorded now, when one is: a send may go into it. */
    recording?: string
    intoRecording?: boolean
  }>(),
  {
    vars: () => [],
    outcome: undefined,
    history: () => [],
    shownSend: undefined,
    compareWith: undefined,
    recording: undefined,
    intoRecording: false,
  }
)
const emit = defineEmits<{
  (e: 'change', request: HttpRequest): void
  (e: 'send'): void
  (e: 'open-run'): void
  (e: 'open-script', name: string): void
  (e: 'into-recording', on: boolean): void
  (e: 'show-send', id: string): void
  (e: 'compare', id: string | undefined): void
  /** The settings where this device's keys are kept. */
  (e: 'open-keys'): void
}>()

const phone = Platform.isPhone
/** When the answer shown was sent, if it is not the latest. */
const shownAt = computed(() =>
  props.shownSend && props.shownSend !== props.history[0]?.id
    ? props.history.find((h) => h.id === props.shownSend)?.at
    : undefined
)
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const folded = reactive(new Set<string>(['scripts']))
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))

const parts = computed(() => [
  { id: 'params', label: 'Params', count: on(props.request.params) },
  { id: 'headers', label: 'Headers', count: on(props.request.headers) },
  ...(props.request.method === 'GET' || props.request.method === 'HEAD'
    ? []
    : [{ id: 'body', label: 'Body', count: undefined }]),
  {
    id: 'scripts',
    label: 'Scripts',
    count: [props.request.scripts.before, props.request.scripts.after].filter(Boolean).length,
  },
  { id: 'checks', label: 'Checks', count: props.request.checks.length },
])
// Every line, the ones left out too: they are there to read and to switch back on.
const on = (pairs: HttpPair[]) => pairs.length

/** A variable of the address this environment has no value for. */
const unknownVar = computed(() =>
  [...props.request.url.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .find((name) => !props.vars.some((v) => v.key === name))
)
/** Why it cannot go as it is, in words for the tooltip. */
const blocked = computed(() => {
  const missing = [...props.request.params, ...props.request.headers].find(
    (p) => !p.off && p.missing
  )
  if (missing) return missing.missing
  return unknownVar.value ? `${unknownVar.value} has no value in ${props.environment}` : undefined
})
/** A key this device does not have, by name, when that is what keeps it from going. */
const missingKey = computed(() =>
  [...props.request.params, ...props.request.headers].some((p) => !p.off && p.missing && p.secret)
)
/** `1 step in code`, `3 steps in code`. */
const stepsInCode = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'} in code`

const resolved = computed(() => {
  const query = props.request.params
    .filter((p) => !p.off)
    .map((p) => `${p.key}=${p.value}`)
    .join('&')
  const url = props.request.url.replace(
    /\{\{(\w+)\}\}/g,
    (whole, name: string) => props.vars.find((v) => v.key === name)?.value ?? whole
  )
  return query ? `${url}?${query}` : url
})

function send() {
  if (!blocked.value && props.outcome?.kind !== 'sending') emit('send')
}

function changePair(part: string, i: number, pair: HttpPair) {
  const key = part === 'params' ? 'params' : 'headers'
  emit('change', {
    ...props.request,
    [key]: props.request[key].map((p, j) => (j === i ? pair : p)),
  })
}
function removePair(part: string, i: number) {
  const key = part === 'params' ? 'params' : 'headers'
  emit('change', { ...props.request, [key]: props.request[key].filter((_, j) => j !== i) })
}
function addPair(part: string, pair: HttpPair) {
  const key = part === 'params' ? 'params' : 'headers'
  emit('change', { ...props.request, [key]: [...props.request[key], pair] })
}

const answerTab = ref('body')
watch(
  () => props.outcome,
  (now, before) => {
    // A fresh answer is read from its body; looking through the history keeps its tab.
    if (now?.kind !== 'answered' || before?.kind !== 'answered') answerTab.value = 'body'
  }
)
watch(
  () => props.compareWith,
  (c) => c && (answerTab.value = 'body')
)
const answerTabs = computed(() => {
  const r = props.outcome?.kind === 'answered' ? props.outcome.response : undefined
  const checks = r?.checks ?? []
  return [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', badge: r?.headers.length },
    ...(checks.length
      ? [
          {
            id: 'checks',
            label: 'Checks',
            badge: `${checks.filter((c) => c.passed).length}/${checks.length}`,
          },
        ]
      : []),
    ...(props.history.length > 1
      ? [{ id: 'history', label: 'History', badge: props.history.length }]
      : []),
  ]
})
const statusTone = (status: number) => (status >= 400 ? 'error' : status >= 300 ? 'muted' : 'ok')
</script>

<style lang="scss">
.abele-http-request {
  container-type: inline-size;
  padding: var(--size-4-4) var(--size-4-6);
}

// The request and its answer one under the other; in a wide tab side by side, as Postman lays
// them, so the answer is in sight however long the request is.
.abele-http-request__top,
.abele-http-request__parts,
.abele-http-request__answer {
  margin-bottom: var(--size-4-4);
}
@container (min-width: 44em) {
  .abele-http-request__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas: 'top top' 'parts answer';
    column-gap: var(--size-4-8);
    align-items: start;
  }
  .abele-http-request__top {
    grid-area: top;
  }
  .abele-http-request__parts {
    grid-area: parts;
  }
  .abele-http-request__layout > .abele-http-request__answer {
    grid-area: answer;
    padding-top: 0;
    border-top: none;
  }
}

.abele-http-request__top {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

// The tab already says it is the body; the viewer keeps only its size and lines.
.abele-http-request__body-view .abele-debug-value-view__name {
  display: none;
}

.abele-http-request__line {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-http-request__method {
  flex: 0 0 auto;
  font-family: var(--font-monospace);
  font-weight: var(--font-semibold);
}

.abele-http-request__url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-monospace);
}

.abele-http-request__send {
  flex: 0 0 auto;
}

.abele-http-request__resolved {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  // From the method's frame, the column's edge.
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
    color: inherit;
  }
}

.abele-http-request__env {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.abele-http-request__to {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  padding: 0;
  color: var(--text-muted);
}

.abele-http-request__to_missing {
  color: var(--text-error);
}

.abele-http-request__parts {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-http-request__part > .abele-fold-heading {
  margin-bottom: var(--size-2-2);
}

.abele-http-request__body textarea {
  width: 100%;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  resize: vertical;
}

.abele-http-request__rows {
  display: flex;
  flex-direction: column;
}

.abele-http-request__answer {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding-top: var(--size-4-3);
  border-top: var(--border-width) solid var(--background-modifier-border);
}

.abele-http-request__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--size-2-2) var(--size-4-2);
  font-size: var(--font-ui-small);
  color: var(--text-normal);
}

.abele-http-request__status {
  font-family: var(--font-monospace);
  font-weight: var(--font-semibold);
}
.abele-http-request__status_ok {
  color: var(--color-green);
}
.abele-http-request__status_error {
  color: var(--text-error);
}
.abele-http-request__status_muted {
  color: var(--text-muted);
}

.abele-http-request__fact {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-http-request__steps {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
  margin-inline-start: auto;
  color: var(--text-accent);
  cursor: var(--cursor);

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
    color: inherit;
  }
}

.abele-http-request__into {
  flex: 0 0 auto;
}
// On, the recording's own red: the same code as the dot of a recording in the Debug view.
.abele-http-request__into_on {
  color: var(--color-red);
}
.abele-http-request__in-run {
  height: auto;
  padding: 0;
  color: var(--color-red);
}
.abele-http-request__compare {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.abele-http-request__compare-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}

.abele-http-request__header-value {
  background: none;
  padding: 0;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
}

.abele-http-request__notice {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  font-size: var(--font-ui-small);
  color: var(--text-muted);

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
    color: inherit;
  }
}
.abele-http-request__notice_error {
  color: var(--text-error);
}
.abele-http-request__notice_warning {
  color: var(--text-warning);
}

// On a phone the address takes its own line, the method and Send under it.
.abele-http-request_phone {
  padding: var(--size-4-3) var(--size-4-4);

  .abele-http-request__line {
    flex-wrap: wrap;
  }
  .abele-http-request__url {
    order: -1;
    flex-basis: 100%;
  }
  .abele-http-request__send {
    margin-inline-start: auto;
  }
  .abele-http-request__resolved {
    margin-top: 0;
  }
}
</style>
