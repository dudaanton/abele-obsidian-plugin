import { pathToWikilink } from '@/helpers/pathsHelpers'
import { reactive } from 'vue'
import { Task } from './Task'
import { TypedEntityList } from './TypedEntityList'

export class TasksList extends TypedEntityList<Task> {
  tasks = this.items
  constructor() {
    super('task', (path) => reactive(new Task({ wikilink: pathToWikilink(path) })) as Task)
  }
}
