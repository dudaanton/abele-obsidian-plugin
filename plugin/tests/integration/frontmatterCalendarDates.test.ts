import { afterEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { load } from 'js-yaml'
import {
  getNoteRawFrontmatter,
  parseNoteContent,
  updateNoteFrontmatter,
} from '@/helpers/notesUtils'
import { TaskHeader } from '@/entities/TaskHeader'
import { Task } from '@/entities/Task'
import { Log } from '@/entities/Log'
import { Note } from '@/entities/Note'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import { TemplateService } from '@/templates/TemplateService'
import { TransactionNoteTemplate } from '@/templates/TransactionNoteTemplate'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { templateHarness } from '../helpers/templateHarness'
import { taskHarness, TASK_PATH } from '../helpers/taskHarness'

vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>()
  const { dump } = await import('js-yaml')
  return { ...original, stringifyYaml: (value: unknown) => dump(value) }
})

afterEach(() => {
  VaultWatcherWrapper.destroy()
})

const parse = (text: string) => parseNoteContent(new TFile(), text)
const day = '2032-04-05'
const body = '\n\nSample body\n'
const localMidnight = dayjs(`${day}T00:00:00`).toISOString()
const utcMidnight = `${day}T00:00:00Z`
const timestamp = '2032-04-05T18:45:12+02:00'
const localTime = dayjs(timestamp).format('YYYY-MM-DDTHH:mm:ss')

// Run this file with TZ set before starting Vitest: UTC, America/Los_Angeles, Asia/Tokyo.
describe(`calendar dates in ${process.env.TZ ?? 'the local time zone'}`, () => {
  it.each([
    `due: ${day}`,
    `"due": &calendar ${day} # calendar day\ncopy: *calendar`,
    `due: !!timestamp ${day}`,
    `due: '${day}'`,
  ])('reads and rewrites %s without changing the calendar day', async (yaml) => {
    const env = templateHarness([
      { path: 'Notes/sample.md', raw: `---\n${yaml}\ncreated: ${day}\n---\n${body}` },
    ])
    const file = env.app.vault.getFileByPath('Notes/sample.md')!
    const before = await parse(await env.app.vault.read(file))
    expect(before).toMatchObject({ due: day, created: day, content: body })
    if (yaml.includes('copy:')) expect(before.copy).toBe(day)

    await updateNoteFrontmatter(file.path, { extra: true })
    const written = await env.app.vault.read(file)
    expect(await parse(written)).toEqual({ ...before, extra: true })
    expect(load(getNoteRawFrontmatter(written)!)).toMatchObject({ due: day, created: day })
  })

  it.each([timestamp, utcMidnight, localMidnight])(
    'retains the time of %s, including explicit midnight, through an unrelated edit',
    async (value) => {
      const expected = dayjs(value).format('YYYY-MM-DDTHH:mm:ss')
      const env = templateHarness([
        { path: 'Notes/sample.md', raw: `---\nstart: ${value}\ndue: ${day}\n---\n${body}` },
      ])
      const file = env.app.vault.getFileByPath('Notes/sample.md')!
      const before = await parse(await env.app.vault.read(file))
      expect(before).toMatchObject({ start: expected, due: day })
      expect(dayjs(before.start).valueOf()).toBe(dayjs(value).valueOf())
      await updateNoteFrontmatter(file.path, { extra: true })
      expect(await parse(await env.app.vault.read(file))).toEqual({ ...before, extra: true })
    }
  )

  it('does not change the existing YAML reader or nested date values', async () => {
    expect(
      await parse(
        `---\noctal: 012\nquoted: '012'\nflag: yes\nnested:\n  day: ${day}\nlist: [${day}]\n---\nBody`
      )
    ).toEqual({
      octal: 10,
      quoted: '012',
      flag: 'yes',
      nested: { day: new Date(utcMidnight) },
      list: [new Date(utcMidnight)],
      content: 'Body',
    })
  })

  it('loads editor task dates and preserves them through a task template rewrite', async () => {
    const env = taskHarness()
    env.editor.setValue(
      `---\ntype: task\ncreated: ${day}\ndue: ${day}\nstart: ${timestamp}\n---\n${body}`
    )
    const header = new TaskHeader({ id: 'sample', filePath: TASK_PATH })
    try {
      await header.load()
      expect(header.createdAt.format('YYYY-MM-DD')).toBe(day)
      expect(header.due.format('YYYY-MM-DD')).toBe(day)
      const written = new TaskNoteTemplate(env.app).createTemplate({
        oldProps: header.oldProps,
        createdAt: header.createdAt,
        due: header.due,
        content: body,
      })
      expect(await parse(written)).toMatchObject({
        created: day,
        due: day,
        start: localTime,
        content: body,
      })
    } finally {
      header.cleanup()
    }
  })

  it('leaves host-cache dates unchanged for tasks, logs, calendar and timeline models', async () => {
    templateHarness([
      {
        path: 'Tasks/sample.md',
        frontmatter: { type: 'task', created: day, due: day },
        raw: `---\ntype: task\ncreated: ${day}\ndue: ${day}\n---\nSample task`,
      },
      { path: 'Notes/sample-log.md', frontmatter: { type: 'log', created: day } },
    ])
    const task = new Task({ wikilink: '[[Tasks/sample]]' })
    const log = new Log('Notes/sample-log.md')
    const note = new Note('Notes/sample-log.md')
    try {
      await task.load()
      await task.loadContent()
      await log.load()
      await note.load()
      expect(task.createdAt.format('YYYY-MM-DD')).toBe(day)
      expect(task.due.format('YYYY-MM-DD')).toBe(day)
      expect(task.getTaskDate().format('YYYY-MM-DD')).toBe(day)
      expect(task.dates).toEqual([day])
      expect(task.getSortTimestamp()).toBe(dayjs(day).endOf('day').unix())
      expect(log.getLogDateOrToday().format('YYYY-MM-DD')).toBe(day)
      expect(note.getNoteDateOrToday().format('YYYY-MM-DD')).toBe(day)
    } finally {
      task.cleanup()
      log.cleanup()
      note.cleanup()
    }
  })

  it('keeps calendar scalars when a user template merges an overlapping property', async () => {
    const env = templateHarness()
    const template = await env.template(
      `---\nlabels: old\ncreated: ${day}\nstart: ${timestamp}\n---\n${body}`,
      { template_for_labels: 'new' }
    )
    const file = await TemplateService.getInstance().createNoteFromTemplate(template, new Map())
    const written = await env.app.vault.read(file)
    expect(await parse(written)).toMatchObject({
      created: day,
      start: localTime,
      labels: 'new',
      content: body,
    })
    // The merge must not replace a calendar scalar with an explicit UTC datetime.
    expect(load(getNoteRawFrontmatter(written)!)).toMatchObject({ created: new Date(utcMidnight) })
    expect(getNoteRawFrontmatter(written)).toContain(`created: ${day}\n`)
  })

  it('keeps calendar scalars while transaction template properties are merged', async () => {
    const env = templateHarness()
    const template = new TransactionNoteTemplate(env.app)
    // Exercise the merge codec directly without file naming or finance settings.
    const written = (
      template as unknown as {
        setFrontmatterProp(content: string, key: string, value: unknown): string
      }
    ).setFrontmatterProp(`---\ncreated: ${day}\nstart: ${timestamp}\n---\n${body}`, 'extra', true)
    expect(await parse(written)).toMatchObject({
      created: day,
      start: localTime,
      extra: true,
      content: body,
    })
    expect(getNoteRawFrontmatter(written)).toContain(`created: ${day}\n`)
  })
})
