/**
 * What opening a group note costs in the real app.
 *
 * The component tier proves each list renders one page; it cannot prove the page is
 * actually cheap, because happy-dom computes no layout. Only a running Obsidian can be
 * asked how long the main thread was unavailable and how much DOM the footer produced.
 *
 * Before paging, `ScaleTest/Notes/Projects.md` on a 43,346-file vault produced 100,984
 * footer elements and a 4,511ms stall, against 477ms spent gathering the underlying
 * relations. Paging brings the same note to 1,452 elements and a ~1.3s stall.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  isObsidianRunning,
  hasTestApi,
  activeVaultName,
  activeVaultFileCount,
} from './helpers/obsidianCli'

const GROUP_NOTE = process.env.OBSIDIAN_TEST_GROUP ?? 'ScaleTest/Notes/Projects.md'

/** How long the probe lets the render settle before reading the DOM. */
const SETTLE_MS = 15_000

/**
 * The element count is the precise guard: it is deterministic (1,452 on every run of this
 * vault) and two orders of magnitude below the 100,984 that unpaged rendering produced, so
 * no machine is fast or slow enough to change the verdict.
 *
 * The stall is a coarse backstop only. Roughly 1.3s of it survives paging and has nothing
 * to do with rendering: `NoteRelations` constructs and loads an entity for every relation
 * it gathers, all 11,489 of them, whether or not any is rendered. The ceiling therefore
 * sits above that floor rather than at a value paging alone could reach.
 */
const MAX_FOOTER_NODES = 5_000
const MAX_STALL_MS = 3_000

interface NoteRenderSample {
  longestStallMs: number
  totalStalledMs: number
  footerNodes: number
  noteRows: number
  logs: number
  taskViews: number
  dateBlocks: number
  markdownBlocks: number
  done: boolean
}

let available = false

/** Polls the probe rather than awaiting it — a promise cannot cross the `eval` boundary. */
async function runRenderProbe(notePath: string): Promise<NoteRenderSample> {
  evalRaw(
    `window.__abeleTest.startNoteRenderProbe(${JSON.stringify(notePath)}, ${SETTLE_MS})`,
    60_000
  )

  const deadline = Date.now() + SETTLE_MS + 60_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))

    const sample = evalJson<NoteRenderSample | null>(
      'window.__abeleTest.noteRenderResult ?? null',
      60_000
    )
    if (sample?.done) return sample
  }

  throw new Error(`Render probe for ${notePath} did not finish within its window`)
}

describe('footer render cost', () => {
  beforeAll(() => {
    available = isObsidianRunning() && hasTestApi()
    if (!available) return

    console.info(
      `\n  vault ...................... ${activeVaultName()}` +
        `\n  files ...................... ${activeVaultFileCount()}` +
        `\n  group note ................. ${GROUP_NOTE}\n`
    )
  })

  it('opens a wide group note without flooding the DOM or stalling the UI', async () => {
    if (!available) {
      console.warn('Obsidian is not running with a development build — skipping')
      return
    }

    const sample = await runRenderProbe(GROUP_NOTE)

    console.info(
      [
        '',
        `  footer elements ............ ${sample.footerNodes}`,
        `  note rows .................. ${sample.noteRows}`,
        `  logs ....................... ${sample.logs}`,
        `  task views ................. ${sample.taskViews}`,
        `  timeline date blocks ....... ${sample.dateBlocks}`,
        `  markdown blocks ............ ${sample.markdownBlocks}`,
        `  longest UI stall ........... ${Math.round(sample.longestStallMs)} ms`,
        `  total stalled .............. ${Math.round(sample.totalStalledMs)} ms`,
        '',
      ].join('\n')
    )

    expect(sample.footerNodes).toBeGreaterThan(0)
    expect(sample.footerNodes).toBeLessThan(MAX_FOOTER_NODES)
    expect(sample.longestStallMs).toBeLessThan(MAX_STALL_MS)
  })

  it('renders one page per list rather than one element per relation', async () => {
    if (!available) {
      console.warn('Obsidian is not running with a development build — skipping')
      return
    }

    const relations = evalJson<{ notes: string[]; logs: string[] }>(
      `(() => { const m = window.__abeleTest.measureNoteRelations(${JSON.stringify(GROUP_NOTE)});
        return { notes: m.notes, logs: m.logs } })()`,
      120_000
    )

    const sample = await runRenderProbe(GROUP_NOTE)

    // The premise: this note must actually have far more relations than a page, otherwise
    // the assertions below would hold even with paging removed.
    expect(relations.notes.length).toBeGreaterThan(200)

    // A page of notes is 50, of logs 20. The window may have grown by a page or two if the
    // sentinel came into view during the settle, so this checks the order of magnitude:
    // rendering is bounded by pages, not by how many relations the group has.
    expect(sample.noteRows).toBeLessThan(relations.notes.length / 4)
    if (relations.logs.length > 100) {
      expect(sample.logs).toBeLessThan(relations.logs.length / 4)
    }
  })
})
