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
        :text="t('sync.window.close')"
        :tooltip="t('streamC.7ecb1503458c2bfc')"
        accent
        @click="emit('close')"
      />
      <template v-else>
        <Button
          :text="t('streamC.a0e63d7c7125d29a')"
          :tooltip="
            kind === 'template' ? t('streamC.e8cd9f3661d65b5c') : t('streamC.29df5c3b30b40b43')
          "
          @click="emit('close')"
        />
        <Button
          :text="t('area.confirm')"
          :tooltip="t('streamC.806ec0dcbd1f1c1c')"
          accent
          @click="confirm"
        />
      </template>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

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

const title = computed(() =>
  props.kind === 'template'
    ? t('streamC.c86ec84954d8c60f', { v1: props.name })
    : t('streamC.1da957bdede67571', { v1: props.name })
)
const why = computed(() =>
  props.kind === 'template'
    ? t('streamC.e5d18ee925811f2e')
    : props.refused
      ? t('streamC.267901fa4acc3c7f')
      : props.previous !== undefined
        ? t('streamC.089afe41eb761bbe')
        : t('streamC.4c4da1c3aec6e9b4')
)
const pathLine = computed(() =>
  props.previous !== undefined
    ? t('streamC.2f74fb6c99f673c4', { v1: String(props.path) })
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
