import { evalLong, reloadApp } from './obsidianCli'
import { driver } from './phone'
import { onPhone } from './target'

/** Portable action port. Shared scenario fixtures supply actions and assertions, not device addresses. */
export interface ScenarioHost {
  platform: 'Mac' | 'iPhone'
  evaluate<T>(expression: string): Promise<T>
  evaluatePrivate<T>(expression: string): Promise<T>
  edit(path: string, text: string): Promise<void>
  read(path: string): Promise<string | null>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  open(path: string): Promise<void>
  restart(): Promise<void>
  device(args: string[]): Promise<string>
}
/** Reuses the e2e CLI transport, including its physical-phone branch and envelope checks. */
export function liveScenarioHost(): ScenarioHost {
  const evaluate = async <T>(expression: string): Promise<T> =>
    JSON.parse(await evalLong(`(async () => JSON.stringify(await (${expression})))()`, 60_000)) as T
  const call = async (body: string) => {
    const result = await evalLong(`(async () => { ${body}; return 'ok' })()`, 60_000)
    if (result.trim() !== 'ok') throw new Error('Live scenario action did not complete')
  }
  return {
    platform: onPhone() ? 'iPhone' : 'Mac',
    evaluate,
    evaluatePrivate: async <T>(expression: string): Promise<T> => {
      try {
        return await evaluate<T>(expression)
      } catch {
        throw new Error('Sensitive scenario setup failed')
      }
    },
    edit: (path, text) =>
      call(`const path = ${JSON.stringify(path)}, text = ${JSON.stringify(text)};
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await app.vault.modify(file, text); else {
        const parts = path.split('/').slice(0, -1);
        for (let i=1;i<=parts.length;i++) { const dir=parts.slice(0,i).join('/'); if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir) }
        await app.vault.create(path,text)
      }`),
    read: (path) =>
      evaluate<string | null>(
        `(async () => { const file=app.vault.getAbstractFileByPath(${JSON.stringify(path)}); return file ? await app.vault.read(file) : null })()`
      ),
    rename: (from, to) =>
      call(
        `const file=app.vault.getAbstractFileByPath(${JSON.stringify(from)}); if (!file) throw new Error('Scenario source missing'); await app.fileManager.renameFile(file, ${JSON.stringify(to)})`
      ),
    remove: (path) =>
      call(
        `const file=app.vault.getAbstractFileByPath(${JSON.stringify(path)}); if (!file) throw new Error('Scenario source missing'); await app.vault.delete(file)`
      ),
    open: (path) =>
      call(
        `const file=app.vault.getAbstractFileByPath(${JSON.stringify(path)}); if (!file) throw new Error('Scenario source missing'); await app.workspace.getLeaf(false).openFile(file)`
      ),
    restart: async () => {
      await reloadApp()
    },
    device: async (args) => {
      if (!onPhone()) throw new Error('Physical phone action unavailable on desktop')
      return driver(args)
    },
  }
}
