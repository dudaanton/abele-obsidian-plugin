<template>
  <div class="abele-property-files" :class="{ 'abele-property-files_list': multiple }">
    <Card
      v-for="(entry, index) in cards"
      :key="`${index}:${entry.value}`"
      :title="entry.title"
      :icon="entry.icon"
      :thumbnail="thumbnails[entry.value]"
      clickable
      class="abele-property-files__card"
      @click="phone ? actionsMenu(index, entry, $event) : change(index)"
    >
      <!-- On a phone the cell is too narrow for a name and two glyphs a finger can hit: the
           card is the name, and a tap offers what the glyphs do. -->
      <template v-if="!phone" #actions>
        <Icon
          v-if="entry.openable"
          icon="arrow-up-right"
          tooltip="Open"
          class="abele-property-files__open"
          @click="open(entry)"
        />
        <Icon
          icon="x"
          tooltip="Remove"
          class="abele-property-files__remove"
          @click="remove(index)"
        />
      </template>
    </Card>
    <!-- Quiet words where the value would be, as Obsidian's own "Empty", not a filled button. -->
    <button
      v-if="multiple || cards.length === 0"
      type="button"
      class="abele-property-files__add"
      :aria-label="imagesOnly ? 'Pick a picture from the vault' : 'Pick a file from the vault'"
      @click="add"
    >
      {{
        cards.length
          ? 'Add file'
          : imagesOnly
            ? 'Choose a picture'
            : multiple
              ? 'Add file'
              : 'Choose file'
      }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { openExternal } from '@/helpers/openExternal'
/**
 * A File, Files or cover property drawn as cards: the file's name, what kind it is, and its picture
 * where it has one. Pressing a card picks another file in its place; the arrow opens it, the cross
 * takes it out. Every change goes back as the property's value — a link, or a list of links.
 */
import { computed, reactive, watch } from 'vue'
import { Menu, Platform, type TFile } from 'obsidian'
import Card from '../obsidian/Card.vue'
import Icon from '../obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { isExternalSource, resolveVaultFile } from '@/helpers/resourceUrl'
import { pickAnyFile } from '@/helpers/suggesters/VaultFilePicker'
import { KIND_ICONS, fileKind, linkTarget, withEntry, withoutEntry } from '@/properties/values'
import { thumbnailOf } from '@/properties/thumbnails'

const props = defineProps<{
  entries: string[]
  sourcePath: string
  /** A list of files rather than one. */
  multiple?: boolean
  /** Only pictures are offered: a cover. */
  imagesOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', entries: string[]): void
}>()

const app = GlobalStore.getInstance().app

interface Entry {
  value: string
  title: string
  icon: string
  file: TFile | null
  url: string | null
  openable: boolean
}

const cards = computed<Entry[]>(() =>
  props.entries.map((value) => {
    const target = linkTarget(value) ?? value
    if (isExternalSource(target))
      return { value, title: target, icon: 'link', file: null, url: target, openable: true }
    const file = resolveVaultFile(target, props.sourcePath)
    if (!file)
      return { value, title: target, icon: 'file-question', file, url: null, openable: false }
    const kind = fileKind(file.extension)
    return {
      value,
      title: kind === 'note' ? file.basename : file.name,
      icon: KIND_ICONS[kind],
      file,
      url: null,
      openable: true,
    }
  })
)

const thumbnails = reactive<Record<string, string | undefined>>({})

watch(
  cards,
  (list) => {
    for (const entry of list) {
      if (entry.url) thumbnails[entry.value] = entry.url
      else if (entry.file) {
        const value = entry.value
        void thumbnailOf(app, entry.file).then((url) => {
          thumbnails[value] = url ?? undefined
        })
      }
    }
  },
  { immediate: true }
)

const accepts = (file: TFile) => !props.imagesOnly || fileKind(file.extension) === 'image'

/** A link to the file the way a property keeps one: a wikilink, so a move updates it. */
const linkTo = (file: TFile) =>
  `[[${app.metadataCache.fileToLinktext(file, props.sourcePath, true)}]]`

const pick = () => pickAnyFile(app, accepts)

const phone = Platform.isPhone

function actionsMenu(index: number, entry: Entry, event: MouseEvent | KeyboardEvent) {
  const menu = new Menu()
  if (entry.openable)
    menu.addItem((item) =>
      item
        .setTitle('Open')
        .setIcon('arrow-up-right')
        .onClick(() => void open(entry))
    )
  menu.addItem((item) =>
    item
      .setTitle(props.imagesOnly ? 'Choose another picture' : 'Choose another file')
      .setIcon('replace')
      .onClick(() => void change(index))
  )
  menu.addItem((item) =>
    item
      .setTitle('Remove')
      .setIcon('x')
      .setWarning(true)
      .onClick(() => remove(index))
  )
  if (event instanceof MouseEvent) menu.showAtMouseEvent(event)
  else {
    const r = (event.target as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: r.left, y: r.bottom })
  }
}

async function change(index: number) {
  const file = await pick()
  if (!file) return
  const next = [...props.entries]
  next[index] = linkTo(file)
  emit('change', next)
}

async function add() {
  const file = await pick()
  if (!file) return
  emit('change', props.multiple ? withEntry(props.entries, linkTo(file)) : [linkTo(file)])
}

function remove(index: number) {
  emit('change', withoutEntry(props.entries, index))
}

function open(entry: Entry) {
  if (entry.url) openExternal(entry.url)
  else if (entry.file) void app.workspace.getLeaf(false).openFile(entry.file)
}
</script>

<style lang="scss">
// The value cell of a property row is a flex row; the cards take all of it.
.abele-property-widget {
  flex: 1 1 auto;
  min-width: 0;
}

.abele-property-files {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  width: 100%;
  padding: var(--size-4-1) 0;
  container-type: inline-size;
}

// A file in a property reads as a link does in Obsidian's own property values: one quiet line,
// no box around it. A picture is a small square at the start of the line in place of the icon,
// the open and remove glyphs come under the pointer. A boxed card with the picture pinned to its
// corner looked like a pasted-in widget.
.abele-property-files .abele-property-files__card {
  position: relative;
  min-height: 0;
  padding: var(--size-2-1) var(--size-2-3);
  margin-inline: calc(-1 * var(--size-2-3));
  border: none;
  border-radius: var(--radius-s);
  background: none;
  box-shadow: none;

  &:hover {
    background-color: var(--abele-hover-background);
  }

  .abele-card__head {
    flex-wrap: nowrap;
    align-items: center;
  }

  .abele-card__title {
    flex: 1 1 auto;
    flex-wrap: nowrap;
    align-items: center;
    min-width: 0;
  }

  .abele-card__name {
    min-width: 0;
    overflow: hidden;
    font-size: var(--metadata-input-font-size, var(--font-ui-small));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.abele-card_thumbed {
    padding-inline-start: calc(var(--size-2-3) + var(--size-4-6) + var(--size-4-2));

    .abele-card__icon {
      display: none;
    }

    > .abele-card__thumbnail {
      position: absolute;
      top: 50%;
      inset-inline-start: var(--size-2-3);
      width: var(--size-4-6);
      height: var(--size-4-6);
      transform: translateY(-50%);
      border-radius: var(--radius-s);
      object-fit: cover;
    }
  }

  .abele-card__actions {
    flex: 0 0 auto;
    visibility: hidden;
  }

  &:hover .abele-card__actions,
  &:focus-within .abele-card__actions {
    visibility: visible;
  }
}

.abele-property-files .abele-property-files__add {
  align-self: flex-start;
  height: auto;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  color: var(--text-faint);
  font-size: var(--metadata-input-font-size, var(--font-small));
  font-weight: var(--font-normal);
  cursor: var(--cursor);

  &:hover,
  &:focus-visible {
    color: var(--text-muted);
    background: none;
  }
}
</style>
