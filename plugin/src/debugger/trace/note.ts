// A note about a recorded run, readable on a phone without the node: what was recorded where,
// the steps in time, each value's shape and first lines, the marks. Every value links to the
// whole of it on the node. Built from what was read, so the same run gives the same note.
import { bytes, since } from '@/components/debugger/trace/format'
import type { WireRun, WireShape } from './wire'

/** Steps described one by one; the timeline lists every step up to its own cap. */
export const NOTE_STEPS = 50
export const NOTE_TIMELINE = 500
const SHAPE_LINES = 30

export interface NoteValue {
  shape?: WireShape
  /** The first lines of the value, formatted. */
  head?: string[]
}

export interface RunNoteInput {
  run: WireRun
  /** `step/name` → what was read of it. */
  values: Map<string, NoteValue>
  link(target: { step?: string; name?: string; path?: string }): string
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function shapeLines(node: WireShape, depth = 0, out: string[] = []): string[] {
  if (out.length >= SHAPE_LINES) return out
  const label = node.key ?? '$'
  const extra = [
    node.count !== undefined ? `${node.count}` : '',
    node.optional ? 'optional' : '',
    node.example ? node.example : '',
  ]
    .filter(Boolean)
    .join(' · ')
  out.push(`${'  '.repeat(depth)}${label}: ${node.type}${extra ? ` · ${extra}` : ''}`)
  for (const c of node.children ?? []) shapeLines(c, depth + 1, out)
  return out
}

const fence = (format: string) => (format === 'number' ? 'text' : format)

export function buildRunNote(input: RunNoteInput): string {
  const { run, values } = input
  const link = (target: Parameters<RunNoteInput['link']>[0]) => input.link(target)
  const r = run.run
  const out: string[] = []
  const ended =
    r.state === 'cut'
      ? 'cut short when the node went away'
      : r.state === 'recording'
        ? 'still recording'
        : 'ended'
  out.push(
    `Recorded run [${cell(r.name)}](${link({})}), started ${r.started_at.replace('T', ' ').slice(0, 19)} UTC, ${run.steps.length} steps, ${ended}.`
  )
  out.push('')

  out.push('## Record points', '')
  if (!run.points.length) out.push('None were set.', '')
  else {
    out.push('| Where | Takes | When | Note | Fired |', '| --- | --- | --- | --- | --- |')
    for (const p of run.points)
      out.push(
        `| \`${cell(p.file)}:${p.line}\` | ${cell(p.take.length ? p.take.join(', ') : 'the frame’s variables')} | ${p.when ? `\`${cell(p.when)}\`` : ''} | ${cell(p.note ?? '')} | ${p.hits} |`
      )
    out.push('')
  }

  out.push('## Timeline', '')
  if (!run.steps.length) out.push('No record point was reached.', '')
  else {
    out.push('| Step | Time | What | Where | Values |', '| --- | --- | --- | --- | --- |')
    for (const s of run.steps.slice(0, NOTE_TIMELINE)) {
      const where = s.place ? `\`${cell(fileName(s.place.file))}:${s.place.line}\`` : (s.host ?? '')
      const vals = s.values
        .map((v) =>
          v.failed
            ? `${v.name} ✕`
            : v.masked
              ? `${v.name} ••••`
              : v.same
                ? `${v.name} =`
                : `${v.name} ${bytes(v.bytes)}`
        )
        .join(', ')
      out.push(
        `| [${s.id}](${link({ step: s.id })}) | ${since(s.at)} | ${cell(s.label)} | ${where} | ${cell(vals)} |`
      )
    }
    if (run.steps.length > NOTE_TIMELINE)
      out.push('', `${run.steps.length - NOTE_TIMELINE} more steps are in the run itself.`)
    out.push('')
  }

  const described = run.steps.slice(0, NOTE_STEPS)
  if (described.length) out.push('## Steps', '')
  for (const s of described) {
    out.push(`### ${s.id} · ${cell(s.label)}`, '')
    const facts = [
      s.place
        ? `\`${s.place.file}:${s.place.line}\`${s.place.fn ? ` in \`${s.place.fn}\`` : ''}`
        : '',
      since(s.at),
      s.paused_ms ? `paused ${Math.round(s.paused_ms)} ms` : '',
    ].filter(Boolean)
    out.push(facts.join(' · '), '')
    for (const v of s.values) {
      const head = `${v.name} · ${v.brief || v.format} · ${bytes(v.bytes)}`
      if (v.failed) {
        out.push(`> [!failure] ${v.name}: not taken`, `> ${cell(v.failed)}`, '')
        continue
      }
      if (v.masked) {
        out.push(`> [!info] ${v.name}: masked before writing`, '')
        continue
      }
      if (v.same) {
        out.push(
          `> [!note] ${v.name}: the same as the last time · [open](${link({ step: s.id, name: v.name })})`,
          ''
        )
        continue
      }
      const read = values.get(`${s.id}/${v.name}`)
      out.push(`> [!abstract]- ${cell(head)} · [open](${link({ step: s.id, name: v.name })})`)
      if (read?.shape) {
        out.push('> ```text')
        for (const l of shapeLines(read.shape)) out.push(`> ${l}`)
        out.push('> ```')
      }
      if (read?.head?.length) {
        out.push(`> \`\`\`${fence(v.format)}`)
        for (const l of read.head) out.push(`> ${l}`)
        out.push('> ```')
      }
      out.push('')
    }
  }
  if (run.steps.length > NOTE_STEPS)
    out.push(
      `The other ${run.steps.length - NOTE_STEPS} steps are in the timeline above and in the run.`,
      ''
    )

  if (run.marks.length) {
    out.push('## Marks', '')
    for (const m of run.marks) {
      const at = [m.step, m.name, m.path].filter(Boolean).join(' · ')
      const tags = m.tags?.length ? ` ${m.tags.map((t) => `#${t}`).join(' ')}` : ''
      out.push(
        `- [${cell(at)}](${link({ step: m.step, name: m.name, path: m.path })}): ${cell(m.comment)}${tags}`
      )
    }
    out.push('')
    const questions = run.marks.filter((m) => m.tags?.includes('question'))
    if (questions.length) {
      out.push('## Questions', '')
      for (const m of questions)
        out.push(
          `- ${cell(m.comment)} ([${m.step}](${link({ step: m.step, name: m.name, path: m.path })}))`
        )
      out.push('')
    }
  }

  out.push('## What happens in this flow', '', '')
  return out.join('\n')
}

/** A link a note can carry to a run, a value, or a path inside one. */
export function traceLink(state: {
  registrationId: string
  projectId: string
  runId: string
  step?: string
  name?: string
  path?: string
}) {
  const q = new URLSearchParams({
    node: state.registrationId,
    project: state.projectId,
    run: state.runId,
    ...(state.step ? { step: state.step } : {}),
    ...(state.name ? { name: state.name } : {}),
    ...(state.path ? { path: state.path } : {}),
  })
  return `obsidian://abele-trace?${q.toString()}`
}
