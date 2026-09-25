<template>
  <ObsidianModal title="All keys" size="tall" @close="emit('close')">
    <div ref="root" class="abele-secrets-list">
      <p class="abele-secrets-list__summary">{{ summary }}</p>

      <!-- The store's names are encrypted with its values: locked, it can only be said to exist -->
      <template v-if="status === 'locked' || status === 'stale'">
        <Setting :name="lockedName" :desc="unlockDesc">
          <Input v-model="passphrase" password placeholder="Passphrase" />
          <Button
            text="Unlock"
            accent
            :disabled="!passphrase || busy"
            :tooltip="
              passphrase ? 'Open the store here and list its keys' : 'Type the passphrase first'
            "
            @click="unlock"
          />
        </Setting>
      </template>
      <p v-else-if="status === 'damaged'" class="abele-secrets-list__note">
        The synced store cannot be decrypted, so the keys only it holds cannot be listed. The keys
        below are the ones this device has.
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
              :tooltip="shown.has(row.id) ? 'Hide the key' : 'Show the key'"
              @click="toggle(row.id)"
            />
            <Icon icon="copy" tooltip="Copy the key" @click="copyOne(row)" />
          </template>
          <code v-if="row.set" class="abele-secrets-list__value">{{
            shown.has(row.id) ? store.get(row.id) : MASK
          }}</code>
        </Card>
      </CardGrid>

      <EmptyState
        v-if="!rows.length"
        text="No keys yet. A key entered anywhere in the plugin's settings is listed here."
      />

      <Setting name="Copy all" :desc="copyAllDesc">
        <Button
          text="Copy all"
          warning
          :disabled="!setCount"
          :tooltip="setCount ? 'Put every key on the clipboard, after a warning' : 'No key is set'"
          @click="confirmingAll = true"
        />
      </Setting>

      <ConfirmModal
        v-if="confirmingAll"
        title="Copy every key"
        :message="copyAllWarning"
        confirm-text="Copy all"
        confirm-tooltip="Put every key on the clipboard as plain text"
        @confirm="copyAll"
        @close="confirmingAll = false"
      />
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
  device: { label: 'On this device', color: 'grey' },
  synced: { label: 'Synced', color: 'green' },
  differs: { label: 'Differs from keychain', color: 'orange' },
  'store-only': { label: 'Only in the store', color: 'orange' },
  'not-synced': { label: 'Not in the store', color: 'orange' },
  locked: { label: 'Store locked', color: 'grey' },
  unset: { label: 'Not set', color: 'grey' },
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
  const parts = [all === 1 ? '1 key' : `${all} keys`, `${setCount.value} set`]
  const synced = rows.value.filter((r) => r.state === 'synced').length
  if (status.value === 'unlocked') parts.push(`${synced} synced`)
  return parts.join(' · ')
})

const explained = (row: SecretRow): string | undefined => {
  switch (row.state) {
    case 'differs':
      return "This device's keychain holds another value, changed outside the plugin. The store's value is the one used."
    case 'store-only':
      return "In the store but not in this device's keychain. The plugin still uses it."
    case 'not-synced':
      return 'Set on this device and not in the store. Set it again to put it there.'
    default:
      return undefined
  }
}

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const meta = (row: SecretRow): string[] => [
  ...(row.unused ? ['Not used by any setting on this device'] : row.uses),
  ...(row.at ? [`Updated ${when(row.at)}`] : []),
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

const copy = (text: string, what: string) =>
  copyKey(text, what, doc().defaultView ?? activeWindow)

const copyOne = (row: SecretRow) => copy(store.get(row.id), row.name)

const copyAll = () =>
  copy(
    copyAllText(rows.value, (id) => store.get(id)),
    setCount.value === 1 ? '1 key' : `${setCount.value} keys`
  )

const clears = computed(() => clipboard().read !== null)

const copyAllDesc =
  'Every key that is set, as lines of name = value — for a password manager, or to paste into another app.'

const copyAllWarning = computed(
  () =>
    `Every key listed here — ${setCount.value} of them — goes onto the clipboard as plain text, where any app on this device can read it. ` +
    (clears.value
      ? 'It is cleared from the clipboard in a minute if it is still there.'
      : 'On this device it stays there until something else is copied.')
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
    ? 'Synced keys are out of date here'
    : 'Synced keys are locked on this device'
)

const unlockDesc = computed(() =>
  refused.value
    ? 'That passphrase does not open the store.'
    : 'The store may hold keys this device does not have. Their names are encrypted too, so they are listed once it is unlocked.'
)

async function unlock(): Promise<void> {
  busy.value = true
  try {
    if (!(await store.unlock(passphrase.value))) refused.value = true
  } catch (e) {
    console.error('[Abele] the store could not be unlocked', (e as Error)?.message)
    new Notice('The store could not be unlocked.')
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
