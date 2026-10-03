import { pathToWikilink, wikilinkToPath } from '@/helpers/pathsHelpers'
import { GlobalStore } from '@/stores/GlobalStore'
import { normalizePath } from 'obsidian'
import { reactive } from 'vue'
import { Account } from './Account'
import { TypedEntityList } from './TypedEntityList'

export class AccountsList extends TypedEntityList<Account> {
  accounts = this.items
  constructor() {
    super('account', (path) => reactive(new Account({ wikilink: pathToWikilink(path) })) as Account)
  }
  getAccountByWikilink(wikilink: string): Account | null {
    const { app } = GlobalStore.getInstance()
    const file = app.metadataCache.getFirstLinkpathDest(wikilinkToPath(wikilink), '')
    return file ? this.accounts.get(normalizePath(file.path)) || null : null
  }
}
