<template>
  <Modal
    :title="t('streamC.c8219c29ffc4fa52', { v1: String(name) })"
    :can-close="() => !busy"
    close-in-footer
    phone-sheet
    @close="close"
  >
    <dl class="abele-server-delete__facts">
      <dt>{{ t('settings.CalendarsSettings.server.aef7de28') }}</dt>
      <dd>{{ host }}</dd>
      <dt>{{ t('settings.metadata.abc7e9892806b047') }}</dt>
      <dd>{{ facts.files.toLocaleString(currentLocale().format) }}</dd>
      <dt>{{ t('settings.ImageModelEditModal.size.1af85190') }}</dt>
      <dd>{{ folderSize(facts.bytes) }}</dd>
      <dt>{{ t('streamC.1acc804ac37f32e3') }}</dt>
      <dd>
        <ul class="abele-server-delete__access">
          <li v-for="one in facts.access" :key="one.label">
            <span>{{ one.label }}</span>
            <span class="abele-server-delete__scope">{{ one.scope }}</span>
          </li>
        </ul>
      </dd>
    </dl>
    <p class="abele-server-delete__note">{{ t('streamC.ad151a07bc5a6fa5') }}</p>
    <p v-if="failure" class="abele-server-delete__error" role="alert">{{ failure }}</p>
    <template #footer>
      <Button :text="t('kit.cancel')" :tooltip="t('kit.cancelTooltip')" @click="close" />
      <Button
        :text="
          busy
            ? t('streamC.43b5894c3e4e2b24')
            : failure
              ? t('streamC.d8b8392e2c542950')
              : t('streamC.2bf85fe0a42ff813')
        "
        warning
        :disabled="busy || !facts.canWrite"
        :tooltip="t('streamC.637f261b0b03cd13')"
        @click="confirm"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { t, currentLocale } from '@/i18n'

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
