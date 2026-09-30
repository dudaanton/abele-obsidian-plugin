/** Real task entities/templates over the shared vault fake, plus an independently edited tab. */
import type { App, TFile } from 'obsidian'
import { dump } from 'js-yaml'
import { useVault } from './testEnv'
import type { FakeFileSpec } from './fakeVault'

export const TASK_PATH = 'Tasks/Water seedlings.md'
export const TASK_BODY = '\nWater seedlings\n\n- [x] Tray one\n- [X] Tray two\n- [ ] Tray three\n'

export function taskHarness(frontmatter: Record<string, unknown> = {}, extra: FakeFileSpec[] = []) {
  const props = { type: 'task', created: '2028-01-01', ...frontmatter }
  const app = useVault([{ path: TASK_PATH, frontmatter: props, content: TASK_BODY }, ...extra])
  const file = app.vault.getFileByPath(TASK_PATH)!
  let text = `---\n${dump(props)}---\n${TASK_BODY}`
  let open = true
  const editor = {
    getValue: () => text,
    setValue: (value: string) => {
      text = value
    },
  }
  const workspace = {
    getLeavesOfType: () => (open ? [{ view: { file, editor } }] : []),
    getActiveViewOfType: () => null,
    openLinkText: () => {},
  }
  Object.assign(app, { workspace })
  return {
    app: app as typeof app & App,
    file,
    editor,
    close: () => {
      open = false
    },
    text: () => text,
    read: (target: TFile = file) => app.vault.read(target),
  }
}

/** A controlled asynchronous boundary, never a sleep or a wall-clock assertion. */
export function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
