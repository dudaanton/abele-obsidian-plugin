/**
 * Synchronous callers need a protocol reply, not the CLI's process exit. Some CLI invocations
 * print the complete answer but keep their output pipe open. This proxy reads a nonce-framed
 * JSON reply, terminates only its CLI child, and exits as soon as that answer is complete.
 */
import { spawn } from 'node:child_process'

const [cli, expected, deadline, ...args] = process.argv.slice(2)
const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
let errors = ''
let finished = false

function finish(status) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  const exit = () => {
    child.stdout.destroy()
    child.stderr.destroy()
    process.stdout.write(output, () => {
      process.stderr.write(errors, () => process.exit(status))
    })
  }
  // 'exit', not 'close': descendants can inherit an output pipe, but the direct CLI child
  // must be reaped before the synchronous caller returns. No helper is left running.
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) exit()
  else {
    child.once('exit', exit)
    child.kill('SIGKILL')
  }
}

function replied() {
  // Logs may contain arrows or JSON. Only the final response with this request's nonce is
  // accepted, and only after its terminating newline and complete JSON have arrived.
  if (!output.endsWith('\n')) return false
  for (const match of output.matchAll(/(?:^|\n)=> /g)) {
    try {
      const reply = JSON.parse(output.slice(match.index + match[0].length).trim())
      if (reply?.__abeleReply === expected) return true
    } catch {
      /* an earlier log or an incomplete response */
    }
  }
  return false
}

// Stay within the caller's existing allowance, including this proxy's own startup time.
const timer = setTimeout(() => finish(124), Math.max(1, Number(deadline) - Date.now() - 25))
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  output += chunk
  if (replied()) finish(0)
})
child.stderr.on('data', (chunk) => {
  errors += chunk
})
child.on('error', (error) => {
  errors += error.message
  finish(127)
})
child.on('close', (status) => finish(status ?? 1))
