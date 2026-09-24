<template>
  <Modal title="Choose an icon" size="tall" @close="emit('close')">
    <div ref="root" class="abele-icon-picker" @keydown="onKeydown">
      <Search v-model="query" placeholder="Search icons, e.g. calendar" />

      <EmptyState v-if="!matches.length" :text="`No icon is called anything like “${query}”.`" />

      <div v-else ref="grid" class="abele-icon-picker__scroller">
        <div class="abele-icon-picker__grid">
          <Icon
            v-for="(name, idx) in shown"
            :key="name"
            class="abele-icon-picker__icon"
            :icon="name"
            :tooltip="name"
            :active="idx === cursor"
            @click="emit('choose', name)"
          />
        </div>
        <div v-if="shown.length < matches.length" class="abele-icon-picker__more">
          <Button
            text="Show more"
            :tooltip="`Show the next ${Math.min(PAGE, matches.length - shown.length)} of ${
              matches.length - shown.length
            } icons not drawn yet`"
            @click="pages++"
          />
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { getIconIds } from 'obsidian'
import Modal from './Modal.vue'
import Search from './Search.vue'
import Icon from './Icon.vue'
import Button from './Button.vue'
import EmptyState from './EmptyState.vue'

/**
 * Every icon Obsidian can draw, as a grid to click, narrowed by a search field.
 *
 * The names are Obsidian's own Lucide set with the `lucide-` prefix taken off, which is how a
 * header button stores its icon and how `setIcon` takes it; an icon another plugin added keeps
 * its whole name. The search field keeps the focus throughout: the arrow keys move the pressed
 * tile and Enter takes it, so the grid can be worked without leaving the keyboard.
 */
const props = defineProps<{
  /** The icon chosen so far, pressed when the picker opens. */
  current?: string
}>()

const emit = defineEmits<{
  (e: 'choose', icon: string): void
  (e: 'close'): void
}>()

/**
 * How many tiles are drawn at once. Lucide is over a thousand glyphs, each an SVG; drawing all
 * of them at once is a pause on a phone, and a search narrows to a handful anyway.
 */
const PAGE = 300

const allIcons: string[] = [
  ...new Set(getIconIds().map((id) => (id.startsWith('lucide-') ? id.slice(7) : id))),
].sort((a, b) => a.localeCompare(b))

const query = ref('')
const pages = ref(1)
const cursor = ref(-1)
const root = ref<HTMLElement>()
const grid = ref<HTMLElement>()

/**
 * The icons holding every word typed, those whose name starts with the first word ahead of
 * the rest — `cal` puts `calendar` before `alarm-clock-calendar`. A dash counts as a space.
 */
const matches = computed(() => {
  const words = query.value.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return allIcons
  const found = allIcons.filter((name) => {
    const spaced = name.replace(/-/g, ' ')
    return words.every((word) => spaced.includes(word))
  })
  const leading = (name: string) => (name.startsWith(words[0]) ? 0 : 1)
  return found.sort((a, b) => leading(a) - leading(b) || a.localeCompare(b))
})

const shown = computed(() => matches.value.slice(0, pages.value * PAGE))

/** The current icon's page drawn and its tile pressed, so the picker opens where it is. */
onMounted(() => {
  const at = props.current ? allIcons.indexOf(props.current) : -1
  if (at >= 0) {
    pages.value = Math.floor(at / PAGE) + 1
    cursor.value = at
  }
  root.value?.querySelector('input')?.focus()
  void nextTick(revealCursor)
})

/** A new search starts at its first match, at the top of the grid rather than where it was. */
watch(query, () => {
  pages.value = 1
  cursor.value = matches.value.length ? 0 : -1
  void nextTick(() => {
    if (grid.value) grid.value.scrollTop = 0
  })
})

/**
 * How many tiles make one row, read from where they stand. With nothing laid out every tile
 * stands at the same spot, and a row is then one tile.
 */
const columns = (): number => {
  const tiles = Array.from(
    grid.value?.querySelectorAll<HTMLElement>('.abele-icon-picker__icon') ?? []
  )
  if (tiles.length < 2 || tiles[1].offsetLeft === tiles[0].offsetLeft) return 1
  const rowEnd = tiles.findIndex((tile) => tile.offsetTop !== tiles[0].offsetTop)
  return rowEnd === -1 ? tiles.length : rowEnd
}

const revealCursor = () => {
  const tile = grid.value?.querySelectorAll<HTMLElement>('.abele-icon-picker__icon')[cursor.value]
  tile?.scrollIntoView?.({ block: 'nearest' })
}

const move = (by: number) => {
  if (!shown.value.length) return
  const from = cursor.value < 0 ? 0 : cursor.value
  const to = Math.min(Math.max(from + by, 0), matches.value.length - 1)
  if (to >= shown.value.length) pages.value++
  cursor.value = to
  void nextTick(revealCursor)
}

const onKeydown = (event: KeyboardEvent) => {
  const steps: Record<string, () => number> = {
    ArrowRight: () => 1,
    ArrowLeft: () => -1,
    ArrowDown: () => columns(),
    ArrowUp: () => -columns(),
  }
  const step = steps[event.key]
  if (step) {
    event.preventDefault()
    move(step())
    return
  }
  if (event.key === 'Enter' && !event.isComposing) {
    const name = shown.value[cursor.value]
    if (!name) return
    event.preventDefault()
    emit('choose', name)
  }
}
</script>

<style lang="scss">
.abele-icon-picker {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  flex: 1 1 auto;
  min-height: 0;
}

/**
 * The one scroller in the dialog. Padded by the width of a focus ring and pulled back by as
 * much, so the pressed tile's ring is not cut at the scroller's edge.
 */
.abele-icon-picker__scroller {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-1);
  margin: calc(-1 * var(--size-4-1));
}

/**
 * Tiles large enough to hit with a thumb, as many to a row as fit — never a fixed count, which
 * would either crowd a phone or leave a desktop dialog mostly empty.
 */
.abele-icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-4-12), 1fr));
  gap: var(--size-4-1);
}

.abele-icon-picker__grid .abele-icon-picker__icon {
  justify-content: center;
  min-height: var(--size-4-12);

  .abele-obsidian-icon__icon svg {
    width: var(--icon-l);
    height: var(--icon-l);
  }
}

.abele-icon-picker__more {
  display: flex;
  justify-content: center;
  padding-top: var(--size-4-3);
}
</style>
