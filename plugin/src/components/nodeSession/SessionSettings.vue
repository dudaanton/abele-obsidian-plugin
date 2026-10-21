<template>
  <button
    ref="el"
    type="button"
    class="clickable-icon abele-session-settings"
    :aria-label="facts"
    @click="open"
  >
    <span
      ref="glyph"
      class="abele-session-settings__mode"
      :class="{ 'abele-session-settings__mode_bypass': settings.mode === 'bypass' }"
      aria-hidden="true"
    />
    <span v-if="!phone" class="abele-session-settings__model">{{ said }}</span>
    <ContextMeter v-if="live.context" :context="live.context" />
  </button>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// How the session runs, in one quiet control at the composer's foot: its permission mode as a
// glyph; the model's family in a word; how full the context is,
// as a share that turns orange near the end. The effort and the account are its tooltip. It opens one menu of everything the session can
// be set to, compacting first. On a phone the words go and the glyph and the share stay.
import { computed, onMounted, ref, watch } from 'vue'
import { Menu, Platform, setIcon, setTooltip } from 'obsidian'
import ContextMeter from './ContextMeter.vue'
import {
  MODE,
  tokens,
  type NodeSessionLive,
  type PermissionMode,
  type SessionChoice,
} from './types'

const props = defineProps<{
  live: NodeSessionLive
  /** An answer is under way: a change applies from the next message. */
  busy?: boolean
}>()
const emit = defineEmits<{ compact: [] }>()
const phone = Platform.isPhone

const settings = computed(() => props.live.settings)
const label = (list: SessionChoice[], id: string) => list.find((c) => c.id === id)?.label ?? id
const model = computed(() => label(props.live.choices.models, settings.value.model))
const effort = computed(() => label(props.live.choices.efforts, settings.value.effort))
/** The model's family is enough beside the field, «Opus»: the row is full with the field's own
 *  glyphs, and the effort, which changes seldom, is in the tooltip and the menu. */
const said = computed(() => model.value.split(' ')[0])
const counts = computed(() =>
  props.live.context
    ? t('chat.contextTokens', {
        used: tokens(props.live.context.used),
        limit: tokens(props.live.context.limit),
      })
    : t('chat.notReported')
)
const facts = computed(() =>
  [
    t('chat.modelEffort', { model: model.value, effort: effort.value.toLowerCase() }),
    label(props.live.choices.accounts, settings.value.account),
    `${MODE[settings.value.mode].label}: ${MODE[settings.value.mode].said}`,
    t('chat.context', { value: counts.value }),
  ].join('\n')
)

const el = ref<HTMLElement>()
const glyph = ref<HTMLElement>()
const paint = () => {
  if (glyph.value) setIcon(glyph.value, MODE[settings.value.mode].icon)
  if (el.value) setTooltip(el.value, facts.value, { placement: 'top' })
}
onMounted(paint)
watch([() => settings.value.mode, facts], paint, { flush: 'post' })

/** Opened by a press, or by «/model» and its kin, over the control either way. */
function open(event?: MouseEvent): void {
  const menu = new Menu()
  const { choices } = props.live
  menu.addItem((i) =>
    i
      .setTitle(
        props.live.context
          ? t('chat.compactMenuCount', { value: counts.value })
          : t('chat.compactMenu')
      )
      .setIcon('fold-vertical')
      .setSection('Context')
      .onClick(() => emit('compact'))
  )
  if (props.busy)
    menu.addItem((i) => i.setTitle(t('chat.nextMessage')).setIsLabel(true).setSection('Note'))
  const group = (
    title: string,
    list: SessionChoice[],
    current: string,
    set: (id: string) => void
  ) => {
    menu.addItem((i) => i.setTitle(title).setIsLabel(true).setSection(title))
    for (const c of list)
      menu.addItem((i) =>
        i
          .setTitle(c.unavailable ? `${c.label} · ${c.unavailable}` : c.label)
          .setChecked(c.id === current)
          .setDisabled(!!c.unavailable)
          .setSection(title)
          .onClick(() => set(c.id))
      )
  }
  group(t('chat.model'), choices.models, settings.value.model, (model) =>
    props.live.change({ model })
  )
  group(t('chat.effort'), choices.efforts, settings.value.effort, (effort) =>
    props.live.change({ effort })
  )
  group(t('chat.account'), choices.accounts, settings.value.account, (account) =>
    props.live.change({ account })
  )
  menu.addItem((i) => i.setTitle(t('chat.permissions')).setIsLabel(true).setSection('Permissions'))
  for (const mode of choices.modes ?? (Object.keys(MODE) as PermissionMode[])) {
    const off = mode === 'bypass' && !choices.bypassAllowed
    menu.addItem((i) =>
      i
        .setTitle(off ? t('chat.modeDisabled', { mode: MODE[mode].label }) : MODE[mode].label)
        .setIcon(MODE[mode].icon)
        .setChecked(mode === settings.value.mode)
        .setDisabled(off)
        .setWarning(mode === 'bypass' && !off)
        .setSection('Permissions')
        .onClick(() => props.live.change({ mode }))
    )
  }
  // Over the control that opened it, as from a keyboard as from a press.
  const at = el.value?.getBoundingClientRect()
  if (at) menu.showAtPosition({ x: at.left, y: at.top })
  else if (event) menu.showAtMouseEvent(event)
}
defineExpose({ open })
</script>

<style lang="scss">
// One control of the field's row: glyph, words and share at the size of its other codes.
.abele-session-settings.clickable-icon {
  gap: var(--size-2-2);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-session-settings__mode {
  display: inline-flex;
  flex-shrink: 0;
}
.abele-session-settings__model {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
