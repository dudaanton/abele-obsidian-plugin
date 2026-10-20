<template>
  <ShareDialog
    v-if="screen === 'empty'"
    :source="source"
    host="sync.example"
    @close="emit('close')"
  />
  <ShareDetail
    v-else-if="screen === 'long' || screen === 'readonly'"
    :share="share"
    :choices="items"
    :add="noop"
    :remove="noop"
    :revoke="noop"
    @close="emit('close')"
  />
  <RemoveCopyModal
    v-else-if="screen === 'removed'"
    :item="detached"
    :remove="noop"
    @close="emit('close')"
  />
  <ServerDeleteModal
    v-else-if="screen === 'delete'"
    name="Sample collection"
    host="sync.example"
    :facts="facts"
    :remove="noop"
    :choices="items.slice(0, 3).map((item) => ({ value: item.id, label: itemLabel(item) }))"
    :choice="items[0].id"
    @close="emit('close')"
  />
  <Modal v-else title="Sample connection" size="tall" phone-sheet @close="emit('close')">
    <ConnectionItems :items="connectionItems" />
  </Modal>
</template>

<script setup lang="ts">
import Modal from '@/components/obsidian/Modal.vue'
import ConnectionItems from '@/components/sync/ConnectionItems.vue'
import RemoveCopyModal from '@/components/sync/RemoveCopyModal.vue'
import ServerDeleteModal from '@/components/sync/ServerDeleteModal.vue'
import ShareDialog from '@/components/sync/ShareDialog.vue'
import ShareDetail from '@/components/sync/ShareDetail.vue'
import {
  itemLabel,
  type ShareItem,
  type ShareSetSource,
  type ConnectionItem,
} from '@/sync/shareSets'

const props = defineProps<{
  screen: 'empty' | 'long' | 'readonly' | 'removed' | 'delete' | 'states'
}>()
const emit = defineEmits<{ close: [] }>()
const noop = async () => {}
const items: ShareItem[] = Array.from({ length: 20 }, (_, index) => ({
  id: 'sample-' + index,
  kind: (['folder', 'group', 'file'] as const)[index % 3],
  path: `Sample collection/Long descriptive parent folder/Example item ${index + 1}${index % 3 ? '.md' : ''}`,
}))
const share = {
  id: 'sample-share',
  label: 'Sample shared collection',
  items,
  readOnly: props.screen === 'readonly',
  createdAt: '2025-01-01T12:00:00Z',
  revokedAt: null,
}
const detached: ConnectionItem = { ...items[0], state: { kind: 'detached' }, files: 8, edited: 2 }
const connectionItems: ConnectionItem[] = [
  { ...items[1], state: { kind: 'synced' } },
  { ...items[2], state: { kind: 'error', reason: 'Server temporarily unavailable' } },
  detached,
  { ...items[3], state: { kind: 'moved', to: 'Sample collection/New folder' } },
  { ...items[4], state: { kind: 'paused' } },
]
const facts = {
  files: 8,
  bytes: 2048,
  access: [],
  canWrite: true,
  also: [{ path: 'Example note.md', group: 'Sample group' }],
}
/** Presentation data only: the fixture opens no engines, sockets or server connections. */
const source: ShareSetSource = {
  several: () => true,
  items: () => connectionItems,
  label: () => share.label,
  owner: () => true,
  choices: () => items,
  shares: async () => [],
  issue: async () => '',
  add: noop,
  remove: noop,
  revoke: noop,
  preview: () => null,
  pauseItem: noop,
  followItem: noop,
  removeCopy: noop,
  deleteFacts: () => facts,
  deleteFromServer: noop,
}
</script>
