<template>
  <ObsidianModal
    :title="title"
    size="tall"
    modal-class="abele-script-review"
    @close="emit('close')"
  >
    <p class="abele-script-review__why">{{ why }}</p>
    <p class="abele-script-review__path setting-item-description">{{ pathLine }}</p>
    <div ref="codeEl" class="abele-script-review__code" />
    <template #footer>
      <Button
        v-if="refused"
        text="Close"
        tooltip="Close this; the script does not run here"
        accent
        @click="emit('close')"
      />
      <template v-else>
        <Button
          text="Not now"
          :tooltip="
            kind === 'template'
              ? 'Leave commands and plugin methods waiting'
              : 'Leave it waiting; nothing runs it'
          "
          @click="emit('close')"
        />
        <Button
          text="Confirm"
          tooltip="Let this version run on this device"
          accent
          @click="confirm"
        />
      </template>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Platform } from 'obsidian'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { unifiedMergeView } from '@codemirror/merge'
import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'

/**
 * The dialog a script or template from elsewhere is confirmed in: why it waits, what it is, yes
 * or not now. The code is a read-only CodeMirror view, against `previous` as one column with what
 * went and what came marked in it when there is one. Answers `true` on Confirm only; any other
 * way of closing it is no answer. Opened by `reviewScript()`.
 */
const props = defineProps<{
  kind: 'script' | 'template'
  name: string
  path: string
  /** The text that would run. */
  text: string
  /** The text last confirmed at this path, when this device kept it. */
  previous?: string
  /** Refused by where it came from: shown, but there is nothing to confirm. */
  refused?: boolean
}>()

const emit = defineEmits<{
  (e: 'answer', value: true): void
  (e: 'close'): void
}>()

const title = computed(() => `Confirm ${props.kind} "${props.name}"`)
const why = computed(() =>
  props.kind === 'template'
    ? 'This template can run commands or call plugin methods. Those parts will not run until you confirm this version on this device. Review the execution settings and the full template below. Confirmation does not reapply the template; use it again afterwards.'
    : props.refused
      ? 'This version arrived through a connection that is not allowed to bring scripts to this device, so it does not run here. Change the script on this device to run it.'
      : props.previous !== undefined
        ? 'This script changed without being written on this device — through sync or another app. Buttons, automations, startup and agents will not run it until you confirm the change here.'
        : 'This script appeared without being written on this device — through sync or another app. Buttons, automations, startup and agents will not run it until you confirm it here.'
)
const pathLine = computed(() =>
  props.previous !== undefined
    ? `${props.path} — changes against the version last confirmed here`
    : props.path
)

const codeEl = ref<HTMLElement | null>(null)
let view: EditorView | null = null

onMounted(() => {
  // Read-only: changing the code here would confirm something nobody reviewed.
  view = new EditorView({
    parent: codeEl.value ?? undefined,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        lineNumbers(),
        ...(props.kind === 'template' ? [] : [javascript()]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(props.previous !== undefined
          ? [
              unifiedMergeView({
                original: props.previous,
                mergeControls: false,
                highlightChanges: !Platform.isPhone,
              }),
            ]
          : []),
      ],
    }),
  })
})
onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

function confirm(): void {
  emit('answer', true)
  emit('close')
}
</script>
