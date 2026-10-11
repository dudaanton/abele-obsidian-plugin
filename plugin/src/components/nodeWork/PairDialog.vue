<template>
  <div class="abele-pair" :class="`abele-pair_${step}`">
    <template v-if="step === 'paste'">
      <div class="abele-pair__where">
        <div class="abele-pair__where-title">
          <span class="abele-pair__step">1</span>On the computer with the node
        </div>
        <p class="abele-pair__text">Run this in a terminal. It prints a pairing code.</p>
        <div class="abele-pair__command">
          <code>abele-node pair</code>
          <Icon
            icon="copy"
            size="xs"
            tooltip="Copy the command"
            @click="emit('copy', 'abele-node pair')"
          />
        </div>
      </div>

      <div class="abele-pair__where">
        <div class="abele-pair__where-title"><span class="abele-pair__step">2</span>Here</div>
        <Input
          v-model="text"
          as-text-area
          :rows="3"
          :invalid="!!badCode"
          placeholder="Paste the pairing code"
          aria-label="Pairing code"
          class="abele-pair__code-field"
        />
        <div v-if="badCode" class="abele-pair__error" role="alert">{{ badCode }}</div>

        <!-- What the code holds, read out of it at once, to be checked against the node. -->
        <!-- What the code holds, to check against the node: who it is, its key, how long the
             code works. The name leads; the key is a grid of fours, read group by group. -->
        <div v-if="parsed && !badCode" class="abele-pair__card" aria-label="What the code holds">
          <span class="abele-pair__card-icon"><Icon icon="server" :interactive="false" /></span>
          <div class="abele-pair__card-body">
            <div class="abele-pair__card-head">
              <span
                ref="nameEl"
                class="abele-pair__card-name"
                :aria-label="
                  parsed.nodeId ? `${parsed.name} · Node ID ${parsed.nodeId}` : parsed.name
                "
                >{{ parsed.name }}</span
              >
              <span ref="expiresEl" class="abele-pair__card-expires"
                ><Icon icon="clock" size="xs" :interactive="false" />{{ shortExpiry }}</span
              >
            </div>
            <div ref="keyEl" class="abele-pair__key" role="group" aria-label="Node key">
              <span v-for="(group, i) in groups" :key="i">{{ group }}</span>
            </div>
          </div>
        </div>
        <!-- Where to reach the node: read from the code, but the same node may be reached by
             another address from here (its local one, a VPN, a tunnel), so these are fields. -->
        <template v-if="parsed && !badCode">
          <Setting
            class="abele-pair__setting"
            name="Address"
            :desc="host.trim() === parsed.host ? 'From the code.' : `The code says ${parsed.host}.`"
            :error="hostError"
          >
            <Input
              v-model="host"
              :invalid="!!hostError"
              aria-label="Address"
              autocomplete="off"
              spellcheck="false"
            />
          </Setting>
          <Setting
            class="abele-pair__setting"
            name="Port"
            :desc="
              port.trim() === String(parsed.port)
                ? 'From the code.'
                : `The code says ${parsed.port}.`
            "
            :error="portValid ? undefined : 'A number from 1 to 65535.'"
          >
            <Input
              v-model="port"
              :invalid="!portValid"
              inputmode="numeric"
              aria-label="Port"
              autocomplete="off"
            />
          </Setting>
        </template>
        <Setting
          v-if="parsed && keyChanged && !badCode"
          class="abele-pair__changed"
          name="The key is not the one from before"
          desc="This device knew this node by another key. Connect only if the node really got a new one."
        >
          <Checkbox :is-enabled="confirmed" @toggle="confirmed = !confirmed" />
        </Setting>
      </div>

      <div class="modal-button-container abele-modal__actions">
        <Button
          v-if="phone && canScan"
          text="Scan"
          icon="scan-qr-code"
          tooltip="Read the code with the camera"
          @click="emit('scan')"
        />
        <Button
          text="Connect"
          accent
          :loading="busy"
          :disabled="
            busy || !parsed || !!badCode || !host.trim() || !portValid || (keyChanged && !confirmed)
          "
          tooltip="Ask the node to let this device in"
          @click="connect"
        />
      </div>
    </template>

    <template v-else>
      <div class="abele-pair__where">
        <div class="abele-pair__where-title">
          <span class="abele-pair__step">3</span>On {{ parsed?.name ?? 'the node' }}, approve this
          device
        </div>
        <p class="abele-pair__text">Run this there and choose this device in the list:</p>
        <div class="abele-pair__command">
          <code>abele-node approve-pair</code>
          <Icon
            icon="copy"
            size="xs"
            tooltip="Copy the command"
            @click="emit('copy', 'abele-node approve-pair')"
          />
        </div>
        <div class="abele-pair__device">
          <Icon :icon="phone ? 'smartphone' : 'laptop'" size="xs" :interactive="false" />
          <span>{{ device }}</span>
          <code v-if="deviceFingerprint">{{ deviceFingerprint }}</code>
        </div>
      </div>
      <div class="abele-pair__waiting" role="status">
        <StatusDot tone="orange" pulse label="Waiting for the node" />
        <span>Waiting for {{ parsed?.name ?? 'the node' }}…</span>
      </div>
      <div class="modal-button-container abele-modal__actions">
        <Button text="Back" tooltip="Use another code" @click="emit('back')" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Connecting this device to AbeleNode. The node prints a pairing code; pasted here, it is read at
// once and what it holds is shown to check: the node's name, where it is, its key. Connect asks the
// node, and the owner lets the device in there, choosing it by the name shown here. The dialog
// closes itself once the node agrees.
import { computed, ref, watch } from 'vue'
import { Platform, setTooltip } from 'obsidian'
import Input from '../obsidian/Input.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Setting from '../obsidian/Setting.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import type { PairingCode } from './types'

const props = withDefaults(
  defineProps<{
    step: 'paste' | 'waiting'
    /** Reads a pasted code, or says what is wrong with it. */
    parse: (text: string) => PairingCode | { error: string } | null
    /** This device's name, as the node will list it. */
    device: string
    /** Set when the node did not answer, or answered no. */
    error?: string
    /** The node is known to this device under another key. */
    keyChanged?: boolean
    /** A code to start with. */
    initial?: string
    busy?: boolean
    deviceFingerprint?: string
    canScan?: boolean
  }>(),
  {
    error: undefined,
    keyChanged: false,
    initial: '',
    busy: false,
    deviceFingerprint: undefined,
    canScan: true,
  }
)

const emit = defineEmits<{
  /** The code, and where to reach the node: what the code says, or what was typed over it. */
  (e: 'connect', text: string, at: { host: string; port: number }): void
  (e: 'scan'): void
  (e: 'back'): void
  (e: 'copy', text: string): void
}>()

const phone = Platform.isPhone
const text = ref(props.initial)
const confirmed = ref(false)
watch(text, () => {
  confirmed.value = false
})
const result = computed(() => (text.value.trim() ? props.parse(text.value.trim()) : null))
const parsed = computed(() => (result.value && !('error' in result.value) ? result.value : null))
// A code that cannot be read; a node that did not answer is said under the fields instead,
// so the address can be changed right there.
const badCode = computed(() => (result.value && 'error' in result.value ? result.value.error : ''))
// The address the error is about; editing it away hides the error.
const tried = ref(props.error && parsed.value ? `${parsed.value.host}:${parsed.value.port}` : '')
// A node that did not answer is said on the address it was asked at, until that is changed.
const hostError = computed(() =>
  !host.value.trim()
    ? 'Where the node is: a name or an IP address.'
    : props.error && tried.value === `${host.value.trim()}:${port.value.trim()}`
      ? props.error
      : undefined
)
function connect() {
  tried.value = `${host.value.trim()}:${port.value.trim()}`
  emit('connect', text.value, { host: host.value.trim(), port: Number(port.value) })
}
const host = ref('')
const port = ref('')
const reset = () => {
  host.value = parsed.value?.host ?? ''
  port.value = parsed.value ? String(parsed.value.port) : ''
}
// A new code fills the address and port again; edits stay until the code changes.
watch(() => parsed.value && `${parsed.value.host}:${parsed.value.port}`, reset, { immediate: true })
const portValid = computed(
  () => /^\d{1,5}$/.test(port.value.trim()) && Number(port.value) > 0 && Number(port.value) < 65536
)
const shortExpiry = computed(() => {
  return (
    parsed.value?.expiresShort ??
    `${parsed.value?.expires.match(/^(\d+) (?:more )?minutes?/i)?.[1] ?? '10'} min`
  )
})
const expiresEl = ref<HTMLElement>()
const keyEl = ref<HTMLElement>()
const nameEl = ref<HTMLElement>()
watch(
  [nameEl, expiresEl, keyEl, parsed],
  () => {
    // The node's id is for telling two nodes of one name apart: under the pointer, not in the card.
    if (nameEl.value)
      setTooltip(nameEl.value, parsed.value?.nodeId ? `Node ID ${parsed.value.nodeId}` : '')
    if (expiresEl.value) setTooltip(expiresEl.value, `Valid until ${parsed.value?.expires ?? ''}`)
    if (keyEl.value)
      setTooltip(
        keyEl.value,
        'The node key. The node printed the same one; check it group by group.'
      )
  },
  { flush: 'post' }
)
const groups = computed(() => parsed.value?.fingerprint.match(/.{1,4}/g) ?? [])
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
  gap: var(--size-4-2);

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
// The step number as a small round mark, so the places read as an order, not as a list.
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
.abele-pair__code-field textarea {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
}
.abele-pair__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}
// The code read out: the node as a card, its glyph beside a column of name and key.
.abele-pair__card {
  display: flex;
  gap: var(--size-4-3);
  padding: var(--size-4-3);
  border-radius: var(--radius-m);
  background-color: var(--background-secondary);
}
.abele-pair__card-icon {
  display: flex;
  flex: 0 0 auto;
  align-self: flex-start;
  align-items: center;
  // As tall as the name's line, so the glyph sits beside the name, not in the card's middle.
  height: calc(var(--font-ui-medium) * var(--line-height-normal));
  color: var(--icon-color);

  .abele-obsidian-icon {
    padding: 0;
    --icon-size: var(--icon-m);
  }
}
.abele-pair__card-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-pair__card-head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-pair__card-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-pair__card-expires {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--size-2-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon {
    padding: 0;
  }
}
// The key in groups of four, four to a row, every group in its column.
.abele-pair__key {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  justify-content: start;
  gap: var(--size-2-2) var(--size-4-3);
  color: var(--text-muted);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;
}
.abele-pair__code-field textarea {
  word-break: break-all;
}
.abele-pair__device {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);

  .abele-obsidian-icon {
    padding: 0;
    color: var(--icon-color);
  }
}
.abele-pair__waiting {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
// The fields sit in the step's column, as rows of a settings form.
.abele-pair__setting.setting-item {
  padding-block: var(--size-4-2);
}
.abele-pair .modal-button-container {
  margin-top: var(--size-4-2);
}
</style>
