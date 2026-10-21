<template>
  <Modal
    :title="t('streamC.c8219c29ffc4fa52', { v1: String(name) })"
    :can-close="() => !busy"
    close-in-footer
    phone-sheet
    @close="close"
  >
    <Setting v-if="choices?.length" :name="t('sync.deleteChoice')">
      <Dropdown
        :model-value="choice ?? ''"
        :disabled="busy"
        :options="choices.map((one) => ({ value: one.value, display: one.label }))"
        @update:model-value="emit('choose', $event)"
      />
    </Setting>
    <dl class="abele-server-delete__facts">
      <dt>{{ t('settings.CalendarsSettings.server.aef7de28') }}</dt>
      <dd>{{ host }}</dd>
      <dt>{{ t('settings.metadata.abc7e9892806b047') }}</dt>
      <dd>{{ facts.files.toLocaleString(currentLocale().format) }}</dd>
      <dt>{{ t('settings.ImageModelEditModal.size.1af85190') }}</dt>
      <dd>{{ folderSize(facts.bytes) }}</dd>
      <dt v-if="facts.access.length">{{ t('streamC.1acc804ac37f32e3') }}</dt>
      <dd v-if="facts.access.length">
        <ul class="abele-server-delete__access">
          <li v-for="one in facts.access" :key="one.label">
            <span>{{ one.label }}</span>
            <span class="abele-server-delete__scope">{{ one.scope }}</span>
          </li>
        </ul>
      </dd>
    </dl>
    <p v-for="one in warnings" :key="one.key" class="abele-server-delete__also mod-warning">
      <template v-if="one.group">
        {{
          t(one.count === 1 ? 'sync.overlapGroup' : 'sync.overlapGroupMany', {
            name: one.path.split('/').pop()?.replace(/\.md$/, '') ?? '',
            group: one.group,
            count: String(one.count),
          })
        }}
      </template>
      <template v-else>
        {{
          t('sync.overlapCount', {
            name: one.path.split('/').pop()?.replace(/\.md$/, '') ?? '',
            count: String(one.overlapCount),
          })
        }}
      </template>
    </p>
    <p v-if="facts.alsoMore" class="abele-server-delete__also mod-warning">
      {{ t('sync.overlapMore') }}
    </p>
    <p class="abele-server-delete__note">{{ note || t(SERVER_DELETE_DEVICE_NOTE) }}</p>
    <p v-if="facts.unavailableReason" class="abele-server-delete__error" role="alert">
      {{ facts.unavailableReason }}
    </p>
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
import { ref, computed } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import {
  folderSize,
  serverDeleteFailure,
  SERVER_DELETE_DEVICE_NOTE,
  type ServerDeleteFacts,
} from './serverDelete'

const props = defineProps<{
  name: string
  host: string
  facts: ServerDeleteFacts & {
    also?: { path: string; group?: string; groupId?: string; overlapCount?: number }[]
    alsoMore?: boolean
  }
  remove: () => Promise<void>
  choices?: { value: string; label: string }[]
  choice?: string
  note?: string
}>()
const emit = defineEmits<{ close: []; done: []; choose: [value: string] }>()

const busy = ref(false)
const failure = ref('')
const warnings = computed(() => {
  const grouped = new Map<
    string,
    {
      key: string
      path: string
      group?: string
      overlapCount?: number
      count: number
      paths: Set<string>
    }
  >()
  for (const [index, one] of (props.facts.also ?? []).entries()) {
    const key = one.group ? 'group:' + (one.groupId ?? one.group) : 'other:' + index
    const current = grouped.get(key)
    if (current) {
      current.paths.add(one.path)
      current.count = current.paths.size
    } else grouped.set(key, { ...one, key, count: 1, paths: new Set([one.path]) })
  }
  return [...grouped.values()]
})

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
.abele-server-delete__also {
  margin: 0 0 var(--size-4-2);
  color: var(--text-warning);
}
.abele-server-delete__error {
  margin: var(--size-4-2) 0 0;
  color: var(--text-error);
  overflow-wrap: anywhere;
}
</style>
