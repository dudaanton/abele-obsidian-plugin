<template>
  <Modal
    :title="`Remove your copy of ${itemName(item)}?`"
    :can-close="() => !busy"
    close-in-footer
    phone-sheet
    @close="close"
  >
    <dl class="abele-server-delete__facts">
      <dt>Files here</dt>
      <dd>{{ files.toLocaleString('en') }}</dd>
      <dt>Changed here</dt>
      <dd>{{ edited ? `${edited.toLocaleString('en')}, they stay` : 'None' }}</dd>
      <template v-if="item.kept">
        <dt>Also synced elsewhere</dt>
        <dd>{{ item.kept.toLocaleString('en') }}, they stay</dd>
      </template>
    </dl>
    <p class="abele-server-delete__note">
      Files you have not changed leave this device. Nothing changes on the server or for anyone
      else.
    </p>
    <p v-if="failure" class="abele-server-delete__error" role="alert">{{ failure }}</p>
    <template #footer>
      <Button text="Cancel" tooltip="Close this and change nothing" @click="close" />
      <Button
        :text="busy ? 'Removing…' : `Remove ${count}`"
        warning
        :disabled="busy || !(files - edited - (item.kept ?? 0))"
        tooltip="Remove the files you have not changed from this device"
        @click="confirm"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * Removing what is left on this device of an item no longer shared: how many files, how many
 * were changed here and stay. Only unchanged files go, and only from here.
 */
import { computed, ref } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { connectionError } from '@/sync/tokenUi'
import { itemName, type ConnectionItem } from '@/sync/shareSets'

const props = defineProps<{ item: ConnectionItem; remove: () => Promise<void> }>()
const emit = defineEmits<{ close: []; done: [] }>()

const busy = ref(false)
const failure = ref('')
const files = computed(() => props.item.files ?? 0)
const edited = computed(() => props.item.edited ?? 0)
const count = computed(() => {
  const n = files.value - edited.value - (props.item.kept ?? 0)
  return `${n.toLocaleString('en')} ${n === 1 ? 'file' : 'files'}`
})

function close() {
  if (!busy.value) emit('close')
}
async function confirm() {
  if (busy.value || files.value <= edited.value + (props.item.kept ?? 0)) return
  busy.value = true
  failure.value = ''
  try {
    await props.remove()
    emit('done')
  } catch (error) {
    failure.value = connectionError(error)
  } finally {
    busy.value = false
  }
}
</script>
