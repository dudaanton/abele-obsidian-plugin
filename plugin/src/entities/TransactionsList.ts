import { pathToWikilink } from '@/helpers/pathsHelpers'
import { reactive } from 'vue'
import { Transaction } from './Transaction'
import { TypedEntityList } from './TypedEntityList'

export class TransactionsList extends TypedEntityList<Transaction> {
  transactions = this.items
  constructor() {
    super(
      'transaction',
      (path) => reactive(new Transaction({ wikilink: pathToWikilink(path) })) as Transaction
    )
  }
}
