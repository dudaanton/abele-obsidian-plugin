<template>
  <ObsidianModal
    :title="t('settings.transfer.TransferSendModal.send_to_another_device.71ef2876')"
    @close="emit('close')"
  >
    <div ref="root" class="abele-transfer-send">
      <!--
        Before the codes, when the sync connection is going with keys: the server is to make a
        device for the other side, and the device list will show it under this name. Asked here,
        at the moment the codes are made, so the device is made once — not on every tick.
      -->
      <template v-if="naming">
        <Setting
          :name="t('settings.transfer.TransferSendModal.name_for_the_other_device.33a35391')"
          :desc="t('settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846')"
        >
          <Input
            :model-value="name"
            :placeholder="t('settings.transfer.TransferSendModal.other_device.76d065a6')"
            @update:model-value="name = $event"
          />
        </Setting>
        <p v-if="busy" class="abele-transfer-send__hint">
          {{ t('settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48') }}
        </p>
      </template>

      <template v-else>
        <div v-if="code" class="abele-transfer-send__code">
          <div class="abele-transfer-send__code-label">
            {{ t('settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7') }}
          </div>
          <div class="abele-transfer-send__code-value">{{ code }}</div>
        </div>

        <!--
          The clipboard refused — a window that is not focused, or one that may not write it —
          so the text is put where it can be selected and copied by hand.
        -->
        <Input
          v-if="uncopied"
          as-text-area
          class="abele-transfer-send__fallback"
          :model-value="text"
        />

        <template v-if="showing && frames.length">
          <QrCode
            :text="frames[index]"
            :label="
              t('settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606', {
                value0: String(index + 1),
                value1: String(frames.length),
              })
            "
          />

          <div v-if="frames.length > 1" class="abele-transfer-send__series">
            <Icon
              icon="chevron-left"
              :tooltip="t('settings.transfer.TransferSendModal.previous_code.9073b55e')"
              @click="step(-1)"
            />
            <span class="abele-transfer-send__counter">{{ index + 1 }} / {{ frames.length }}</span>
            <Icon
              icon="chevron-right"
              :tooltip="t('settings.transfer.TransferSendModal.next_code.2924d04c')"
              @click="step(1)"
            />
            <Icon
              :icon="cycling ? 'pause' : 'play'"
              :tooltip="
                cycling
                  ? t('settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8')
                  : t('settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219')
              "
              @click="cycling = !cycling"
            />
          </div>
        </template>

        <p v-if="note" class="abele-transfer-send__hint">{{ note }}</p>
        <p class="abele-transfer-send__hint">{{ advice }}</p>
      </template>
    </div>
    <!-- The ways it can go, at the window's foot under the code the camera is pointed at; the
         one the screen leads with stands last. -->
    <template #footer>
      <template v-if="naming">
        <Button
          :text="t('settings.transfer.TransferSendModal.make_the_codes.05fce439')"
          accent
          :disabled="busy || !name.trim()"
          :tooltip="
            name.trim()
              ? t('settings.transfer.TransferSendModal.have_the_server_make_the.26277032')
              : t('settings.transfer.TransferSendModal.give_the_other_device_a.62f36130')
          "
          @click="emit('named', name.trim())"
        />
      </template>
      <template v-else>
        <Button
          :text="t('settings.transfer.TransferSendModal.save_a_file.637ed29a')"
          :tooltip="t('settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0')"
          @click="save"
        />
        <Button
          v-if="!showing"
          :text="t('settings.transfer.TransferSendModal.show_the_codes.1eb16a33')"
          :tooltip="
            frames.length === 1
              ? t('settings.transfer.singleQr')
              : t('settings.transfer.multipleQr', { count: frames.length })
          "
          @click="showing = true"
        />
        <Button
          :text="t('settings.transfer.TransferSendModal.copy_the_text.a9c0e598')"
          :accent="!showing"
          :tooltip="t('settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d')"
          @click="copy"
        />
      </template>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { Notice } from 'obsidian'
import { platformClipboard } from '@/secrets/clipboard'
import { platformRoads, saveTransfer, type SavedTo } from '@/transfer/saveFile'
import ObsidianModal from '../../obsidian/Modal.vue'
import QrCode from '../../obsidian/QrCode.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Input from '../../obsidian/Input.vue'
import Setting from '../../obsidian/Setting.vue'
import { GlobalStore } from '@/stores/GlobalStore'

const props = withDefaults(
  defineProps<{
    /** The transfer cut for a camera, one code at a time. */
    frames?: string[]
    /** The same transfer in one piece, for the roads that are not a picture. */
    text?: string
    /** The one-time code, when the transfer carries a key. */
    code?: string
    /** Ask for the other device's name first; the parent makes the codes once it has one. */
    naming?: boolean
    /** The parent is asking the server for the other device. */
    busy?: boolean
    /** Something about what went, said above the advice: the sync connection's fate, today. */
    note?: string
  }>(),
  { frames: () => [], text: '', code: undefined, naming: false, busy: false, note: '' }
)

const emit = defineEmits<{ (e: 'close'): void; (e: 'named', name: string): void }>()

/** GUESS-7: the name offered is a plain one; the person is expected to make it theirs. */
const name = ref('Other device')

const root = useTemplateRef<HTMLElement>('root')
const index = ref(0)

/** Settings can open in a window of their own, and the clipboard and timers are that window's. */
const win = () => root.value?.win ?? window

/**
 * How many codes are still worth pointing a camera at.
 *
 * Past that the QR road stops being the quick one — a real set of settings runs to dozens of
 * codes, and a phone that has no camera in its webview is left photographing them one at a
 * time. So it is offered rather than shown, and the text is what the screen leads with.
 */
const WORTH_PHOTOGRAPHING = 6

const showing = ref(props.frames.length <= WORTH_PHOTOGRAPHING)
const cycling = ref(props.frames.length > 1)

// The codes arrive after the name when there was one to ask for.
watch(
  () => props.frames.length,
  (count) => {
    index.value = 0
    showing.value = count <= WORTH_PHOTOGRAPHING
    cycling.value = count > 1
  }
)

const advice = computed(() => {
  const tail = props.code
    ? t('settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8')
    : ''

  if (props.frames.length === 1)
    return t('settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601', {
      value0: String(tail),
    })
  if (props.frames.length <= WORTH_PHOTOGRAPHING) {
    return t('settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2', {
      count: props.frames.length,
      value1: String(tail),
    })
  }
  return t('settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f', {
    count: props.frames.length,
    value1: String(tail),
  })
})

const step = (by: number) => {
  index.value = (index.value + by + props.frames.length) % props.frames.length
  // Stepping by hand means taking over; carrying on cycling would move the code out from
  // under the camera the reader has just been pointed at.
  cycling.value = false
}

/** Set when the clipboard would not take the text: the text is then shown to select by hand. */
const uncopied = ref(false)

const selectFallback = () => {
  const field = root.value?.querySelector<HTMLTextAreaElement>(
    '.abele-transfer-send__fallback .abele-obsidian-input__base'
  )
  field?.focus()
  field?.select()
}

/**
 * Through Electron's clipboard on the desktop, which does not care whether the window has focus;
 * the page's clipboard refuses an unfocused one, and on a phone that is the only one there is.
 */
const copy = async () => {
  try {
    await platformClipboard(win()).write(props.text)
  } catch (error) {
    console.debug('[Abele] the clipboard would not take the transfer', error)
    uncopied.value = true
    new Notice(t('settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659'))
    await nextTick()
    selectFallback()
    return
  }
  new Notice(t('settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c'))
}

/** What the person is told once the file has gone somewhere. */
const savedLine = (saved: SavedTo): string | null => {
  const open = t('settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07')
  if (saved.road === 'disk')
    return t('settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2', {
      value0: String(saved.path),
      value1: String(open),
    })
  if (saved.road === 'vault') {
    return (
      t('settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d', {
        value0: String(saved.path),
      }) +
      t('settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef', {
        value0: String(open),
      })
    )
  }
  return null
}

/**
 * Never into the vault's own files: a transfer can hold a key locked by a short code, or a live
 * device token, and a sync would carry it to every device and keep it in the server's history.
 * The desktop's save dialog, then the share sheet, then a hidden folder (`saveFile.ts`).
 */
const save = async () => {
  const { app } = GlobalStore.getInstance()
  try {
    const saved = await saveTransfer(
      app,
      props.text,
      `Abele transfer ${stamp()}.txt`,
      platformRoads(win())
    )
    const line = savedLine(saved)
    if (line) new Notice(line)
  } catch (error) {
    new Notice(
      t('settings.transfer.TransferSendModal.could_not_save_it_value.14315a58', {
        value0: String(error instanceof Error ? error.message : error),
      })
    )
  }
}

/** A name with no colons in it, which is what a file name may not have. */
const stamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

let timer: number | null = null

const stop = () => {
  if (timer !== null) win().clearInterval(timer)
  timer = null
}

/**
 * How long each code stays up.
 *
 * Slow enough for a phone to lock onto one and decode it, quick enough that a series of six
 * comes round in a few seconds. A missed code is not a problem — the reader collects whatever
 * it sees and waits for the rest to come round again.
 */
const FRAME_MS = 700

// The element's own window: settings can open in a window of their own, whose timers stop
// when it closes — the main window's would keep firing at a component that is long gone.
watch([cycling, showing, root], () => {
  stop()
  if (!cycling.value || !showing.value || !root.value) return
  timer = win().setInterval(() => {
    index.value = (index.value + 1) % props.frames.length
  }, FRAME_MS)
})

onBeforeUnmount(stop)
</script>

<style lang="scss">
.abele-transfer-send {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-4);
}

.abele-transfer-send .abele-qr {
  // A phone needs a target it can fill its viewfinder with, and the modal is as wide as it is.
  max-width: 20em;
}

.abele-transfer-send__code {
  text-align: center;
}

.abele-transfer-send__code-label {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-transfer-send__code-value {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-large);
  letter-spacing: var(--size-4-1);
  color: var(--text-normal);
}

.abele-transfer-send__series {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-transfer-send__counter {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.abele-transfer-send__fallback .abele-obsidian-input__base {
  font-family: var(--font-monospace);
  word-break: break-all;
}

.abele-transfer-send__hint {
  margin: 0;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
</style>
