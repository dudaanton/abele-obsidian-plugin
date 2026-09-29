#!/usr/bin/env node
// Read-only review output. The runtime catalog carries neither hashes nor omitted subjects.
import { generateChangelog } from './changelog.mjs'
let unrecognized = []
const releases = generateChangelog(undefined, {
  onUnrecognized: (items) => {
    unrecognized = items
  },
})
process.stdout.write(JSON.stringify({ releases, unrecognized }, null, 2) + '\n')
