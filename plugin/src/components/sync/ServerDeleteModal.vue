<template>
  <Modal
    :title="`Delete ${name} from the server?`"
    :can-close="() => !busy"
    close-in-footer
    phone-sheet
    @close="close"
  >
    <dl class="abele-server-delete__facts">
      <dt>Server</dt>
      <dd>{{ host }}</dd>
      <dt>Files</dt>
      <dd>{{ facts.files.toLocaleString('en') }}</dd>
      <dt>Size</dt>
      <dd>{{ folderSize(facts.bytes) }}</dd>
      <dt>Access closed</dt>
      <dd>
        <ul class="abele-server-delete__access">
          <li v-for="one in facts.access" :key="one.label">
            <span>{{ one.label }}</span>
            <span class="abele-server-delete__scope">{{ one.scope }}</span>
          </li>
        </ul>
      </dd>
    </dl>
    <p class="abele-server-delete__note">
      The files stay in the server's trash for 30 days. This device disconnects and keeps every
      file. Devices with that access stop and keep their copies.
    </p>
    <p v-if="failure" class="abele-server-delete__error" role="alert">{{ failure }}</p>
    <template #footer>
      <Button text="Cancel" tooltip="Close this and change nothing" @click="close" />
      <Button
        :text="busy ? 'Deleting…' : failure ? 'Try again' : 'Delete from the server'"
        warning
        :disabled="busy || !facts.canWrite"
        tooltip="Move these files to the server's trash, close every access to them and disconnect"
        @click="confirm"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * Asks before one connection's files leave the server: which server, how much, and whose
 * access closes with them. While it runs it cannot be closed; uncertainty offers retry.
 */
import { ref } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import { folderSize, serverDeleteFailure, type ServerDeleteFacts } from './serverDelete'

const props = defineProps<{
  name: string
  host: string
  facts: ServerDeleteFacts
  remove: () => Promise<void>
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const busy = ref(false)
const failure = ref('')

function close(): void {
  if (!busy.value) emit('close')
}

async function confirm(): Promise<void> {
  if (busy.value || !props.facts.canWrite) return
  busy.value = true
  failure.value = ''
  try {
    await props.remove()
    busy.value = false
    emit('done')
  } catch (error) {
    busy.value = false
    failure.value = serverDeleteFailure(props.host, error)
  }
}
</script>

<style lang="scss">
.abele-server-delete__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--size-2-3) var(--size-4-4);
  margin: 0 0 var(--size-4-4);

  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
}
.abele-server-delete__access {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }
}
.abele-server-delete__scope {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-server-delete__note {
  margin: 0;
  color: var(--text-muted);
}
.abele-server-delete__error {
  margin: var(--size-4-2) 0 0;
  color: var(--text-error);
  overflow-wrap: anywhere;
}
</style>
