/**
 * Disposes of every chat session a test changed, when that test ends.
 *
 * A session coalesces its file writes: `markDirty` sets a short timer and the write happens
 * when it fires. A test that ends without closing its session leaves that timer running into
 * the next test — past its stubs, where the chat write reaches the real settings save and
 * throws with no plugin behind it. `tests/setup/pendingWrites.ts` fails such a test; calling
 * this at the top of a file is the cure for files whose sessions are made in many places,
 * some of them inside services.
 *
 * Destroying rather than flushing: the test is over, so its writes have nothing left to prove,
 * and a flush would run against whatever stubs are still in place at that moment.
 */
import { afterAll, afterEach } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'

export function destroyChatsAfterEach(): void {
  const live = new Set<ChatSession>()
  const markDirty = ChatSession.prototype.markDirty
  // Patched by hand rather than with `vi.spyOn`, which a file's own `restoreAllMocks` would
  // take off again in the middle of the file.
  ChatSession.prototype.markDirty = function (this: ChatSession) {
    live.add(this)
    return markDirty.call(this)
  }

  afterEach(() => {
    for (const session of live) session.destroy()
    live.clear()
  })

  afterAll(() => {
    ChatSession.prototype.markDirty = markDirty
  })
}
