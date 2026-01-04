<template>
  <ObsidianModal title="Migrate from Dataview" @close="emit('close')">
    <div class="abele-migrate-dv-modal">
      <div class="abele-migrate-dv-modal__description"></div>
      <Setting
        class="abele-migrate-dv-modal__setting"
        name="Dataview ID"
        desc="The ID of the Dataview plugin instance to migrate from."
      >
        <Input v-model="dataviewId" placeholder="'dataview' by default" />
      </Setting>
      <Setting
        class="abele-migrate-dv-modal__setting"
        name="Tasks query"
        desc="The Dataview query to find tasks to migrate."
      >
        <Input v-model="query" placeholder='e.g. TASK where contains(tags, "#task")' as-text-area />
      </Setting>
      <div class="abele-migrate-dv-modal__buttons">
        <ObsidianButton
          text="Search for tasks"
          accent
          :disabled="searching || processing"
          @click="search"
        />
        <ObsidianButton
          v-if="dvTasks"
          :disabled="searching || processing"
          text="Create tasks notes and remove tasks"
          @click="promptProceeding"
        />
        <div v-if="processing" class="abele-migrate-dv-modal__count">{{ processingText }}</div>
        <div v-else-if="completed" class="abele-migrate-dv-modal__count">Completed!</div>
        <div v-else-if="dvTasks" class="abele-migrate-dv-modal__count">
          {{ dvTasks.length }} results
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import { computed, ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { Notice, TFile } from 'obsidian'
import { createTask } from '@/commands/createTask'
import { createTaskEmbedded, getRecurrentTaskTitle } from '@/helpers/tasksUtils'
import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { extractDateFromFilename } from '@/helpers/datesHelper'

interface Position {
  start: {
    col: number
    line: number
    offset: number
  }
  end: {
    col: number
    line: number
    offset: number
  }
}

interface DVTask {
  text: string
  path: string
  position: Position
}

interface ParsedTask {
  text: string
  tags: string[]
  recurrence: string | null
  due: string | null
  completedAt: string | null
  scheduled: string | null
}

const dataviewId = ref('dataview')
const query = ref('TASK where contains(tags, "#task")')
const dvTasks = ref<DVTask[] | null>(null)

const searching = ref(false)
const processing = ref(false)
const completed = ref(false)

const search = async () => {
  searching.value = true
  processing.value = false
  completed.value = false

  const { app } = GlobalStore.getInstance()

  const dv = (app as any).plugins?.plugins?.[dataviewId.value]

  if (!dv) {
    new Notice(`Dataview plugin with ID '${dataviewId.value}' not found.`)
    searching.value = false
    return
  }

  try {
    const res = await dv.api.query(query.value)
    if (res.error) throw res.error

    const tasks = res.value?.values
    if (!tasks || !Array.isArray(tasks) || !tasks[0].task)
      throw new Error('No tasks found in the query result.')

    dvTasks.value = tasks
  } catch (e) {
    new Notice('Error executing Dataview query. Check the console for details.')
    console.error(e)
  }

  searching.value = false
}

// const removeTextAtPosition = (content: string, position: Position): string => {
//   const start = position.start.offset
//   let end = position.end.offset
//
//   if (content.startsWith('\r\n', end)) {
//     end += 2
//   } else if (content.startsWith('\n', end)) {
//     end += 1
//   }
//
//   return content.slice(0, start) + content.slice(end)
// }

const replaceTextAtPosition = (
  content: string,
  replacement: string,
  position: Position
): string => {
  const start = position.start.offset
  let end = position.end.offset

  // if (content.startsWith('\r\n', end)) {
  //   end += 2
  // } else if (content.startsWith('\n', end)) {
  //   end += 1
  // }

  return content.slice(0, start) + replacement + content.slice(end)
}

const parseTask = (line: string): ParsedTask => {
  let text = line
  const tags: string[] = []

  const tagRegex = /#([\w-]+)/g
  text = text.replace(tagRegex, (_, tag) => {
    tags.push(tag)
    return ''
  })

  const extractAndRemove = (regex: RegExp): string | null => {
    const match = text.match(regex)
    if (match && match[1]) {
      text = text.replace(match[0], '')
      return match[1].trim()
    }
    return null
  }

  const recurrence = extractAndRemove(/🔁\s+([^📅✅⏳]+)/)
  const due = extractAndRemove(/📅\s+(\d{4}-\d{2}-\d{2})/)
  const completedAt = extractAndRemove(/✅\s+(\d{4}-\d{2}-\d{2})/)
  const scheduled = extractAndRemove(/⏳\s+(\d{4}-\d{2}-\d{2})/)

  return {
    text: text.trim().replace(/\s{2,}/g, ' '),
    tags,
    recurrence,
    due,
    completedAt,
    scheduled,
  }
}

const promptProceeding = () => {
  if (confirm('Do you have backups of your notes? Proceeding will remove tasks from your notes.')) {
    createTasksNotes()
  }
}

const processedTasksSuccessfully = ref(0)
const processedTasksFailed = ref(0)

const createTasksNotes = async () => {
  if (!dvTasks.value) return

  const tasks = [...dvTasks.value]

  tasks.sort((a, b) => {
    // offset biggest to smallest
    return b.position.start.offset - a.position.start.offset
  })

  completed.value = false
  processing.value = true
  processedTasksSuccessfully.value = 0
  processedTasksFailed.value = 0

  const { app } = GlobalStore.getInstance()

  for (const task of tasks) {
    const parsedTask = parseTask(task.text)

    const note = app.vault.getAbstractFileByPath(task.path)
    if (!(note instanceof TFile)) {
      processedTasksFailed.value += 1
      continue
    }

    console.log(note)

    const noteCache = app.metadataCache.getFileCache(note)

    if (!noteCache) {
      processedTasksFailed.value += 1
      continue
    }

    let createdAt: dayjs.Dayjs

    if (noteCache.frontmatter?.created) {
      const date = dayjs(noteCache.frontmatter.created, DATE_FORMAT)

      if (date?.isValid()) {
        createdAt = date
      }
    }

    if (!createdAt) {
      const date = extractDateFromFilename(note.basename)

      if (date?.isValid()) {
        createdAt = date
      }
    }

    if (!createdAt) {
      createdAt = dayjs(note.stat.ctime)
    }

    let completedAt: dayjs.Dayjs

    if (parsedTask.completedAt) {
      const date = dayjs(parsedTask.completedAt, DATE_FORMAT)

      if (date?.isValid()) {
        completedAt = date
      }
    }

    let scheduled: dayjs.Dayjs

    if (parsedTask.scheduled) {
      const date = dayjs(parsedTask.scheduled, DATE_FORMAT)

      if (date?.isValid()) {
        scheduled = date
      }
    }

    let due: dayjs.Dayjs

    if (parsedTask.due) {
      const date = dayjs(parsedTask.due, DATE_FORMAT)

      if (date?.isValid()) {
        due = date
      }
    }

    const createdTask = await createTask(
      {
        title: getRecurrentTaskTitle(parsedTask.text),
        createdAt,
        completedAt,
        date: scheduled,
        due,
        recurrence: parsedTask.recurrence,
        content: parsedTask.text,
        oldProps: {
          tags: parsedTask.tags,
        },
      },
      false
    )

    const taskEmbedded = createTaskEmbedded(createdTask.wikilink)

    const fileContent = await app.vault.adapter.read(task.path)
    const newContent = replaceTextAtPosition(fileContent, taskEmbedded, task.position)

    await app.vault.adapter.write(task.path, newContent)

    processedTasksSuccessfully.value += 1
  }

  processing.value = false
  completed.value = true
}

const processingText = computed(() => {
  return `Processing... Completed: ${processedTasksSuccessfully.value}/${
    dvTasks.value?.length || 0
  }. Failed: ${processedTasksFailed.value}`
})

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<style lang="scss">
.modal:has(.abele-sar-fm-modal) {
  width: 700px;
}

.abele-sar-fm-modal__description {
  margin-top: calc(var(--p-spacing));
  margin-bottom: calc(var(--p-spacing) * 1.5);
}

.abele-migrate-dv-modal__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--p-spacing) / 4);
}

.abele-migrate-dv-modal__setting {
  margin: var(--p-spacing) 0;
}

.abele-migrate-dv-modal__count {
  margin-left: calc(var(--p-spacing) / 2);
  align-self: center;
  color: var(--text-muted);
}
</style>
