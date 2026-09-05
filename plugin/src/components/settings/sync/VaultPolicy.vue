<template>
  <Section
    title="Vault policy"
    desc="How the server treats this vault. These are the vault's own settings, shared by every device on it — not this device's."
  >
    <EmptyState v-if="settings === null" :text="loadError ?? 'Reading the vault policy…'" />

    <template v-else>
      <Setting
        name="When two devices change one note"
        desc="Merge keeps both edits in the one note. A conflict file leaves your note alone and writes the other version beside it."
      >
        <Dropdown
          :model-value="conflict"
          :options="CONFLICT_OPTIONS"
          @update:model-value="setConflict"
        />
      </Setting>

      <Setting
        name="Encrypt notes carrying a property"
        desc="Stored now, applied in a later version: nothing is encrypted yet. A note whose frontmatter carries this property and value will be the one that is."
      >
        <Checkbox :is-enabled="signatureEnabled" @toggle="toggleSignature" />
      </Setting>

      <template v-if="signatureEnabled">
        <Setting name="Property" desc="The frontmatter field to look at.">
          <Input
            :model-value="signatureProperty"
            placeholder="e.g. private"
            @update:model-value="signatureProperty = $event"
          />
        </Setting>

        <Setting name="Value" desc="What that field has to say.">
          <Input
            :model-value="signatureValue"
            placeholder="e.g. true"
            @update:model-value="signatureValue = $event"
          />
        </Setting>
      </template>

      <Setting :name="saveName" :desc="saveError ?? undefined">
        <Button
          text="Save policy"
          accent
          :disabled="busy"
          tooltip="Send these to the server, for every device on this vault"
          @click="save"
        />
      </Setting>

      <Setting
        name="Largest file the vault accepts"
        :desc="`Set on the server: ${formatBytes(settings.max_file_bytes)}. This device's own cap is under what it syncs.`"
      >
        <Badge :text="formatBytes(settings.max_file_bytes)" />
      </Setting>

      <Setting name="History kept" :desc="retentionDesc">
        <Badge :text="`${settings.retention.notes_days} days`" />
      </Setting>
    </template>
  </Section>
</template>

<script setup lang="ts">
/**
 * The vault's policy, as the server holds it.
 *
 * These belong to the vault rather than to this device: a conflict rule that differed between
 * two devices would be no rule at all. So they are read from `state()` and written back with
 * `updateSettings`, which answers with the whole settings object — that answer is what this
 * screen redraws from, so a value the server clamped or defaulted is what you end up looking
 * at, not what you typed.
 *
 * The key signature is stored and not yet acted on. Encryption arrives in a later version;
 * writing the rule now means a vault set up today is already carrying it when it does, and
 * the row says so rather than pretending otherwise.
 */
import { computed, onMounted, ref } from 'vue'
import type { VaultSettings } from '@abele/sync-protocol'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Badge from '../../obsidian/Badge.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { SyncService } from '@/sync/SyncService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { formatBytes } from '@/helpers/reduceImage'
import { reasonOf } from '@/sync/format'

const CONFLICT_OPTIONS = [
  { value: 'merge', display: 'Merge the two versions' },
  { value: 'conflict-file', display: 'Write a conflict file' },
]

const sync = () => SyncService.getInstance()

const settings = ref<VaultSettings | null>(null)
const loadError = ref<string | null>(null)
const saveError = ref<string | null>(null)
const busy = ref(false)

const conflict = ref<VaultSettings['conflict']>('merge')
const signatureEnabled = ref(false)
const signatureProperty = ref('')
const signatureValue = ref('')

const saveName = computed(() => (saveError.value === null ? 'Save' : 'Could not save the policy'))

const retentionDesc = computed(() => {
  const kept = settings.value?.retention
  if (kept === undefined) return ''
  return `Set on the server. Attachments ${kept.attachments_days} days, settings ${kept.settings_days} days.`
})

/** The fields, set from whatever the server last said. */
function adopt(vault: VaultSettings): void {
  settings.value = vault
  conflict.value = vault.conflict
  signatureEnabled.value = vault.key_signature?.enabled ?? false
  signatureProperty.value = vault.key_signature?.property ?? ''
  signatureValue.value = vault.key_signature?.value ?? ''
}

onMounted(async () => {
  const client = sync().client()
  if (client === null) {
    loadError.value = 'The vault policy is on the server, and this device is not connected to one.'
    return
  }
  try {
    adopt((await client.state()).settings)
  } catch (error) {
    loadError.value = `The vault policy could not be read: ${reasonOf(error)}`
  }
})

function setConflict(value: string): void {
  conflict.value = value === 'conflict-file' ? 'conflict-file' : 'merge'
}

function toggleSignature(): void {
  signatureEnabled.value = !signatureEnabled.value
}

/**
 * Writes the policy, and keeps this device's own copy of the signature in step.
 *
 * The server's copy is what every device reads; the one in `data.json` is what this device
 * has to hand when it is offline, which is when the rule will actually be applied. Both are
 * written from the one answer, so neither can be the odd one out.
 */
async function save(): Promise<void> {
  const client = sync().client()
  if (client === null || busy.value) return
  busy.value = true
  saveError.value = null
  try {
    const property = signatureProperty.value.trim()
    // Half a signature would name every note or none, so it is both halves or nothing at all.
    const signature =
      signatureEnabled.value && property !== ''
        ? { enabled: true, property, value: signatureValue.value }
        : null
    const updated = await client.updateSettings({
      conflict: conflict.value,
      key_signature: signature,
    })
    adopt(updated)
    const config = AbeleConfig.getInstance()
    config.sync.keySignature =
      updated.key_signature === null || !updated.key_signature.enabled
        ? null
        : { property: updated.key_signature.property, value: updated.key_signature.value }
    await config.saveSettings()
    sync().note('the vault policy was changed from this device')
  } catch (error) {
    saveError.value = reasonOf(error)
  } finally {
    busy.value = false
  }
}
</script>
