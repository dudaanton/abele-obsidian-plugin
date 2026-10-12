<template>
  <ObsidianModal title="Tasks from Dataview" @close="emit('close')">
    <div class="abele-migrate-dv-modal">
      <Setting
        class="abele-migrate-dv-modal__setting"
        name="Dataview plugin"
        desc="Its ID, if it is installed under another one."
      >
        <Input v-model="dataviewId" placeholder="dataview" />
      </Setting>
      <Setting
        class="abele-migrate-dv-modal__setting"
        name="Which tasks"
        desc="A Dataview TASK query. Each task found becomes a note of its own and leaves a link in its place."
      >
        <Input v-model="query" placeholder='TASK where contains(tags, "#task")' as-text-area />
      </Setting>

      <RunReport
        v-if="processing || completed"
        class="abele-migrate-dv-modal__report"
        :running="processing"
        :percent="percent"
        :status="processing ? processingText : 'Done.'"
        :facts="facts"
      />
      <FoundList
        v-else-if="searching || dvTasks || searchError"
        class="abele-migrate-dv-modal__found"
        icon="list-checks"
        :state="searching ? 'working' : searchError ? 'error' : dvTasks?.length ? 'list' : 'none'"
        working-title="Asking Dataview"
        none-title="No tasks"
        none-text="The query found no task."
        error-title="The query did not run"
        :error-text="searchError"
        :summary="`${dvTasks?.length ?? 0} ${dvTasks?.length === 1 ? 'task' : 'tasks'} would become notes`"
      >
        <EntryRow
          v-for="(task, i) in shownTasks"
          :key="i"
          role="listitem"
          class="abele-migrate-dv-modal__task"
        >
          {{ task.text }}
          <template #meta>
            <span>{{ task.path.replace(/\.md$/, '') }}</span>
          </template>
        </EntryRow>
        <ObsidianButton
          v-if="(dvTasks?.length ?? 0) > shownTasks.length"
          quiet
          class="abele-migrate-dv-modal__more"
          :text="`Show ${(dvTasks?.length ?? 0) - shownTasks.length} more`"
          tooltip="Show every task the query found"
          @click="allTasks = true"
        />
      </FoundList>
    </div>
    <template #footer>
      <ObsidianButton
        :text="dvTasks ? 'Search again' : 'Find the tasks'"
        tooltip="Run the query and list the tasks it finds"
        :accent="!dvTasks?.length"
        :disabled="searching || processing"
        @click="search"
      />
      <ObsidianButton
        v-if="dvTasks?.length && !completed"
        :text="`Make ${dvTasks.length} task ${dvTasks.length === 1 ? 'note' : 'notes'}`"
        tooltip="Make a note of each task and leave a link where it was"
        accent
        :loading="processing"
        :disabled="searching || processing"
        @click="promptProceeding"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { confirmAction } from '@/modal/confirm'
import ObsidianModal from './obsidian/Modal.vue'
import ObsidianButton from './obsidian/Button.vue'
import Setting from './obsidian/Setting.vue'
import Input from './obsidian/Input.vue'
import EntryRow from './obsidian/EntryRow.vue'
import FoundList from './obsidian/FoundList.vue'
import RunReport from './obsidian/RunReport.vue'
import { computed, ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { TFile } from 'obsidian'
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

const searchError = ref('')
const allTasks = ref(false)
const shownTasks = computed(() =>
  allTasks.value ? (dvTasks.value ?? []) : (dvTasks.value ?? []).slice(0, 8)
)

const search = async () => {
  searching.value = true
  processing.value = false
  completed.value = false

  const { app } = GlobalStore.getInstance()

  const dv = (app as any).plugins?.plugins?.[dataviewId.value]

  searchError.value = ''
  dvTasks.value = null
  if (!dv) {
    searchError.value = `No plugin with the ID '${dataviewId.value}' is installed and on.`
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
    searchError.value = e instanceof Error ? e.message : String(e)
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

  const recurrence = extractAndRemove(/🔁\s+([^📅✅⏳]+)/u)
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

const promptProceeding = async () => {
  if (
    await confirmAction(GlobalStore.getInstance().app, {
      title: 'Migrate from Dataview',
      message: 'Do you have backups of your notes? Proceeding will remove tasks from your notes.',
      confirmText: 'Proceed',
      confirmTooltip: 'Create task notes and remove the original tasks',
    })
  ) {
    await createTasksNotes()
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

    console.debug(note)

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

const percent = computed(() => {
  const total = dvTasks.value?.length ?? 0
  return total
    ? Math.round(((processedTasksSuccessfully.value + processedTasksFailed.value) / total) * 100)
    : undefined
})
const facts = computed(() =>
  [
    { label: 'Task notes made', value: processedTasksSuccessfully.value },
    { label: 'Failed', value: processedTasksFailed.value },
  ].filter((fact) => fact.value)
)

const processingText = computed(() => {
  return `Making task notes · ${processedTasksSuccessfully.value + processedTasksFailed.value} of ${
    dvTasks.value?.length || 0
  }`
})

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<style lang="scss">
.abele-migrate-dv-modal__report,
.abele-migrate-dv-modal__found {
  margin-top: var(--size-4-4);
}

.abele-migrate-dv-modal .abele-migrate-dv-modal__more {
  align-self: flex-start;
  margin-top: var(--size-2-2);
}
</style>
