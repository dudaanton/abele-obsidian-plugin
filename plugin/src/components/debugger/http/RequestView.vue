<template>
  <!-- A saved request in its tab of the main area, read as Postman reads one: the method and the
       address on one line with Send, what the address comes to in this environment under it, the
       parts of the request as folds, and the answer below. -->
  <div class="abele-http-request" :class="{ 'abele-http-request_phone': phone }">
    <div ref="layout" class="abele-http-request__layout" :style="split">
      <div class="abele-http-request__top">
        <div v-if="collection" class="abele-http-request__collection">{{ collection }}</div>
        <div class="abele-http-request__line">
          <Dropdown
            class="abele-http-request__method"
            :class="`abele-http-method_${request.method.toLowerCase()}`"
            :options="METHODS.map((m) => ({ value: m, display: methodName(m) }))"
            :model-value="request.method"
            :aria-label="t('streamC.52a0f9b65b278850')"
            @update:model-value="
              (m: string) => emit('change', { ...request, method: m as HttpMethod })
            "
          />
          <input
            type="text"
            class="abele-http-request__url"
            :value="request.url"
            :aria-label="t('settings.nodes.address')"
            spellcheck="false"
            @change="emit('change', { ...request, url: ($event.target as HTMLInputElement).value })"
            @keydown.enter.prevent="send"
          />
          <!-- Send stays beside the address; its recording options are labelled below. -->
          <Button
            class="abele-http-request__send"
            accent
            :text="
              outcome?.kind === 'sending'
                ? t('streamC.b8ed5279e897be5d')
                : t('settings.TransferSettings.send.f6f4688f')
            "
            :loading="outcome?.kind === 'sending'"
            :disabled="!!blocked || outcome?.kind === 'sending'"
            :tooltip="
              blocked ??
              (recording && intoRecording
                ? t('streamC.b943fb892c6ec34a', { v1: environment })
                : t('streamC.74a056ddca844e78', { v1: environment }))
            "
            @click="send"
          />
        </div>
        <div class="abele-http-request__options">
          <label
            v-if="recording"
            class="abele-http-request__recording"
            @click="emit('into-recording', !intoRecording)"
          >
            <Checkbox
              class="abele-http-request__into"
              :class="{ 'abele-http-request__into_on': intoRecording }"
              :is-enabled="intoRecording"
              role="switch"
              :aria-label="t('requests.record')"
              @toggle="emit('into-recording', !intoRecording)"
            />
            <span>{{ t('requests.record') }} · {{ recording }}</span>
          </label>
          <label class="abele-http-request__timeout">
            <span>{{ t('requests.timeout') }}</span>
            <Dropdown
              :model-value="String(timeoutMs)"
              :options="
                [30000, 60000, 180000, 300000].map((ms) => ({
                  value: String(ms),
                  display: t('requests.timeoutSeconds', { seconds: ms / 1000 }),
                }))
              "
              :aria-label="t('requests.timeout')"
              @update:model-value="(value: string) => emit('timeout', Number(value))"
            />
          </label>
        </div>
        <Button
          v-if="paused || pausedAt"
          class="abele-http-request__paused"
          quiet
          wrap
          :text="
            pausedAt ? t('requests.paused', { location: pausedAt }) : t('streamC.e159b06187d369a0')
          "
          :tooltip="t('requests.openPaused')"
          @click="emit('open-debugger')"
        />
        <!-- What it goes to: the address with this environment's values put in, a key by its name. -->
        <div class="abele-http-request__resolved">
          <Icon icon="layers" size="xs" no-hover />
          <span class="abele-http-request__env">{{ environment }}</span>
          <code
            class="abele-http-request__to abele-selectable"
            :class="{ 'abele-http-request__to_missing': unknownVar }"
            >{{ resolved }}</code
          >
        </div>
        <!-- Read from a file of the project: where, as a way back to it; an edit goes there. -->
        <div v-if="request.origin" class="abele-http-request__resolved abele-http-request__origin">
          <Icon icon="file-code" size="xs" no-hover />
          <span v-if="gone" class="abele-http-request__gone">{{
            t('requests.file.gone', { file: request.origin.file })
          }}</span>
          <a
            v-else
            href="#"
            class="abele-http-request__origin-link"
            :aria-label="t('requests.file.openLine', { line: request.origin.line })"
            @click.prevent="emit('open-origin')"
            >{{ t('requests.file.at', { file: request.origin.file, line: request.origin.line }) }}</a
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
            <!-- The body in the plugin's own code editor, coloured for its format; Mod+Enter sends. -->
            <CodeField
              v-else-if="part.id === 'body'"
              class="abele-http-request__body"
              :value="request.body?.text ?? ''"
              :path="`body.${!request.body || request.body.format === 'json' ? 'json' : 'txt'}`"
              :label="t('streamC.6ccaa6415b5ee449')"
              :placeholder="t('streamC.e5c6c6025a921a07')"
              @change="
                (text: string) =>
                  emit('change', {
                    ...request,
                    body: { format: request.body?.format ?? 'json', text },
                  })
              "
              @submit="send"
            />
            <!-- What earlier answers give it: each value as it came, under it the request and
                 when; one not sent yet is red with a glyph that sends that request first. -->
            <div
              v-else-if="part.id === 'answers'"
              class="abele-http-request__captures"
              role="table"
              :aria-label="part.label"
            >
              <div
                v-for="c in captures"
                :key="c.expression"
                class="abele-http-pairs__row abele-http-request__capture"
                :class="{ 'abele-http-request__capture_missing': c.value === undefined }"
                role="row"
                :aria-label="c.expression"
              >
                <Icon icon="corner-down-right" size="xs" no-hover />
                <span class="abele-http-pairs__key abele-http-request__capture-name">{{
                  c.name
                }}</span>
                <span class="abele-http-request__capture-value">
                  <template v-if="c.value !== undefined"
                    ><code>{{ c.value }}</code>
                    <span class="abele-http-request__capture-from">{{
                      [c.from.name, c.status, c.at].filter(Boolean).join(' · ')
                    }}</span></template
                  >
                  <span v-else>{{ t('requests.capture.notSent', { name: c.from.name }) }}</span>
                </span>
                <Icon
                  v-if="c.value === undefined"
                  icon="send-horizontal"
                  size="xs"
                  :tooltip="t('requests.capture.sendFirst', { name: c.from.name })"
                  @click="emit('send-first', c.from.id)"
                />
                <span v-else />
              </div>
            </div>
            <!-- A script named runs from here: its row opens it, the glyphs change it or take it
                 off. With none, the row is the way to pick one, as Obsidian's own empty slots
                 are: a plus and what it is for. -->
            <div v-else-if="part.id === 'scripts'" class="abele-http-request__rows">
              <template v-for="when in ['before', 'after'] as const" :key="when">
                <TreeItem
                  v-if="request.scripts[when]"
                  flush
                  :icon="scriptProblems[when] ? 'file-warning' : 'file-code'"
                  :class="[
                    'abele-http-request__script',
                    { 'abele-http-request__script_problem': scriptProblems[when] },
                  ]"
                  :text="request.scripts[when]!"
                  :note="WHEN[when]"
                  :label="
                    scriptProblems[when] ??
                    t('streamC.3d5ce0e92464fbb0', { v1: String(request.scripts[when]) })
                  "
                  @click="emit('open-script', request.scripts[when]!)"
                >
                  <template #actions>
                    <Icon
                      icon="arrow-left-right"
                      size="xs"
                      :tooltip="
                        t('streamC.bd33ba8a6535f6eb', { v1: String(WHEN[when].toLowerCase()) })
                      "
                      @click.stop="emit('pick-script', when)"
                    />
                    <Icon
                      icon="x"
                      size="xs"
                      :tooltip="t('streamC.5d8a9146b2d9c438')"
                      @click.stop="emit('remove-script', when)"
                    />
                  </template>
                </TreeItem>
                <TreeItem
                  v-else
                  flush
                  class="abele-http-request__script_none"
                  icon="plus"
                  :text="WHEN[when]"
                  :label="t('streamC.5d6bb3ded416d548', { v1: String(WHEN[when].toLowerCase()) })"
                  @click="emit('pick-script', when)"
                />
              </template>
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
                    :text="
                      check.passed ? t('streamC.7c376836146b9add') : t('streamC.867b3a58d506de5c')
                    "
                  />
                </template>
              </TreeItem>
            </div>
          </template>
        </section>
      </div>

      <!-- Between the request and its answer, Obsidian's own divider, as tall as the taller of the
           two: dragged, the request's side takes that width and keeps it on this device; a double
           click evens them again. -->
      <PanelResizeHandle
        class="abele-http-request__divider"
        :label="t('streamC.8eb1d1e8b5c337db')"
        v-bind="divider"
      />

      <!-- The answer, as DevTools reads a request: a line of facts, then the body and the headers. -->
      <div ref="answer" class="abele-http-request__answer" aria-live="polite">
        <template v-if="outcome?.kind === 'answered'">
          <div class="abele-http-request__facts abele-selectable">
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
              v-if="recorded || outcome.response.steps"
              class="abele-http-request__steps"
              role="button"
              tabindex="0"
              @click="emit('open-run')"
              @keydown.enter="emit('open-run')"
              ><Icon icon="list-video" size="xs" no-hover />{{
                outcome.response.steps
                  ? stepsInCode(outcome.response.steps)
                  : t('debug.httpOpenRecorded')
              }}</a
            >
          </div>
          <Tabs v-model="answerTab" level="secondary" :tabs="answerTabs" />
          <div v-if="answerTab === 'body' && compareWith" class="abele-http-request__compare">
            <div class="abele-http-request__compare-head">
              <span>{{ t('streamC.06dfcaf5fb7a968a') }} {{ compareWith.at }}</span>
              <Icon
                icon="x"
                size="xs"
                :tooltip="t('streamC.3c42477022526f1c')"
                @click="emit('compare', undefined)"
              />
            </div>
            <Diff
              :text-left="compareWith.body ?? ''"
              :text-right="outcome.response.body"
              layout="unified"
              :label-before="compareWith.at"
              :label-after="t('streamC.0c2beefde8fa8421')"
              :empty-text="t('streamC.ea655da9d8ae8bd3')"
            />
          </div>
          <EmptyState
            v-else-if="answerTab === 'body' && !outcome.response.body"
            :text="t('streamC.c8c2e1d98310b574')"
          />
          <DebugValueView
            v-else-if="answerTab === 'body'"
            class="abele-http-request__body-view"
            :name="t('streamC.6ccaa6415b5ee449')"
            :value="outcome.response.body"
            wrap
          />
          <!-- Name and value in two columns, as DevTools lists them: a long value (a policy, a
               cookie) wraps under itself and never pushes its name out. -->
          <dl
            v-else-if="answerTab === 'headers'"
            class="abele-http-request__headers abele-selectable"
          >
            <template v-for="(h, i) in outcome.response.headers" :key="i">
              <dt>{{ h.key }}</dt>
              <dd>
                <code class="abele-http-request__header-value">{{ h.value }}</code>
              </dd>
            </template>
          </dl>
          <div
            v-else-if="answerTab === 'history'"
            class="abele-http-request__rows abele-http-request__history abele-selectable"
          >
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
                  :tooltip="t('streamC.09d892425ee70442')"
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
                  :tooltip="t('streamC.bb676eb6678e12ad')"
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
                  :text="c.passed ? t('streamC.85cd61f8c3c8a01e') : t('kit.failed')"
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
          <NodeErrorText :error="outcome.reason" />
        </div>
        <div
          v-else-if="outcome?.kind === 'unknown'"
          class="abele-http-request__notice abele-http-request__notice_warning"
          role="status"
        >
          <Icon icon="circle-help" size="xs" no-hover />
          <NodeErrorText v-if="outcome.reason" :error="outcome.reason" />
          <span v-else>{{ t('streamC.c43b098892a1b5a1', { v1: String(outcome.after) }) }}</span>
        </div>
        <div
          v-else-if="outcome?.kind === 'sending'"
          class="abele-http-request__notice"
          role="status"
        >
          <StatusDot tone="accent" :label="t('streamC.e595f17fac1d8384')" pulse />
          <span>{{ t('streamC.343517de2f012b5c') }}</span>
        </div>
        <!-- Nothing sent and it cannot go as it is: why, where the answer would be, with the way
             to put it right when that is a key this device lacks. -->
        <div
          v-else-if="blocked"
          class="abele-http-request__notice abele-http-request__notice_error"
          role="status"
        >
          <Icon :icon="unsent ? 'corner-down-right' : 'key-round'" size="xs" no-hover />
          <span class="abele-http-request__why">{{ blocked }}</span>
          <Button
            v-if="missingKey"
            class="abele-http-request__open-keys"
            :text="t('streamC.20ddc5d1000b3b31')"
            @click="emit('open-keys')"
          />
          <Button
            v-else-if="unsent"
            class="abele-http-request__open-keys"
            :text="t('requests.capture.sendFirst', { name: unsent.from.name })"
            @click="emit('send-first', unsent.from.id)"
          />
        </div>
        <EmptyState v-else :text="t('streamC.21e20af8ac700aae')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'

// Every part of a request is a fold, so a long body or a dozen headers never push the answer
// out of sight; what is folded is remembered for the tab. A value that cannot be sent as it is
// (a key the plugin does not have, a variable with no value) keeps Send off and says why in the
// tooltip; the address under the line shows it in red.
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Platform } from 'obsidian'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import CodeField from '../../obsidian/CodeField.vue'
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
import PanelResizeHandle from '../../obsidian/PanelResizeHandle.vue'
import { usePanelResize } from '../../obsidian/usePanelResize'
import RequestPairs from './RequestPairs.vue'
import type {
  HttpEnvironment,
  HttpMethod,
  HttpOutcome,
  HttpPair,
  HttpRequest,
  HttpSend,
  HttpCapture,
} from './types'

const props = withDefaults(
  defineProps<{
    recorded?: boolean
    request: HttpRequest
    environment: string
    collection?: string
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
    timeoutMs?: number
    paused?: boolean
    pausedAt?: string
    /** Why a named script cannot run, when it cannot: gone, or not made to run around requests. */
    scriptProblems?: { before?: string; after?: string }
    /** Values earlier answers give it, for a request read from a file of the project. */
    captures?: HttpCapture[]
    /** The file it was read from is no longer there; its last answer is still shown. */
    gone?: boolean
  }>(),
  {
    vars: () => [],
    collection: undefined,
    outcome: undefined,
    history: () => [],
    shownSend: undefined,
    compareWith: undefined,
    recording: undefined,
    intoRecording: false,
    timeoutMs: 300000,
    paused: false,
    pausedAt: undefined,
    scriptProblems: () => ({}),
    captures: () => [],
    gone: false,
  }
)
const emit = defineEmits<{
  (e: 'change', request: HttpRequest): void
  (e: 'send'): void
  (e: 'timeout', ms: number): void
  (e: 'open-debugger'): void
  (e: 'open-run'): void
  (e: 'open-script', name: string): void
  /** The picker of `@request` scripts, for the script run before it goes or after it comes back. */
  (e: 'pick-script', when: 'before' | 'after'): void
  (e: 'remove-script', when: 'before' | 'after'): void
  (e: 'into-recording', on: boolean): void
  (e: 'show-send', id: string): void
  (e: 'compare', id: string | undefined): void
  /** The settings where this device's keys are kept. */
  (e: 'open-keys'): void
  /** The file it was read from, at its line. */
  (e: 'open-origin'): void
  /** The request an earlier answer is wanted from, sent first. */
  (e: 'send-first', id: string): void
}>()

const phone = Platform.isPhone
const answer = ref<HTMLElement>()
const WHEN = {
  before: t('streamC.d733f8c9697720a6'),
  after: t('streamC.c01b93eb231f467d'),
} as const
/** The request side's width in a wide tab, on this device. */
const HTTP_SPLIT_KEY = 'abele-http-request-width'
/** When the answer shown was sent, if it is not the latest. */
const shownAt = computed(() =>
  props.shownSend && props.shownSend !== props.history[0]?.id
    ? props.history.find((h) => h.id === props.shownSend)?.at
    : undefined
)
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
// On a phone the method is said as the list of requests says it, so the address keeps its room.
const methodName = (m: HttpMethod) =>
  phone && m === 'DELETE' ? 'DEL' : phone && m === 'OPTIONS' ? 'OPT' : m

// Scripts start folded, and so does every part with nothing in it: an empty request reads as
// its headings alone, and opening one shows the line to add the first.
const folded = reactive(new Set<string>())
const foldEmpty = () => {
  folded.clear()
  for (const part of parts.value) if (part.id === 'scripts' || part.count === 0) folded.add(part.id)
}
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))

const parts = computed(() => [
  { id: 'params', label: t('streamC.7ffdd4b4c44c366a'), count: on(props.request.params) },
  {
    id: 'headers',
    label: t('settings.ai.McpServerModal.headers.194e9fe6'),
    count: on(props.request.headers),
  },
  ...(props.request.method === 'GET' || props.request.method === 'HEAD'
    ? []
    : [{ id: 'body', label: t('streamC.6ccaa6415b5ee449'), count: undefined }]),
  ...(props.captures.length
    ? [{ id: 'answers', label: t('requests.capture.title'), count: props.captures.length }]
    : []),
  {
    id: 'scripts',
    label: t('settings.tabs.scripts'),
    count: [props.request.scripts.before, props.request.scripts.after].filter(Boolean).length,
  },
  {
    id: 'checks',
    label: t('settings.ai.InterceptorSettings.checks.de07d072'),
    count: props.request.checks.length,
  },
])
// Every line, the ones left out too: they are there to read and to switch back on.
const on = (pairs: HttpPair[]) => pairs.length
foldEmpty()
watch(() => props.request.id, foldEmpty)

const layout = ref<HTMLElement>()
// The answer keeps at least as much room as the request may be narrowed to.
const { divider } = usePanelResize(layout, HTTP_SPLIT_KEY, 30, 22)
// The width as the divider holds it, so a drag starts from what is drawn; until the tab has been
// measured the two sides share it evenly.
const split = computed(() =>
  divider.value.max > 0 ? { '--abele-panel-width': `${divider.value.current}px` } : undefined
)

/** A variable of the address this environment has no value for. */
const unknownVar = computed(() =>
  [...props.request.url.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .find((name) => !props.vars.some((v) => v.key === name))
)
/** An earlier answer it takes a value from, when that request was not sent yet. */
const unsent = computed(() => props.captures.find((c) => c.value === undefined))
/** Why it cannot go as it is, in words for the tooltip. */
const blocked = computed(() => {
  const missing = [...props.request.params, ...props.request.headers].find(
    (p) => !p.off && p.missing
  )
  if (missing) return missing.missing
  if (unsent.value) return t('requests.capture.blocked', { name: unsent.value.from.name })
  if (props.gone) return t('requests.file.gone', { file: props.request.origin?.file ?? '' })
  return unknownVar.value
    ? t('streamC.c63d84f2d189cdf0', { v1: String(unknownVar.value), v2: String(props.environment) })
    : undefined
})
/** A key this device does not have, by name, when that is what keeps it from going. */
const missingKey = computed(() =>
  [...props.request.params, ...props.request.headers].some((p) => !p.off && p.missing && p.secret)
)
/** `1 step in code`, `3 steps in code`. */
const stepsInCode = (n: number) =>
  t('streamC.56dbc16aaad1e94c', { v1: String(n), v2: String(n === 1 ? 'step' : 'steps') })

const resolved = computed(() => {
  const query = props.request.params
    .filter((p) => !p.off)
    .map((p) => `${p.key}=${p.value}`)
    .join('&')
  const url = props.request.url.replace(
    /\{\{([\w.$-]+)\}\}/g,
    (whole, name: string) =>
      props.vars.find((v) => v.key === name)?.value ??
      props.captures.find((c) => c.expression === name)?.value ??
      whole
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
  () => props.pausedAt || props.paused,
  async (paused) => {
    if (!phone || !paused) return
    await nextTick()
    layout.value?.querySelector<HTMLElement>('.abele-http-request__paused')?.scrollIntoView?.({
      block: 'center',
      behavior: 'auto',
    })
  }
)
watch(
  () => props.outcome,
  (now, before) => {
    // A fresh answer is read from its body; looking through the history keeps its tab.
    if (now?.kind !== 'answered' || before?.kind !== 'answered') answerTab.value = 'body'
    if (phone && before?.kind === 'sending' && now?.kind !== 'sending')
      void nextTick(() =>
        window.requestAnimationFrame(() =>
          answer.value?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
        )
      )
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
    { id: 'body', label: t('streamC.6ccaa6415b5ee449') },
    {
      id: 'headers',
      label: t('settings.ai.McpServerModal.headers.194e9fe6'),
      badge: r?.headers.length,
    },
    ...(checks.length
      ? [
          {
            id: 'checks',
            label: t('settings.ai.InterceptorSettings.checks.de07d072'),
            badge: `${checks.filter((c) => c.passed).length}/${checks.length}`,
          },
        ]
      : []),
    ...(props.history.length > 1
      ? [{ id: 'history', label: t('streamC.0e76960093379060'), badge: props.history.length }]
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
    grid-template-columns: minmax(0, 1fr) var(--size-4-8) minmax(0, 1fr);
    grid-template-areas: 'top top top' 'parts divider answer';
    align-items: start;
  }
  .abele-http-request__top {
    grid-area: top;
  }
  .abele-http-request__parts {
    grid-area: parts;
  }
  .abele-http-request__layout {
    grid-template-columns: var(--abele-panel-width, minmax(0, 1fr)) var(--size-4-8) minmax(0, 1fr);
  }
  // Obsidian's divider, its hairline always drawn as between two panes, in the middle of the gap
  // and as tall as the taller side; the whole gap takes the drag, wide enough for a finger.
  // Obsidian hides a last leaf's handles by five classes; this one is inside the leaf.
  .abele-http-request
    .abele-http-request__layout
    > .workspace-leaf-resize-handle.abele-panel-resize-handle.abele-http-request__divider {
    --abele-divider-line: var(--divider-color);
    display: block;
    position: relative;
    inset: auto;
    grid-area: divider;
    align-self: stretch;
    width: auto;
    height: auto;
    margin: 0;
    border: none;
    background: linear-gradient(var(--abele-divider-line), var(--abele-divider-line)) center /
      var(--divider-width) 100% no-repeat;
    cursor: col-resize;
    touch-action: none;

    &:hover,
    &:focus-visible {
      --abele-divider-line: var(--divider-color-hover);
      background-size: var(--divider-width-hover) 100%;
    }
    &.is-active {
      --abele-divider-line: var(--color-accent);
      background-size: var(--divider-width-hover) 100%;
    }
  }
  .abele-http-request__layout > .abele-http-request__answer {
    grid-area: answer;
    padding-top: 0;
    border-top: none;
  }
}

.abele-http-request__divider {
  display: none;
}

// A script that cannot run says so in red, its tooltip saying why; an empty slot is a quiet line.
.abele-http-request__script_problem .tree-item-inner {
  color: var(--text-error);
}
.abele-http-request__script_none {
  color: var(--text-faint);
}
// The rows light up past the column's edge, as the file explorer's do, so the words stay on it.
.abele-http-request__script > .tree-item-self,
.abele-http-request__script_none > .tree-item-self {
  margin-inline: calc(-1 * var(--size-2-3));
  padding-inline: var(--size-2-3);
}

.abele-http-request__top {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-http-request__options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2) var(--size-4-4);
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}
.abele-http-request__collection {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.abele-http-request__recording,
.abele-http-request__timeout {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-http-request__recording > span {
  overflow-wrap: anywhere;
}
.abele-http-request__paused {
  align-self: flex-start;
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

.abele-http-request__origin {
  margin-top: var(--size-2-2);
}
.abele-http-request__origin-link {
  color: var(--text-muted);
  text-decoration: none;

  &:hover {
    color: var(--text-accent);
    text-decoration: underline;
  }
}
.abele-http-request__gone {
  color: var(--text-faint);
}
// What earlier answers give: the pairs' own columns, the name muted, the value as it came and
// faint after it the request and when; red where that request was not sent yet.
.abele-http-request__capture {
  .abele-obsidian-icon:first-child {
    height: auto;
    padding: 0;
    color: var(--text-faint);
  }
}
.abele-http-request__capture-name {
  padding: var(--size-2-1) var(--size-2-2);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}
.abele-http-request__capture-value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--size-4-2);
  min-width: 0;
  padding: var(--size-2-1) var(--size-2-2);
  font-size: var(--font-ui-small);

  code {
    font-family: var(--font-monospace);
    color: var(--text-normal);
    overflow-wrap: anywhere;
  }
}
.abele-http-request__capture-from {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.abele-http-request__capture_missing .abele-http-request__capture-value {
  color: var(--text-error);
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

.abele-http-request__headers {
  display: grid;
  grid-template-columns: fit-content(40%) minmax(0, 1fr);
  gap: var(--size-4-2) var(--size-4-4);
  margin: 0;
  font-size: var(--font-ui-small);

  dt {
    color: var(--text-normal);
    overflow-wrap: anywhere;
  }
  dd {
    margin: 0;
    min-width: 0;
  }
}

.abele-http-request__header-value {
  background: none;
  padding: 0;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

// Nothing sent yet: one quiet line level with the request's first heading, not a block of its own.
.abele-http-request__answer > .abele-empty-state {
  display: flex;
  align-items: center;
  min-height: calc(var(--font-ui-medium) * var(--line-height-tight) + var(--size-2-2));
  padding: 0;
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

// On a phone too the method, the address and Send are one line, as a browser's address bar is:
// a long address scrolls inside its field and is read in full on the line under it.
.abele-http-request_phone {
  padding: var(--size-4-3) var(--size-4-4);
  padding-block-end: calc(
    var(--navbar-height, 0px) + var(--navbar-bottom-offset, 0px) + var(--size-4-3)
  );

  .abele-http-request__line {
    gap: var(--size-4-1);
  }
  .abele-http-request__resolved {
    margin-top: 0;
  }
  // The script's name on its line and the moment it runs under it, as the quick switcher puts
  // a note's folder, so a long name never squeezes it into a column.
  .abele-http-request__script .abele-tree-item__inner {
    flex-wrap: wrap;
  }
  .abele-http-request__script .abele-tree-item__text {
    flex: 1 1 0;
  }
  .abele-http-request__script .abele-tree-item__note {
    flex-basis: 100%;
    padding-inline-start: calc(var(--icon-xs) + var(--size-4-1));
  }
}
</style>
