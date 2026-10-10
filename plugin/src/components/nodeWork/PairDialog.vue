<template>
  <div class="abele-pair" :class="`abele-pair_${step}`">
    <template v-if="step === 'paste'">
      <div class="abele-pair__where">
        <div class="abele-pair__where-title">
          <span class="abele-pair__step">1</span>On the computer with the node
        </div>
        <p class="abele-pair__text">
          In Obsidian there, open the Node panel and choose Invite a device in its menu. Without
          Obsidian, run this command:
        </p>
        <div class="abele-pair__command">
          <code>abele-node pair invite</code>
          <Icon
            icon="copy"
            size="xs"
            tooltip="Copy the command"
            @click="emit('copy', 'abele-node pair invite')"
          />
        </div>
      </div>
      <div class="abele-pair__where">
        <div class="abele-pair__where-title"><span class="abele-pair__step">2</span>Here</div>
        <p class="abele-pair__text">Scan the QR code it shows, or paste its text.</p>
        <Input
          v-model="text"
          as-text-area
          :rows="4"
          :invalid="!!error"
          placeholder="Invitation"
          aria-label="Invitation"
          class="abele-pair__invitation"
        />
        <div v-if="error" class="abele-pair__error" role="alert">{{ error }}</div>
      </div>
      <div class="modal-button-container">
        <Button
          text="Scan QR"
          icon="scan-qr-code"
          tooltip="Read the invitation with the camera"
          @click="emit('scan')"
        />
        <Button
          text="Continue"
          accent
          :disabled="!text.trim()"
          tooltip="Check the invitation"
          @click="emit('review', text)"
        />
      </div>
    </template>

    <template v-else-if="step === 'check' && invitation">
      <div class="abele-pair__node">
        <span class="abele-pair__node-icon"><Icon icon="server" :interactive="false" /></span>
        <div>
          <div class="abele-pair__node-name">{{ invitation.name }}</div>
          <div class="abele-pair__node-address">{{ invitation.address }}</div>
        </div>
      </div>
      <p class="abele-pair__text">Check its key: the node printed the same one.</p>
      <div class="abele-pair__fingerprint" aria-label="Node key">
        <span v-for="(group, i) in groups" :key="i">{{ group }}</span>
      </div>
      <Setting
        v-if="invitation.keyChanged"
        class="abele-pair__changed"
        name="The key changed"
        desc="It is not the key this device paired with before. Check the new one on the node."
      >
        <Checkbox :is-enabled="confirmed" @toggle="confirmed = !confirmed" />
      </Setting>
      <div class="modal-button-container">
        <Button text="Back" tooltip="Use another invitation" @click="emit('back')" />
        <Button
          text="Pair"
          accent
          :disabled="invitation.keyChanged && !confirmed"
          tooltip="Ask the node to let this device in"
          @click="emit('pair')"
        />
      </div>
    </template>

    <template v-else-if="step === 'waiting'">
      <div class="abele-pair__where">
        <div class="abele-pair__where-title">
          <span class="abele-pair__step">3</span>On {{ invitation?.name }}, let this device in
        </div>
        <p class="abele-pair__text">
          Obsidian there asks about this device by itself. Without Obsidian, run
          <code class="abele-pair__inline">abele-node pair approve</code>. Either way it shows this
          code; let the device in only if it is the same:
        </p>
        <div class="abele-pair__code">{{ code }}</div>
      </div>
      <div class="abele-pair__waiting" role="status">
        <StatusDot tone="orange" pulse label="Waiting for confirmation" />
        <span>Waiting for confirmation…</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Pairing this device with AbeleNode on another computer: the invitation the node prints, its
// key to compare, then a code to confirm on the node. Each step is one short column with one
// action, the way Nuxt's auth form is; the dialog closes itself once the node agrees.
import { computed, ref } from 'vue'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Setting from '../obsidian/Setting.vue'
import StatusDot from '../obsidian/StatusDot.vue'

const props = withDefaults(
  defineProps<{
    step: 'paste' | 'check' | 'waiting'
    invitation?: { name: string; address: string; fingerprint: string; keyChanged?: boolean }
    /** The code the node shows when it is asked to confirm this device. */
    code?: string
    error?: string
  }>(),
  { invitation: undefined, code: undefined, error: undefined }
)

const emit = defineEmits<{
  (e: 'review', text: string): void
  (e: 'scan'): void
  (e: 'pair'): void
  (e: 'back'): void
  (e: 'copy', text: string): void
}>()

const text = ref('')
const confirmed = ref(false)
const groups = computed(() => props.invitation?.fingerprint.match(/.{1,4}/g) ?? [])
</script>

<style lang="scss">
.abele-pair {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.abele-pair__where {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);

  & + & {
    margin-top: var(--size-4-2);
  }
}
.abele-pair__where-title {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
}
// The step number as a small round mark, so the two places read as an order, not as a list.
.abele-pair__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-4-5);
  height: var(--size-4-5);
  border-radius: 50%;
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-pair__where > :not(.abele-pair__where-title) {
  --abele-pair-indent: calc(var(--size-4-5) + var(--size-4-2));
  max-width: calc(100% - var(--abele-pair-indent));
  margin-inline-start: var(--abele-pair-indent);
}
.abele-pair__inline {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-pair__text {
  margin: 0;
  color: var(--text-normal);
  font-size: var(--font-ui-small);
}
.abele-pair__command {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-1) var(--size-4-1) var(--size-4-3);
  border-radius: var(--radius-s);
  background-color: var(--code-background);

  code {
    color: var(--code-normal);
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
  }
}
.abele-pair__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
.abele-pair__node {
  display: flex;
  align-items: center;
  gap: var(--size-4-3);
}
.abele-pair__node-icon {
  display: flex;
  color: var(--icon-color);
  --icon-size: var(--icon-l);
  --icon-stroke: var(--icon-l-stroke-width);
}
.abele-pair__node-name {
  color: var(--text-normal);
  font-weight: var(--font-semibold);
}
.abele-pair__node-address {
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
// The key in groups of four, so it can be read aloud and compared group by group.
.abele-pair__fingerprint {
  display: grid;
  grid-template-columns: repeat(8, auto);
  justify-content: start;
  gap: var(--size-2-2) var(--size-4-2);
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
}
.abele-pair__code {
  color: var(--text-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-larger);
  font-weight: var(--font-semibold);
}
.abele-pair__waiting {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-pair .modal-button-container {
  margin-top: var(--size-4-2);
}
</style>
