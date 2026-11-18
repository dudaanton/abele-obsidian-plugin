<template>
  <ConnectionWindow
    v-if="state.startsWith('connection-')"
    :ui="ui"
    :connection-id="id"
    @close="emit('close')"
  />
  <ShareDialog
    v-else-if="state.startsWith('share-')"
    :source="source"
    host="sync.example"
    @close="emit('close')"
  />
  <TokenDialogs v-else :ui="ui" mode="connect" @close="emit('close')" />
</template>

<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import ShareDialog from '@/components/sync/ShareDialog.vue'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { shareSetSource, type ShareSetSource, type ShareItem } from '@/sync/shareSets'
import { DEVICE_SCOPE_LEASE } from '@/sync/deviceScopeLease'
import { tokenUiFixture, sampleIssuedToken } from './tokenUiFixture'

const props = defineProps<{ state: string }>()
const emit = defineEmits<{ close: [] }>()
// Presentation-only adapters: no real files, server requests or credentials.
const ui = tokenUiFixture()
ui.candidates.value = []
ui.questions.value = []
ui.activity.value = {}
const id = ui.rows.value[0].id
const vault: ShareItem = { kind: 'vault', id: 'sample-vault', path: '/' }
const choices: ShareItem[] = [
  vault,
  ...Array.from({ length: 36 }, (_, index) => ({
    id: 'sample-choice-' + index,
    kind: (['folder', 'group', 'file'] as const)[index % 3],
    path:
      'Sample collection/Long descriptive parent/Example item ' +
      String(index + 1).padStart(2, '0') +
      (index % 3 ? '.md' : ''),
  })),
]
const missing: ShareItem = { kind: 'group', id: 'sample-missing', path: 'Missing sample group.md' }
const selected = ref<ShareItem[]>(
  props.state === 'connection-narrowing'
    ? [vault]
    : props.state === 'connection-missing'
      ? [choices[1], missing]
      : [choices[1]]
)
const published = ref(false)
const pending = new Set<() => void>()
const release = () => {
  for (const resolve of pending) resolve()
  pending.clear()
}
const hold = () => new Promise<void>((resolve) => pending.add(resolve))
const noop = async () => {}
const previous = shareSetSource.value
const source: ShareSetSource = {
  several: () => true,
  items: () => null,
  label: () => 'Sample connection',
  owner: () => true,
  choices: () => choices,
  shares: async () => [],
  members: (item) => (item.kind === 'group' ? (item.id === 'sample-choice-1' ? 0 : 18) : undefined),
  connectScope: async (_token, signal) => {
    if (props.state === 'connect-checking') await hold()
    signal.throwIfAborted()
    if (props.state === 'connect-error') throw new Error('Sample server unavailable')
    const restricted: ShareItem[] = [
      choices[1],
      choices[2],
      {
        kind: 'file',
        id: 'sample-restricted-file',
        path: choices[1].path + '/Checklist.md',
      },
    ]
    return {
      choices: props.state === 'connect-restricted' ? restricted : choices,
      serverFiles: props.state === 'connect-default' ? 0 : 48,
      ...(props.state === 'connect-restricted' ? { narrowed: [choices[1], choices[2]] } : {}),
    }
  },
  deviceScope: () => ({
    items: selected.value,
    choices,
    narrowed: false,
    notes: { [missing.id]: { text: 'Not found on this device', faint: true } },
  }),
  setDeviceScope: async (_id, items) => {
    selected.value = items
    ui.refresh()
  },
  notOnServer: (_id, items) =>
    items.length && !published.value ? { files: 32, items: items.map((item) => item.id) } : null,
  issue: async (_id, _set, sending) => {
    if (props.state === 'share-uploading') {
      sending?.(12, 32)
      await hold()
    }
    if (props.state === 'share-failure') throw new Error('Sample upload unavailable')
    published.value = true
    return sampleIssuedToken
  },
  add: noop,
  remove: noop,
  revoke: noop,
  preview: () => null,
  pauseItem: noop,
  followItem: noop,
  removeCopy: noop,
  deleteFacts: () => null,
  deleteFromServer: noop,
}
shareSetSource.value = source
if (props.state.startsWith('connection-')) {
  ui.registry.storage(id).saveLocalStorage(DEVICE_SCOPE_LEASE, {
    selection: selected.value,
    current: { id: 'sample-owned-device-key', reference: 'sample-device-reference', records: [] },
    cleanup: [],
  })
}
onMounted(async () => {
  document.addEventListener('abele-scope-capture-release', release)
  await nextTick()
  if (!props.state.startsWith('connection-') && !props.state.startsWith('share-')) {
    const input = document.querySelector<HTMLInputElement>('.modal input[type=password]')
    if (!input) throw new Error('Connect token field missing')
    input.value = sampleIssuedToken
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
onBeforeUnmount(() => {
  release()
  document.removeEventListener('abele-scope-capture-release', release)
  shareSetSource.value = previous
})
</script>
