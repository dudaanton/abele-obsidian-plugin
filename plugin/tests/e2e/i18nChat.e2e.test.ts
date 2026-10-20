import { describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

const shots = shotDir('i18n-chat')

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'localized chat and session controls',
  () => {
    it.each([
      { locale: 'ru', phone: false, layout: 'desktop' },
      { locale: 'en-XA', phone: false, layout: 'desktop' },
      { locale: 'ru', phone: true, layout: 'phone' },
      { locale: 'en-XA', phone: true, layout: 'phone' },
    ])(
      'shows $locale controls in the real $layout layout',
      async ({ locale, phone }) => {
        async function check() {
          const result = JSON.parse(
            await evalLong(
              `(async () => {
          ${WAIT_PRELUDE}
          const api = window.__abeleTest;
          await api.setTestLocale(${JSON.stringify(locale)});
          const fs = require('fs');
          fs.mkdirSync(${JSON.stringify(shots)}, { recursive: true });
          const win = require('@electron/remote').getCurrentWindow();
          const failures = [];
          const capture = async (name, root) => {
            await new Promise(resolve => setTimeout(resolve, 300));
            const box = root.getBoundingClientRect();
            if (box.left < -1 || box.right > innerWidth + 1 || root.scrollWidth > root.clientWidth + 2)
              failures.push(name + ': horizontal overflow');
            fs.writeFileSync(${JSON.stringify(shots + '/' + locale + (phone ? '-phone-' : '-desktop-'))} + name + '.png', (await win.webContents.capturePage()).toPNG());
          };
          const escape = async () => {
            const modal = document.querySelector('.modal.abele-modal, .abele-close-tab');
            const header = [...(modal?.querySelectorAll('.modal-close-button, .modal-header-button') ?? [])].find(el => el.getBoundingClientRect().width);
            if (header) header.click();
            else if (modal?.classList.contains('abele-modal_footer-dismiss')) {
              const cancel = modal.querySelector('.abele-modal__footer button:not(.mod-cta):not(.mod-warning), .modal-button-container button:not(.mod-cta):not(.mod-warning)');
              if (!cancel) throw Error('No dismiss button in footer');
              cancel.click();
            } else {
              modal?.parentElement?.querySelector('.modal-bg')?.click();
            }
            if (!await until(() => !document.querySelector('.modal.abele-modal, .abele-close-tab'))) throw Error('Dialog did not close: ' + (modal?.querySelector('.modal-title')?.textContent ?? 'unknown'));
          };
          try {
            for (const name of ['selection-history', 'selection-unresolved']) {
              api.openDialog(name);
              const modal = await until(() => document.querySelector('.modal.abele-modal, .abele-close-tab'));
              if (!modal) throw Error(name + ' did not mount');
              try {
                const title = modal.querySelector('.modal-title')?.textContent ?? '';
                if (${JSON.stringify(locale)} === 'ru' && !title.includes('Сохранённое выделение')) failures.push(name + ': missing Russian title');
                if (${JSON.stringify(locale)} === 'en-XA' && !title.includes('⟦')) failures.push(name + ': missing pseudo title');
                await capture(name, modal);
              } finally { await escape(); }
            }
            for (const state of ['empty', 'long', 'error', 'agent', 'agent-asking', 'asking', 'working', 'compacting']) {
              await api.openNodeSessionFixture(state);
              const root = await until(() => document.querySelector('.abele-node-chat .abele-session-settings')?.closest('.abele-node-chat'));
              if (!root) throw Error(state + ' did not mount');
              try {
                const messages = root.querySelector('.abele-ai-chat__messages');
                if (messages) messages.scrollTop = messages.scrollHeight;
                await capture(state, root);
                if (state === 'agent') {
                  const plan = root.querySelector('.abele-session-plan');
                  if (!plan) throw Error('Plan did not mount');
                  const label = plan.getAttribute('aria-label') ?? '';
                  if (${JSON.stringify(locale)} === 'ru' && !label.startsWith('План:')) failures.push('missing Russian plan');
                  if (${JSON.stringify(locale)} === 'en-XA' && !label.includes('⟦')) failures.push('missing pseudo plan');
                }
                if (state === 'error') {
                  root.querySelector('.abele-session-settings').click();
                  const item = await until(() => document.querySelector('.menu .menu-item'));
                  if (!item) throw Error('Session menu did not mount');
                  item.click();
                  const modal = await until(() => document.querySelector('.modal.abele-modal, .abele-close-tab'));
                  if (!modal) throw Error('Compact dialog did not mount');
                  try { await capture('compact', modal); } finally { await escape(); }
                }
              } finally { await api.closeNodeSessionFixture(); }
            }
            {
              if (!api.ChatService.getInstance().canCreateTab) throw Error('No room for a synthetic regular chat');
              const id = await api.openRegularChatFixture();
              const session = api.ChatService.getInstance().getSession(id);
              if (!session) throw Error('Regular fixture did not create a session');
              session.save = async () => {};
              session.flush = async () => {};
              session.saveForRelease = async () => {};
              const root = await until(() => [...document.querySelectorAll('.abele-ai-chat')].find(el => el.getBoundingClientRect().width && !el.classList.contains('abele-node-chat')));
              if (!root) throw Error('Regular chat did not mount');
              const agent = session.agent.value;
              if (!agent) throw Error('Regular fixture has no agent');
              const descriptionBefore = agent.description;
              agent.description = 'Migrated from the global AI settings.';
              const q = { id: 'sample-locale-question', role: 'user', content: 'Review the sample project.', timestamp: 1700000000000 };
              const set = messages => {
                session.isStreaming.value = false;
                session.isExecutingTool.value = false;
                session.pendingToolCalls.value = [];
                session.pendingQuestions.value = null;
                session.error.value = null;
                session.errorPresentation.value = null;
                session.retrying.value = null;
                session.allChatMessages = messages;
                session.activeLeafId = messages.at(-1)?.id ?? null;
                session.updateVisibleMessages();
              };
              try {
                await capture('regular-rich', root);
                set([]);
                if (!await until(() => root.querySelector('.cm-placeholder, textarea[placeholder]'))) throw Error('Regular composer placeholder did not mount');
                const placeholder = root.querySelector('.cm-placeholder')?.textContent ?? root.querySelector('textarea[placeholder]')?.getAttribute('placeholder') ?? '';
                if (${JSON.stringify(locale)} === 'ru' && placeholder !== 'Сообщение…') failures.push('regular composer: missing Russian placeholder');
                if (${JSON.stringify(locale)} === 'en-XA' && !placeholder.includes('⟦')) failures.push('regular composer: missing pseudo placeholder');
                const subtitle = root.querySelector('.abele-ai-chat__empty')?.textContent ?? '';
                if (subtitle.includes('Migrated from the global AI settings.')) failures.push('regular empty: untranslated agent subtitle');
                if (agent.description !== 'Migrated from the global AI settings.') failures.push('regular empty: stored description changed');
                await capture('regular-empty', root);
                set([q, { id: 'sample-locale-command', role: 'tool-call', parentId: q.id, content: '', timestamp: q.timestamp + 1000, toolName: 'run_command', toolStatus: 'pending', toolCallId: 'sample-locale-call', toolParams: { command: 'printf "sample check"' } }]);
                session.pendingToolCalls.value = [{ id: 'sample-locale-call', type: 'toolCall', name: 'run_command', arguments: { command: 'printf "sample check"' } }];
                if (!await until(() => root.querySelector('.abele-tool-approval'))) throw Error('Regular approval did not mount');
                const run = root.querySelector('.abele-chat-run .abele-tree-item__text')?.textContent ?? '';
                if (${JSON.stringify(locale)} === 'ru' && run !== 'Запрошено выполнение') failures.push('regular approval: missing Russian run summary');
                if (${JSON.stringify(locale)} === 'en-XA' && !run.includes('⟦')) failures.push('regular approval: missing pseudo run summary');
                await capture('regular-approval', root);
                set([q]);
                session.pendingQuestions.value = { questions: [{ question: 'Which sample version?', options: ['Short sample version', 'Detailed sample version with a longer explanation'] }], currentIndex: 0, answers: [], resolve: () => {} };
                if (!await until(() => root.querySelector('.abele-chat-question'))) throw Error('Regular question did not mount');
                await capture('regular-question', root);
                set([q]);
                session.error.value = 'Sample service unavailable. Your draft is retained.';
                session.retrying.value = { secondsLeft: 5, attempt: 1, of: 3 };
                if (!await until(() => root.querySelector('.abele-ai-chat__error'))) throw Error('Regular error did not mount');
                await capture('regular-error', root);
              } finally { agent.description = descriptionBefore; set([]); await api.closeRegularChatFixture(); }
            }
            for (const state of ['empty', 'conflict', 'legacy']) {
              const folder = 'ScaleTest/sample-locale-rewind-' + Date.now();
              if (app.vault.getAbstractFileByPath(folder)) throw Error('Synthetic folder already exists');
              await app.vault.createFolder(folder);
              const edited = folder + '/sample-reference-with-a-long-title.md';
              const created = folder + '/sample-created.md';
              try {
                if (state !== 'empty') await app.vault.create(edited, 'Sample original text.');
                await api.openRewind(state === 'empty' ? '' : edited, state === 'empty' ? '' : created, state === 'legacy' ? 'legacy' : state === 'conflict');
                const modal = await until(() => document.querySelector('.modal.abele-modal, .abele-close-tab'));
                if (!modal) throw Error('Rewind ' + state + ' did not mount');
                const before = state === 'empty' ? '' : await app.vault.read(app.vault.getAbstractFileByPath(edited));
                try { await capture('rewind-' + state, modal); } finally { await escape(); }
                if (state !== 'empty' && before !== await app.vault.read(app.vault.getAbstractFileByPath(edited))) throw Error('Closing the localized dialog restored a file');
              } finally {
                const own = app.vault.getAbstractFileByPath(folder);
                if (own) await app.vault.delete(own, true);
              }
            }
            for (const agentsState of ['empty', 'many', 'mixed', 'error']) {
              void api.openDialog('agents', { agentsState });
              const modal = await until(() => document.querySelector('.modal.abele-modal, .abele-close-tab'));
              if (!modal) throw Error('Agents ' + agentsState + ' did not mount');
              try {
                if (agentsState === 'mixed') {
                  if (${JSON.stringify(locale)} === 'ru' && modal.textContent.includes('Offline')) failures.push('untranslated offline coverage');
                }
                await capture('agents-' + agentsState, modal);
              } finally { await escape(); }
            }
            for (const name of ['chat-artifacts-empty', 'chat-artifacts-long', 'chat-navigation', 'agents-tabs', 'reply-revision', 'reply-versions', 'node-pairing', 'node-pairing-recovery', 'node-pairing-endpoint', 'node-question', 'node-files', 'node-edit-conflict', 'node-edit-unknown', 'node-edit-binary', 'node-diffs', 'node-review', 'node-history', 'reply-original', 'github-connection-approval', 'github-agent-access', 'github-connection']) {
              void api.openDialog(name);
              const modal = await until(() => document.querySelector('.modal.abele-modal, .abele-close-tab'));
              if (!modal) throw Error(name + ' did not mount');
              try { await capture(name, modal); } finally { await escape(); }
            }
            for (const state of ['home', 'file', 'changes', 'compare', 'empty', 'missing', 'offline', 'conflict', 'outcome-unknown']) {
              await api.openNodeRepositoryFixture(state);
              const root = await until(() => document.querySelector('.workspace-leaf.mod-active .abele-github, .workspace-leaf.mod-active .abele-github-view__source-unavailable, .workspace-leaf.mod-active .abele-node-repository__unavailable'));
              if (!root) throw Error('Repository ' + state + ' did not mount');
              try { await capture('repository-' + state, root); } finally { await api.closeNodeRepositoryFixture(); }
            }
            return JSON.stringify(failures);
          } finally {
            const cleanupErrors = [];
            for (const close of [api.closeRegularChatFixture, api.closeNodeRepositoryFixture, api.closeNodeSessionFixture]) {
              try { await close(); } catch (error) { cleanupErrors.push(String(error)); }
            }
            await api.setTestLocale('en');
            if (cleanupErrors.length) throw Error('Fixture cleanup failed: ' + cleanupErrors.join('; '));
          }
        })()`,
              90_000
            )
          ) as string[]
          expect(result, `${locale} ${phone ? 'phone' : 'desktop'}`).toEqual([])
        }
        try {
          if (phone) await withEmulatedPhone(check)
          else await check()
        } finally {
          evalRaw(`window.__abeleTest?.setTestLocale('en')`)
          await reloadApp('app.emulateMobile(false)')
        }
      },
      300_000
    )
  }
)
