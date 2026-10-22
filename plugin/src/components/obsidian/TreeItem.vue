<template>
  <div
    class="tree-item abele-tree-item"
    :class="{
      'is-collapsed': collapsible && collapsed,
      'abele-tree-item_collapsed': collapsible && collapsed,
      'abele-tree-item_active': active,
      'abele-tree-item_disabled': disabled,
      'abele-tree-item_plain': plain,
      'abele-tree-item_flush': flush,
    }"
  >
    <div
      class="tree-item-self abele-tree-item__self"
      :class="{
        'is-being-renamed': renaming,
        'is-clickable': !inert,
        'mod-collapsible': collapsible,
        'is-active': active,
      }"
      :role="flush ? undefined : 'treeitem'"
      :tabindex="inert ? undefined : 0"
      :aria-expanded="collapsible ? !collapsed : undefined"
      :aria-current="active ? 'true' : undefined"
      :aria-disabled="disabled || undefined"
      :data-path="path"
      :aria-label="label ?? (where ? `${where}/${text}` : undefined)"
      @click="rowClick"
      @keydown.enter="rowKey"
    >
      <div
        v-if="collapsible"
        ref="chevron"
        class="tree-item-icon collapse-icon abele-tree-item__toggle"
        :class="{ 'is-collapsed': collapsed }"
        @click="foldApart && !inert && ($event.stopPropagation(), emit('toggle'))"
      />
      <div class="tree-item-inner abele-tree-item__inner">
        <!-- A choice the row stands for, ahead of its name: a check in a list of what to send. -->
        <span v-if="$slots.leading" class="abele-tree-item__leading" @click.stop
          ><slot name="leading"
        /></span>
        <span v-show="!renaming" ref="glyph" class="abele-tree-item__glyph" aria-hidden="true" />
        <span v-if="where && !renaming" class="abele-tree-item__named">
          <span class="abele-tree-item__text">{{ text }}</span>
          <!-- Cut from its start, so the folder nearest the file is what stays. -->
          <span class="abele-tree-item__where"
            ><bdi dir="ltr">{{ where }}</bdi></span
          >
        </span>
        <span
          v-else-if="renaming"
          ref="editor"
          class="abele-tree-item__text"
          contenteditable="plaintext-only"
          role="textbox"
          :aria-label="label || text"
          spellcheck="false"
          @click.stop
          @keydown="renameKey"
          @blur="finishRename"
          >{{ renameText }}</span
        >
        <span v-else class="abele-tree-item__text">{{ text }}</span>
        <span v-if="note && !renaming" class="abele-tree-item__note">{{ note }}</span>
      </div>
      <div
        v-if="!renaming && (flair || $slots.actions || $slots.end)"
        class="tree-item-flair-outer"
      >
        <span v-if="flair" class="tree-item-flair abele-tree-item__flair">{{ flair }}</span>
        <!-- Codes that are always there: a state dot, a kind of change. -->
        <span v-if="$slots.end" class="abele-tree-item__end"><slot name="end" /></span>
        <!-- Shown while the row is pointed at or focused; always on a phone, which cannot point. -->
        <span v-if="$slots.actions" class="abele-tree-item__actions"><slot name="actions" /></span>
      </div>
    </div>
    <div v-if="collapsible && !collapsed && $slots.default" class="tree-item-children">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

/**
 * One row of a tree, drawn with Obsidian's own tree classes — the file explorer's, the outline's —
 * so indentation, hover, the active row and the collapse arrow are the theme's. Its children go in
 * the default slot, shown while it is open.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** A glyph before the name: `folder`, `file`. */
    icon?: string
    /** Muted text at the row's end: a size, a count. */
    flair?: string
    /** Faint text after the name, cut short when the row is narrow: where a file lies. */
    note?: string
    /**
     * Where a file lies, its folder path: a faint line of its own under the name, as Obsidian's
     * quick switcher puts it. Beside the name, both broke into syllables in a narrow pane.
     */
    where?: string
    /** The row in words, where its glyph and faintness already say it: its tooltip. */
    label?: string
    /** The row stands for what is shown now. */
    active?: boolean
    /** Has children to fold: draws the arrow, and shows the default slot while open. */
    collapsible?: boolean
    collapsed?: boolean
    /** Carried as `data-path`, for finding the row again. */
    path?: string
    /**
     * A row that is only read — a list of files a question is about: no hover, no tab stop, no
     * click. Without it every row is one more stop for the keyboard on the way to the buttons.
     */
    plain?: boolean
    /**
     * A line of a flat list a window reports — not a branch of a tree: it starts at the list's
     * edge, with no room kept for an arrow or a glyph it does not have.
     */
    flush?: boolean
    /** Seen but not open now: faint, no hover, no tab stop, no click. */
    disabled?: boolean
    /**
     * The arrow folds and the row does something else, as a heading in the outline jumps to its
     * place: the arrow then sends `toggle` instead of the row's `click`.
     */
    foldApart?: boolean
    renaming?: boolean
  }>(),
  {
    icon: undefined,
    note: undefined,
    where: undefined,
    label: undefined,
    flair: undefined,
    active: false,
    collapsible: false,
    collapsed: false,
    path: undefined,
    plain: false,
    flush: false,
    disabled: false,
    foldApart: false,
  }
)

const inert = computed(() => props.plain || props.disabled)

const emit = defineEmits<{
  /** The row was clicked, or Enter pressed on it; the event says which modifier keys were held. */
  click: [event: MouseEvent]
  /** The arrow was clicked, on a row that folds apart from its click. */
  toggle: []
  rename: [name: string]
  'rename-cancel': []
}>()
const editor = ref<HTMLElement>()
const renameText = ref(props.text)
let renameFinished = false
const finishRename = () => {
  if (renameFinished) return
  renameFinished = true
  const name = editor.value?.textContent?.trim()
  if (name) emit('rename', name)
  else emit('rename-cancel')
}
const cancelRename = () => {
  if (renameFinished) return
  renameFinished = true
  emit('rename-cancel')
}
// The host's document keymap handles Enter before an editable row hears it.
// Capture only this editor's keys, as the chat find field does.
const renameKey = (event: KeyboardEvent) => {
  if (event.target !== editor.value || event.isComposing) return
  if (event.key !== 'Enter' && event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Enter') finishRename()
  else cancelRename()
}
let renameWindow: Window | null = null
const detachRenameKey = () => renameWindow?.removeEventListener('keydown', renameKey, true)
watch(
  editor,
  (element) => {
    detachRenameKey()
    renameWindow = element?.ownerDocument.defaultView ?? null
    renameWindow?.addEventListener('keydown', renameKey, true)
  },
  { flush: 'post' }
)
onBeforeUnmount(detachRenameKey)
watch(
  () => props.renaming,
  async (editing) => {
    if (!editing) return
    renameFinished = false
    renameText.value = props.text
    await nextTick()
    editor.value?.focus()
    if (editor.value) {
      const range = editor.value.ownerDocument.createRange()
      range.selectNodeContents(editor.value)
      const selection = editor.value.ownerDocument.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  },
  { immediate: true }
)

/** Enter on a focused row is a click, with the keys the keyboard event held. */
const keyClick = (e: KeyboardEvent) =>
  new MouseEvent('click', {
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
  })

/** A control in the row's actions is its own: its click and its Enter never navigate the row. */
const fromAction = (e: Event) =>
  e.target instanceof Element && !!e.target.closest('.abele-tree-item__actions')

const rowClick = (e: MouseEvent) => {
  if (!props.renaming && !inert.value && !fromAction(e)) emit('click', e)
}

/** Enter navigates only from the row itself; on a child control it stays that control's. */
const rowKey = (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return
  e.preventDefault()
  if (!inert.value) emit('click', keyClick(e))
}

const chevron = ref<HTMLElement>()
const glyph = ref<HTMLElement>()

const draw = () => {
  if (chevron.value && !chevron.value.firstChild) setIcon(chevron.value, 'right-triangle')
  if (glyph.value) {
    glyph.value.replaceChildren()
    if (props.icon) setIcon(glyph.value, props.icon)
  }
}
onMounted(draw)
watch(() => [props.icon, props.collapsible], draw, { flush: 'post' })
</script>

<style lang="scss">
.abele-tree-item__text[contenteditable] {
  flex: 1 1 auto;
  min-width: 0;
  outline: none;
}
// A row that is only read does not answer the pointer: Obsidian brightens a row's flair on hover,
// which on a row with nothing to press reads as an invitation to click.
.abele-tree-item_plain > .abele-tree-item__self:hover .tree-item-flair,
.abele-tree-item_disabled > .abele-tree-item__self:hover .tree-item-flair {
  color: var(--text-faint);
}
.abele-tree-item__inner {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  min-width: 0;
}

// A row keeps its weight under the pointer. Obsidian's rows take another weight on hover, which
// knocks a bold heading back to normal and makes the text jump; a row that should be bold says so
// with `--abele-tree-item-weight`, and the hover keeps it.
.abele-tree-item__self {
  // A row the keyboard brings to the edge of its list stops short of it, so its focus ring shows whole.
  scroll-margin-block: var(--size-4-1);
  --abele-tree-item-weight: var(--nav-item-weight);
  font-weight: var(--abele-tree-item-weight);
}
body:not(.is-grabbing) .abele-tree-item__self.is-clickable:hover {
  font-weight: var(--abele-tree-item-weight);
}

.abele-tree-item__glyph {
  display: flex;
  align-items: center;
  height: 1lh;
  flex: 0 0 auto;
  color: var(--icon-color);
  opacity: var(--icon-opacity);
  width: var(--icon-xs);

  .svg-icon {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-xs-stroke-width);
  }
}

// A row with a check and no glyph starts its name right after the check.
.abele-tree-item__leading + .abele-tree-item__glyph:empty {
  display: none;
}

.abele-tree-item_flush > .abele-tree-item__self {
  padding-inline-start: 0;

  .abele-tree-item__glyph:empty {
    display: none;
  }
}

.abele-tree-item__leading {
  display: flex;
  align-items: center;
  height: 1lh;
  flex: 0 0 auto;

  input[type='checkbox'] {
    margin: 0;
  }
}

.abele-tree-item_disabled > .abele-tree-item__self {
  color: var(--text-faint);
  cursor: default;

  .abele-tree-item__glyph {
    color: var(--text-faint);
  }
}

.abele-tree-item__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.abele-tree-item__note {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--abele-text-meta-color);
  font-size: var(--abele-text-meta-size);
  overflow-wrap: anywhere;
}
// A file and where it lies: the name on its line, the path under it, each cut short rather than
// broken, the way the file explorer keeps a name to one line.
.abele-tree-item__inner:has(> .abele-tree-item__named) {
  flex: 1 1 auto;
}
.abele-tree-item__named {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;

  > .abele-tree-item__text,
  > .abele-tree-item__where {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
.abele-tree-item__where {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
  // The ellipsis at the start: the folders every file shares go first, the one it is in stays.
  direction: rtl;
  text-align: left;
}
.abele-tree-item__inner:has(.abele-tree-item__note) {
  flex: 1 1 auto;
  align-items: baseline;
}
// The glyph has no text to give a baseline, so it keeps to the top of the name's first line,
// the line the codes at the row's end are measured against.
.abele-tree-item__inner:has(.abele-tree-item__note) > .abele-tree-item__glyph,
.abele-tree-item__inner:has(.abele-tree-item__note) > .abele-tree-item__leading {
  align-self: flex-start;
}

.abele-tree-item__end {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);

  // A code is drawn bare; a glyph that opens something keeps Obsidian's whole button box, its
  // height taken back by a margin so the row does not grow.
  .abele-obsidian-icon:not(.clickable-icon) {
    padding: 0;
  }
  .abele-obsidian-icon.clickable-icon {
    margin-block: calc(-1 * var(--size-2-2));
  }
}

// What stands at the row's end — a count, a dot, a glyph, the hover actions — lines up with the
// first line of the name, not with the middle of a row the name has wrapped onto two lines: the
// row aligns to its top, and the end is one text line tall with its contents centred in it.
.abele-tree-item__self {
  align-items: flex-start;
}
.abele-tree-item__self > .tree-item-flair-outer {
  display: flex;
  align-self: flex-start;
  align-items: center;
  height: 1lh;
  font-size: inherit;
  line-height: inherit;
}
// A phone's row reaches the touch size by its padding, so a name on one line is still centred.
body.is-phone .abele-tree-item__self {
  padding-block: max(var(--size-4-1), calc((var(--touch-size-m) - 1lh) / 2));
}

.abele-tree-item__self .tree-item-flair {
  white-space: nowrap;
}

.abele-tree-item__actions {
  display: flex;
  visibility: hidden;

  .abele-tree-item__self:hover &,
  .abele-tree-item__self:focus-within &,
  body.is-phone & {
    visibility: visible;
  }

  // Obsidian's whole button box, its height taken back by a margin so the row does not grow.
  .abele-obsidian-icon.clickable-icon {
    margin-block: calc(-1 * var(--size-2-2));
    scroll-margin-block: var(--size-2-3);
  }

  // In line on a phone: a step from the count or the date before it.
  body.is-phone & {
    margin-inline-start: var(--size-2-2);
  }
}
// With a pointer the actions take no room until wanted: they come up over the row's end codes
// on hover, so a name is not cut short by buttons nobody sees. A phone shows them always, in line.
body:not(.is-phone) .abele-tree-item__self > .tree-item-flair-outer {
  position: relative;
}
// The row's own light over the pane's colour: solid, so no letters show through the buttons. A
// tree in a dialog or the main area stands on the primary colour, a sidebar's on the secondary.
.abele-tree-item {
  --abele-tree-item-ground: var(--background-secondary);
  --abele-tree-item-tint: var(--nav-item-background-hover);
}
.mod-root .abele-tree-item,
.modal .abele-tree-item {
  --abele-tree-item-ground: var(--background-primary);
}
.abele-tree-item__self.is-active {
  --abele-tree-item-tint: var(--nav-item-background-active);
}
body:not(.is-phone) .abele-tree-item__actions {
  position: absolute;
  inset-inline-end: 0;
  top: 50%;
  translate: 0 -50%;
  border-radius: var(--radius-s);
  background:
    linear-gradient(var(--abele-tree-item-tint), var(--abele-tree-item-tint)),
    var(--abele-tree-item-ground);
}
// A code the buttons take the place of under the pointer: gone while they show, so nothing of it
// peeks out beside them.
body:not(.is-phone)
  .abele-tree-item__self:is(:hover, :focus-within)
  .abele-tree-item__under-actions {
  visibility: hidden;
}
</style>
