<template>
  <ObsidianModal
    :title="t('settings.SecretsListModal.all_keys.9e5c5da4')"
    size="tall"
    @close="emit('close')"
  >
    <div ref="root" class="abele-secrets-list">
      <p class="abele-secrets-list__summary">{{ summary }}</p>

      <!-- The store's names are encrypted with its values: locked, it can only be said to exist -->
      <template v-if="status === 'locked' || status === 'stale'">
        <Setting :name="lockedName" :desc="unlockDesc">
          <Input
            v-model="passphrase"
            password
            :placeholder="t('settings.SecretsListModal.passphrase.e7611f05')"
          />
          <Button
            :text="t('settings.SecretsListModal.unlock.4ac709aa')"
            accent
            :disabled="!passphrase || busy"
            :tooltip="
              passphrase
                ? t('settings.SecretsListModal.open_the_store_here_and.6be7e00a')
                : t('settings.SecretsListModal.type_the_passphrase_first.397584ff')
            "
            @click="unlock"
          />
        </Setting>
      </template>
      <p v-else-if="status === 'damaged'" class="abele-secrets-list__note">
        {{ t('settings.SecretsListModal.the_synced_store_cannot_be.df30eba8') }}
      </p>

      <CardGrid stack>
        <Card
          v-for="row in rows"
          :key="row.id"
          :title="row.name"
          :subtitle="row.unused ? undefined : row.id"
          :description="explained(row)"
          :meta="meta(row)"
        >
          <template #badges>
            <Badge :text="STATES[row.state].label" :color="STATES[row.state].color" />
          </template>
          <template v-if="row.set" #actions>
            <Icon
              :icon="shown.has(row.id) ? 'eye-off' : 'eye'"
              :tooltip="
                shown.has(row.id)
                  ? t('settings.SecretsListModal.hide_the_key.46a22923')
                  : t('settings.SecretsListModal.show_the_key.90d90eb7')
              "
              @click="toggle(row.id)"
            />
            <Icon
              icon="copy"
              :tooltip="t('settings.SecretsListModal.copy_the_key.30d7860a')"
              @click="copyOne(row)"
            />
          </template>
          <code v-if="row.set" class="abele-secrets-list__value">{{
            shown.has(row.id) ? store.get(row.id) : MASK
          }}</code>
        </Card>
      </CardGrid>

      <EmptyState
        v-if="!rows.length"
        :text="t('settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6')"
      />

      <Setting :name="t('settings.SecretsListModal.copy_all.96e3f09a')" :desc="copyAllDesc">
        <Button
          :text="t('settings.SecretsListModal.copy_all.96e3f09a')"
          warning
          :disabled="!setCount"
          :tooltip="
            setCount
              ? t('settings.SecretsListModal.put_every_key_on_the.a26cf3c7')
              : t('settings.SecretsListModal.no_key_is_set.f4f5b239')
          "
          @click="confirmingAll = true"
        />
      </Setting>

      <ConfirmModal
        v-if="confirmingAll"
        :title="t('settings.SecretsListModal.copy_every_key.2f918de3')"
        :message="copyAllWarning"
        :confirm-text="t('settings.SecretsListModal.copy_all.96e3f09a')"
        :confirm-tooltip="t('settings.SecretsListModal.put_every_key_on_the.8118968c')"
        @confirm="copyAll"
        @close="confirmingAll = false"
      />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { t } from '@/i18n'
/**
 * Every key the plugin knows on this device, each masked until asked for.
 *
 * A shown value hides itself after half a minute, when the window goes to the background, and
 * when the dialog closes — it is never kept anywhere but on the screen. A copied value comes
 * off the clipboard a minute later where the device allows it (`secrets/clipboard.ts`).
 * Nothing here writes a value to the console, and nothing an agent runs can open this.
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import Icon from '../obsidian/Icon.vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import type { KitColor } from '@/constants/colors'
import { secrets } from '@/secrets/SecretStore'
import { copyAllText, secretCatalog, type KeyState, type SecretRow } from '@/secrets/catalog'
import { platformClipboard } from '@/secrets/clipboard'
import { copyKey } from '@/secrets/copyKey'
import { AbeleConfig } from '@/services/AbeleConfig'

const emit = defineEmits<{ (e: 'close'): void }>()

/** How long a shown value stays on the screen. */
const SHOW_FOR_MS = 30_000
const MASK = '••••••••••••'

const STATES: Record<KeyState, { label: string; color: KitColor }> = {
  device: { label: t('settings.SecretsListModal.on_this_device.38b9d88c'), color: 'grey' },
  synced: { label: t('settings.SecretsListModal.synced.5da22fe4'), color: 'green' },
  differs: {
    label: t('settings.SecretsListModal.differs_from_keychain.922767e7'),
    color: 'orange',
  },
  'store-only': {
    label: t('settings.SecretsListModal.only_in_the_store.9bb2ce40'),
    color: 'orange',
  },
  'not-synced': {
    label: t('settings.SecretsListModal.not_in_the_store.507fd6ce'),
    color: 'orange',
  },
  locked: { label: t('settings.SecretsListModal.store_locked.d47ee0fe'), color: 'grey' },
  unset: { label: t('settings.SecretsListModal.not_set.4895f731'), color: 'grey' },
}

const store = secrets()
const status = computed(() => store.status.value)
const root = ref<HTMLElement>()

const rows = computed<SecretRow[]>(() => {
  void store.version.value
  return secretCatalog(AbeleConfig.getInstance().exportSettings(), {
    status: store.status.value,
    contents: store.contents(),
    has: (id) => !!store.get(id),
  })
})

const setCount = computed(() => rows.value.filter((r) => r.set).length)

const summary = computed(() => {
  const all = rows.value.length
  const parts = [
    all === 1 ? settingsCount('key', 1) : settingsCount('key', all),
    t('settings.SecretsListModal.value_set.f4c8f3b4', { value0: String(setCount.value) }),
  ]
  const synced = rows.value.filter((r) => r.state === 'synced').length
  if (status.value === 'unlocked')
    parts.push(t('settings.SecretsListModal.value_synced.1785a4d0', { value0: String(synced) }))
  return parts.join(' · ')
})

const explained = (row: SecretRow): string | undefined => {
  switch (row.state) {
    case 'differs':
      return t('settings.SecretsListModal.this_device_s_keychain_holds.1b27e956')
    case 'store-only':
      return t('settings.SecretsListModal.in_the_store_but_not.5e27c94a')
    case 'not-synced':
      return t('settings.SecretsListModal.set_on_this_device_and.db43f1dd')
    default:
      return undefined
  }
}

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const meta = (row: SecretRow): string[] => [
  ...(row.unused ? [t('settings.SecretsListModal.not_used_by_any_setting.85faf2ac')] : row.uses),
  ...(row.at
    ? [t('settings.SecretsListModal.updated_value.51194723', { value0: String(when(row.at)) })]
    : []),
]

// ── Showing ──────────────────────────────────────────────────

const shown = reactive(new Set<string>())
const timers = new Map<string, number>()

function hide(id: string): void {
  shown.delete(id)
  const timer = timers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  timers.delete(id)
}

function hideAll(): void {
  for (const id of [...shown]) hide(id)
}

function toggle(id: string): void {
  if (shown.has(id)) return hide(id)
  shown.add(id)
  timers.set(
    id,
    window.setTimeout(() => hide(id), SHOW_FOR_MS)
  )
}

/** The document the dialog is in: settings can be a window of their own. */
const doc = () => root.value?.ownerDocument ?? activeDocument
const onVisibility = () => {
  if (doc().visibilityState === 'hidden') hideAll()
}
let watched: Document | null = null
onMounted(() => {
  watched = doc()
  watched.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  watched?.removeEventListener('visibilitychange', onVisibility)
  hideAll()
})

// ── Copying ──────────────────────────────────────────────────

const clipboard = () => platformClipboard(doc().defaultView ?? activeWindow)
const confirmingAll = ref(false)

const copy = (text: string, what: string) => copyKey(text, what, doc().defaultView ?? activeWindow)

const copyOne = (row: SecretRow) => copy(store.get(row.id), row.name)

const copyAll = () =>
  copy(
    copyAllText(rows.value, (id) => store.get(id)),
    setCount.value === 1 ? settingsCount('key', 1) : settingsCount('key', setCount.value)
  )

const clears = computed(() => clipboard().read !== null)

const copyAllDesc = t('settings.SecretsListModal.every_key_that_is_set.19a2b157')

const copyAllWarning = computed(
  () =>
    t('settings.SecretsListModal.every_key_listed_here_value.a6aac65e', {
      value0: String(setCount.value),
    }) +
    (clears.value
      ? t('settings.SecretsListModal.it_is_cleared_from_the.06480e6f')
      : t('settings.SecretsListModal.on_this_device_it_stays.57af8178'))
)

// ── Unlocking ────────────────────────────────────────────────

const passphrase = ref('')
const busy = ref(false)
const refused = ref(false)
watch(passphrase, () => {
  refused.value = false
})
watch(status, () => {
  passphrase.value = ''
})

const lockedName = computed(() =>
  status.value === 'stale'
    ? t('settings.SecretsListModal.synced_keys_are_out_of.408b671b')
    : t('settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24')
)

const unlockDesc = computed(() =>
  refused.value
    ? t('settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8')
    : t('settings.SecretsListModal.the_store_may_hold_keys.5b2f6105')
)

async function unlock(): Promise<void> {
  busy.value = true
  try {
    if (!(await store.unlock(passphrase.value))) refused.value = true
  } catch (e) {
    console.error('[Abele] the store could not be unlocked', (e as Error)?.message)
    new Notice(t('settings.SecretsListModal.the_store_could_not_be.bafdcd54'))
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss">
.abele-secrets-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-secrets-list__summary,
.abele-secrets-list__note {
  margin: 0;
  color: var(--text-muted);
}

.abele-secrets-list__value {
  display: block;
  margin-top: var(--size-2-2);
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  // A key is one long token; broken anywhere rather than pushing the card sideways.
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
