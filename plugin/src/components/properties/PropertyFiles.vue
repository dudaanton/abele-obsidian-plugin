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
      @click="change(index)"
    >
      <template #actions>
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
    <Button
      v-if="multiple || cards.length === 0"
      :text="multiple ? 'Add file' : 'Choose file'"
      icon="plus"
      :tooltip="imagesOnly ? 'Pick a picture from the vault' : 'Pick a file from the vault'"
      class="abele-property-files__add"
      @click="add"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A File, Files or cover property drawn as cards: the file's name, what kind it is, and its picture
 * where it has one. Pressing a card picks another file in its place; the arrow opens it, the cross
 * takes it out. Every change goes back as the property's value — a link, or a list of links.
 */
import { computed, reactive, watch } from 'vue'
import type { TFile } from 'obsidian'
import Card from '../obsidian/Card.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
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
  if (entry.url) window.open(entry.url)
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

// A property row is one line tall; the card keeps to a compact version of itself there.
.abele-property-files .abele-property-files__card {
  justify-content: center;
  padding-block: var(--size-4-1);
  padding-inline-start: var(--size-4-2);
  min-height: 0;

  // One line: a long name is cut rather than pushing the arrow and the cross under it, which
  // in the narrow sidebar and on a phone made every card twice as tall.
  .abele-card__head {
    flex-wrap: nowrap;
    align-items: center;
  }

  .abele-card__title {
    flex: 1 1 auto;
    flex-wrap: nowrap;
    min-width: 0;
  }

  &:not(.abele-card_thumbed) {
    padding-inline-end: var(--size-4-2);
  }

  &.abele-card_thumbed {
    min-height: var(--size-4-12);
  }

  .abele-card__name {
    min-width: 0;
    overflow: hidden;
    font-size: var(--metadata-input-font-size, var(--font-ui-small));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .abele-card__actions {
    flex: 0 0 auto;
  }
}

.abele-property-files__add {
  align-self: flex-start;
}

// On a phone, or in the sidebar, the picture takes less of the row, so the name has room to be read.
@container (max-width: 280px) {
  .abele-property-files .abele-card_thumbed.abele-property-files__card {
    padding-inline-end: calc(var(--size-4-9) + var(--size-4-2));
  }

  .abele-property-files .abele-card_thumbed .abele-card__thumbnail {
    width: var(--size-4-9);
  }
}
</style>
