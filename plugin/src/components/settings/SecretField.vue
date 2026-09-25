<template>
  <div ref="root" class="abele-secret-field">
    <div v-if="value" class="abele-secret-field__stored">
      <code class="abele-secret-field__value">{{ shown ? value : masked }}</code>
      <Icon
        :icon="shown ? 'eye-off' : 'eye'"
        :tooltip="shown ? 'Hide the key' : 'Show the key'"
        @click="shown = !shown"
      />
      <Icon icon="copy" tooltip="Copy the key" @click="copy" />
    </div>
    <div class="abele-secret-field__row">
      <Input
        :model-value="modelValue"
        password
        :placeholder="value ? replacePlaceholder : placeholder"
        @update:model-value="emit('update:model-value', $event)"
        @keydown.enter="save"
      />
      <Icon v-if="modelValue" icon="check" with-bg :tooltip="saveTooltip" @click="save" />
      <slot v-else-if="value" name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A setting that holds a key: the key already stored, masked, with a way to show it in full
 * and to copy it — and below it a field for a new one.
 *
 * Shown only while asked for; leaving the settings forgets that it was. Copying goes through
 * the same clipboard as the list of all keys, so on the desktop the key comes off the
 * clipboard a minute later if it is still there.
 */
import { computed, ref } from 'vue'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import { copyKey } from '@/secrets/copyKey'

const props = withDefaults(
  defineProps<{
    /** The key stored now, '' when there is none. */
    value: string
    /** What is being typed as a new key. */
    modelValue: string
    placeholder?: string
    replacePlaceholder?: string
    saveTooltip?: string
    /** How the notice after a copy names it. */
    what?: string
  }>(),
  {
    placeholder: undefined,
    replacePlaceholder: 'New key...',
    saveTooltip: 'Save key',
    what: 'The key',
  }
)

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
  (e: 'save'): void
}>()

const root = ref<HTMLElement>()
const shown = ref(false)

const masked = computed(() =>
  props.value.length <= 8 ? '••••••••' : `${props.value.slice(0, 4)}••••${props.value.slice(-4)}`
)

const save = () => {
  if (props.modelValue) emit('save')
}

const copy = () =>
  copyKey(props.value, props.what, root.value?.ownerDocument.defaultView ?? activeWindow)
</script>

<style lang="scss">
.abele-secret-field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-secret-field__stored,
.abele-secret-field__row {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-secret-field__value {
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--font-monospace);
  font-size: var(--font-small);
  color: var(--text-muted);
  // Obsidian aligns a settings control to the end; a key wrapped onto several lines reads from
  // its start.
  text-align: start;
  // A key is one long token; broken anywhere rather than pushing the row sideways.
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
