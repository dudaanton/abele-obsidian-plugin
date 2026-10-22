export const en = {
  'node.loading.changes': 'Loading changes…',
  'node.loading.history': 'Loading history…',
  'node.loading.files': 'Loading files…',
  'node.loading.updatingChanges': 'Updating changes…',
  'node.loading.updatingFiles': 'Updating files…',
  'node.loading.slow': 'Still reading the files… {loaded} so far',
  'node.error.readingFile': 'Reading {path}',
  'node.log.truncated': 'Only the latest part of the log is shown.',
  'node.log.missing': 'No log files are available on this node.',
  'node.log.unavailable': 'The node could not read its log files.',
  'node.log.unknownTime': 'Unknown time',
  'node.state.offline': 'The node is offline.',
  'node.state.reconnecting': 'The node is offline. Reconnecting…',
  'node.state.slow': 'The node is slow to answer. Waiting…',
  'node.action.retry': 'Retry',
  'node.action.refresh': 'Refresh',
  'node.action.reconnect': 'Reconnect',
  'node.action.trust': 'Trust this folder…',
  'node.action.pair': 'Connect again',
  'node.action.settings': 'Node settings',
  'node.action.update': 'How to update',
  'node.action.install': 'How to install',
  'node.error.copyDetails': 'Copy details',
  'node.error.code': 'Code',
  'node.error.what': 'What',
  'node.error.where': 'Where',
  'node.error.when': 'When',
  'node.error.original': 'Original action',
  'node.log.title': 'Node log',
  'node.log.all': 'All lines',
  'node.log.warnings': 'Warnings and errors',
  'node.log.filter': 'Which lines',
  'node.log.copy': 'Copy what is shown',
  'node.log.offline':
    'The log can be read when the node is online. Below is what was loaded earlier.',
  'node.log.empty': 'No log entries.',
  'node.log.loading': 'Loading node log…',
  'node.error.ownerOnly': 'Only the node owner can trust this folder.',
  'node.error.gitTimeout':
    "Git on the node didn't answer in time. The computer running the node may be busy.",
  'node.error.operationTimeout':
    "The operation on the node didn't finish in time. The computer running the node may be busy.",
  'node.error.connectionTimeout':
    "The connection to the node didn't complete in time. The computer running the node may be busy.",
  'node.error.controlTimeout':
    "The local node control didn't answer in time. The computer running the node may be busy.",
  'node.error.tooOld': 'This node version does not support this operation. Update the node.',
  'node.error.providerMissing':
    'The required provider is unavailable on the node. Check that it is installed and configured.',
  'node.file.waitingForNode': 'The file will open when the node is back.',
  'node.file.retry': 'Retry',
  'node.error.details': 'Details',
  'node.analysis.title': 'Code analysis',
  'node.analysis.untrusted': 'folder not trusted',
  'node.analysis.notSetUp': 'not set up in this project',
  'node.analysis.failed': 'failed',
  'node.analysis.starting': 'starting',
  'node.analysis.running': 'running',
  'node.analysis.loading': 'Code analysis is starting…',
  'node.analysis.off': 'Code analysis is off for this file',
  'node.analysis.error': 'Code analysis failed',
  'node.analysis.trustNeeded': 'Code analysis: folder not trusted',
  'node.analysis.typescriptOnly': 'Code analysis: TypeScript only. ESLint isn’t set up.',
  'node.analysis.summary': 'Code analysis: {names}',
  'node.analysis.trust': 'Trust this folder…',
  'node.analysis.eslintHelp': 'How to set up ESLint',

  'node.manager.failed': 'Command failed',
  'node.manager.applied': 'Changes applied',
  'node.manager.cancelled': 'Cancelled',
  'node.manager.running': 'Running',
  'node.commit.refresh': 'Refresh',
  'node.manager.contextUpdate':
    'Update the node to 0.4.47 or later to run commands from this chat.',
  'node.manager.notSubmitted': 'Command was not submitted for execution: {reason}',
  'node.manager.permissionChanged': 'Command permissions changed. Request the command again.',

  'requests.refresh': 'Refresh requests',
  'debug.launchUnknown':
    'The launch result is unknown. Reconnect and check the debug sessions before trying again.',
  'debug.launchMissing': 'The program was not found. Check its path relative to the folder.',
  'debug.followNoMatches': 'No recorded steps contain this value.',
  'node.chat.deleteHint':
    'Delete this session and its chat history from the node? Files in its folder stay as they are.',
  'node.search.invalidRegex': 'Check the regular expression and try again.',
  'node.lsp.locations': 'Locations: {count}',
  'node.lsp.noLocations': 'No matching locations',
  'node.lsp.count': 'Diagnostics: {count}',
  'node.lsp.loading': 'Analyzing code…',
  'node.lsp.error': 'Language analysis unavailable: {message}',
  'node.lsp.retry': 'Retry',
  'node.lsp.untrusted': 'Language servers need permission to run project code in this folder.',
  'node.lsp.trust': 'Trust folder',
  'node.lsp.missing': 'Language server missing. Install on the node:',
  'node.lsp.copy': 'Copy command',
  'node.lsp.install': 'Install popular servers',
  'node.lsp.eslintMissing':
    'ESLint is missing or not configured in this project. TypeScript analysis remains available.',
  'node.lsp.noDiagnostics': 'No diagnostics',
  'node.lsp.references': 'Find references to {name}',

  'debug.stopAtStart': 'Stop at start',
  'debug.pausedAtStart': 'Paused at start',
  'node.disconnectRevokeNotice':
    'Disconnect this device and revoke its key on the node? Other devices stay connected.',
  'node.tools.callPlace': 'on {device}',
  'node.tools.askedAgent': 'Asked {agent}',
  'node.tools.runner': 'Runs in Obsidian on {device}',
  'node.tools.noRunner': 'No device with Obsidian is connected to the node now',
  'node.tools.nodeAgent': 'Node agent',
  'node.tools.modes': 'Off = unavailable. Ask = needs approval. Auto = runs on its own.',
  'node.tools.waiting': 'Waiting for Obsidian',
  'node.tools.executing': 'Running in Obsidian',
  'node.tools.unknown':
    'The action outcome could not be confirmed. Check the affected files before requesting it again.',
  'node.actionDeniedByOwner': 'User rejected this action',
  'streamB.runSummary.move.done': 'Moved',
  'streamB.runSummary.move.running': 'Moving',
  'streamB.runSummary.move.waiting': 'Asked to move',
  'node.disconnectTokenNotice':
    'Remove this device’s saved connection? This does not revoke its key on the node. Revoke that device key in the node’s token list to prevent further access with it.',
  'node.error.requestMissing': 'This request is no longer on the node.',
  'debug.frameSourceUnavailable': 'This frame has no source available in this folder.',
  'node.delegation.updateRequired': 'This node needs an update to take tasks from chats',
  'node.files.directoryDeleteSummary': 'Delete folder {path} with {files} in {folders}?',
  'node.files.directoryMoveSummary':
    'Move folder {path} with {files} in {folders} to {destination}?',
  'node.files.showFiles': 'Show files',
  'node.files.uncommitted': 'Uncommitted',
  'node.files.untracked': 'Untracked',
  'node.files.gitStatusUnavailable': 'Git status unavailable',
  'node.files.gitRecoveryWarning':
    'Uncommitted and untracked contents cannot be recovered from Git.',
  'node.files.fileCount': { one: '{count} file', other: '{count} files' },
  'node.files.folderCount': { one: '{count} folder', other: '{count} folders' },
  'node.files.renameAction': 'Rename',
  'node.files.moveAction': 'Move',
  'node.files.directoryConfirm':
    'Delete folder {path}? These are all the entries that will be removed:',
  'node.files.directoryMoveConfirm':
    'Move folder {path} to {destination}? These are all the entries that will move:',
  'node.files.gitLock': 'Git worktree lock',
  'node.localRunning': 'AbeleNode is running on this computer',
  'node.files.nameOnly': 'Enter a file name without folders.',
  'node.files.attachMessage':
    'Browse this repository’s other worktrees and allow file editing in the worktree you choose? Agent execution still needs separate approval.',
  'node.files.saveLocked': 'Saving is locked here',
  'node.files.newFile': 'New file…',
  'node.files.newFolder': 'New folder…',
  'node.files.rename': 'Rename…',
  'node.files.move': 'Move…',
  'node.files.delete': 'Delete…',
  'node.files.deleteConfirm': 'Delete {path}? This removes the file from this folder.',
  'node.files.allowEditing':
    'Allow creating, editing, moving and deleting files in this worktree? This does not allow agent execution.',
  'node.files.worktreeBusyTitle': 'Worktree is in use',
  'node.files.worktreeBusy':
    'This worktree is held by: {holders}. Stop its sessions before deleting it.',
  'node.files.unknownHolder': 'another operation on the node',
  'node.files.stopSessions': 'Stop these sessions',
  'node.files.sessionsStopped':
    'Sessions stopped. Choose Delete worktree again when they have finished stopping.',
  'node.error.busy':
    'This resource is in use. Wait for the current operation to finish and try again.',
  'node.error.busyStage':
    'Could not stage the files because the worktree is busy. Wait for the current action to finish and try again.',
  'node.error.busyChat':
    'Could not start a new chat because the folder or worktree is busy. Wait for the current action to finish and try again.',
  'node.error.busyRead':
    'Editing stopped. The file could not be refreshed because the worktree is busy. Refresh when the current action finishes.',
  'node.error.workspaceDirty':
    'The worktree has uncommitted changes. Commit or discard them before deleting it.',
  'node.codeLineUnavailable': 'The linked lines no longer exist in this file.',
  'image.timeLimit.label': 'Image generation time limit',
  'image.timeLimit.unlimited': 'No limit',
  'image.timeLimit.minutes': '{minutes} minutes',
  'image.timeLimit.error':
    'Image request reached the {minutes}-minute limit. Change it in Settings → AI → Models → Image generation time limit.',

  'node.delegation.activity': 'Activity and reports',
  'node.delegation.done': 'Done',
  'node.delegation.working': 'Working',
  'node.delegation.unknown': 'Stopped; outcome uncertain',
  'maps.lightAddressExample': 'https://tiles.example.com/{z}/{x}/{y}.png',
  'maps.darkAddressExample': 'https://tiles.example.com/dark/{z}/{x}/{y}.png',
  'node.error.size': 'The request is too large. Reduce its size and try again.',
  'node.error.route':
    'The node address was refused. Check the address allowed by the pairing invitation.',

  'node.error.tls':
    'The node could not be reached securely. Check its address, certificate and connection.',
  'node.error.access': 'The node refused access. Pair again or check your permissions.',
  'node.error.unknownOutcome':
    'The result is unknown. Refresh and check what happened before trying again.',
  'node.error.outputLimit': 'The node returned too much output. Narrow the request or use paging.',
  'node.error.limit': 'The node reached a limit. Wait before trying again.',
  'node.error.debugger':
    'The debugger is unavailable. Check the debug configuration and reconnect.',
  'node.error.generic':
    'The node could not complete the request. Check the details before trying again.',
  'node.error.connection': 'The node is disconnected. Check the connection and reconnect.',
  'node.error.pairing': 'Pairing could not be completed. Check the invitation and pair again.',
  'node.error.identity': 'The node or target has changed. Check its identity and reconnect.',
  'node.error.stale': 'The data has changed. Refresh before trying again.',
  'node.error.staleResource': 'The folder or worktree has changed. Refresh and choose it again.',
  'node.error.folderUnavailable':
    'This folder is no longer available on the node. It may have been removed or may no longer be a repository.',
  'node.folderRefreshed':
    'The folder was refreshed. Press Create again to create the requested folder.',
  'node.error.trust': 'This folder is not trusted. Review its trust settings before continuing.',
  'node.error.unavailable':
    'This feature is unavailable. Check the node configuration and version.',

  'kit.cancel': 'Cancel',
  'kit.delete': 'Delete',
  'kit.deleteTooltip': 'Go ahead and delete it',
  'kit.cancelTooltip': 'Close this and change nothing',
  'kit.filename': 'filename',
  'kit.create': 'Create',
  'kit.submitTooltip': 'Go ahead with this text',
  'kit.where': 'Where this is',
  'kit.allLevels': 'Show every level',
  'kit.empty': 'No items yet',
  'kit.noMatches': 'No matches',
  'kit.loading': 'Loading…',
  'kit.loadError': 'Could not load items',
  'kit.details': 'Details',
  'kit.noEvents': 'No events yet',
  'kit.sourceMissing': 'Source unavailable',
  'kit.saveError': 'Could not save',
  'kit.progress': 'Progress',
  'kit.clear': 'Clear',
  'kit.selectAll': 'Select all',
  'kit.chooseNone': 'Choose none of these',
  'kit.chooseAll': 'Choose every one of these',
  'kit.chooseIcon': 'Choose an icon',
  'kit.searchIcons': 'Search icons, e.g. calendar',
  'kit.noIcon': 'No icon is called anything like “{query}”.',
  'kit.refreshing': 'Refreshing…',
  'kit.objectMissing': 'Object unavailable',
  'kit.objectError': 'Could not load object',
  'kit.waiting': 'Waiting for your answer',
  'kit.closeSearch': 'Close the search',
  'kit.folder': 'Folder',
  'kit.scope': 'Scope',
  'kit.unknown': 'Unknown',
  'kit.removeNote': 'Take this note out',
  'kit.copyPath': 'Copy full path',
  'kit.reveal': 'Reveal in file explorer',
  'kit.targetMissing': 'Target unavailable',
  'kit.vaultRoot': 'Vault root',
  'kit.previousMonth': 'Previous month',
  'kit.dateRange': 'Choose date range',
  'kit.nextMonth': 'Next month',
  'kit.noQuote': 'No quoted text',
  'kit.collapseQuote': 'Collapse quote',
  'kit.expandQuote': 'Expand quote',
  'kit.exactTime': 'Exact time',
  'kit.working': 'Working',
  'kit.done': 'Done',
  'kit.failed': 'Failed',
  'kit.skipped': 'Left alone',
  'kit.errors': 'Errors',
  'kit.moreBelow': 'More below',
  'kit.selection': 'Selection',
  'kit.moreActions': 'More actions',
  'kit.showRest': 'Show the rest of the list',
  'kit.showMore': { one: 'Show {count} more', other: 'Show {count} more' },
  'kit.underlineOn': 'Underline on',
  'kit.underlineOff': 'Underline off',
  'kit.underline': 'Underline annotation',
  'kit.savingColour': 'Saving colour',
  'kit.selectionMissing': 'Selection unavailable',
  'kit.noColour': 'No colour',
  'kit.savingNamedColour': 'Saving {colour}…',
  'kit.colourDisabled': 'Colour cannot be changed here',
  'kit.waveform': 'Waveform',
  'kit.colour.grey': 'Grey',
  'kit.colour.red': 'Red',
  'kit.colour.orange': 'Orange',
  'kit.colour.yellow': 'Yellow',
  'kit.colour.green': 'Green',
  'kit.colour.cyan': 'Cyan',
  'kit.colour.blue': 'Blue',
  'kit.colour.purple': 'Purple',
  'kit.colour.pink': 'Pink',
  'settings.tabs.tasks': 'Tasks',
  'settings.tabs.logs': 'Logs',
  'settings.tabs.journals': 'Journals',
  'settings.tabs.calendars': 'Calendars',
  'settings.tabs.finance': 'Finance',
  'settings.tabs.timeTracking': 'Time Tracking',
  'settings.tabs.ai': 'AI Agent',
  'settings.tabs.scripts': 'Scripts',
  'settings.tabs.links': 'Links',
  'settings.tabs.github': 'Git hosting',
  'settings.tabs.nodes': 'Nodes',
  'settings.tabs.reader': 'Books',
  'settings.tabs.quickButton': 'Quick button',
  'settings.tabs.headerButtons': 'Header buttons',
  'settings.tabs.linter': 'Linter',
  'settings.tabs.transfer': 'Transfer',
  'settings.tabs.sync': 'Sync',
  'settings.tabs.other': 'Other',
  'settings.groups.notes': 'Notes',
  'settings.groups.moneyTime': 'Money and time',
  'settings.groups.agents': 'Agents',
  'settings.groups.buttons': 'Buttons',
  'settings.groups.data': 'Data',
  'settings.documentation': 'Documentation',
  'settings.documentationTooltip': 'Close the settings and read what this tab is for',
  'settings.englishDocs': 'Documentation is in English',
  'kit.imageMissing': 'Image unavailable',
  'kit.loadingImage': 'Loading image…',
  'kit.deviceMissing': 'Unavailable on this device',
  'kit.hideDetail': 'Hide {label}',
  'kit.showDetail': 'Show {label}',
  'kit.description': 'description',
  'kit.openSource': 'Open source for {title}',
  'kit.retry': 'Retry {title}',
  'kit.moreIcons': '{count} more icons below',
  'kit.image': 'image',
  'kit.imageMissingNamed': 'Image unavailable: {name}',
  'kit.previewImage': 'Preview {name}',
  'kit.inputLoading': 'Загружаю',
  'kit.partOf': '{shown} of {total}',
  'kit.workspace': 'Workspace: {name}',
  'kit.qrCode': 'QR code',
  'kit.askSelection': 'Ask the agent about this in a new chat',
  'kit.addSelection': 'Add to the open chat',
  'node.trust.title': 'Trust this folder for agents?',
  'node.trust.message':
    'Agents can run commands and change files in {path}. Trust this folder only if you know its contents. You can follow the agent in its chat and stop it there.',
  'node.trust.allow': 'Trust folder',
  'node.chat.closeTab':
    'Close tab — the session stays on the node. Reopen it from the node panel to follow or stop it.',
  'kit.noteSelection': 'Insert into the note you were last in',
  'kit.linkSelection': 'Copy a link to these lines',
  'kit.saving': 'Saving…',
  'commands.convert-drawings-to-canvases': 'Convert legacy drawings to canvases',
  'drawing.conversion-result':
    'Drawings: {converted} converted, {existing} already converted, {failed} failed. Originals kept.',
  'commands.migrate-excalidraw-drawing': 'Migrate this Excalidraw drawing to a canvas',
  'commands.migrate-excalidraw-vault': 'Migrate all Excalidraw drawings to canvases',
  'commands.new-canvas': 'New canvas',
  'commands.open-canvas-viewer': 'Open current canvas in diagram viewer',
  'commands.open-changelog': 'Open changelog',
  'commands.cycle-checkbox-state': 'Cycle checkbox state',
  'commands.insert-columns': 'Insert columns',
  'commands.column-options': 'Column options',
  'commands.remove-columns': 'Remove columns',
  'commands.add-text-comment': 'Add comment',
  'commands.open-node-repository': 'Open node repository',
  'commands.chat-about-github-item': 'Chat about this GitHub item',
  'commands.open-github-repository': 'Open GitHub repository…',
  'commands.show-github-notifications': 'Show GitHub notifications',
  'commands.open-github-link': 'Open GitHub link or item',
  'commands.copy-link-to-lines': 'Copy link to selected lines',
  'commands.linter-open': 'Open linter',
  'commands.linter-lint-note': 'Lint current note',
  'commands.linter-lint-folder': 'Lint folder…',
  'commands.linter-lint-vault': 'Lint vault',
  'commands.sync-now': 'Sync now',
  'commands.sync-pause-resume': 'Pause or resume sync',
  'commands.sync-log': 'Open sync settings',
  'commands.sync-deleted-files': 'Open deleted files',
  'commands.reader-toggle-eink': 'Toggle e-ink mode for books on this device',
  'commands.reader-toggle-zen': 'Toggle zen mode for books on this device',
  'commands.open-requests': 'Open requests',
  'commands.import-requests': 'Import requests from the clipboard',
  'commands.new-presentation': 'New presentation',
  'commands.open-presentation': 'Open presentation',
  'commands.preview-presentation': 'Preview presentation beside editor',
  'commands.play-presentation': 'Play presentation',
  'commands.present-presentation': 'Present with speaker view',
  'commands.agents': 'Agents',
  'ribbon.agents': 'Agents',
  'commands.comment-here': 'Comment here',
  'commands.show-ai-sidebar': 'Show AI chat sidebar',
  'commands.find-in-chat': 'Find in the current chat',
  'commands.search-all-chats': 'Search all chats',
  'commands.chat-close-tab': 'Close the current chat tab',
  'commands.chat-reopen-tab': 'Reopen the last closed chat tab',
  'commands.chat-next-tab': 'Go to the next chat tab',
  'commands.chat-previous-tab': 'Go to the previous chat tab',
  'ribbon.show-ai-chat': 'Show AI chat',
  'commands.voice-input': 'Dictate into the note',
  'commands.show-script-runs': 'Show script runs',
  'commands.open-documentation': 'Open documentation',
  'commands.open-quick-menu': 'Open quick menu',
  'commands.show-script-api': 'Show script API reference',
  'commands.review-key-destinations': 'Review key destinations',
  'commands.create-task': 'Create new task',
  'commands.create-task-and-insert-link': 'Create new task and insert into current note',
  'commands.find-and-replace':
    'Find and replace in frontmatter and content of all notes, matching the criteria',
  'commands.import-files': 'Import files to vault',
  'commands.save-media': 'Save remote media to vault',
  'commands.unused-media': 'Find and delete unused media',
  'commands.deduplicate-media': 'Deduplicate media attachments',
  'commands.migrate-from-dataview': 'Migrate tasks from Dataview',
  'commands.migrate-from-firefly': 'Migrate data from Firefly III',
  'commands.create-transaction': 'Create new transaction',
  'commands.create-transaction-and-insert-link':
    'Create new transaction and insert into current note',
  'commands.show-timeline-sidebar': 'Show timeline sidebar',
  'commands.migrate-dataview-fields': 'Migrate from Dataview fields',
  'commands.show-todo-sidebar': 'Show todo sidebar',
  'commands.show-finance-sidebar': 'Show finance sidebar',
  'commands.show-accounts-sidebar': 'Show accounts sidebar',
  'commands.migrate-from-toggl': 'Migrate time entries from Toggl',
  'commands.show-time-tracking-sidebar': 'Show time tracking sidebar',
  'commands.start-timer': 'Start timer for current note',
  'commands.stop-timer': 'Stop active timer',
  'commands.paste-from-clipboard': 'Paste from clipboard at cursor',
  'commands.create-note-from-template': 'Create note from template',
  'commands.create-note-in-group': 'Create note in group',
  'commands.replace-note-with-template': 'Replace current note with template',
  'commands.insert-template-at-cursor': 'Insert template at cursor',
  'commands.insert-gallery': 'Insert image gallery',
  'commands.convert-images-to-galleries': 'Convert images on page to galleries',
  'commands.reindex-footnotes': 'Reindex footnotes',
  'commands.insert-highlight': 'Insert colored highlight',
  'commands.remove-highlight': 'Remove colored highlight',
  'commands.set-cover-from-first-media': 'Set cover from first image/video in note',
  'commands.open-today-daily-note': "Open today's daily note",
  'commands.create-css-snippet': 'Create CSS snippet',
  'commands.reload-css-snippets': 'Reload CSS snippets',
  'commands.create-script': 'Create script',
  'ribbon.show-timeline-sidebar': 'Show timeline sidebar',
  'ribbon.show-todo-sidebar': 'Show todo sidebar',
  'ribbon.show-finance-sidebar': 'Show finance sidebar',
  'ribbon.show-time-tracking': 'Show time tracking',
  'ribbon.show-script-runs': 'Show script runs',
  'commands.open-node': 'Open node',
  'ribbon.node': 'Node',
  'commands.toggle-zen-mode': 'Toggle zen mode',
  'commands.add-to-agent-context': 'Add to agent context',
  'commands.chat-about-current-note': 'Chat about this',
  'commands.attach-note-to-chat': 'Attach to a chat',
  'commands.attach-chat-to-current-note': 'Attach a chat to note',
  'commands.copy-note-wikilink': 'Copy wikilink',
  'commands.review-scripts': 'Review scripts waiting for confirmation',
  'commands.script': 'Script: {name}',
  'settings.nodes.title': 'Nodes',
  'settings.nodes.description':
    'Computers the agent can work on for you: open one, pick a project, and watch and answer here. Their keys and history stay on this device.',
  'settings.nodes.check': "Check this device's node connection",
  'settings.nodes.open': 'Open session',
  'settings.nodes.openTip': 'Pick a session or manage projects and workspaces',
  'settings.nodes.more': 'Pairing, debugger access, remove',
  'settings.nodes.pairTitle': 'Pair a node on another computer',
  'settings.nodes.pairDesc':
    'A remote desktop or a server, by an invitation from it. A device that was revoked pairs again the same way.',
  'settings.nodes.pair': 'Pair',
  'settings.nodes.pairTip': 'Scan or paste an invitation; re-pair or verify a changed node key',
  'settings.nodes.addTitle': 'Add the node on this computer',
  'settings.nodes.addDesc': 'One running here, by the token it gives.',
  'settings.nodes.add': 'Add',
  'settings.nodes.addTip': 'Name the node here and paste its token',
  'settings.nodes.traceTitle': 'Notes about recorded runs',
  'settings.nodes.traceDesc':
    "Folder for a note about a run the debugger recorded, yours or the agent's: a vault folder, or on a computer any folder by its full path. The run itself stays on the node.",
  'settings.nodes.traceExample': 'e.g. Trace',
  'settings.nodes.traceFolder': 'Folder for notes about recorded runs',
  'settings.nodes.chooseFolderTip': 'Choose a folder on this computer, in the vault or outside it',
  'settings.nodes.chooseFolder': 'Choose a folder for notes about recorded runs',
  'settings.nodes.name': 'Name',
  'settings.nodes.nameDesc': 'What this node is called on this device.',
  'settings.nodes.localPlaceholder': 'Local node',
  'settings.nodes.label': 'Node label',
  'settings.nodes.address': 'Address',
  'settings.nodes.addressDesc': "Only this computer's own address; another computer is paired.",
  'settings.nodes.url': 'Node URL',
  'settings.nodes.token': 'Token',
  'settings.nodes.tokenDesc':
    "The one abele-node token create prints. Kept in this device's keychain only.",
  'settings.nodes.pasteToken': 'Paste token',
  'settings.nodes.installationToken': 'Node installation token',
  'settings.nodes.cancel': 'Cancel',
  'settings.nodes.cancelTip': 'Close this and add nothing',
  'settings.nodes.authenticateTip': 'Authenticate and pin the local node identity on this device',
  'settings.nodes.untitledChat': 'Untitled chat',
  'settings.nodes.unavailable': 'Node unavailable',
  'settings.nodes.added': 'Connected. Open a session here or from the new chat menu.',
  'settings.nodes.connected': 'Connected',
  'settings.nodes.connecting': 'Connecting…',
  'settings.nodes.disconnected': 'Not connected',
  'settings.nodes.repair': 'Pairing / re-pair',
  'settings.nodes.remove': 'Remove',
  'settings.nodes.removed':
    'Connection removed from this device. Node history and the daemon credential are unchanged.',
  'commands.insert-columns-two': 'Insert two equal columns',
  'commands.insert-columns-three': 'Insert three equal columns',
  'commands.insert-columns-aside': 'Insert text with an aside',
  'ribbon.agentsStatus': 'Agents · Needs attention: {attention}. Working: {running}',
  'ribbon.agentsStatusIncomplete':
    'Agents · Needs attention: {attention}. Working: {running} · Some conversations could not be checked',
  'settings.AiSettings.general.c910d474': 'General',
  'settings.AiSettings.models.d17d2d78': 'Models',
  'settings.AiSettings.agents.279b44d2': 'Agents',
  'settings.AiSettings.prompts.5f2e66e6': 'Prompts',
  'settings.AttachmentRulesSettings.attachment_folders.4ec7937c': 'Attachment folders',
  'settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d':
    'Files pasted or dropped into a note in one of these folders go to the folder its rule names. The deepest folder wins.',
  'settings.AttachmentRulesSettings.add_a_rule.bed79361': 'Add a rule',
  'settings.AttachmentRulesSettings.notes_in.af0c6387': 'Notes in',
  'settings.AttachmentRulesSettings.notes_folder.b8c1e974': 'Notes folder',
  'settings.AttachmentRulesSettings.folder.74ccd433': 'Folder',
  'settings.AttachmentRulesSettings.remove_this_rule.00612239': 'Remove this rule',
  'settings.AttachmentRulesSettings.attachments_go_to.7b114ade': 'Attachments go to',
  'settings.AttachmentRulesSettings.attachment_folder.fce49098': 'Attachment folder',
  'settings.AttachmentRulesSettings.subfolder_name.f381c5ab': 'Subfolder name',
  'settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7':
    "No rules: attachments follow Obsidian's setting.",
  'settings.AttachmentRulesSettings.add_a_folder_rule.879a8360': 'Add a folder rule',
  'settings.AttachmentRulesSettings.same_folder_as_the_note.32781177': 'Same folder as the note',
  'settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55':
    'In the folder specified below',
  'settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483':
    "In subfolder under the note's folder",
  'settings.AttachmentRulesSettings.whole_vault.cb44fe25': 'Whole vault',
  'settings.CalendarsSettings.calendars.e0b2b00c': 'Calendars',
  'settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b':
    'Events from Google, iCloud, Outlook or any CalDAV server, shown beside the tasks: in the sidebar calendar, the timeline and a daily note. Read only — nothing is ever written to a calendar, and no note is made unless you ask for one from an event.',
  'settings.CalendarsSettings.read_every_minutes.f4ca625e': 'Read every (minutes)',
  'settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf':
    'When Obsidian starts, then this often while it is open. {value0} at least; Google itself updates a link only every few hours.',
  'settings.CalendarsSettings.read_now.20d8b246': 'Read now',
  'settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9':
    'Read every calendar that is shown again, now',
  'settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f': 'No calendar is shown yet',
  'settings.CalendarsSettings.your_calendars.80ca6c5e': 'Your calendars',
  'settings.CalendarsSettings.not_read.e4f441c4': 'Not read: ',
  'settings.CalendarsSettings.change_this_calendar.a6ced910': 'Change this calendar',
  'settings.CalendarsSettings.add_another_calendar.744b9f9c': 'Add another calendar',
  'settings.CalendarsSettings.no_calendars_yet.0097b3fe': 'No calendars yet',
  'settings.CalendarsSettings.a_secret_link_from_google.21e49135':
    'A secret link from Google, iCloud or Outlook, or a CalDAV account.',
  'settings.CalendarsSettings.add_calendar.9067e0e8': 'Add calendar',
  'settings.CalendarsSettings.add_a_calendar_to_show.6973ff63':
    'Add a calendar to show beside the tasks',
  'settings.CalendarsSettings.name.dcd1d522': 'Name',
  'settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee':
    'Shown beside each of its events.',
  'settings.CalendarsSettings.e_g_work.7f2ce0de': 'e.g. {literal0}',
  'settings.CalendarsSettings.colour.3a9dfa58': 'Colour',
  'settings.CalendarsSettings.its_events_are_marked_with.16eafb54':
    'Its events are marked with it.',
  'settings.CalendarsSettings.connected_by.9952ce52': 'Connected by',
  'settings.CalendarsSettings.a_secret_link_to_the.9b051a7d':
    'A secret link to the calendar, or a CalDAV account with its username and password.',
  'settings.CalendarsSettings.link.a6a32dbc': 'Link',
  'settings.CalendarsSettings.forget_the_link.45aee758': 'Forget the link',
  'settings.CalendarsSettings.server.aef7de28': 'Server',
  'settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72':
    "The CalDAV address: {literal0} for iCloud, {literal1} for Fastmail, your Nextcloud's address for Nextcloud.",
  'settings.CalendarsSettings.username.e3b89e9d': 'Username',
  'settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f':
    'For iCloud, the email of the Apple Account.',
  'settings.CalendarsSettings.password.e7cf3ef4': 'Password',
  'settings.CalendarsSettings.app_specific_password.ffcc8f77': 'App-specific password',
  'settings.CalendarsSettings.forget_the_password.9d745dd0': 'Forget the password',
  'settings.CalendarsSettings.calendar.d5d0a30b': 'Calendar',
  'settings.CalendarsSettings.one_calendar_of_the_account.562ef915':
    'One calendar of the account, or all of them. Find calendars asks the server which there are.',
  'settings.CalendarsSettings.find_calendars.d59c2286': 'Find calendars',
  'settings.CalendarsSettings.set_the_server_the_username.111eaa0a':
    'Set the server, the username and the password first',
  'settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb':
    'Ask the server which calendars this account has',
  'settings.CalendarsSettings.delete.e2d0a549': 'Delete',
  'settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787':
    'Delete this calendar from the settings and its key from the keychain',
  'settings.CalendarsSettings.done.11a6767d': 'Done',
  'settings.CalendarsSettings.close_this_window_changes_are.91342d87':
    'Close this window; changes are kept as you make them',
  'settings.CalendarsSettings.delete_the_calendar.e601c301': 'Delete the calendar',
  'settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0':
    'Delete {value0}? Its events leave the lists, and its {value1} is removed from the keychain. The calendar itself is not touched.',
  'settings.CalendarsSettings.google_the_calendar_s_settings.065b586e':
    'Google: the calendar’s settings, “Secret address in iCal format”. iCloud: share the calendar as a public calendar and copy its link. Outlook: publish the calendar and copy the ICS link. Kept in the keychain — anyone with the link can read the calendar.',
  'settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48':
    'For iCloud, an app-specific password made at account.apple.com, not the account’s own. Kept in the keychain, never in the settings file.',
  'settings.CalendarsSettings.secret_link_ics.a3f8db65': 'Secret link (ICS)',
  'settings.CalendarsSettings.caldav_account.bb860701': 'CalDAV account',
  'settings.CalendarsSettings.the_value_could_not_be.3daaa765':
    'The {value0} could not be kept in the keychain: {value1}',
  'settings.CalendarsSettings.asking_the_server.fb689559': 'Asking the server…',

  'settings.CalendarsSettings.the_account_has_no_calendar.a059bc95':
    'The account has no calendar with events.',
  'settings.CalendarsSettings.all_calendars_of_the_account.3b138d44':
    'All calendars of the account',
  'settings.CalendarsSettings.just_now.7ddb44d8': 'just now',
  'settings.CalendarsSettings.value_min_ago.c85acd7d': '{value0} min ago',
  'settings.CalendarsSettings.not_shown.a08f0f94': 'Not shown',
  'settings.CalendarsSettings.reading.874bfa5b': 'Reading…',
  'settings.CalendarsSettings.no_password_yet.11f1e05e': 'No password yet',
  'settings.CalendarsSettings.no_link_yet.60e5be61': 'No link yet',
  'settings.CalendarsSettings.could_not_be_read.51a02791': 'Could not be read',
  'settings.CalendarsSettings.not_read_yet.fbe841ea': 'Not read yet',
  'settings.CalendarsSettings.reading_the_calendars.b8ec37a1': 'Reading the calendars…',
  'settings.CalendarsSettings.value_of_the_calendars_could.c86147d0':
    '{value0} of the calendars could not be read; each says why below.',
  'settings.CalendarsSettings.read_every_calendar_again_now.d8b13597':
    'Read every calendar again now rather than at the next interval.',
  'settings.FinanceSettings.transactions.3e5136fd': 'Transactions',
  'settings.FinanceSettings.transaction_path_template.39b564b9': 'Transaction path template',
  'settings.FinanceSettings.template_for_new_transaction_file.0e3740ec':
    'Template for new transaction file paths. Leave empty to keep existing paths; new transactions use their titles in the vault root. Variables: {literal0}, {literalDate}, {literal1}, {literal2}, {literal3}, {literal4}.',
  'settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45': 'e.g. {literal1}',
  'settings.FinanceSettings.transaction_template_note.010eab6c': 'Transaction template note',
  'settings.FinanceSettings.path_to_a_template_note.397b813a':
    'Path to a template note used when creating new transactions.',
  'settings.FinanceSettings.path_to_template_note.18b70a08': 'Path to template note',
  'settings.FinanceSettings.default_currency.67e65877': 'Default currency',
  'settings.FinanceSettings.default_currency_code_for_new.7d536f52':
    'Default currency code for new transactions.',
  'settings.FinanceSettings.e_g_eur.00afdaf5': 'e.g. {literal0}',
  'settings.FinanceSettings.pinned_currencies.b882d6bc': 'Pinned currencies',
  'settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698':
    'Comma-separated currencies to show balance summaries in the sidebar. Order is preserved.',
  'settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64': 'e.g. {literal0}',
  'settings.FinanceSettings.exchange_rates.a1875e41': 'Exchange rates',
  'settings.FinanceSettings.fetch_today_s_rates.c175748e': "Fetch today's rates",
  'settings.FinanceSettings.once_a_day_from_a.73d47942':
    'Once a day, from a public table that needs no key; nothing about the vault is sent. Sums of several currencies and the order of accounts by amount use them.',
  'settings.FinanceSettings.show_sums_in.86b3b3d2': 'Show sums in',
  'settings.FinanceSettings.the_currency_a_sum_of.42c9988d':
    'The currency a sum of several currencies is shown in.',
  'settings.FinanceSettings.rates.54dd2169': 'Rates',
  'settings.FinanceSettings.fetch_today_s_rates_now.68e35189': "Fetch today's rates now",
  'settings.FinanceSettings.firefly_iii_migration.59031cf7': 'Firefly III Migration',
  'settings.FinanceSettings.firefly_iii_url.3050cc31': 'Firefly III URL',
  'settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a':
    'Base URL of your Firefly III instance.',
  'settings.FinanceSettings.e_g_https_firefly_example.6999e343': 'e.g. {literal1}',
  'settings.FinanceSettings.firefly_iii_token.45c3acb2': 'Firefly III token',
  'settings.FinanceSettings.personal_access_token_for_firefly.7deff96a':
    'Personal Access Token for Firefly III API. Stored in the keychain, never in the settings file.',
  'settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788': 'Enter your Firefly III token',
  'settings.FinanceSettings.forget_the_token.961a44b9': 'Forget the token',
  'settings.FinanceSettings.accounts_folder.8f9b5bf3': 'Accounts folder',
  'settings.FinanceSettings.folder_for_account_notes_created.dab1fa98':
    'Folder for account notes created during migration.',
  'settings.FinanceSettings.enter_accounts_folder_path.93935780': 'Enter accounts folder path',
  'settings.FinanceSettings.categories_folder.60253c7c': 'Categories folder',
  'settings.FinanceSettings.folder_for_category_notes_created.9f0764fe':
    'Folder for category notes created during migration.',
  'settings.FinanceSettings.enter_categories_folder_path.306fac3f': 'Enter categories folder path',
  'settings.FinanceSettings.fetching_today_s_rates.1182bcb9': "Fetching today's rates…",
  'settings.FinanceSettings.could_not_fetch_value.ae250f78': 'Could not fetch: {value0}',
  'settings.FinanceSettings.not_fetched_yet.21ca804f': 'Not fetched yet.',
  'settings.FinanceSettings.could_not_update_since_value.9af0a0fc':
    'Could not update since {value0}{value1}',
  'settings.FinanceSettings.from_value_value.11c05045': 'From {value0}, {value1}',
  'settings.FinanceSettings.no_rate_for_value_left.b8718978':
    'No rate for {value0}: left out of sums',
  'settings.GithubAccessReport.token.d2089be6': 'Token',
  'settings.GithubAccessReport.sent.c16bc82b': 'Sent',
  'settings.GithubAccessReport.not_sent.cd5f943d': 'Not sent',
  'settings.GithubAccessReport.refused.66b87354': 'Refused',
  'settings.GithubAccessReport.skipped.12698ce1': 'Skipped',
  'settings.GithubAccessReport.a_fine_grained_personal_access.04646cce':
    'a fine-grained personal access token',
  'settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc':
    'a classic personal access token',
  'settings.GithubAccessReport.an_oauth_token.4e87c03e': 'an OAuth token',
  'settings.GithubAccessReport.a_github_app_s_token.911c13a3': "a GitHub App's token",
  'settings.GithubAccessReport.a_token_of_a_kind.7af25278':
    'a token of a kind GitHub does not mark',
  'settings.GithubAccessReport.sent_with_every_request_value.a8affe59':
    'Sent with every request: {value0}, {value1} characters.',
  'settings.GithubAccessReport.no_token_was_sent_with.8d5461bf':
    'No token was sent with these requests.',
  'settings.GithubAccessReport.token_is_set_for_value.2c01fdf9': 'Token is set for: {value0}',
  'settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e':
    'Repository: {value0}/{value1} on {value2}',
  'settings.GithubAccessReport.belongs_to_value.d316930d': 'Belongs to {value0}.',
  'settings.GithubAccessReport.expires_value.f820bc15': 'Expires {value0}.',
  'settings.GithubAccessReport.scopes_value.1d42883b': 'Scopes: {value0}.',
  'settings.GithubAccessReport.api_value.011cfaea': 'API: {value0}',
  'settings.GithubAccessReport.needs_value.9e07998c': 'Needs: {value0}',
  'settings.GithubAccessReport.github_said_value.cc7a0df5': 'GitHub said: "{value0}"',
  'settings.GithubConnectionEditor.add_github_connection.a8b1ed9f': 'Add GitHub connection',
  'settings.GithubConnectionEditor.edit_github_connection.ca1cc639': 'Edit GitHub connection',
  'settings.GithubConnectionEditor.account.7e1b0d56': 'Account',
  'settings.GithubConnectionEditor.name.dcd1d522': 'Name',
  'settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0':
    'A name for this connection, independent of the account discovered from its token.',
  'settings.GithubConnectionEditor.connection_name.686d4d5d': 'Connection name',
  'settings.GithubConnectionEditor.server.aef7de28': 'Server',
  'settings.GithubConnectionEditor.empty_is_github_com_for.0f201123':
    'Empty is github.com. For Enterprise, use its full address including any port.',
  'settings.GithubConnectionEditor.github_com.3aeb0024': 'github.com',
  'settings.GithubConnectionEditor.token.d2089be6': 'Token',
  'settings.GithubConnectionEditor.github_pat.94238580': 'github_pat_...',
  'settings.GithubConnectionEditor.forget_the_token.961a44b9': 'Forget the token',
  'settings.GithubConnectionEditor.default_for_this_server.c7a4b365': 'Default for this server',
  'settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859':
    'Used when no repository-owner preference selects another connection.',
  'settings.GithubConnectionEditor.repository_owners.89c91e93': 'Repository owners',
  'settings.GithubConnectionEditor.one_per_line_sample_org.335517a9':
    'One per line: sample-org, sample-org/*, sample-*, or sample-org/project. More specific rules win.',
  'settings.GithubConnectionEditor.sample_org_nsample_org_project.9045ecd8':
    'sample-org\\nsample-org/project',
  'settings.GithubConnectionEditor.check_access.abb9a172': 'Check access',
  'settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0':
    'Checks only this connection. Leave the repository empty to discover the account.',
  'settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009': 'owner/repo or a GitHub link',
  'settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799':
    "Send read requests with this draft's token without storing it",
  'settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327':
    'Another connection uses the same account on this server. You can still save it.',
  'settings.GithubConnectionEditor.cancel.19766ed6': 'Cancel',
  'settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff':
    'Discard this draft without changing settings or the keychain',
  'settings.GithubConnectionEditor.save.1509f561': 'Save',
  'settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364':
    'Store this connection and its token, then close the editor',
  'settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6':
    'The token will be forgotten when you save.',
  'settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e':
    'A token is stored on this device. Enter a replacement, or leave empty to keep it. Changes are saved only with Save.',
  'settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60':
    'Synced keys are locked; unlock them to use the token, or enter a new one.',
  'settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf':
    'No token on this device. Stored in the keychain only when you save.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209':
    'Give owner/repo or a repository link.',
  'settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d':
    'This repository is on another server. Choose its connection instead.',
  'settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4':
    'This repository is on a different server address, scheme or port. Use this connection’s server.',
  'settings.GithubConnectionEditor.asking_github.5becc057': 'Asking GitHub…',
  'settings.GithubConnectionEditor.the_access_check_failed.90fa9dca': 'The access check failed.',
  'settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c':
    'Open repositories, issues, pull requests, commits and files from GitHub, Forgejo and Gitea in tabs, and notifications in a sidebar. Available actions depend on the service.',
  'settings.GithubSettings.open_github_links_in_obsidian.815b1959': 'Open Git links in Obsidian',
  'settings.GithubSettings.a_click_on_a_supported.f005fa1f':
    'A supported repository link opens in a tab. Other links, and links clicked with Alt held, open in the browser.',
  'settings.GithubSettings.default_repository.525a8366': 'Default repository',
  'settings.GithubSettings.where_the_command_open_github.750aa580':
    'Where Open GitHub link or item looks up an item when no repository tab supplies context. Use owner/repo or a repository link; choose a connection for an ambiguous name.',
  'settings.GithubSettings.owner_repo.65e817ee': 'owner/repo',
  'settings.GithubSettings.pinned_repositories.03dccfeb': 'Pinned repositories',
  'settings.GithubSettings.first_in_open_github_repository.067f8a9c':
    'First in Open GitHub repository…, and transferred with settings. Pin a repository from that picker (Alt+Enter) or a repository tab menu.',
  'settings.GithubSettings.nothing_pinned_yet.0b27e4d1': 'Nothing pinned yet.',
  'settings.GithubSettings.unpin_this_repository.91038877': 'Unpin this repository',
  'settings.GithubSettings.connections.dc273117': 'Connections',
  'settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9':
    'Each connection has its own service, server and account; choose one default per server. Use a token with repository read access for browsing. GitHub notifications require a classic token with the notifications scope.',
  'settings.GithubSettings.no_connections_public_github_com.534d40f4':
    'No connections. Public github.com repositories are read anonymously.',
  'settings.GithubSettings.default.2a7e0b7b': ' · Default',
  'settings.GithubSettings.check.9d60841e': 'Check',
  'settings.GithubSettings.check_this_connection_s_account.64de4945':
    "Check this connection's account and repository access",
  'settings.GithubSettings.edit.464c4ffd': 'Edit',
  'settings.GithubSettings.edit_this_connection_s_name.de8cb86e':
    "Edit this connection's name, server, token and owner preferences",
  'settings.GithubSettings.delete.e2d0a549': 'Delete',
  'settings.GithubSettings.remove_this_connection_after_confirmation.f3a7dd7f':
    'Remove this connection after confirmation',
  'settings.GithubSettings.public_github_com_anonymous.c18bb859': 'Public github.com (anonymous)',
  'settings.GithubSettings.value_of_value_requests_remaining.037c7ebe':
    '{value0} of {value1} requests remaining{value2}',
  'settings.GithubSettings.quota_not_observed_yet_normally.b802706a':
    'Quota not observed yet; normally 60 requests an hour shared by this device.',
  'settings.GithubSettings.add_connection.685f88ae': 'Add connection',
  'settings.GithubSettings.create_a_connection_with_its.a4245461':
    'Create a connection with its own keychain token',
  'settings.GithubSettings.notifications.78801183': 'Notifications',
  'settings.GithubSettings.a_fine_grained_personal_access.259d3619':
    'A fine-grained personal access token can read repository content, but GitHub serves notifications only to a classic token with the notifications scope. Set the Notifications token below for the retained single inbox. It stays bound to the server where it was set.',
  'settings.GithubSettings.notifications_token.e314ce9b': 'Notifications token',
  'settings.GithubSettings.optional_a_classic_personal_access.0e7b2561':
    'Optional. A classic personal access token with the notifications scope, used only by the notifications panel: GitHub does not let a fine-grained token read notifications. Empty: the panel uses the default connection. Stored in the keychain.',
  'settings.GithubSettings.ghp.ff475c83': 'ghp_...',
  'settings.GithubSettings.forget_the_notifications_token.5f48625d':
    'Forget the notifications token',
  'settings.GithubSettings.pages.9046da16': 'Pages',
  'settings.GithubSettings.how_a_github_tab_lays.f030133b':
    'How a GitHub tab lays out what it shows.',
  'settings.GithubSettings.page_width.217fbef1': 'Page width',
  'settings.GithubSettings.how_wide_the_text_of.8d0e20a7':
    'How wide the text of a tab runs: conversations, commit messages, rendered markdown and folder pages. Diffs and code always take the whole tab.',
  'settings.GithubSettings.width_in_pixels.b3f8f713': 'Width in pixels',
  'settings.GithubSettings.from_value_to_value_a.87f8c5fb':
    'From {value0} to {value1}. A tab narrower than this uses what it has.',
  'settings.GithubSettings.markdown_files_open_as.5541a0b8': 'Markdown files open as',
  'settings.GithubSettings.preview_rendered_and_a_link.7f27338b':
    'Preview: rendered, and a link to lines of the file marks the paragraphs, lists or code blocks that hold them. Code: the file as it is written, line by line. The switch above a file changes it for that tab.',
  'settings.GithubSettings.people.7db20897': 'People',
  'settings.GithubSettings.who_wrote_an_issue_a.deb19dbb':
    'Who wrote an issue, a comment, a review or a commit, with their picture. Names and pictures are asked of GitHub once and kept on this device for a week.',
  'settings.GithubSettings.show_people_by.989a820c': 'Show people by',
  'settings.GithubSettings.their_name_as_their_profile.2452b5a6':
    'Their name as their profile gives it, or their login. The other one is in the tooltip, and a click or a tap on a person swaps the two right there. Someone whose profile has no name is shown by login either way.',
  'settings.GithubSettings.kept_names_and_pictures.586c5b5f': 'Kept names and pictures',
  'settings.GithubSettings.clear.83b12c22': 'Clear',
  'settings.GithubSettings.forget_every_kept_name_and.ddf1b164':
    'Forget every kept name and picture; they are asked for again as people are shown',
  'settings.GithubSettings.nothing_is_kept_yet.7287d9c8': 'Nothing is kept yet',
  'settings.GithubSettings.code_search.ca5e7167': 'Code search',
  'settings.GithubSettings.search_the_code_of_the.1ce06300':
    'Search the code of the version a tab shows, and go to definition, from inside the tab. The repository at that version is downloaded once a session and searched here.',
  'settings.GithubSettings.largest_repository_to_download_mb.c4edc368':
    'Largest repository to download (MB)',
  'settings.GithubSettings.its_files_at_that_version.5d039cfc':
    'Total file size at that revision. Larger GitHub repositories fall back to server code search on the default branch, requiring a token. Forgejo and Gitea report the archive limit instead.',
  'settings.GithubSettings.delete_github_connection.e4dfa050': 'Delete Git connection',
  'settings.GithubSettings.delete_connection.e960651b': 'Delete connection',
  'settings.GithubSettings.delete_value_its_local_token.b78722f1':
    'Delete {value0}? Its local token will be forgotten; other connections are kept.',
  'settings.GithubSettings.remove_the_notifications_token_from.5b3f8312':
    'Remove the notifications token from the keychain? The notifications panel goes back to the main token.',
  'settings.GithubSettings.token_available_on_this_device.8141399a':
    'Token available on this device',
  'settings.GithubSettings.synced_keys_locked.1673153c': 'Synced keys locked',
  'settings.GithubSettings.no_token_on_this_device.a87b4f4f': 'No token on this device',
  'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4':
    'This connection changed elsewhere. Close this draft and edit its current settings.',
  'settings.GithubSettings.could_not_save_the_token.8edbb7d6':
    'Could not save the token to the keychain. Nothing was changed; try again.',
  'settings.GithubSettings.readable_line_width_like_notes.526184e3':
    'Readable line width, like notes',
  'settings.GithubSettings.full_width.d34008d2': 'Full width',
  'settings.GithubSettings.preview.324b134f': 'Preview',
  'settings.GithubSettings.code.340f4630': 'Code',
  'settings.GithubSettings.name.dcd1d522': 'Name',
  'settings.GithubSettings.login.9d6322c1': 'Login',
  'settings.GithubSettings.value_value_kept_on_this.ceefdd92': {
    one: '{count} person is kept on this device. Clear them to have every name and picture asked for again — after someone changed theirs, say.',
    other:
      '{count} people are kept on this device. Clear them to have every name and picture asked for again — after someone changed theirs, say.',
  },
  'settings.GithubSettings.none_kept_on_this_device.bfb58c42': 'None kept on this device yet.',
  'settings.ImageModelEditModal.add_image_model.6b3a2d66': 'Add Image Model',
  'settings.ImageModelEditModal.edit_image_model.ca72d086': 'Edit Image Model',
  'settings.ImageModelEditModal.model_id.089ef2b6': 'Model ID',
  'settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d':
    'API model identifier (e.g. gpt-image-1, flux-pro).',
  'settings.ImageModelEditModal.e_g_gpt_image.c781dc87': 'e.g. {literal0}',
  'settings.ImageModelEditModal.display_name.2b7f6a84': 'Display name',
  'settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Optional label shown in model selector.',
  'settings.ImageModelEditModal.e_g_gpt_image.5ae53afd': 'e.g. {literal0}',
  'settings.ImageModelEditModal.size.1af85190': 'Size',
  'settings.ImageModelEditModal.image_dimensions.1a4bb2f3': 'Image dimensions.',
  'settings.ImageModelEditModal.quality.1b2c08a8': 'Quality',
  'settings.ImageModelEditModal.output_format.93c53d37': 'Output format',
  'settings.ImageModelEditModal.delete_image_model.f28aaecc': 'Delete image model',
  'settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0':
    'Delete {value0}? Agents using it will have no model until one is\n        chosen again.',
  'settings.ImageModelEditModal.save.1509f561': 'Save',
  'settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Keep these settings and close',
  'settings.ImageModelEditModal.delete.e2d0a549': 'Delete',
  'settings.ImageModelEditModal.remove_this_image_model_from.c139edec':
    'Remove this image model from the provider',
  'settings.ImageModelEditModal.landscape.caa8642b': '1536×1024 (landscape)',
  'settings.ImageModelEditModal.portrait.29d9d2d0': '1024×1536 (portrait)',
  'settings.ImageModelEditModal.auto.02862497': 'Auto',
  'settings.ImageModelEditModal.low.f793de20': 'Low',
  'settings.ImageModelEditModal.medium.8e588cd1': 'Medium',
  'settings.ImageModelEditModal.high.c4ebc6d4': 'High',
  'settings.JournalsSettings.value_journal.cc8a4dd5': '{value0} journal',
  'settings.JournalsSettings.journal_value.06b87038': 'Journal #{value0}',
  'settings.JournalsSettings.remove_this_journal.c3a84c0a': 'Remove this journal',
  'settings.JournalsSettings.default_journal.b54bf1fd': 'Default journal',
  'settings.JournalsSettings.journal_name.4a021433': 'Journal name',
  'settings.JournalsSettings.journal_type_property_value_or.04441eaf':
    'Journal type property value or filename RegExp',
  'settings.JournalsSettings.type_or_regexp.241a5ad0': 'Type or RegExp',
  'settings.JournalsSettings.date_property_name.8e90965d': 'Date property name',
  'settings.JournalsSettings.optional.59be7133': 'Optional',
  'settings.JournalsSettings.new_journal_note_path_template.862462e1':
    'New journal note path template',
  'settings.JournalsSettings.path_template.ec234daf': 'Path template',
  'settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9':
    'Day of reccurence period, when note is created',
  'settings.JournalsSettings.optional_default_to_first.e58c831d': "Optional. Default to 'first'.",
  'settings.JournalsSettings.template_note_path.de4db36f': 'Template note path',
  'settings.JournalsSettings.journal_reccurence.8957b0f1': 'Journal reccurence',
  'settings.JournalsSettings.add_journal.f49ae75e': 'Add journal',
  'settings.JournalsSettings.add_another_journal.0d345224': 'Add another journal',
  'settings.JournalsSettings.daily.b36c2611': 'Daily',
  'settings.JournalsSettings.weekly.29751324': 'Weekly',
  'settings.JournalsSettings.monthly.9b11f6b7': 'Monthly',
  'settings.JournalsSettings.yearly.6e69b59e': 'Yearly',
  'settings.KeyDestinationsModal.review_key_destinations.2058c462': 'Review key destinations',
  'settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597':
    'Choose a key and recipient. Confirmation and HTTP allowance are local to this device.',
  'settings.KeyDestinationsModal.saved_key.85ec79d9': 'Saved key',
  'settings.KeyDestinationsModal.recipient_address.454d0391': 'Recipient address',
  'settings.KeyDestinationsModal.recipient_url.59ef2635': 'Recipient URL',
  'settings.KeyDestinationsModal.new_key_name.0e18145f': 'New key name',
  'settings.KeyDestinationsModal.new_key_value.7a7e9552': 'New key value',
  'settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477':
    'Protected storage; saved only when you confirm.',
  'settings.KeyDestinationsModal.key_permissions.1f24b6b7': 'Key permissions',
  'settings.KeyDestinationsModal.let_value_be_sent_to.3057160b':
    'Let {value0} be sent to {value1} from this device',
  'settings.KeyDestinationsModal.remove_key_permission.60713985': 'Remove key permission',
  'settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd':
    'Stop sending {value0} to {value1}; the key stays saved',
  'settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5':
    'Service destinations to confirm',
  'settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2':
    'Let {value0} receive its key at {value1} from this device',
  'settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3':
    'HTTP transport on this device',
  'settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f':
    'Unencrypted transport only; each key still needs its own recipient permission.',
  'settings.KeyDestinationsModal.remove_http_exception.ae72ff92': 'Remove HTTP exception',
  'settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28':
    'Stop allowing unencrypted key transport to {value0}',
  'settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc': 'Allow key and address',
  'settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82':
    'Save this key permission on this device; nothing is sent now',
  'settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d':
    ' — Unencrypted: anyone on the network path can read the key.',
  'settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1':
    ' — Public HTTP cannot receive keys. Change this address to HTTPS.',
  'settings.KeyDestinationsModal.choose_a_key.68bb8fb8': 'Choose a key',
  'settings.KeyDestinationsModal.save_a_new_named_key.7982a2de': 'Save a new named key…',
  'settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb':
    ' Save this new key in protected storage.',
  'settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0':
    'Choose a saved key and enter the recipient address.',
  'settings.KeyDestinationsModal.allowed_on_this_device.bac894b7': 'Allowed on this device',
  'settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda':
    'Needs confirmation on this device',
  'settings.KeyDestinationsModal.allow_unencrypted_http.e905502b': 'Allow unencrypted HTTP',
  'settings.KeyDestinationsModal.allow_on_this_device.a92ce243': 'Allow on this device',
  'settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8':
    'The store key cannot be sent to a recipient.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46':
    'Allowed {value0} → {value1}. Retry the original script; nothing was sent automatically.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642':
    'Allowed {value0} → {value1}. Retry the original script.',
  'settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad':
    'Removed {value0} → {value1}. The saved key and other permissions remain.',
  'settings.KeyDestinationsModal.confirmed_value_value.b96426a6': 'Confirmed {value0} → {value1}.',
  'settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86':
    'HTTP exception removed. Keys cannot use this unencrypted address.',
  'settings.LinksSettings.links_that_run_things.6849bb37': 'Links that run things',
  'settings.LinksSettings.each_one_is_an_obsidian.bcfd9260':
    'Each one is an obsidian:// address that runs a script or a command when it is opened — from a bookmark, another app or a shortcut.',
  'settings.LinksSettings.untitled_link.be1c93df': 'Untitled link',
  'settings.LinksSettings.copy_the_link_s_address.331a3bd9': "Copy the link's address",
  'settings.LinksSettings.change_this_link.f6aa89bf': 'Change this link',
  'settings.LinksSettings.add_another_link.a8b73866': 'Add another link',
  'settings.LinksSettings.no_links_yet.30d3e862': 'No links yet',
  'settings.LinksSettings.a_name_for_the_address.f36bdc5a':
    'A name for the address, and the script or command it runs.',
  'settings.LinksSettings.add_link.dfe9ca4d': 'Add link',
  'settings.LinksSettings.add_a_link_and_set.5eb68448': 'Add a link and set it up',
  'settings.LinksSettings.new_link.98ee0dfb': 'New link',
  'settings.LinksSettings.name.dcd1d522': 'Name',
  'settings.LinksSettings.the_part_of_the_address.2929fc21':
    'The part of the address after name=, in plain letters and dashes.',
  'settings.LinksSettings.add_movie.2f79eca6': 'add-movie',
  'settings.LinksSettings.runs.848f54e8': 'Runs',
  'settings.LinksSettings.script.102acc10': 'Script',
  'settings.LinksSettings.choose_a_script.d8ff6dd0': 'Choose a script…',
  'settings.LinksSettings.search_the_scripts_for_the.e5119ad8':
    'Search the scripts for the one this link runs',
  'settings.LinksSettings.command.71316697': 'Command',
  'settings.LinksSettings.search_the_commands_for_the.ebe2fa5b':
    'Search the commands for the one this link runs',
  'settings.LinksSettings.wait_for_sync.8d3efbd1': 'Wait for sync',
  'settings.LinksSettings.run_only_once_obsidian_sync.91ba259b':
    'Run only once Obsidian Sync has brought the vault up to date.',
  'settings.LinksSettings.address.56ef8f20': 'Address',
  'settings.LinksSettings.add_param_value_to_hand.2c89675e':
    'Add &param=value to hand the script its values.',
  'settings.LinksSettings.delete.e2d0a549': 'Delete',
  'settings.LinksSettings.remove_this_link.d7173cb1': 'Remove this link',
  'settings.LinksSettings.done.11a6767d': 'Done',
  'settings.LinksSettings.close_this_window_changes_are.91342d87':
    'Close this window; changes are kept as you make them',
  'settings.LinksSettings.choose_a_command.58e501e1': 'Choose a command…',
  'settings.LinksSettings.runs_the_script_value.c5e5c031': 'Runs the script {value0}',
  'settings.LinksSettings.runs_a_script_none_chosen.1b6f1723': 'Runs a script — none chosen yet',
  'settings.LinksSettings.runs_the_command_value.c397fa11': 'Runs the command {value0}',
  'settings.LinksSettings.runs_a_command_none_chosen.67edb64d': 'Runs a command — none chosen yet',
  'settings.LinksSettings.link_copied.d12860c2': 'Link copied',
  'settings.LintRuleModal.on.13001175': 'On',
  'settings.LintRuleModal.switched_off_the_rule_checks.db75c03b':
    'Switched off, the rule checks nothing.',
  'settings.LintRuleModal.how_bad.016a19df': 'How bad',
  'settings.LintRuleModal.an_error_or_a_warning.ea93bb11':
    'An error or a warning, as the list shows it.',
  'settings.LintRuleModal.where_it_applies.39e44cbf': 'Where it applies',
  'settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53':
    'Left empty, everywhere. Lists are comma-separated.',
  'settings.LintRuleModal.only_in.aed9f516': 'Only in',
  'settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac':
    'Folders, or globs like Projects/*/Tasks.',
  'settings.LintRuleModal.everywhere.dcc10bfd': 'Everywhere',
  'settings.LintRuleModal.not_in.1bc8651b': 'Not in',
  'settings.LintRuleModal.folders_or_globs_left_alone.a5983464':
    'Folders or globs left alone inside those.',
  'settings.LintRuleModal.nowhere.7e32434d': 'Nowhere',
  'settings.LintRuleModal.note_types.52d728fb': 'Note types',
  'settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66':
    'Only notes whose type is one of these.',
  'settings.LintRuleModal.any_type.b05fc1fe': 'Any type',
  'settings.LintRuleModal.having_a_property.07dd0569': 'Having a property',
  'settings.LintRuleModal.only_notes_with_this_property.adbc72b9':
    'Only notes with this property — equal to the value, when one is given.',
  'settings.LintRuleModal.property.40040cb1': 'Property',
  'settings.LintRuleModal.any_value.004f62d2': 'Any value',
  'settings.LintRuleModal.settings_of_the_rule.99e57b0c': 'Settings of the rule',
  'settings.LintRuleModal.as_it_ships.be4ca4de': 'As it ships',
  'settings.LintRuleModal.put_this_rule_back_the.6e2ebc57':
    'Put this rule back the way the plugin ships it',
  'settings.LintRuleModal.done.11a6767d': 'Done',
  'settings.LintRuleModal.close_this_the_changes_are.459403b0': 'Close this; the changes are saved',
  'settings.LintRuleModal.error.54a0e8c1': 'Error',
  'settings.LintRuleModal.warning.e981ddae': 'Warning',
  'settings.LinterSettings.the_linter_checks_notes_against.67baa82b':
    'The linter checks notes against the rules below — a note at a time, a folder or the whole vault — and lists what does not follow them in a tab of its own. Much of it can be fixed there in one go; the rest opens at the line to fix by hand.',
  'settings.LinterSettings.linter.99bede8d': 'Linter',
  'settings.LinterSettings.the_tab_with_what_the.e019607d': 'The tab with what the last run found.',
  'settings.LinterSettings.open_linter.72c54acd': 'Open linter',
  'settings.LinterSettings.close_the_settings_and_open.125786ff':
    "Close the settings and open the linter's tab",
  'settings.LinterSettings.folders_to_skip.ad324780': 'Folders to skip',
  'settings.LinterSettings.no_rule_looks_in_these.2a478951':
    'No rule looks in these, unless a note in one is linted by name. Comma-separated; a folder, or a glob like Archive/**.',
  'settings.LinterSettings.templates_attachments.2440bdba': 'Templates, Attachments',
  'settings.LinterSettings.rules.4228aeb0': 'Rules',
  'settings.LinterSettings.each_can_be_switched_off.240786af':
    'Each can be switched off, told how bad a finding is, kept to some folders or note types, and given its own settings.',
  'settings.LinterSettings.set_up_value.45578254': 'Set up {value0}',
  'settings.LinterSettings.rules_of_your_own.f29b0461': 'Rules of your own',

  'settings.LinterSettings.no_script_rules_yet.37cf496e': 'No script rules yet.',
  'settings.LinterSettings.not_in_value.d95a4831': 'not in {value0}',
  'settings.LinterSettings.for_value_notes.670a9ee4': 'for {value0} notes',
  'settings.LinterSettings.is_set.c7d5e11f': ' is set',
  'settings.LinterSettings.error.54a0e8c1': 'Error',
  'settings.LinterSettings.warning.e981ddae': 'Warning',
  'settings.LogsSettings.logs_note_types.0793e6f2': 'Logs note types',
  'settings.LogsSettings.optional_comma_separated_list_of.8730c2d2':
    'Optional comma-separated list of note types to consider as log notes.',
  'settings.LogsSettings.e_g_journal_log_daily.a54faefe': 'e.g. {literal0}',
  'settings.ModelEditModal.add_model.7060e824': 'Add Model',
  'settings.ModelEditModal.edit_model.e76cc0ba': 'Edit Model',
  'settings.ModelEditModal.model_id.089ef2b6': 'Model ID',
  'settings.ModelEditModal.api_model_identifier_e_g.5c0e2892':
    'API model identifier (e.g. gpt-4o, claude-sonnet-4-20250514).',
  'settings.ModelEditModal.e_g_gpt_o.c6a41eb7': 'e.g. {literal0}',
  'settings.ModelEditModal.display_name.2b7f6a84': 'Display name',
  'settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Optional label shown in model selector.',
  'settings.ModelEditModal.e_g_gpt_o.c9f23b2e': 'e.g. {literal0}',
  'settings.ModelEditModal.context_window.7696d085': 'Context window',
  'settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14':
    'Maximum input tokens the model supports.',
  'settings.ModelEditModal.max_output_tokens.397dda07': 'Max output tokens',
  'settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9':
    'Maximum tokens in a single response.',
  'settings.ModelEditModal.request_timeout_seconds.1b1b1d08': 'Request timeout (seconds)',
  'settings.ModelEditModal.wait_for_the_first_response.08adebcb':
    'Wait for the first response or next chunk, not the whole answer. 1–3600 seconds; empty uses the global timeout. Applies to chat and background work with this model.',
  'settings.ModelEditModal.global_timeout.542c2bf3': 'Global timeout',
  'settings.ModelEditModal.reasoning.d8211e24': 'Reasoning',
  'settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996':
    'Enable reasoning/thinking for supported models.',
  'settings.ModelEditModal.thinking_effort.264c28cb': 'Thinking effort',
  'settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5':
    "Controls how much reasoning the model does. Leave at Default for model's own behavior.",
  'settings.ModelEditModal.delete_model.b7828ba0': 'Delete model',
  'settings.ModelEditModal.delete_value_agents_using_it.c65217d0':
    'Delete {value0}? Agents using it will have no model until one is\n        chosen again.',
  'settings.ModelEditModal.save.1509f561': 'Save',
  'settings.ModelEditModal.keep_these_settings_and_close.88a64dfa': 'Keep these settings and close',
  'settings.ModelEditModal.delete.e2d0a549': 'Delete',
  'settings.ModelEditModal.remove_this_model_from_the.2838dd4b':
    'Remove this model from the provider',
  'settings.ModelEditModal.enter_seconds_correct_this_value.508147a7':
    'Enter 1–3600 seconds. Correct this value before saving.',
  'settings.OtherSettings.look.a0de5719': 'Look',
  'settings.OtherSettings.full_width_sidebars.bc7a2b4e': 'Full-width sidebars',
  'settings.OtherSettings.make_sidebars_take_the_full.15d01abc':
    'Make sidebars take the full screen width on a phone.',
  'settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63': 'Half-width sidebars on tablet',
  'settings.OtherSettings.make_sidebars_take_half_the.f915aa8e':
    'Make sidebars take half the screen width on a tablet.',
  'settings.OtherSettings.css_snippets_folder.0f718ada': 'CSS snippets folder',
  'settings.OtherSettings.vault_folder_with_css_files.063bfc1c':
    'Vault folder with .css files to auto-apply as style snippets. Leave empty to disable.',
  'settings.OtherSettings.e_g_snippets.d1877812': 'e.g. {literal0}',
  'settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19': 'Drawn by Abele in a note',
  'settings.OtherSettings.each_one_in_place_of.7bc5aa3f':
    "Each one in place of Obsidian's own drawing.",
  'settings.OtherSettings.own_drawing_of_properties.909062a8': 'Own drawing of properties',
  'settings.OtherSettings.in_a_note_s_properties.769ed541':
    "In a note's properties: a wallet's balance beside a link to it, sums worked out in number fields, and cards for File and Files properties and for the cover. Off is Obsidian's own drawing.",
  'settings.OtherSettings.counter_properties.8ebc8e5b': 'Counter properties',
  'settings.OtherSettings.comma_separated_property_names_drawn.054f1654':
    'Comma-separated property names drawn as a number with − and + buttons. An empty value counts as 0. Needs own drawing of properties on.',
  'settings.OtherSettings.e_g_reps_glasses.bcb26756': 'e.g. {literal0}',
  'settings.OtherSettings.mermaid_viewer.0fee57c7': 'Draw diagrams',
  'settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa':
    'Draw mermaid and pele blocks with zoom, drag and full screen. Turn off to show their source as ordinary code.',
  'settings.OtherSettings.open_canvases_in_abele.0104f91b': 'Open canvases in Abele',
  'settings.OtherSettings.open_diagrams_in_the_read.b48fc66f':
    'Open diagrams in the read-only viewer with walkthrough steps. Use Open in Obsidian Canvas in its header to edit a diagram in the native canvas.',
  'settings.OtherSettings.editor_syntax_highlighting.9bbd35c2': 'Editor syntax highlighting',
  'settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd':
    "Highlight more fenced-code languages in Source and Live Preview, using Obsidian's own theme. Native highlighting and rendered blocks stay unchanged. Extra highlighting is limited to blocks of 32,768 characters and 1,000 lines.",
  'settings.OtherSettings.opening_notes.d2eceee4': 'Opening notes',
  'settings.OtherSettings.remember_where_notes_were_left.1010d0b2':
    'Remember where notes were left',
  'settings.OtherSettings.open_each_note_at_the.c4f04706':
    "Open each note at the scroll and cursor it was left at, kept on this device. A link to a heading or block, a search result or a book's highlight still goes to its own place.",
  'settings.OtherSettings.maps.119e66d1': 'Maps',
  'settings.OtherSettings.coordinates_property.afe852a5': 'Coordinates property',
  'settings.OtherSettings.note_property_holding_a_place.d3b2dd8b':
    "Note property holding a place as 'lat, lon'. The agent is told to write into this one.",
  'settings.OtherSettings.coordinates.29abdbc9': 'coordinates',
  'settings.OtherSettings.map_style.62a4d250': 'Map style',
  'settings.OtherSettings.how_maps_in_notes_and.dc2e0608':
    'How maps in notes and chats look. The free styles need no key or account.',
  'settings.OtherSettings.style_url.221b2c65': 'Style URL',
  'settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee':
    'A MapLibre style.json of your own provider.',
  'settings.OtherSettings.the_plugin.cb8c07f4': 'The plugin',
  'settings.OtherSettings.changelog.ead07c84': 'Changelog',
  'settings.OtherSettings.see_what_changed_in_every.b28c48a6':
    'See what changed in every plugin version, newest first.',
  'settings.OtherSettings.open_changelog.f8738613': 'Open changelog',
  'settings.OtherSettings.open_the_plugin_changelog.f99c92b8': 'Open the plugin changelog',
  'settings.OtherSettings.keyboard_diagnostics.b559c4cd': 'Keyboard diagnostics',
  'settings.OtherSettings.show_at_the_top_of.2cad0798':
    'Show, at the top of the screen, what the app reports about the on-screen keyboard — for a screenshot when a dialog ends up under it. Stays on this device.',
  'settings.OtherSettings.date_properties.9201e6b8': 'Date properties',
  'settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640':
    'Comma-separated property names drawn as a date with buttons a day back and on, how far away it is, and a button to its daily note. Needs own drawing of properties on.',
  'settings.OtherSettings.priority_properties.21f4bae9': 'Priority properties',
  'settings.OtherSettings.comma_separated_property_names_drawn.b31eb248':
    'Comma-separated property names drawn as a task priority, low, medium or high, with buttons to raise and lower it. Needs own drawing of properties on.',
  'settings.OtherSettings.label_properties.7ad8c49d': 'Label properties',
  'settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7':
    'Comma-separated property names drawn as labels, added from those already used in the vault or typed. Needs own drawing of properties on.',
  'settings.OtherSettings.group_properties.23d1a496': 'Group properties',
  'settings.OtherSettings.comma_separated_property_names_that.cb39dad8':
    'Comma-separated property names that get a button beside their list, adding one of the notes already used as groups. The list is still typed into as usual. Needs own drawing of properties on.',
  'settings.QuickButtonSettings.a_round_button_at_the.aa095d26':
    "A round button at the edge of the screen on a phone. It opens a menu of quick actions for whatever is in front: your own actions below, a note's header buttons, and what the plugin offers there — a book's search and highlights, a note's timer and chat. It gets out of the way while you read or type. Drag it to move it; it keeps the side and height it is left at.",
  'settings.QuickButtonSettings.show_the_quick_button.65b455f7': 'Show the quick button',
  'settings.QuickButtonSettings.on_a_phone_it_is.0737337d':
    'On a phone. It is a concept, so it starts switched off.',
  'settings.QuickButtonSettings.also_on_a_tablet.5f696152': 'Also on a tablet',
  'settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d':
    'Show it on a tablet as well as on a phone.',
  'settings.QuickButtonSettings.side.630ef00b': 'Side',
  'settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46':
    'The edge of the screen it stands at. Dragging it across changes it.',
  'settings.QuickButtonSettings.height.bfe2eca4': 'Height',
  'settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1':
    'Dragged higher than where it rests, above the bottom bar of each screen.',
  'settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94':
    'Where it rests: just above the bottom bar of each screen.',
  'settings.QuickButtonSettings.put_it_back.55057d7e': 'Put it back',
  'settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b':
    'Move it back down to where it rests',
  'settings.QuickButtonSettings.it_is_already_where_it.36b74557':
    'It is already where it rests; drag it to raise it',
  'settings.QuickButtonSettings.your_actions.6c06c355': 'Your actions',
  'settings.QuickButtonSettings.at_the_top_of_the.b6848b73':
    'At the top of the menu, in this order. A command appears only where it can run, so one meant for notes is not offered over a book.',
  'settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002': 'Nothing of your own yet.',
  'settings.QuickButtonSettings.name_in_the_menu.feca41eb': 'Name in the menu',
  'settings.QuickButtonSettings.choose_the_icon_it_has.e8357476':
    'Choose the icon it has in the menu',
  'settings.QuickButtonSettings.already_the_first.eab62d41': 'Already the first',
  'settings.QuickButtonSettings.move_it_up_the_menu.20938d10': 'Move it up the menu',
  'settings.QuickButtonSettings.already_the_last.a6ec4b12': 'Already the last',
  'settings.QuickButtonSettings.move_it_down_the_menu.dc508335': 'Move it down the menu',
  'settings.QuickButtonSettings.take_it_out_of_the.4a64934c': 'Take it out of the menu',
  'settings.QuickButtonSettings.add_a_command.b907f252': 'Add a command',
  'settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7':
    "Search Obsidian's commands — any plugin's — for one to put in the menu",
  'settings.QuickButtonSettings.add_a_script.c4526bc4': 'Add a script',
  'settings.QuickButtonSettings.search_your_scripts_for_one.df40b370':
    'Search your scripts for one to put in the menu',
  'settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a': 'Take out of the menu',
  'settings.QuickButtonSettings.take_value_out_of_the.f628c5a3':
    'Take {value0} out of the quick menu? The command or script itself stays.',
  'settings.QuickButtonSettings.right.883361d5': 'Right',
  'settings.QuickButtonSettings.left.58eb9032': 'Left',
  'settings.QuickButtonSettings.unnamed.e504e615': 'Unnamed',
  'settings.QuickButtonSettings.command_value.b7bcffe4': 'Command: {value0}',
  'settings.QuickButtonSettings.script_value.804f5354': 'Script: {value0}',
  'settings.ReaderSettings.epub_books_in_the_vault.7574b8de':
    "EPUB books in the vault open in a reader tab of their own, and PDFs can too. These choices apply to every book, and can also be changed from a book's tab with the Aa button.",
  'settings.SavedKeyRequestModal.send_saved_keys.618ddec9': 'Send saved keys?',
  'settings.SavedKeyRequestModal.key.99a52df3': 'Key',
  'settings.SavedKeyRequestModal.keys.f0d66a79': 'Keys',
  'settings.SavedKeyRequestModal.sent_to.4e7201c7': 'Sent to',

  'settings.SavedKeyRequestModal.cancel.19766ed6': 'Cancel',
  'settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8':
    'Send nothing and leave the permissions as they are',
  'settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17': 'Allow address and send',
  'settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3':
    'Remember {value0} for these keys on this device, then send the request',
  'settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82':
    'Could not save this key permission, so nothing was sent. Check key destinations and try again.',
  'settings.ScriptsSettings.library.dc20b3d5': 'Library',
  'settings.ScriptsSettings.every_script_in_the_folder.8e2a3585':
    'Every script in the folder, and what it does',
  'settings.ScriptsSettings.selection_menus.22601a32': 'Selection menus',
  'settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4':
    'Choose scripts for books and chats independently',
  'settings.ScriptsSettings.header_buttons.1d80ae78': 'Header buttons',
  'settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e':
    'Buttons in note headers that run a script',
  'settings.ScriptsSettings.automations.ad1fb9ec': 'Automations',
  'settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66':
    'Scripts that run by themselves when a task or a note changes',
  'settings.ScriptsSettings.startup.65d48235': 'Startup',
  'settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc':
    'Scripts that run each time Obsidian starts',
  'settings.ScriptsSettings.general.c910d474': 'General',
  'settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d':
    'Turn scripts on and choose their folder',
  'settings.ScriptsSettings.books.9da7f76b': 'Books',
  'settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97':
    'Scripts on words selected in a book',
  'settings.ScriptsSettings.chats.ef5b4049': 'Chats',
  'settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b':
    'Scripts chosen for words selected in a chat',
  'settings.SecretField.hide_the_key.46a22923': 'Hide the key',
  'settings.SecretField.show_the_key.90d90eb7': 'Show the key',
  'settings.SecretField.copy_the_key.30d7860a': 'Copy the key',
  'settings.SecretField.new_key.31ffdeb5': 'New key...',
  'settings.SecretField.save_key.b6e0aef2': 'Save key',
  'settings.SecretField.the_key.144976d8': 'The key',
  'settings.SecretStoreSettings.synced_keys.a764d83d': 'Synced keys',
  'settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab':
    "Every API key and token kept in one encrypted store that syncs with the plugin's settings. Each device needs only the passphrase, typed once. Without it the store is unreadable, on any device and in any copy of the settings file.",
  'settings.SecretStoreSettings.status.920e413c': 'Status',
  'settings.SecretStoreSettings.all_keys.9e5c5da4': 'All keys',
  'settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da':
    'Every key the plugin uses on this device: what it is for, whether it is synced, and a way to show or copy it.',
  'settings.SecretStoreSettings.show.0df6f1ca': 'Show',
  'settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1': 'List every key on this device',
  'settings.SecretStoreSettings.passphrase.e7611f05': 'Passphrase',
  'settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e':
    'At least 12 characters. Typed on every device that should have the keys; nothing can recover it.',
  'settings.SecretStoreSettings.repeat_the_passphrase.4b93336c': 'Repeat the passphrase',
  'settings.SecretStoreSettings.passphrase_again.47b97578': 'Passphrase again',
  'settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573':
    'Keys moving into the store: {value0}',
  'settings.SecretStoreSettings.cancel.19766ed6': 'Cancel',
  'settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492':
    'Close this and change nothing',
  'settings.SecretStoreSettings.turn_on.5a1f096a': 'Turn on',
  'settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24':
    "Encrypt this device's keys into the store and sync them",
  'settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910':
    'Moves the keys this device has into the store, under a passphrase you choose.',
  'settings.SecretStoreSettings.set_up.4da10f1f': 'Set up',
  'settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b':
    'Choose a passphrase for the synced keys',
  'settings.SecretStoreSettings.unlock_on_this_device.ec7699b7': 'Unlock on this device',
  'settings.SecretStoreSettings.unlock.4ac709aa': 'Unlock',
  'settings.SecretStoreSettings.open_the_store_here_and.879288fd':
    "Open the store here and put its keys in this device's keychain",
  'settings.SecretStoreSettings.new_passphrase.5cc14549': 'New passphrase',
  'settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e':
    'Every other device asks for it once, the next time the settings reach it.',
  'settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be': 'Repeat the new passphrase',
  'settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb': 'New passphrase again',
  'settings.SecretStoreSettings.change_the_passphrase.a9a3e51b': 'Change the passphrase',
  'settings.SecretStoreSettings.change.c0bf75bd': 'Change',
  'settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af':
    'Encrypt the store again under the new passphrase',
  'settings.SecretStoreSettings.change_passphrase.a0ffb851': 'Change passphrase',
  'settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29':
    'The keys are encrypted again. Other devices keep working with their keys, and ask for the new passphrase.',
  'settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286': 'Choose a new passphrase',
  'settings.SecretStoreSettings.remove_from_this_device.43b9a522': 'Remove from this device',
  'settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0':
    'The passphrase and every key in the store leave this device. The store and other devices keep them; unlock again to get them back.',
  'settings.SecretStoreSettings.remove.c3812fc4': 'Remove',
  'settings.SecretStoreSettings.take_the_synced_keys_off.537f867f':
    'Take the synced keys off this device',
  'settings.SecretStoreSettings.turn_off.06f0e210': 'Turn off',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0':
    'The store leaves the settings. Every device that was unlocked keeps its keys in its own keychain; any other device will need them entered by hand.',
  'settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d':
    'Stop syncing keys, keeping them on each device',
  'settings.SecretStoreSettings.start_over.5eed7e9f': 'Start over',
  'settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f':
    'Removes the store from the settings on every device, for a new one with a new passphrase. The keys this device has stay here.',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2':
    'Remove the synced keys from the settings',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195':
    'Remove the synced keys from this device',
  'settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae':
    "The passphrase and the {value0} in the store leave this device's keychain. Features using them stop working here until it is unlocked again.",
  'settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c': 'Turn off synced keys',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814':
    'The store leaves the settings on every device. Devices that were unlocked keep their keys; a new device will not get them.',
  'settings.SecretStoreSettings.the_store_is_removed_from.7d71216a':
    "The store is removed from the settings on every device, with every key in it that no device holds. This device's own keys stay.",
  'settings.SecretStoreSettings.off.ca7981b4': 'Off',
  'settings.SecretStoreSettings.each_device_keeps_its_own.02c01692':
    'Each device keeps its own keys, entered on that device.',
  'settings.SecretStoreSettings.locked_on_this_device.e1223c06': 'Locked on this device',
  'settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954':
    'Another device keeps keys in the store. Enter its passphrase to have them here too.',
  'settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4': 'Unlocked on this device',
  'settings.SecretStoreSettings.out_of_date.c8f1506a': 'Out of date',
  'settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603':
    'The passphrase was changed on another device. Keys already here keep working; enter the new passphrase to get changes again.',
  'settings.SecretStoreSettings.damaged.3604e21d': 'Damaged',
  'settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8':
    'The store in the settings file cannot be decrypted, though this device has the right passphrase: the file was changed by something other than the plugin. Keys already on this device keep working.',
  'settings.SecretStoreSettings.value_in_the_store_a.02db016b':
    '{value0} in the store. A key added or changed anywhere in the plugin goes into it and reaches your other devices with the settings.',
  'settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8':
    'That passphrase does not open the store.',
  'settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983':
    'The new passphrase, as set on the other device.',
  'settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36':
    'The passphrase chosen when synced keys were turned on.',
  'settings.SecretStoreSettings.the_two_do_not_match.184006b7': 'The two do not match.',
  'settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6':
    'At least {value0} characters.',
  'settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86':
    'Synced keys are on: {value0} keys in the store.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c':
    'Synced keys could not be turned on',
  'settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b':
    'Unlocked: {value0} keys on this device.',
  'settings.SecretStoreSettings.the_store_could_not_be.be373a49': 'The store could not be unlocked',
  'settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec':
    'The passphrase is changed. Other devices will ask for it.',
  'settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1':
    'The passphrase could not be changed',
  'settings.SecretStoreSettings.the_keys_could_not_be.a70d217b':
    'The keys could not be removed from this device',
  'settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f':
    'Synced keys could not be turned off',
  'settings.SecretStoreSettings.the_store_could_not_be.76043571': 'The store could not be removed',
  'settings.SecretsListModal.all_keys.9e5c5da4': 'All keys',
  'settings.SecretsListModal.passphrase.e7611f05': 'Passphrase',
  'settings.SecretsListModal.unlock.4ac709aa': 'Unlock',
  'settings.SecretsListModal.open_the_store_here_and.6be7e00a':
    'Open the store here and list its keys',
  'settings.SecretsListModal.type_the_passphrase_first.397584ff': 'Type the passphrase first',
  'settings.SecretsListModal.the_synced_store_cannot_be.df30eba8':
    'The synced store cannot be decrypted, so the keys only it holds cannot be listed. The keys below are the ones this device has.',
  'settings.SecretsListModal.hide_the_key.46a22923': 'Hide the key',
  'settings.SecretsListModal.show_the_key.90d90eb7': 'Show the key',
  'settings.SecretsListModal.copy_the_key.30d7860a': 'Copy the key',
  'settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6':
    "No keys yet. A key entered anywhere in the plugin's settings is listed here.",
  'settings.SecretsListModal.copy_all.96e3f09a': 'Copy all',
  'settings.SecretsListModal.put_every_key_on_the.a26cf3c7':
    'Put every key on the clipboard, after a warning',
  'settings.SecretsListModal.no_key_is_set.f4f5b239': 'No key is set',
  'settings.SecretsListModal.copy_every_key.2f918de3': 'Copy every key',
  'settings.SecretsListModal.on_this_device.38b9d88c': 'On this device',
  'settings.SecretsListModal.synced.5da22fe4': 'Synced',
  'settings.SecretsListModal.differs_from_keychain.922767e7': 'Differs from keychain',
  'settings.SecretsListModal.only_in_the_store.9bb2ce40': 'Only in the store',
  'settings.SecretsListModal.not_in_the_store.507fd6ce': 'Not in the store',
  'settings.SecretsListModal.store_locked.d47ee0fe': 'Store locked',
  'settings.SecretsListModal.not_set.4895f731': 'Not set',
  'settings.SecretsListModal.this_device_s_keychain_holds.1b27e956':
    "This device's keychain holds another value, changed outside the plugin. The store's value is the one used.",
  'settings.SecretsListModal.in_the_store_but_not.5e27c94a':
    "In the store but not in this device's keychain. The plugin still uses it.",
  'settings.SecretsListModal.set_on_this_device_and.db43f1dd':
    'Set on this device and not in the store. Set it again to put it there.',
  'settings.SecretsListModal.not_used_by_any_setting.85faf2ac':
    'Not used by any setting on this device',
  'settings.SecretsListModal.updated_value.51194723': 'Updated {value0}',
  'settings.SecretsListModal.every_key_that_is_set.19a2b157':
    'Every key that is set, as lines of name = value — for a password manager, or to paste into another app.',
  'settings.SecretsListModal.every_key_listed_here_value.a6aac65e':
    'Every key listed here — {value0} of them — goes onto the clipboard as plain text, where any app on this device can read it. ',
  'settings.SecretsListModal.it_is_cleared_from_the.06480e6f':
    'It is cleared from the clipboard in a minute if it is still there.',
  'settings.SecretsListModal.on_this_device_it_stays.57af8178':
    'On this device it stays there until something else is copied.',
  'settings.SecretsListModal.synced_keys_are_out_of.408b671b': 'Synced keys are out of date here',
  'settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24':
    'Synced keys are locked on this device',
  'settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8':
    'That passphrase does not open the store.',
  'settings.SecretsListModal.the_store_may_hold_keys.5b2f6105':
    'The store may hold keys this device does not have. Their names are encrypted too, so they are listed once it is unlocked.',
  'settings.SecretsListModal.the_store_could_not_be.bafdcd54': 'The store could not be unlocked.',
  'settings.SyncSettings.waiting_for_you.9f760ab2': 'Waiting for you',
  'settings.SyncSettings.code_that_came_from_another.89b6b46f':
    'Code that came from another device and private files a shared note links to.',

  'settings.SyncSettings.view_the_exact_incoming_version.6497a546':
    'View the exact incoming version',

  'settings.SyncSettings.allow_or_deny_this_file.5d819259':
    'Allow or deny this file for this connection',
  'settings.SyncSettings.connections.dc273117': 'Connections',
  'settings.SyncSettings.each_connection_works_on_its.4a88585e':
    'Each connection works on its own. Disconnecting keeps every file on this device.',
  'settings.SyncSettings.no_connections_yet.8697571e': 'No connections yet',
  'settings.SyncSettings.paste_a_token_or_scan.257b9a79':
    'Paste a token or scan a QR code to connect.',
  'settings.SyncSettings.sync_this_connection_now.52cd5ea4': 'Sync this connection now',
  'settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85':
    'Pause, share, deleted files, disconnect',
  'settings.SyncSettings.connect_to_a_server.232ac7de': 'Connect to a server',
  'settings.SyncSettings.by_a_token_you_were.d2dab8e7':
    'By a token you were given, pasted or scanned.',
  'settings.SyncSettings.connect.c0e20f6d': 'Connect…',
  'settings.SyncSettings.paste_a_token_for_a.256b8463':
    'Paste a token for a server, folder or group',
  'settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6':
    'File exchange is opening. Connections that need attention keep their files here.',
  'settings.SyncSettings.sync_is_opening_if_it.1225ed54':
    'Sync is opening. If it cannot open, restart Obsidian and try again.',
  'settings.SyncSettings.the_whole_vault.0a409543': 'the whole vault',
  'settings.SyncSettings.deleted_value_from_the_server.70376e92':
    'Deleted {value0} from the server. Its files stay on this device.',
  'settings.SyncSettings.keep_syncing_into_the_same.12873e9a':
    'Keep syncing into the same local folder',
  'settings.SyncSettings.follow_moved_folder.bba3cc92': 'Follow moved folder',
  'settings.SyncSettings.restore_from_the_server.6186b8b7': 'Restore from the server',
  'settings.SyncSettings.resume.d640c742': 'Resume',
  'settings.SyncSettings.pause.858e4ba7': 'Pause',
  'settings.SyncSettings.share.51fc2d24': 'Share…',
  'settings.SyncSettings.deleted_files.5352e2e9': 'Deleted files',
  'settings.SyncSettings.what_this_device_syncs.979d00ce': 'What this device syncs',
  'settings.SyncSettings.disconnect.f1142965': 'Disconnect…',
  'settings.SyncSettings.delete_from_the_server.b3acd04d': 'Delete from the server…',
  'settings.SyncSettings.delete_from_the_server_read.5f7e4370': 'Delete from the server: read only',
  'settings.SyncSettings.delete_from_the_server_unavailable.516a170e':
    'Delete from the server: unavailable; check the server connection and version',
  'settings.SyncSettings.the_file_could_not_be.accad798':
    'The file could not be opened. Its contents have been kept. Try again when a server is available.',
  'settings.SyncSettings.incoming_changes_could_not_be.24745c6e':
    'Incoming changes could not be opened. Reopen sync settings to try again.',
  'settings.TaskLabelsSettings.labels.934b8899': 'Labels',
  'settings.TaskLabelsSettings.labels_are_read_from_a.310aa3b6':
    "Labels are read from a task's property, one value or a list of them. Each label can have a colour; the rest are grey.",
  'settings.TaskLabelsSettings.label_property.2b08cac9': 'Label property',
  'settings.TaskLabelsSettings.the_task_property_labels_are.5b8a2eb7':
    'The task property labels are read from (default: "labels").',
  'settings.TaskLabelsSettings.priority_property.1588ceb0': 'Priority property',
  'settings.TaskLabelsSettings.the_task_property_priority_is.19d87f4b':
    'The task property priority is read from and written to (default: "priority"). Does not change which properties have widgets.',
  'settings.TaskLabelsSettings.priority.3092a5f0': 'priority',
  'settings.TaskLabelsSettings.add_a_label.43db67d6': 'Add a label',
  'settings.TaskLabelsSettings.to_colour_a_label_before.7f8888f5':
    'To colour a label before any task carries it.',
  'settings.TaskLabelsSettings.label.0e66373f': 'Label',
  'settings.TaskLabelsSettings.add.9fd728c6': 'Add',
  'settings.TaskLabelsSettings.add_this_label_to_the.b2c3c5b9': 'Add this label to the list',
  'settings.TasksSettings.tasks_folder.9c703cd1': 'Tasks folder',
  'settings.TasksSettings.optional_folder_path_to_store.68deedd3':
    'Optional folder path to store task files (default: "Tasks").',
  'settings.TasksSettings.enter_tasks_folder_path.685fec4a': 'Enter tasks folder path',
  'settings.TasksSettings.tasks_time_choices.97d2bb52': 'Tasks time choices',
  'settings.TasksSettings.optional_comma_separated_list_of.352a5929':
    'Optional comma-separated list of time choices for tasks (e.g. "09:00,12:00,18:00").',
  'settings.TasksSettings.e_g.4c04e29e': 'e.g. {literal0}',
  'settings.TasksSettings.tasks_date_choices.56987dbf': 'Tasks date choices',
  'settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e':
    'Optional comma-separated list of date choices for tasks (e.g. "Today,Tomorrow,Next Week").',
  'settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0': 'e.g. {literal0}',
  'settings.TasksSettings.tasks_recurrence_choices.5933e491': 'Tasks recurrence choices',
  'settings.TasksSettings.optional_comma_separated_list_of.f364b641':
    'Optional comma-separated list of recurrence choices for tasks (e.g. "Daily,Weekly,Monthly").',
  'settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3': 'e.g. {literal0}',
  'settings.TasksSettings.busy_day_threshold.ebd745bf': 'Busy day threshold',
  'settings.TasksSettings.number_of_tasks_in_a.def227ff':
    'Number of tasks in a day to consider it as a "busy day".',
  'settings.TasksSettings.e_g.8c2fb766': 'e.g. {literal0}',
  'settings.TasksSettings.week_starts_on_monday.1e6c3ee3': 'Week starts on Monday',
  'settings.TasksSettings.set_the_first_day_of.0426b53c':
    'Set the first day of the week for date calculations.',
  'settings.TasksSettings.birth_date.5164b245': 'Birth date',
  'settings.TasksSettings.where_the_life_layout_of.291ea708':
    'Where the Life layout of a calendar base starts counting your weeks. Used by every base.',
  'settings.TasksSettings.life_expectancy.da8e9e4d': 'Life expectancy',
  'settings.TasksSettings.the_years_the_life_layout.4cd598a4':
    "The years the Life layout draws. A calendar base can ask for its own in the view's options.",
  'settings.TimeTrackingSettings.time_entry_path_template.b06163ff': 'Time entry path template',
  'settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8':
    'Template for new time entry file paths. Variables: {literal0}, {literal1}, {literal2}, {literalDate}.',
  'settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce': 'e.g. {literal2}',
  'settings.TimeTrackingSettings.trackable_note_types.4b331926': 'Trackable note types',
  'settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd':
    'Comma-separated note types that show the timer button in header (e.g. task,project).',
  'settings.TimeTrackingSettings.e_g_task.1c985447': 'e.g. {literal0}',
  'settings.TimeTrackingSettings.track_all_notes.41a2243c': 'Track all notes',
  'settings.TimeTrackingSettings.show_the_timer_button_in.983d0303':
    'Show the timer button in the header for all notes, regardless of type.',
  'settings.TransferSettings.send_to_another_device.71ef2876': 'Send to another device',
  'settings.TransferSettings.tick_what_should_travel_what.be4e856b':
    'Tick what should travel. What you pick can go as a QR code, as text to paste, or as a file to send.',
  'settings.TransferSettings.include_keys.f7508fd4': 'Include keys',
  'settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9':
    'API keys travel with whatever needs them. A transfer carrying a key is locked behind a one-time code, shown here and typed on the other device.',
  'settings.TransferSettings.what_to_send.bceb988a': 'What to send',
  'settings.TransferSettings.clear.83b12c22': 'Clear',
  'settings.TransferSettings.select_all.1fc9a387': 'Select all',
  'settings.TransferSettings.send_nothing.1bc92d8a': 'Send nothing',
  'settings.TransferSettings.send_everything_listed_here.f1ac2a00': 'Send everything listed here',
  'settings.TransferSettings.send_everything_under_value.1db19fa3':
    'Send everything under {value0}',
  'settings.TransferSettings.send_value.c229d699': 'Send {value0}',
  'settings.TransferSettings.carries_a_key.0d090cb4': 'Carries a key',
  'settings.TransferSettings.send_all_of_the_value.f01a8818': 'Send all of the {value0}',
  'settings.TransferSettings.nothing_here_can_be_transferred.49a46df4':
    'Nothing here can be transferred yet.',
  'settings.TransferSettings.preview.324b134f': 'Preview',
  'settings.TransferSettings.see_exactly_what_would_be.5a694fa9': 'See exactly what would be sent',
  'settings.TransferSettings.choose_something_to_send_first.5fde4c03':
    'Choose something to send first',
  'settings.TransferSettings.send.f6f4688f': 'Send',
  'settings.TransferSettings.hand_what_you_chose_to.f4aa3506':
    'Hand what you chose to the other device',
  'settings.TransferSettings.receive_from_another_device.955f97bb': 'Receive from another device',
  'settings.TransferSettings.read_the_codes_the_other.7d52f77b':
    'Read the codes the other device is showing. Nothing is written until you have seen what arrived.',
  'settings.TransferSettings.read_a_transfer.da2dcc0f': 'Read a transfer',
  'settings.TransferSettings.camera_a_photo_of_the.d9996865':
    'Camera, a photo of the code, a file, or the text itself.',
  'settings.TransferSettings.scan.ea1c510d': 'Scan',
  'settings.TransferSettings.read_a_transfer_from_another.60d1c2f6':
    'Read a transfer from another device',
  'settings.TransferSettings.notes.8a7525b1': 'Notes',
  'settings.TransferSettings.money_and_time.ebb5a49d': 'Money and time',
  'settings.TransferSettings.agents.279b44d2': 'Agents',
  'settings.TransferSettings.buttons.d452583a': 'Buttons',
  'settings.TransferSettings.data.cec3a9b8': 'Data',
  'settings.TransferSettings.nothing_selected_yet.d6f9822a': 'Nothing selected yet.',
  'settings.TransferSettings.fits_in_one_code.324a2a38': 'Fits in one code.',
  'settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4':
    'Takes {value0} codes, shown one after another.',
  'settings.TransferSettings.takes_value_codes_too_many.304d8234':
    'Takes {value0} codes — too many to photograph, so it would go as text or as a file.',
  'settings.TransferSettings.applied_value.d4ffb612': 'Applied {value0}.',
  'settings.TransferSettings.value_could_not_be_stored.cf4fe457':
    '{value0} could not be stored — the name this vault uses for it is one Obsidian will not take.',
  'settings.TransferSettings.value_could_not_be_written.93eaa96e': '{value0} could not be written.',
  'settings.ai.AgentEditorModal.agent_value.c67844d1': 'Agent: {value0}',
  'settings.ai.AgentEditorModal.agent.11b39c93': 'Agent',
  'settings.ai.AgentEditorModal.name.dcd1d522': 'Name',
  'settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51': 'Shown in the agent picker.',
  'settings.ai.AgentEditorModal.description.526e0087': 'Description',
  'settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342':
    'Tells other agents what this one is for.',
  'settings.ai.AgentEditorModal.utility_agent.e8384fe8': 'Utility agent',
  'settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc':
    'Hidden from the chat picker. Still available to scripts, delegation and draft\n              review.',
  'settings.ai.AgentEditorModal.model.5e2c614c': 'Model',
  'settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab':
    'The model this agent runs on.',
  'settings.ai.AgentEditorModal.fallback_model.ed293bb6': 'Fallback model',
  'settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0':
    'Offered as a retry when a request fails. Used automatically in delegated runs,\n              where nobody can press a button.',
  'settings.ai.AgentEditorModal.background_model.905a0833': 'Background model',
  'settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428':
    "For naming and compacting this agent's chats. Unset, the plugin-wide Background\n              Model setting decides — and unset there too, the chat's own model does.",
  'settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a':
    "They read this agent's chats in this order, each given what the one before\n              returned: your messages before the agent does, its answers before they stay, or\n              both. An agent says what it thinks; a script decides. A chat can keep its own list.",
  'settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9':
    "Blocks are joined in order with a blank line between them. Use {value0} for today's date.",
  'settings.ai.AgentEditorModal.block_value.dd05ec6a': 'Block {value0}',
  'settings.ai.AgentEditorModal.move_up.c66feb5e': 'Move up',
  'settings.ai.AgentEditorModal.move_down.40bb50da': 'Move down',
  'settings.ai.AgentEditorModal.remove.c3812fc4': 'Remove',
  'settings.ai.AgentEditorModal.path_to_note.ef6763e6': 'Path to note...',
  'settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2':
    'Instructions for this agent...',
  'settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4':
    'No prompt blocks. This agent runs with no instructions of its own.',
  'settings.ai.AgentEditorModal.add_text_block.4b0903f4': 'Add text block',
  'settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8':
    'Append a block of instructions written here',
  'settings.ai.AgentEditorModal.add_note_block.34512584': 'Add note block',
  'settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7':
    'Append a block read from a note in the vault',
  'settings.ai.AgentEditorModal.permission_mode.c7a8e6db': 'Permission mode',
  'settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c':
    'What this agent may do without asking.',
  'settings.ai.AgentEditorModal.github_connections.e95944e1': 'GitHub connections',
  'settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61':
    'Off: no access. Ask: approve each operation in an interactive chat. On: use without asking. New connections start Off on every server. These choices do not enable an Off tool.',
  'settings.ai.AgentEditorModal.github_com.3aeb0024': 'github.com',
  'settings.ai.AgentEditorModal.unavailable_connection_value.795252e1':
    'Unavailable connection: {value0}',
  'settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef':
    'This agent refers to a connection not present on this device. Transfer the connection or leave it Off.',
  'settings.ai.AgentEditorModal.scope.b073f6c6': 'Scope',
  'settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74':
    'Where this agent works by default. A delegated run also gets whatever the chat\n              that delegated to it had open.',
  'settings.ai.AgentEditorModal.tools.ea93d6a2': 'Tools',
  'settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983':
    'Off = unavailable. Ask = needs approval. Auto = runs on its own. File tools are\n              always available and governed by the permission mode above.',
  'settings.ai.AgentEditorModal.offer_tools.677c3882': 'Offer tools',
  'settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7':
    'By section: the agent sees one entry per section with what it is for, and opens a section when it needs it. All at once: every enabled tool is offered from the start.',
  'settings.ai.AgentEditorModal.skills.66d0f523': 'Skills',
  'settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3':
    'Which skills this agent can load on demand.',

  'settings.ai.AgentEditorModal.delegation_depth.29ea0156': 'Delegation depth',
  'settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e':
    'How far this agent may delegate. 0 removes the delegate tool entirely.',
  'settings.ai.AgentEditorModal.basic.0e35f6e9': 'Basic',
  'settings.ai.AgentEditorModal.prompts.5f2e66e6': 'Prompts',
  'settings.ai.AgentEditorModal.memory.c3963aed': 'Memory',
  'settings.ai.AgentEditorModal.access.ec5ba0ab': 'Access',
  'settings.ai.AgentEditorModal.delegation.a6d910ba': 'Delegation',
  'settings.ai.AgentEditorModal.text.71988c4d': 'Text',
  'settings.ai.AgentEditorModal.note.d8da2c49': 'Note',
  'settings.ai.AgentEditorModal.all_skills.78abcbbf': 'All skills',
  'settings.ai.AgentEditorModal.no_skills.5083cd4b': 'No skills',
  'settings.ai.AgentEditorModal.only_selected.c1792bfe': 'Only selected',
  'settings.ai.AgentEditorModal.cannot_delegate.6a16ca61': 'Cannot delegate',
  'settings.ai.AgentEditorModal.level.3292ae98': '1 level',
  'settings.ai.AgentEditorModal.levels.8b7cdd29': '2 levels',
  'settings.ai.AgentEditorModal.levels.93b1554a': '3 levels',
  'settings.ai.AgentEditorModal.off.ca7981b4': 'Off',
  'settings.ai.AgentEditorModal.ask.b8c209cd': 'Ask',
  'settings.ai.AgentEditorModal.on.13001175': 'On',
  'settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c':
    'What this agent was asked to remember. Only this agent sees it: it is added to its\n      system prompt, laid out by the memory template in the general AI settings. The agent adds\n      and changes items with the remember tool and removes them with forget; both can be switched\n      off on the Access tab.',
  'settings.ai.AgentMemoryEditor.added_value.29f396e2': 'Added {value0}',
  'settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d': 'Forget this item',
  'settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6':
    'Nothing remembered yet. Ask the agent in a chat to remember something, or add it here.',
  'settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77':
    'Something this agent should remember...',
  'settings.ai.AgentMemoryEditor.add.9fd728c6': 'Add',
  'settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8':
    "Add this line to the agent's memory",
  'settings.ai.AgentsSettings.an_agent_is_a_model.148349b4':
    'An agent is a model, a set of instructions, and what it is allowed to do. Chats run on\n      one; scripts and other agents can delegate to one.',
  'settings.ai.AgentsSettings.default.37a8eec1': 'default',
  'settings.ai.AgentsSettings.utility.57ffcc28': 'utility',
  'settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501': 'Duplicate this agent',
  'settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82':
    'The last agent cannot be deleted — a chat has to run on something',
  'settings.ai.AgentsSettings.delete_this_agent.0ba11bd2': 'Delete this agent',
  'settings.ai.AgentsSettings.add_agent.d3e039d4': 'Add agent',
  'settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1':
    'Create an agent and open it for editing',
  'settings.ai.AgentsSettings.delete_agent.602cc4da': 'Delete agent',
  'settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4':
    'Delete {value0}? Chats still running on it will fall back to the\n        default agent. This cannot be undone.',
  'settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d':
    'A utility agent cannot be the default — it is hidden from chats',
  'settings.ai.AgentsSettings.already_the_default_agent.28842ed7': 'Already the default agent',
  'settings.ai.AgentsSettings.make_this_the_default_agent.4e646862':
    'Make this the default agent for new chats',
  'settings.ai.AgentsSettings.no_model.f62c7d17': 'no model',
  'settings.ai.AgentsSettings.whole_vault.18d9a3b5': 'whole vault',
  'settings.ai.AgentsSettings.no_scope.cc0ca29a': 'no scope',

  'settings.ai.GeneralSettings.ai_agent.b48c8be3': 'AI Agent',
  'settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425':
    'Enable AI agent features including the chat sidebar.',
  'settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23':
    'The AI agent is off. Turn it on under General.',
  'settings.ai.GeneralSettings.keep_running_in_background_while.32440789':
    'Keep running in background while agents work',
  'settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2':
    'Play silent audio while a turn is running. May use more battery; background execution depends on the system.',
  'settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee':
    'Keep running in background always',
  'settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f':
    'Play silent audio even when agents are idle. Off by default; may use more battery.',
  'settings.ai.GeneralSettings.key_destinations.fe672569': 'Key destinations',
  'settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee':
    'Review addresses changed outside this device before sending keys there.',
  'settings.ai.GeneralSettings.review.aff0766a': 'Review',
  'settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591':
    'Review and confirm where this device sends keys',
  'settings.ai.GeneralSettings.chat_storage.b1ad73cf': 'Chat Storage',
  'settings.ai.GeneralSettings.chat_path_template.306fa23b': 'Chat path template',
  'settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e':
    'Path template for chat files. Variables: {value0}, {value1}.',
  'settings.ai.GeneralSettings.ai_chats.f579b34b': 'AI/Chats',
  'settings.ai.GeneralSettings.rewind_space_mb.a3eaae55': 'Rewind space (MB)',
  'settings.ai.GeneralSettings.how_much_room_on_this.f5c80989':
    'How much room, on this device, the copies may take that let a chat put back the\n            files its agent changed. Chats written to least recently lose theirs first. 0 keeps\n            nothing, and chats cannot rewind.',
  'settings.ai.GeneralSettings.migrate_chats.cd7a094d': 'Migrate chats',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b':
    'Move existing chat files to match the current path template.',
  'settings.ai.GeneralSettings.migrating.e3c84baf': 'Migrating...',
  'settings.ai.GeneralSettings.migrate.f988ed29': 'Migrate',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22':
    'Move existing chat files to match the template above',
  'settings.ai.GeneralSettings.comment_agent.42067bbf': 'Comment agent',
  'settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0':
    'Which agent answers comment chats. Utility agents are offered too — the one\n            seeded for comments is one.',
  'settings.ai.GeneralSettings.comment_folder.0f39b86a': 'Comment folder',
  'settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501':
    'Where comment chats are stored',
  'settings.ai.GeneralSettings.ai_comments.e01654c6': 'AI/Comments',
  'settings.ai.GeneralSettings.skills.66d0f523': 'Skills',
  'settings.ai.GeneralSettings.skills_folder.bc563bf9': 'Skills folder',
  'settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b':
    "Skills here are offered to every agent. Elsewhere, only skills in the chat's scope are offered; loading another skill asks first. The agent's skill selection still applies.",
  'settings.ai.GeneralSettings.ai_skills.cebb9b9a': 'AI/Skills',
  'settings.ai.GeneralSettings.integrations.090512d9': 'Integrations',
  'settings.ai.GeneralSettings.brave_search_api_key.309e5bff': 'Brave Search API Key',
  'settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5':
    'Stored securely in keychain.',
  'settings.ai.GeneralSettings.secrets.d8707d41': 'Secrets',

  'settings.ai.GeneralSettings.unnamed.9edb143e': '(unnamed)',
  'settings.ai.GeneralSettings.secret_name.5cdf573b': 'Secret name',
  'settings.ai.GeneralSettings.value.fb2e2c72': 'Value...',
  'settings.ai.GeneralSettings.allowed_addresses.0479f7eb': 'Allowed addresses',
  'settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c':
    "Add an address from a request's confirmation. Each saved-key request still asks.",
  'settings.ai.GeneralSettings.remove.c3812fc4': 'Remove',
  'settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72':
    "Remove this address from the key's allowed list",
  'settings.ai.GeneralSettings.none_yet.adb85cf2': 'None yet',
  'settings.ai.GeneralSettings.remove_this_secret.42b31675': 'Remove this secret',
  'settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa':
    'Cancel — leave the stored value as it is',
  'settings.ai.GeneralSettings.add_secret.f57a23c6': 'Add secret',
  'settings.ai.GeneralSettings.add_another_named_secret.16c8806f': 'Add another named secret',
  'settings.ai.GeneralSettings.providers.996c32b3': 'Providers',
  'settings.ai.GeneralSettings.base_url.70589413': 'Base URL',
  'settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e':
    'OpenAI-compatible API endpoint.',
  'settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef': 'Fetch models from API',
  'settings.ai.GeneralSettings.add_model_manually.c42ee506': 'Add model manually',

  'settings.ai.GeneralSettings.filter_models.e91fd9af': 'Filter models...',
  'settings.ai.GeneralSettings.reasoning.0c4d01e8': 'reasoning',
  'settings.ai.GeneralSettings.no_models_yet.36604ff4': 'No models yet.',
  'settings.ai.GeneralSettings.add_another_provider.91f9cd40': 'Add another provider',
  'settings.ai.GeneralSettings.no_providers_yet.55327313': 'No providers yet',
  'settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8':
    'Any service that speaks the OpenAI API: its address, a key and its models.',
  'settings.ai.GeneralSettings.add_provider.8cd1856b': 'Add provider',
  'settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7':
    'Add another OpenAI-compatible provider',
  'settings.ai.GeneralSettings.background_model.eefa747e': 'Background Model',
  'settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa':
    "Chat models are chosen per agent, on the Agents tab. This one is used for the\n          plugin's own background work — naming chats and compacting long conversations.",
  'settings.ai.GeneralSettings.auxiliary_model.6c245762': 'Auxiliary Model',
  'settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143':
    'Used for chat titles and compaction. Left unset, each chat uses the model it is\n            already talking to; an agent can name one of its own, which wins over this.',
  'settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7': 'Sequential Auxiliary',
  'settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159':
    'Run auxiliary tasks after the main model finishes. Enable for local models with limited throughput.',
  'settings.ai.GeneralSettings.when_a_request_fails.8adc1690': 'When a request fails',
  'settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33':
    'Only failures that pass on their own are repeated — a rate limit, an overloaded provider, a dropped connection. A rejected key or a bad request is not tried again.',
  'settings.ai.GeneralSettings.try_again_automatically.84c6a3e7': 'Try again automatically',
  'settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd':
    'How many further tries after the first.',
  'settings.ai.GeneralSettings.first_wait.548b0480': 'First wait',
  'settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb':
    'Seconds before the first retry. Each one after doubles it, up to a minute.',
  'settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08': 'Request timeout (seconds)',
  'settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5':
    'Wait for the model to connect or send the next response chunk, not for the whole answer. 1–3600 seconds; empty restores 60. Used for chat and background models without their own timeout.',
  'settings.ai.GeneralSettings.voice_input.8748f239': 'Voice input',
  'settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a':
    'Dictate into the chat, or into a note with the “Dictate into the note” command. OpenRouter has no transcription endpoint, so the audio goes to a model that hears — these two were picked for price, for running in Europe, and for not training on what is sent.',
  'settings.ai.GeneralSettings.model.5e2c614c': 'Model',
  'settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f':
    'What turns speech into text.',
  'settings.ai.GeneralSettings.model_id.7789530b': 'Model id',
  'settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177':
    'Any model that accepts audio, as its provider names it.',
  'settings.ai.GeneralSettings.vendor_model.ba723767': 'vendor/model',
  'settings.ai.GeneralSettings.endpoint.3df9726c': 'Endpoint',
  'settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7':
    "Left empty, OpenRouter's chat completions.",
  'settings.ai.GeneralSettings.language.a4fe6526': 'Language',
  'settings.ai.GeneralSettings.told_to_the_model_as.35170cef':
    'Told to the model as a hint. Left empty, it works it out from the audio.',
  'settings.ai.GeneralSettings.russian.5bcc40ad': 'Russian',
  'settings.ai.GeneralSettings.client_name.b6626cd7': 'Client name',
  'settings.ai.GeneralSettings.default.21b111cb': 'Default',
  'settings.ai.GeneralSettings.openrouter_api_key.89616b71': 'OpenRouter API key',
  'settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21':
    'Stored in the keychain, shared with image generation.',
  'settings.ai.GeneralSettings.image_generation.8f4716e6': 'Image Generation',
  'settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226':
    'Short identifier used in model keys (e.g. openai, openrouter).',
  'settings.ai.GeneralSettings.e_g_openai.e3ce2f3c': 'e.g. {literal0}',
  'settings.ai.GeneralSettings.api_type.72e7cc4c': 'API Type',
  'settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d':
    'OpenAI uses /v1/images/generations, OpenRouter uses chat completions.',
  'settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3': 'Leave empty for default: ',
  'settings.ai.GeneralSettings.add_model.b2609f7d': 'Add model',
  'settings.ai.GeneralSettings.add_another_image_provider.fac89d72': 'Add another image provider',
  'settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca': 'No image providers yet',
  'settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb':
    'A service that makes pictures from words, for the agent to draw with.',
  'settings.ai.GeneralSettings.add_image_provider.858726bf': 'Add image provider',
  'settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9':
    'Add another image generation provider',
  'settings.ai.GeneralSettings.default_image_model.164d9980': 'Default Image Model',
  'settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88':
    "Used when agent doesn't specify a model.",
  'settings.ai.GeneralSettings.prompts.5f2e66e6': 'Prompts',
  'settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4':
    "What the plugin says to the models for its own work. Each starts as the plugin's own; change one only to change how that work comes out.",
  'settings.ai.GeneralSettings.tool_descriptions.eb258712': 'Tool descriptions',
  'settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136':
    'What each tool tells the model about itself, shared by every agent. Which tools an agent may use is set per agent.',
  'settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106':
    "{value0} changed from the plugin's own",
  'settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39':
    'Change what the tools tell the model',
  'settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab':
    "Changed from the plugin's own words",
  'settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921': 'Change the {value0} prompt',
  'settings.ai.GeneralSettings.use_the_default.76f7faf5': 'Use the default',
  'settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb': "Go back to the plugin's own words",
  'settings.ai.GeneralSettings.cancel.19766ed6': 'Cancel',
  'settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492':
    'Close this and change nothing',
  'settings.ai.GeneralSettings.save.1509f561': 'Save',
  'settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d': 'Use these words from now on',
  'settings.ai.GeneralSettings.done.11a6767d': 'Done',
  'settings.ai.GeneralSettings.close_this_window.3f02fc8e': 'Close this window',
  'settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9': 'Migrated {value0} chat(s)',
  'settings.ai.GeneralSettings.migration_failed_value.109b5f7f': 'Migration failed: {value0}',
  'settings.ai.GeneralSettings.default_agent.94da52ec': 'Default agent',
  'settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9':
    'Enter 1–3600 seconds. This value has not been saved.',
  'settings.ai.GeneralSettings.something_else.b4768d66': 'Something else…',
  'settings.ai.GeneralSettings.remove_secret.1422ca6e': 'Remove secret',

  'settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101':
    'Saved {value0} to the keychain',
  'settings.ai.GeneralSettings.agent_memory.f3cd4df6': 'Agent memory',
  'settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab':
    'How what an agent was asked to remember is added to its system prompt; {value0} is where the items go.',
  'settings.ai.GeneralSettings.chat_titles.950a9874': 'Chat titles',
  'settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a':
    'Names a chat from its first messages; {value0} is where they go.',
  'settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9': 'Chat titles, system',
  'settings.ai.GeneralSettings.what_the_model_that_names.4a08978e':
    'What the model that names chats is told it is.',
  'settings.ai.GeneralSettings.chat_recap.adaaf80a': 'Chat recap',
  'settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c':
    "The sentence on a chat's card under a note it changed; {value0} is where the messages go.",
  'settings.ai.GeneralSettings.chat_summary.b82dab10': 'Chat summary',
  'settings.ai.GeneralSettings.the_short_line_under_a.c81696a8':
    "The short line under a chat's title in the history; {value0} is where the messages go.",
  'settings.ai.GeneralSettings.compacting.df77799c': 'Compacting',
  'settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886':
    'How a long conversation is summed up so it can go on; {value0} is where it goes.',
  'settings.ai.InterceptorList.interceptors.803987ac': 'Interceptors',
  'settings.ai.InterceptorList.off.ca7981b4': 'Off',
  'settings.ai.InterceptorList.close_its_settings.de0fd0fb': 'Close its settings',
  'settings.ai.InterceptorList.edit_what_it_reads_and.86412c66': 'Edit what it reads and how',
  'settings.ai.InterceptorList.on_runs_in_its_turn.baf521d9': 'On: runs in its turn',
  'settings.ai.InterceptorList.off_skipped_keeps_its_place.28162216':
    'Off: skipped, keeps its place',
  'settings.ai.InterceptorList.move_or_remove.ca447e47': 'Move or remove',
  'settings.ai.InterceptorList.who_reads_an_agent_says.0ff03e5e':
    'Who reads: an agent says what it thinks, a script decides.',
  'settings.ai.InterceptorList.add_interceptor.36b0eb2d': 'Add interceptor',
  'settings.ai.InterceptorList.add_one_at_the_end.98a5c813': 'Add one at the end; it runs last',
  'settings.ai.InterceptorList.an_agent_or_a_script.92a06c1a':
    'An agent or a script that reads first',
  'settings.ai.InterceptorList.everything.75304cf7': 'Everything',
  'settings.ai.InterceptorList.they_run_in_this_order.7b624feb':
    'They run in this order, each given what the one before returned. The agent reads the last one’s text.',
  'settings.ai.InterceptorList.script_value_missing.31a4f5d0': 'Script: {value0} · missing',
  'settings.ai.InterceptorList.missing_agent.4eeff6c3': 'Missing agent',
  'settings.ai.InterceptorList.nobody.3fad99b5': 'Nobody',
  'settings.ai.InterceptorList.move_up.c66feb5e': 'Move up',
  'settings.ai.InterceptorList.move_down.40bb50da': 'Move down',
  'settings.ai.InterceptorList.remove.c3812fc4': 'Remove',
  'settings.ai.InterceptorSettings.interceptor.e7123168': 'Interceptor',
  'settings.ai.InterceptorSettings.checks.de07d072': 'Checks',
  'settings.ai.InterceptorSettings.only_messages_matching.a6b95968': 'Only messages matching',
  'settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb':
    'A regular expression, bare or as /pattern/flags, tried on whatever is checked. The rest pass unchecked. Empty means everything.',

  'settings.ai.InterceptorSettings.reply_only.df23f4c5': 'Reply only',
  'settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839':
    'Send your messages unchanged straight to the main agent. The interceptor may answer beside each message, without holding it, rewriting it or deciding tool approvals.',
  'settings.ai.InterceptorSettings.interceptor_context.4b7f6f53': 'Interceptor context',
  'settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856':
    'How much of the conversation the interceptor sees.',
  'settings.ai.InterceptorSettings.everything.75304cf7': 'Everything',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec':
    'Your messages, before the agent reads them.',
  'settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d':
    "The agent's answers, once it has finished. A new text from the interceptor takes the answer's place; the original stays a press away.",
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706':
    "Your messages before the agent reads them, and its answers once it has finished. A new text from the interceptor takes the answer's place.",
  'settings.ai.McpServerModal.add_mcp_server.0e3e58f9': 'Add MCP server',
  'settings.ai.McpServerModal.edit_mcp_server.35d90caa': 'Edit MCP server',
  'settings.ai.McpServerModal.name.dcd1d522': 'Name',
  'settings.ai.McpServerModal.e_g_context.e900fc3c': 'e.g. {literal0}',
  'settings.ai.McpServerModal.another_server_already_has_this.8e96ea34':
    'Another server already has this name. Tool names come from it, so it has to differ.',
  'settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59':
    "The server's MCP endpoint, reached over HTTP.",
  'settings.ai.McpServerModal.on.13001175': 'On',
  'settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37':
    'Off keeps it here and gives its tools to no agent.',
  'settings.ai.McpServerModal.token.d2089be6': 'Token',
  'settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3':
    'Sent as Authorization: Bearer. Stored in the keychain, never in the settings file.',
  'settings.ai.McpServerModal.optional.59be7133': 'Optional',
  'settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436':
    'Forget the stored token when saving',
  'settings.ai.McpServerModal.headers.194e9fe6': 'Headers',
  'settings.ai.McpServerModal.tools.ea93d6a2': 'Tools',
  'settings.ai.McpServerModal.what_agents_are_told_is.7591a661':
    'What agents are told is this list as it was fetched. It changes only when you fetch it\n          again here and save.',
  'settings.ai.McpServerModal.fetch_tools.4788d40d': 'Fetch tools',
  'settings.ai.McpServerModal.connect_to_the_server_and.db04f00f':
    'Connect to the server and read the tools it offers',
  'settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f': 'Needs the server URL first',
  'settings.ai.McpServerModal.save.1509f561': 'Save',
  'settings.ai.McpServerModal.keep_this_server_and_close.f4798cef': 'Keep this server and close',
  'settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc': 'Needs a name of its own and a URL',
  'settings.ai.McpServerModal.delete.e2d0a549': 'Delete',
  'settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c':
    'Remove this server; agents lose its tools',
  'settings.ai.McpServerModal.delete_mcp_server.1a969bef': 'Delete MCP server',
  'settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d':
    'Delete {value0}? Every agent loses its tools.',

  'settings.ai.McpServerModal.also_the_start_of_its.6f23c597':
    "Also the start of its tools' names: mcp_{value0}_<tool>.",
  'settings.ai.McpServerModal.fetching.8d0738c8': 'Fetching…',
  'settings.ai.McpServerModal.not_fetched_yet.d17fdec2': 'Not fetched yet',
  'settings.ai.McpSettings.servers_that_give_agents_more.67631550':
    "Servers that give agents more tools, reached over HTTP — on a phone too. Nothing is\n      started on this device. A server's tools reach an agent only once they are switched on in\n      that agent's Access tab, and they ask before each call unless set otherwise.",
  'settings.ai.McpSettings.delete_this_server.e42cb344': 'Delete this server',
  'settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef': 'No MCP servers yet.',
  'settings.ai.McpSettings.add_server.1099b2a9': 'Add server',
  'settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42':
    'Connect an MCP server by its address',
  'settings.ai.McpSettings.delete_mcp_server.1a969bef': 'Delete MCP server',
  'settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d':
    'Delete {value0}? Every agent loses its tools.',
  'settings.ai.McpSettings.off.ca7981b4': 'Off',
  'settings.ai.McpSettings.on.13001175': 'On',
  'settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f': 'On, tools not fetched yet',
  'settings.ai.ProviderSettings.unnamed_provider.1b003656': 'Unnamed provider',
  'settings.ai.ProviderSettings.change_this_provider_and_its.6b743289':
    'Change this provider and its models',
  'settings.ai.ProviderSettings.new_provider.38a96a6a': 'New provider',
  'settings.ai.ProviderSettings.name.dcd1d522': 'Name',
  'settings.ai.ProviderSettings.client_name.b6626cd7': 'Client name',
  'settings.ai.ProviderSettings.default.21b111cb': 'Default',
  'settings.ai.ProviderSettings.api_key.16f0ee47': 'API key',
  'settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578':
    'Kept in the keychain of this device.',
  'settings.ai.ProviderSettings.models.d17d2d78': 'Models',
  'settings.ai.ProviderSettings.delete.e2d0a549': 'Delete',
  'settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b':
    'Remove this provider and its models',
  'settings.ai.ProviderSettings.done.11a6767d': 'Done',
  'settings.ai.ProviderSettings.close_this_window_changes_are.91342d87':
    'Close this window; changes are kept as you make them',
  'settings.ai.ToolDescriptions.value_of_value.ca6c5e5f': '{value0} of {value1}',
  'settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab':
    "Changed from the plugin's own words",
  'settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d':
    'Change what {value0} tells the model',
  'settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7':
    'What this tool tells the model about itself.',
  'settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7':
    'What {value0} tells the model',
  'settings.ai.ToolDescriptions.use_the_default.76f7faf5': 'Use the default',
  'settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb':
    "Go back to the plugin's own words",
  'settings.ai.ToolDescriptions.cancel.19766ed6': 'Cancel',
  'settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492':
    'Close this and change nothing',
  'settings.ai.ToolDescriptions.save.1509f561': 'Save',
  'settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d': 'Use these words from now on',
  'settings.ai.interceptorList.reply_only.37786db8': 'reply only',
  'settings.ai.options.ask_before_every_change.f5fb08f2': 'Ask before every change',
  'settings.ai.options.edit_files_without_asking.08674c9f': 'Edit files without asking',
  'settings.ai.options.everything_without_asking.d14adf38': 'Everything without asking',
  'settings.ai.options.value_utility.6fb6bae8': '{value0} · utility',
  'settings.ai.options.script_value_value.97c5d924': 'Script: {value0}{value1}',
  'settings.scripts.AutomationsEditor.automations.ad1fb9ec': 'Automations',

  'settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15': 'No automations yet.',
  'settings.scripts.AutomationsEditor.off.ca7981b4': 'Off',
  'settings.scripts.AutomationsEditor.delete_this_automation.76539f9f': 'Delete this automation',
  'settings.scripts.AutomationsEditor.run_this_automation.25a70adc': 'Run this automation',
  'settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f':
    'Off keeps it set up here without running it.',
  'settings.scripts.AutomationsEditor.name.dcd1d522': 'Name',
  'settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc':
    'What it is called here and in the list of script runs.',
  'settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8': 'e.g. {literal0}',
  'settings.scripts.AutomationsEditor.when.cf9c7aa2': 'When',
  'settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf':
    'What has to happen for the script to run.',
  'settings.scripts.AutomationsEditor.note_types.52d728fb': 'Note types',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4':
    'Comma-separated. Only notes whose type frontmatter is one of these. Empty is any note.',
  'settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4': 'e.g. {literal0}',
  'settings.scripts.AutomationsEditor.folders.c4d6bb20': 'Folders',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774':
    'Comma-separated. Only notes anywhere under one of these. Empty is anywhere.',
  'settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d': 'e.g. {literal0}',
  'settings.scripts.AutomationsEditor.property.40040cb1': 'Property',
  'settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04':
    'Only notes with this frontmatter property. Optional.',
  'settings.scripts.AutomationsEditor.e_g_area.95b1c988': 'e.g. {literal0}',
  'settings.scripts.AutomationsEditor.equals.f939ae3d': 'Equals',
  'settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f':
    '…holding this value, or one of its values. Empty is any value.',
  'settings.scripts.AutomationsEditor.e_g_home.a9f31279': 'e.g. {literal0}',
  'settings.scripts.AutomationsEditor.script.102acc10': 'Script',
  'settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704':
    'Script the automation runs.',
  'settings.scripts.AutomationsEditor.choose_script.e582e7b2': 'Choose script...',
  'settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d':
    'Search the scripts for the one this automation runs',
  'settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9':
    'This script takes no parameters.',
  'settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590': 'At most every (seconds)',
  'settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf':
    'For one note. Changes in between are gathered into one run at the end. 0 runs on every change.',
  'settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225':
    'Also for changes from other devices',
  'settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2':
    'Off, a change that arrives by sync runs nothing here: it already ran on the device where it was made.',
  'settings.scripts.AutomationsEditor.add_automation.537c3ee4': 'Add automation',
  'settings.scripts.AutomationsEditor.add_another_automation.78aa262d': 'Add another automation',
  'settings.scripts.AutomationsEditor.delete_automation.f71084e7': 'Delete automation',
  'settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0':
    'Delete {value0}? Its script stops\n        running by itself. This cannot be undone.',
  'settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a': 'No script chosen yet',
  'settings.scripts.AutomationsEditor.no_description.06a69482': 'No description.',
  'settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925':
    '{value0} · defaults to {value1}',
  'settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78': 'Header buttons',

  'settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4': 'Unnamed button',

  'settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275':
    'Move earlier — already the first',
  'settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10':
    'Move earlier in the header',
  'settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45':
    'Move later — already the last',
  'settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d':
    'Move later in the header',
  'settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e': 'Change this button',
  'settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516': 'Add another button',
  'settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3': 'No header buttons yet',
  'settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f':
    'A command or a script, on the notes you choose.',
  'settings.scripts.HeaderButtonsEditor.add_button.c0f290f3': 'Add button',
  'settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8':
    'Add a header button and set it up',
  'settings.scripts.HeaderButtonsEditor.new_button.c499cbe3': 'New button',
  'settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80': 'What it runs',
  'settings.scripts.HeaderButtonsEditor.runs.848f54e8': 'Runs',
  'settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412':
    'A command from anywhere in Obsidian, or one of your scripts.',
  'settings.scripts.HeaderButtonsEditor.name.dcd1d522': 'Name',
  'settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef':
    "Shown as the button's tooltip, and in the menu where it does not fit.",
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b':
    'Shown on the button, or as its tooltip when it is icon only.',
  'settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.icon.a35abcd6': 'Icon',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8':
    'Shown on the button in the header.',
  'settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06':
    'Choose the icon from the whole set, by picture or by name',
  'settings.scripts.HeaderButtonsEditor.command.71316697': 'Command',
  'settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f':
    'Command the button runs.',
  'settings.scripts.HeaderButtonsEditor.choose_command.ea49d680': 'Choose command...',
  'settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77':
    'Search every command Obsidian has for the one this button runs',
  'settings.scripts.HeaderButtonsEditor.icon_only.7a047008': 'Icon only',
  'settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5':
    'Leave the name off the header, for a header already full.',
  'settings.scripts.HeaderButtonsEditor.script.102acc10': 'Script',
  'settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c': 'Script the button runs.',
  'settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2': 'Choose script...',
  'settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4':
    'Search the scripts for the one this button runs',
  'settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9':
    'This script takes no parameters.',
  'settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1': 'Where it shows',
  'settings.scripts.HeaderButtonsEditor.on_every_note.d761c688': 'On every note',
  'settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572':
    'Whatever its type, tags or folder.',
  'settings.scripts.HeaderButtonsEditor.note_types.52d728fb': 'Note types',
  'settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.folders.c4d6bb20': 'Folders',
  'settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.tags.1331275b': 'Tags',
  'settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4':
    'Comma-separated, with or without #. Notes with one of these, or a tag nested under it, show the button too.',
  'settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318': 'Also on other files',
  'settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c':
    'PDFs, canvases, books and other files opened in a tab, as far as its folders and tags reach. They have no type or properties.',
  'settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87':
    'Only when its properties',
  'settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754':
    'The note must also have these in its frontmatter.',
  'settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb':
    'Show it only on notes whose frontmatter fits, a status or a filled-in date, say.',
  'settings.scripts.HeaderButtonsEditor.add_condition.60a0d835': 'Add condition',
  'settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa':
    'Ask for one more property of the note',
  'settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b': 'Conditions needed',
  'settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1':
    'Whether the note has to fit every condition below or any one of them.',
  'settings.scripts.HeaderButtonsEditor.property.40040cb1': 'Property',
  'settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56': 'e.g. {literal0}',
  'settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189': 'Remove this condition',
  'settings.scripts.HeaderButtonsEditor.delete.e2d0a549': 'Delete',
  'settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9': 'Delete this button',
  'settings.scripts.HeaderButtonsEditor.done.11a6767d': 'Done',
  'settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87':
    'Close this window; changes are kept as you make them',
  'settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880': 'Delete header button',
  'settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26':
    'Delete {value0}? It disappears from every\n        note header it was on. This cannot be undone.',
  'settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee': 'A command',
  'settings.scripts.HeaderButtonsEditor.a_script.1ccd820b': 'A script',
  'settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7': 'No command chosen yet',
  'settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a': 'No script chosen yet',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848':
    'Comma-separated. Notes whose type frontmatter is one of these show the button.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3':
    'No note in this vault has the type {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78':
    'No note in this vault has the types {value0}.',
  'settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815':
    '{value0} Types in use: {value1}.',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44':
    'Comma-separated. Notes anywhere under one of these show the button too. A * stands for ',
  'settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a':
    'any one folder, ** for any depth: {literal0}.',
  'settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9':
    'No folder {value0} in this vault.',
  'settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1':
    'No folders {value0} in this vault.',
  'settings.scripts.HeaderButtonsEditor.is.fa51fd49': 'is',
  'settings.scripts.HeaderButtonsEditor.is_not.e1bf1560': 'is not',
  'settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1': 'is filled in',
  'settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d': 'is empty',
  'settings.scripts.HeaderButtonsEditor.all_of_them.29c88933': 'All of them',
  'settings.scripts.HeaderButtonsEditor.any_one.4013adf2': 'Any one',
  'settings.scripts.HeaderButtonsEditor.no_description.06a69482': 'No description.',
  'settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925':
    '{value0} · defaults to {value1}',
  'settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819':
    'Name a frontmatter property; until then this condition is ignored.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b':
    'Notes whose {value0} is filled in.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a':
    'Notes whose {value0} is empty or missing.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0':
    'Notes whose {value0} is anything but "{value1}", missing included.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f':
    'Notes whose {value0} is "{value1}", or holds it in a list.',
  'settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908':
    'Type the value {value0} must have.',
  'settings.scripts.ScriptLibrary.library.dc20b3d5': 'Library',

  'settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644':
    'Scripts are switched off. Turn them on under General to see what the folder holds.',
  'settings.scripts.ScriptLibrary.filter.638e249f': 'Filter',
  'settings.scripts.ScriptLibrary.by_name_or_description.95a3575e': 'By name or description.',
  'settings.scripts.ScriptLibrary.e_g_archive.a525e8b2': 'e.g. {literal0}',
  'settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0': 'No script matches that.',
  'settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa':
    'No scripts in the folder yet.',
  'settings.scripts.ScriptLibrary.refused.66b87354': 'Refused',
  'settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168': 'Waiting to be confirmed',
  'settings.scripts.ScriptLibrary.off.ca7981b4': 'Off',
  'settings.scripts.ScriptLibrary.toolbar.451aa51a': 'Toolbar',
  'settings.scripts.ScriptLibrary.startup.65d48235': 'Startup',
  'settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87':
    'It changed without being written on this device: look at it and confirm it',
  'settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c':
    'Review execution trust on this device without running the script',
  'settings.scripts.ScriptLibrary.run_this_script_now.ef501cea': 'Run this script now',
  'settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b':
    'Add a header button that runs this script',
  'settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d':
    'No description yet — add a {literal0} line to the top of the file.',
  'settings.scripts.ScriptLibrary.no_parameters.3a7003b7': 'No parameters',
  'settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d':
    'On the toolbar by its {literal0} header line',
  'settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed': 'Take it off the toolbar',
  'settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91':
    'Put it on the toolbar: the left ribbon, and above the keyboard on a phone',
  'settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b':
    'Runs at startup by its {literal0} header line',
  'settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9':
    'Stop running it when Obsidian starts',
  'settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac':
    'Run it each time Obsidian starts',
  'settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6': 'Enable scripts',
  'settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9':
    'Allow JavaScript scripts stored in a vault folder to be registered as commands and AI tools.',
  'settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1': 'Synced script policy',
  'settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f':
    'Personal sync: until confirmed on this device. Shared and agent connections: refuse. Run a script manually to review its exact bytes. Missing provenance requires recovery; approvals never sync.',
  'settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d': 'Scripts folder',
  'settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89':
    'Vault folder containing .js script files.',
  'settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b': 'e.g. {literal0}',
  'settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea':
    'Confirm scripts from other devices',
  'settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac':
    '1 script waits to be confirmed on this device.',
  'settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9':
    '{value0} scripts wait to be confirmed on this device.',
  'settings.scripts.ScriptsGeneral.review.aff0766a': 'Review',

  'settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27':
    'AI Agent → Default Tool Modes',

  'settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e':
    'A script that appears or changes without being written on this device — through Obsidian Sync, iCloud, Syncthing, git — waits until you look at it and confirm it here. Until then buttons, automations, startup and agents do not run it. Scripts you write on this device, in the editor or through Abele, count as confirmed. Switching this on accepts every script in the folder as it is now. Confirmations are kept on this device only; switching it off here forgets them, and only for this device.',
  'settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec':
    'Scripts on selected words',
  'settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f':
    'Scripts pinned to the book selection menu, in this order. Up to three are a button each; more fold into one menu. Other scripts remain under “Other script…”.',
  'settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44':
    'Scripts chosen for the chat selection menu, independently of books. Chat launch support is not enabled yet.',
  'settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7':
    'There are no scripts yet: add one to the scripts folder first.',
  'settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11':
    'Nothing on the menu yet.',
  'settings.scripts.SelectionScriptsSettings.script_value.804f5354': 'Script: {value0}',
  'settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0':
    'Script: {value0} — not found',
  'settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682': 'Name on the bar',
  'settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4':
    'Choose the icon it has on the bar',
  'settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41': 'Already the first',
  'settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10': 'Move it up the menu',
  'settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12': 'Already the last',
  'settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335':
    'Move it down the menu',
  'settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889': 'Take it off the menu',
  'settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79':
    'On the menu by its own header ({value0}), after the ones above. Add it to the list to rename it or give it a place.',
  'settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b': 'Add to the list',
  'settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711':
    'Put {value0} in the list above, to rename it or move it',
  'settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4': 'Add a script',
  'settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f':
    'Search your scripts for one to put on the menu',
  'settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec': 'Take off the menu',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83':
    'Take {value0} off the menu for words in a {value1}? The script itself stays.{value2}',
  'settings.scripts.StartupScriptsEditor.startup.65d48235': 'Startup',
  'settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450':
    'Scripts run each time Obsidian starts, one after another in this order, once the vault is open. A script that takes parameters gets its defaults; one that needs a value with no default is skipped. Put a script here with the power button on its card in the library.',
  'settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa':
    "Don't run startup scripts",
  'settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c':
    'Skips all of them until switched back. If a startup script freezes Obsidian, it is also skipped by itself the next time Obsidian starts.',
  'settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7':
    'There are no scripts yet: add one to the scripts folder first.',
  'settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c':
    'No startup scripts yet.',
  'settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39':
    'Not found in the scripts folder',
  'settings.scripts.StartupScriptsEditor.already_the_first.eab62d41': 'Already the first',
  'settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e': 'Run it earlier',
  'settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12': 'Already the last',
  'settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f': 'Run it later',
  'settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3':
    'Stop running it at startup',
  'settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f':
    'Runs at startup by its own header (@startup), after the ones above, on {value0}. Add it to the list to give it a place.',
  'settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b': 'Add to the list',
  'settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74':
    'Put {value0} in the list above, to move it or choose its devices',
  'settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4': 'Add a script',
  'settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be':
    'Search your scripts for one to run at startup',
  'settings.scripts.StartupScriptsEditor.every_device.9b626893': 'Every device',
  'settings.scripts.StartupScriptsEditor.computers.680cb3c6': 'Computers',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2': 'Phones and tablets',
  'settings.scripts.StartupScriptsEditor.every_device.17779e2b': 'every device',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d': 'phones and tablets',
  'settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7': 'Keep only on the server',
  'settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724':
    'Device-local rule. It runs only when you preview and confirm; pinned, changed and open files stay here.',
  'settings.sync.ExternalFileRules.offload_folder.6566fece': 'Offload folder',
  'settings.sync.ExternalFileRules.empty_means_all_folders.c907d956': 'Empty means all folders.',
  'settings.sync.ExternalFileRules.all_folders.226fd0e5': 'All folders',
  'settings.sync.ExternalFileRules.file_types.696bc9a7': 'File types',
  'settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a':
    'Comma-separated extensions. Empty means all attachment types.',
  'settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d': 'pdf, epub, jpg',
  'settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb': 'Minimum size (MiB)',
  'settings.sync.ExternalFileRules.not_opened_for_days.42eb5259': 'Not opened for days',
  'settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0':
    '0 ignores age. Files without a recorded opening are excluded when age is set.',
  'settings.sync.ExternalFileRules.review_matching_files.f7400143': 'Review matching files',
  'settings.sync.ExternalFileRules.see_every_file_and_the.b398409d':
    'See every file and the estimated space before making changes.',
  'settings.sync.ExternalFileRules.preview.324b134f': 'Preview',
  'settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2':
    'List matching files and review space before offloading',
  'settings.sync.SelectiveSync.what_this_device_syncs.979d00ce': 'What this device syncs',
  'settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522':
    "Notes and canvases always travel. Everything else is this device's own choice — a phone can skip the video and still hold every note.",
  'settings.sync.SelectiveSync.largest_file.5cd59717': 'Largest file',
  'settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7':
    'Files bigger than this are skipped, in megabytes. Leave it empty to take everything.',
  'settings.sync.SelectiveSync.no_limit.f7fcff0d': 'No limit',
  'settings.sync.SelectiveSync.obsidian_settings.b1370814': 'Obsidian settings',
  'settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56': 'Folders this device skips',
  'settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89':
    'Nothing under a folder listed here is uploaded or downloaded by this device. The other devices still hold it.',
  'settings.sync.SelectiveSync.skipped_by_this_device.a7679073': 'Skipped by this device.',
  'settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c':
    'Sync this folder on this device again',
  'settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be':
    'This device syncs every folder.',
  'settings.sync.SelectiveSync.skip_a_folder.1f3e8658': 'Skip a folder',
  'settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43':
    'Pick a folder this device should leave alone.',
  'settings.sync.SelectiveSync.e_g_archive_video.b35fc660': 'e.g. {literal0}',
  'settings.sync.SelectiveSync.skip.28d03596': 'Skip',
  'settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063':
    'Stop syncing this folder on this device',
  'settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698': 'Name a folder to skip first',
  'settings.sync.SelectiveSync.images.be7e2f20': 'Images',
  'settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e':
    'Screenshots, photos, drawings and diagrams.',
  'settings.sync.SelectiveSync.audio.bc1b8890': 'Audio',
  'settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181': 'Recordings and voice notes.',
  'settings.sync.SelectiveSync.video.d534be82': 'Video',
  'settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb':
    'The heaviest thing a vault usually holds.',
  'settings.sync.SelectiveSync.pdfs.211eae3f': 'PDFs',
  'settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99': 'Papers, manuals and scans.',
  'settings.sync.SelectiveSync.everything_else.cd6c5f59': 'Everything else',
  'settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625':
    'Attachments of no listed type, and the scripts folder.',
  'settings.sync.SelectiveSync.app_settings.d43fb8a9': 'App settings',
  'settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd':
    'Editor and file behaviour, from app.json.',
  'settings.sync.SelectiveSync.appearance.3907fa7f': 'Appearance',
  'settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304':
    'The theme, its snippets and the font choices.',
  'settings.sync.SelectiveSync.hotkeys.c15f1530': 'Hotkeys',
  'settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8':
    'The shortcuts you have bound.',
  'settings.sync.SelectiveSync.core_plugins.f2e957b0': 'Core plugins',
  'settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676':
    "Which of Obsidian's own plugins are on.",
  'settings.sync.SelectiveSync.community_plugins.ab574402': 'Community plugins',
  'settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f':
    'The plugins themselves, so a new device installs what this one runs.',
  'settings.sync.SelectiveSync.plugin_settings.95d7fb37': 'Plugin settings',
  'settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b':
    'What each community plugin holds in its own data.json.',
  'settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee':
    'This device keeps its settings in a renamed config folder, {value0}, and sync does not carry one yet: Obsidian settings stay on this device, and those on the server are left alone.',
  'settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882':
    'How much of the configuration folder travels. The workspace, the graph and every plugin cache stay where they are, on every device.',
  'settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2': 'Nothing was changed: {value0}',
  'settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c': 'What will be sent',
  'settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4': 'Carries a key',
  'settings.transfer.TransferPreviewModal.keys.f0d66a79': 'Keys',
  'settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018':
    'Shown masked here; they travel in full, which is why the transfer is locked.',
  'settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f': 'Read a transfer',
  'settings.transfer.TransferScanModal.use_the_camera.429bb22e': 'Use the camera',
  'settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce':
    'Point the camera at the codes on the other device',
  'settings.transfer.TransferScanModal.take_a_photo.996e6a73': 'Take a photo',
  'settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87':
    'Photograph the code, or pick a picture of one',
  'settings.transfer.TransferScanModal.open_a_file.3b31f677': 'Open a file',
  'settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7':
    'Read a transfer saved as a file on the other device',
  'settings.transfer.TransferScanModal.paste_the_text.d98782e3': 'Paste the text',
  'settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa':
    'Paste the transfer as text instead of reading a code',
  'settings.transfer.TransferScanModal.abl.c834a09f': 'ABL1:…',
  'settings.transfer.TransferScanModal.codes_read.99b98121': 'codes read',

  'settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908':
    'Nothing read yet. The other device shows the codes; this one collects them in any order.',
  'settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91':
    'This transfer carries a key, so it is locked. Type the code shown on the other device.',
  'settings.transfer.TransferScanModal.characters.2ad81da8': '8 characters',

  'settings.transfer.TransferScanModal.what_to_do_with_what.99215800':
    'What to do with what is already here',
  'settings.transfer.TransferScanModal.keep_value.c1cdcb02': 'Keep {value0}',
  'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a': 'Not on this device yet',
  'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324':
    'Replaces the one already on this device',
  'settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c': 'Already here, the same',
  'settings.transfer.TransferScanModal.unlock.4ac709aa': 'Unlock',
  'settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253':
    'Open the transfer with this code',
  'settings.transfer.TransferScanModal.apply.31e392d1': 'Apply',
  'settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186':
    'That transfer did not arrive whole. Read the codes again.',
  'settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4':
    'That code does not open this transfer.',
  'settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0':
    'Anything here that the transfer does not mention is left alone.',
  'settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4':
    'Nothing here would be removed: the transfer covers all of it.',
  'settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876':
    '{value0}: {value1}. Scripts, skills and prompts are never deleted.',

  'settings.transfer.TransferScanModal.value_to_store_for_the.22f67128':
    '{value0} to store for the selected items.',
  'settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7':
    'No keys to store for the selected items.',
  'settings.transfer.TransferScanModal.just_now.7ddb44d8': 'just now',
  'settings.transfer.TransferScanModal.today_at_value.c0d04ee3': 'today at {value0}',
  'settings.transfer.TransferScanModal.already_applied.ca602d60': 'Already applied',
  'settings.transfer.TransferScanModal.applying.3329a9bb': 'Applying…',
  'settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead':
    "Write these into this vault's settings",
  'settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d':
    'Tick something to apply first',
  'settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e':
    'These settings could not be applied.',
  'settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870':
    'No camera here. Take a photo of the code, or paste the transfer as text.',
  'settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f':
    'No transfer in that file.',
  'settings.transfer.TransferScanModal.no_code_in_that_picture.34801264':
    'No code in that picture.',
  'settings.transfer.TransferSendModal.send_to_another_device.71ef2876': 'Send to another device',
  'settings.transfer.TransferSendModal.name_for_the_other_device.33a35391':
    'Name for the other device',
  'settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846':
    "The server makes a device of its own for it, and the vault's device list shows it under this name.",
  'settings.transfer.TransferSendModal.other_device.76d065a6': 'Other device',
  'settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48':
    'Asking the server for a device of its own for the other side…',
  'settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7':
    'Type this on the other device',
  'settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606':
    'Transfer code {value0} of {value1}',
  'settings.transfer.TransferSendModal.previous_code.9073b55e': 'Previous code',
  'settings.transfer.TransferSendModal.next_code.2924d04c': 'Next code',
  'settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8':
    'Stop moving through the codes',
  'settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219':
    'Move through the codes on their own',
  'settings.transfer.TransferSendModal.make_the_codes.05fce439': 'Make the codes',
  'settings.transfer.TransferSendModal.have_the_server_make_the.26277032':
    'Have the server make the other device, and show the codes',
  'settings.transfer.TransferSendModal.give_the_other_device_a.62f36130':
    'Give the other device a name first',
  'settings.transfer.TransferSendModal.save_a_file.637ed29a': 'Save a file',
  'settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0':
    'Save the transfer as a file outside what syncs, to send on however you like',
  'settings.transfer.TransferSendModal.show_the_codes.1eb16a33': 'Show the codes',

  'settings.transfer.TransferSendModal.copy_the_text.a9c0e598': 'Copy the text',
  'settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d':
    'Copy the whole transfer, to paste on the other device',
  'settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8':
    ' The code above unlocks it on the other side.',
  'settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601':
    'Read the code, or copy the text.{value0}',
  'settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2': {
    one: '{count} codes, shown one after another — or copy the text and skip the camera.{value1}',
    other: '{count} codes, shown one after another — or copy the text and skip the camera.{value1}',
  },
  'settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f': {
    one: 'This one takes {count} codes, which is more than anyone wants to photograph. Copy the text into a message, or save it as a file and send that.{value1}',
    other:
      'This one takes {count} codes, which is more than anyone wants to photograph. Copy the text into a message, or save it as a file and send that.{value1}',
  },
  'settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659':
    'Could not copy the text. Select it below and copy it, or save it as a file.',
  'settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c':
    'Transfer copied. Paste it on the other device.',
  'settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07':
    'Open it under "Read a transfer" on the other device',
  'settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2':
    'Saved to {value0}. {value1}.',
  'settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d':
    'Saved as {value0}, in a hidden folder of this vault that Abele Sync does not carry. ',
  'settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef':
    '{value0}, and delete it once it is read.',
  'settings.transfer.TransferSendModal.could_not_save_it_value.14315a58':
    'Could not save it: {value0}',
  'settings.rich.bc6ba5473fff4aa8':
    "A script whose first lines say {slot0} is a rule: it gives back {slot1}, a list of what is wrong, and may give back {slot2}, the note's new text. It is listed above with the others. The Scripts page of the documentation shows one.",
  'settings.rich.ae545f75ff9437be': 'No skills in this vault. Skills are notes with {slot0}.',
  'settings.rich.3cf5061d7d4aaae2':
    'Keys and tokens for API requests. AI agent uses {slot0} in fetch calls, which is replaced with the actual value. Stored securely in keychain.',
  'settings.rich.59db234df027f515':
    "Scripts that run by themselves when something happens to a note: a task completed, a note of some type changed. The script reads what happened as {slot0}. Parameters accept {slot1} and any frontmatter field of the note. They run on the device where the change was made; a script's own writes never set off the same automation again.",
  'settings.rich.5c124ccc61dc59ea':
    "Buttons above a note's text that run a command or a script, on the notes you choose, in this order. A script can be handed the note's values: {slot0} or any property, {slot1}.",
  'settings.rich.225479f70a17e374':
    'Every script in the scripts folder. A script describes itself in the comment block at the top of its file: {slot0}, {slot1}, {slot2} and a {slot3} line per value it takes. The pin puts a script on the toolbar: an icon on the left ribbon on a computer, and a place on the toolbar above the keyboard on a phone — {slot4} in its header does the same. The power button runs a script each time Obsidian starts; {slot5} in its header does the same, and the Startup tab puts them in order.',
  'settings.rich.82dd523dc663e313':
    '{slot0} scripts discovered. Configure tool modes in {slot1} or per-chat in the permissions modal.',
  'settings.terms.keySaved': 'Key saved',
  'settings.terms.noKeyYet': 'No key yet',
  'settings.terms.thisKey': 'this key',
  'settings.terms.none': 'none',
  'settings.terms.theSecret': 'the secret',
  'settings.terms.unnamedAutomation': 'this unnamed automation',
  'settings.terms.unnamedButton': 'this unnamed button',
  'settings.terms.password': 'password',
  'settings.terms.link': 'link',
  'settings.terms.book': 'book',
  'settings.terms.chat': 'chat',
  'settings.terms.missingSuffix': ' · missing',
  'settings.terms.resetsSuffix': ' · resets ',
  'settings.metadata.c99cb7557b2bd7cb': 'Read data',
  'settings.metadata.ba35eb1f0c41c920': 'Analyze data',
  'settings.metadata.93b5e95f0841a6c1': 'Book highlights',
  'settings.metadata.9b9ab66d2dc6d4e6': 'Highlight in a book',
  'settings.metadata.836cba1ac2f246a0': 'Change a highlight',
  'settings.metadata.6bbd1e58f841181f': 'Remove a highlight',
  'settings.metadata.1d5729de03eb270a': 'Bookmark in a book',
  'settings.metadata.d9e8263863cd7c1a': 'Book tabs',
  'settings.metadata.c8e5758cffa93be0': 'Book contents',
  'settings.metadata.3e6c3299627e72e5': 'Read book',
  'settings.metadata.efb806b8e248de86': 'Search book',
  'settings.metadata.973b70df8c6835ab': 'Show in a book',
  'settings.metadata.e1b19c0fcc092bb5': 'List books',
  'settings.metadata.3824a9f4dafe92c6': 'Canvas',
  'settings.metadata.ca58ee75a82eb866': 'Chart Docs',
  'settings.metadata.1f104d4e483afe57': 'Copy File',
  'settings.metadata.f1eb5a8241e4bf26': 'Create File',
  'settings.metadata.016fc69b8f33e22e': 'Script API Docs',
  'settings.metadata.e3de1e15d36b9e54': 'Create Script',
  'settings.metadata.cf8c8078d8db9550': 'Current location',
  'settings.metadata.1e814554ca1b586f': 'Read deck',
  'settings.metadata.cf31f39501ec79cc': 'Presentations',
  'settings.metadata.07bcab5dd6c2b3ac': 'Create deck',
  'settings.metadata.a34f02e3fb7f55ab': 'Edit slide',
  'settings.metadata.ee9a26182331bd59': 'Check deck fit',
  'settings.metadata.4c3cd91f9873a96b': 'Open presentation',
  'settings.metadata.3ecb6f7da6cd8b57': 'Delegate to agent',
  'settings.metadata.e1e5fe2043bd3003': 'Delete File',
  'settings.metadata.072bcdf480cf935b': 'Edit Word document',
  'settings.metadata.3a2860ece5a4ee0b': 'Word',
  'settings.metadata.d62c5e04e2041963': 'Word tabs',
  'settings.metadata.fdbd5cb0402f63f0': 'Read Word document',
  'settings.metadata.abcfc9b08f141d57': 'Search Word document',
  'settings.metadata.8fc231e28ab03931': 'Download Image',
  'settings.metadata.d5501e84dd2baf5a': 'Download File',
  'settings.metadata.c3df84ddf2927d7f': 'Look at drawing',
  'settings.metadata.c769c50ec11b66ce': 'Edit File',
  'settings.metadata.5597753f9c2ffeb8': 'Edit Image',
  'settings.metadata.b9aca9af90312aa4': 'Edit selection',
  'settings.metadata.529285444d7e58bf': 'Evaluate JavaScript',
  'settings.metadata.e663529b7a08617b': 'Migrate Excalidraw drawings',
  'settings.metadata.014b08ed6d8976df': 'Fetch URL',
  'settings.metadata.d20890b1e4db1fa1': 'Find Files',
  'settings.metadata.a6bd489d95504499': 'Forget',
  'settings.metadata.0f44b5601ade4f85': 'Generate Image',
  'settings.metadata.1606207c55304e06': 'Geocode',
  'settings.metadata.bf4c6dda970987a0': 'Find places',
  'settings.metadata.06cc7177f48987cc': 'Build route',
  'settings.metadata.abce462b78197fc5': 'Inspect View',
  'settings.metadata.1f728b52096a2eb0': 'Lint notes',
  'settings.metadata.f0c84f13ed58b1d6': 'Fix lint issues',
  'settings.metadata.ede087fd8f5ce83a': 'List Workspace',
  'settings.metadata.535843b2c2fee0eb': 'List Directory',
  'settings.metadata.002cc66337cf3764': 'Move/Rename File',
  'settings.metadata.7ac362063b9f2046': 'Nodes',
  'settings.metadata.1e8d18f62f2d2a2f': 'Open File',
  'settings.metadata.c0d019c19251efca': 'Query docs',
  'settings.metadata.9a72221a27476f3e': 'Questions',
  'settings.metadata.fb9b615c6b482637': 'Read File',
  'settings.metadata.6562fb21e7fbb468': 'Read Image',
  'settings.metadata.7b4a3b51f8248d49': 'Read Logs',
  'settings.metadata.75ce2bbc2da8977a': 'Read Backlinks',
  'settings.metadata.a50358c35c21caf0': 'Read Transactions',
  'settings.metadata.6f987478bf258d46': 'Read Tasks',
  'settings.metadata.8096a7bd9a09e11f': 'Remember',
  'settings.metadata.95e154398a4bc009': 'Replace',
  'settings.metadata.ddf641f9a5ee4177': 'Propose reply revision',
  'settings.metadata.029320ad166c1807': 'Screenshot',
  'settings.metadata.40945d7914b5838d': 'Answer form',
  'settings.metadata.17434a9251409137': 'Read settings',
  'settings.metadata.7fe866d491ae7890': 'Write settings',
  'settings.metadata.6df1bb18a59ab97d': 'Skill',
  'settings.metadata.118469284c824130': 'Template Docs',
  'settings.metadata.f7b314c3f5d5dcea': 'List Templates',
  'settings.metadata.23febe05ea52c943': 'Apply Template',
  'settings.metadata.d04fc7d7e19702f8': 'Web Search',
  'settings.metadata.d78cd87c20261047': 'Write File',
  'settings.metadata.ff4e3889f363a511': 'Write workbook cells',
  'settings.metadata.48d53635551c8fd4': 'Excel',
  'settings.metadata.9a8eb492fd32afbe': 'Workbook sheets',
  'settings.metadata.51feedc6468c9521': 'Read workbook range',
  'settings.metadata.6b11523da566fd08': 'Search workbook',
  'settings.metadata.8463eb4799ceda94': 'Create ZIP',
  'settings.metadata.ee52497854a67e54': 'Read GitHub file',
  'settings.metadata.7ba6f2c8e75022bd': 'GitHub commits',
  'settings.metadata.c97212ae47ab4694': 'Grep code at a version',
  'settings.metadata.eff04b0872a1b825': 'Read GitHub item',
  'settings.metadata.9632f6701a8ca357': 'Pull request files',
  'settings.metadata.ff48a92c96b73fa8': 'Search GitHub',
  'settings.metadata.f5db8240ba9c07c2': 'GitHub tabs',
  'settings.metadata.0a876c393a858219': 'Show on GitHub tab',
  'settings.metadata.47659c3dccc86dc6': 'Read file',
  'settings.metadata.abc7e9892806b047': 'Files',
  'settings.metadata.9608dd142d9b10d7': 'Edit file',
  'settings.metadata.997357233881bfb9': 'Write file',
  'settings.metadata.6990d3217b7749c8': 'Create file',
  'settings.metadata.28e18dc9db382d81': 'Delete file',
  'settings.metadata.f83e6d79cd9c3e10': 'Move file',
  'settings.metadata.b60f1c7ad15c2b04': 'Copy file',
  'settings.metadata.930a81591b83ad25': 'List directory',
  'settings.metadata.15d12bc10296dc2d': 'Find files',
  'settings.metadata.87bb59ba2f92f2a5': 'Workspace',
  'settings.metadata.d515d2ee195fa943': 'Read image',
  'settings.metadata.4190c0c7ec727064': 'Open file',
  'settings.metadata.693ba7f5f3d9f77d': 'App view',
  'settings.metadata.dc37f2f4529c4136': 'Inspect view',
  'settings.metadata.7711faa74a10416c': 'Web search',
  'settings.metadata.2975104784a401e3': 'Web',
  'settings.metadata.3ac575dcce244f93': 'Download image',
  'settings.metadata.9de4149fb9716cfc': 'Download file',
  'settings.metadata.f911e414cf6bdfc5': 'GitHub',
  'settings.metadata.f7f0f6218e3ab3ce': 'Read issue or PR',
  'settings.metadata.046ceaf4f065a500': 'PR files',
  'settings.metadata.d09648c6058a4c84': 'Commits',
  'settings.metadata.49c266baaaa70981': 'Search',
  'settings.metadata.b2cfbf5af10d5b5d': 'Show in a tab',
  'settings.metadata.9da7f76bc81d2f4e': 'Books',
  'settings.metadata.119e66d117ae8f0c': 'Maps',
  'settings.metadata.1c9c87eec07e453b': 'Generate image',
  'settings.metadata.be7e2f20129365c2': 'Images',
  'settings.metadata.d9d12b04b3831c32': 'Edit image',
  'settings.metadata.6bea010c8fb418a4': 'Eval JS',
  'settings.metadata.8fdd2ee8475e29bc': 'Basics',
  'settings.metadata.760ed96061ace03e': 'Delegate',
  'settings.metadata.a6d910ba93b7f894': 'Delegation',
  'settings.metadata.c3963aedaac6c83c': 'Memory',
  'settings.metadata.2e19427030d9d43c': 'Chart docs',
  'settings.metadata.7af023c43013b9a5': 'Docs',
  'settings.metadata.5afdd3f5b60d4d59': 'Template docs',
  'settings.metadata.9d45317393ff2163': 'Read logs',
  'settings.metadata.19b88504fa831ce1': 'Notes data',
  'settings.metadata.8c87f5ea162d2e65': 'Read backlinks',
  'settings.metadata.692a437039f64732': 'Read transactions',
  'settings.metadata.b696d75511dc16f2': 'Finance',
  'settings.metadata.d340a6c01b6f5fee': 'Read tasks',
  'settings.metadata.b3a60e61a5233d05': 'Tasks',
  'settings.metadata.a249b2df7cba7a38': 'List templates',
  'settings.metadata.56b564b75c7fdb48': 'Templates',
  'settings.metadata.a0859ef85c0a0934': 'Apply template',
  'settings.metadata.6dc2a1098225593e': 'Script API docs',
  'settings.metadata.74a883a037bc227f': 'Settings',
  'settings.metadata.ea59135c1811dd4d': 'Create script',
  'settings.metadata.8d0e6b4ab60543cf': 'Scripts',
  'settings.metadata.7000d0dc57ecf4be': 'Read result',
  'settings.metadata.d9e66d2ce531344c': 'Node files',
  'settings.metadata.e93372533f323b2f': 'Node',
  'settings.metadata.6ded9685b4a797e6': 'Read files and search',
  'settings.metadata.562123f8976fe819': 'Edit files',
  'settings.metadata.aec2f93d67b7c4c5': 'Worktrees',
  'settings.metadata.e90a0f8d49e203ea': 'Hand work to a node agent',
  'settings.metadata.b907a91b588b818c': 'Debugger runs',
  'settings.metadata.befc6e918047c85b': 'Your messages',
  'settings.metadata.f39b199601422405': "The agent's answers",
  'settings.metadata.b6c1d862f9f75ec3': 'Both',
  'settings.metadata.0ca9f9fe82be9456': 'Draft only',
  'settings.metadata.65c3ce1551b7fdc4': 'Last 4 messages',
  'settings.metadata.87e460223959d06f': 'Last 10 messages',
  'settings.metadata.27ba0224f1937dcd': 'Whole conversation',
  'settings.metadata.abc9eb2fc4a07abf':
    'User-Agent sent to this connection. Empty keeps the default. Mobile streaming may ignore it.',
  'settings.metadata.fcc01b1454819dec': 'Follows the theme',
  'settings.metadata.17ed08435ee39aec': 'Liberty',
  'settings.metadata.e4378e9c551f7f9c': 'Bright',
  'settings.metadata.437b56da751ee02a': 'Positron, quiet',
  'settings.metadata.60acc53f13a5d1bf': 'Dark',
  'settings.metadata.2620b9ac0d72c634': 'Fiord, dark blue',
  'settings.metadata.3d5b0ed33cbfc204': 'Own style by URL',
  'settings.metadata.a57b3a3a34957437': 'Has properties',
  'settings.metadata.fdd539aca215e393':
    'The note starts with a properties block (--- on its first line).',
  'settings.metadata.a9aeaf057d72407f': 'Properties can be read',
  'settings.metadata.048c4415ef41ad0a': 'Required properties',
  'settings.metadata.ae43692b2a310b8e': 'Properties',
  'settings.metadata.079647a8b86e4378':
    'Comma-separated. "name: default" to have the fix fill it in.',
  'settings.metadata.3c0c64e0fd626bca': 'Has a note type',
  'settings.metadata.a628c83f6a069d90':
    'The note says what it is in its type property — task, person, meeting. With a list of types, the value must be one of them.',
  'settings.metadata.40040cb181f7f0ee': 'Property',
  'settings.metadata.853362b96c0c33a4': 'Where the type is written.',
  'settings.metadata.2b04790e11e9360e': 'Allowed types',
  'settings.metadata.fc2ba0dd4e23cdd0': 'Comma-separated. Empty lets any value through.',
  'settings.metadata.21b111cbfe6e8fca': 'Default',
  'settings.metadata.0482acc3c6913a87':
    'Written by the fix into a note without a type. Empty: nothing is fixed.',
  'settings.metadata.147e6bba43829675': 'No tags',
  'settings.metadata.c03ca2fe828c431e':
    'For a vault that does not use tags: the tags property is taken out by the fix; a #tag in the text is shown to be dealt with by hand.',
  'settings.metadata.d4743e63e45dde22': 'Tags in the text',
  'settings.metadata.587ccd181c91d2a8': 'Also find #tags written in the text.',
  'settings.metadata.fdca3c91c0898bd4': 'Unwanted properties',
  'settings.metadata.a4ef39b33278f6ef':
    'None of the listed properties is there. The fix takes them out.',
  'settings.metadata.0a26d2a3c07531d9': 'Comma-separated.',
  'settings.metadata.29a015b0a78abcc6': 'Blank line after the properties',
  'settings.metadata.56bae77505677e3c':
    'Exactly one blank line stands between the properties and the text.',
  'settings.metadata.6ca1bd19ad8e5df4': 'No first-level heading',
  'settings.metadata.a5b697a0a2aa9674':
    'The file name is the title, so the text has no # heading. The fix takes out one that repeats the name and makes any other a ## heading.',
  'settings.metadata.93df69cc2eaf6ff1': 'Dates written as dates',
  'settings.metadata.7ef1f2a6ca083e8a':
    'The listed properties hold a date as YYYY-MM-DD. The fix rewrites 2026-9-5, 05.09.2026 and [[2026-09-05]].',
  'settings.metadata.9024c197d84940e4': 'Links',
  'settings.metadata.1d80ae7836ce9902': 'Header buttons',
  'settings.metadata.ad1fb9ec0cb3c7a4': 'Automations',
  'settings.metadata.c20c37564e3f3409': 'Journals',
  'settings.metadata.e95944e1c3c81e4c': 'GitHub connections',
  'settings.CalendarsSettings.value_h_ago.d5aa4bb8': '{value0} h ago',
  'settings.CalendarsSettings.value_d_ago.0f70078c': '{value0} d ago',
  'settings.CalendarsSettings.value_from_value_kept.419ae64a': '{value0} from {value1}, kept',
  'settings.CalendarsSettings.value_read_value.6e58c8af': '{value0}, read {value1}',
  'settings.GithubSettings.account_not_checked.d2a6562d': 'Account not checked',
  'settings.GithubSettings.token_expires_within_seven_days.1b81c28c':
    'Token expires within seven days',
  'settings.LinterSettings.in_value.b63d3a91': 'in {value0}',
  'settings.LinterSettings.where_value_value.e534e0d0': 'where {value0}{value1}',
  'settings.LinterSettings.script_value.c5efe1d1': ' Script: {value0}.',
  'settings.LinterSettings.only_value.e2625151': ' Only {value0}.',

  'settings.SecretsListModal.value_set.f4c8f3b4': '{value0} set',
  'settings.SecretsListModal.value_synced.1785a4d0': '{value0} synced',
  'settings.TransferSettings.value_of_value.ca6c5e5f': '{value0} of {value1}',
  'settings.TransferSettings.value_selected.975acbfe': '{value0} selected',

  'settings.ai.interceptorList.matching_value.b4ca1a61': 'matching {value0}',

  'settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986':
    '{value0}…{value1} ({value2} characters)',
  'settings.transfer.TransferScanModal.value_at_value.92c9c89a': '{value0} at {value1}',
  'settings.count.item': { one: '{count} item', other: '{count} items' },
  'settings.count.key': { one: '{count} key', other: '{count} keys' },
  'settings.count.file': { one: '{count} file', other: '{count} files' },
  'settings.count.code': { one: '{count} code', other: '{count} codes' },
  'settings.count.prompt': { one: '{count} prompt', other: '{count} prompts' },
  'settings.count.scopeEntry': { one: '{count} scope entry', other: '{count} scope entries' },
  'settings.count.event': { one: '{count} event', other: '{count} events' },
  'settings.count.model': { one: '{count} model', other: '{count} models' },
  'settings.count.button': { one: '{count} button', other: '{count} buttons' },
  'settings.count.tool': { one: '{count} tool', other: '{count} tools' },

  'settings.parts.fa11c9afc868fc1e': ' · resets {value0}',

  'settings.parts.520a5d3ab1d92888': ' is {value0}',
  'settings.parts.9edb143e79ddd491': '(unnamed)',

  'settings.parts.951aaf14e2b23dff':
    ' Its {value0} header still puts it on this menu; remove that line from the script to hide it.',
  'settings.parts.195dc73d2db93bf8': 'This will be removed',
  'settings.parts.778541341fcda9aa': 'These will be removed',

  'settings.metadata.86ed522daec49399': 'AI general',
  'settings.metadata.8748f23993a86245': 'Voice input',
  'settings.metadata.2c4aed90f68a9826': 'AI providers',
  'settings.metadata.d110fe793fa72de1': 'Image providers',
  'settings.metadata.279b44d2ab4b40c0': 'Agents',
  'settings.metadata.22a7559f09bf8f82': 'MCP servers',
  'settings.metadata.e5f4cb8707719fbd': 'Stored keys',
  'settings.metadata.5f2e66e6539797d0': 'Prompts',
  'settings.metadata.f46ee86a068c4c22': 'Script settings',
  'settings.metadata.66d0f523a379b2de': 'Skills',
  'settings.metadata.f6a1fdbcca54b2f8': 'Prompt notes',
  'settings.metadata.71fea45d263e0906': 'Task completed',
  'settings.metadata.968a994a15bd991a': 'Task reopened',
  'settings.metadata.a3e3e968c40e5951': 'Task created',
  'settings.metadata.ba3078bec8c60a69': 'Task changed',
  'settings.metadata.98acf0d427bd63b5': 'Task date changed',
  'settings.metadata.d41c129fb8fdf353': 'Note created',
  'settings.metadata.e6a78804e128667f': 'Note changed',
  'settings.metadata.4a33279d562ffb24': 'Note renamed',
  'settings.metadata.81f7d1888d5a03be': 'Note deleted',
  'commands.external-file-evict': 'Keep only on the server',
  'commands.external-file-pin': 'Keep on this device',
  'commands.external-file-hydrate': 'Download to this device',
  'settings.ordinal.first': 'first',
  'settings.ordinal.second': 'second',
  'settings.ordinal.third': 'third',
  'settings.ordinal.number': '{count}th',
  'settings.terms.script': 'script',
  'settings.CalendarsSettings.new_link.f9e84245': 'New link...',
  'settings.CalendarsSettings.save_the_link.7b19a248': 'Save the link',
  'settings.CalendarsSettings.the_link.f0fb533a': 'The link',
  'settings.CalendarsSettings.new_password.1abebe85': 'New password...',
  'settings.CalendarsSettings.save_the_password.acd9c185': 'Save the password',
  'settings.CalendarsSettings.the_password.3f4e5252': 'The password',
  'settings.FinanceSettings.new_token.564f08bc': 'New token...',
  'settings.FinanceSettings.save_the_token.8326f085': 'Save the token',
  'settings.FinanceSettings.the_token.d22bffce': 'The token',
  'settings.GithubConnectionEditor.new_token.564f08bc': 'New token...',
  'settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882':
    'Use this token when saving the connection',
  'settings.GithubConnectionEditor.the_token.d22bffce': 'The token',
  'settings.GithubSettings.new_token.564f08bc': 'New token...',
  'settings.GithubSettings.save_the_notifications_token.d4a25b6f': 'Save the notifications token',
  'settings.GithubSettings.the_notifications_token.266dfc35': 'The notifications token',
  'settings.ai.InterceptorList.runs_value.fe51da79': 'Runs {value0}',
  'settings.ai.McpServerModal.new_token.564f08bc': 'New token...',
  'settings.ai.McpServerModal.save_the_token.8326f085': 'Save the token',
  'settings.ai.McpServerModal.the_token.d22bffce': 'The token',
  'settings.transfer.TransferPreviewModal.what_goes.39dde11f': 'what goes',
  'settings.GithubSettings.delete_this_connection_and_forget.1a526c31':
    'Delete this connection and forget its local token',
  'settings.GithubSettings.forget.a6bd489d': 'Forget',
  'settings.GithubSettings.remove_the_notifications_token_from.d1453607':
    'Remove the notifications token from the keychain',
  'settings.ImageModelEditModal.delete_value.8782b778': 'Delete {value0}',
  'settings.ModelEditModal.delete_value.8782b778': 'Delete {value0}',
  'settings.QuickButtonSettings.take_out.a7fc33e3': 'Take out',
  'settings.QuickButtonSettings.take_value_out_of_the.8b01b719': 'Take {value0} out of the menu',
  'settings.SecretsListModal.put_every_key_on_the.8118968c':
    'Put every key on the clipboard as plain text',
  'settings.ai.AgentsSettings.delete_value.8782b778': 'Delete {value0}',
  'settings.ai.McpServerModal.delete_value.8782b778': 'Delete {value0}',
  'settings.ai.McpSettings.delete_value.8782b778': 'Delete {value0}',
  'settings.scripts.AutomationsEditor.delete_value.8782b778': 'Delete {value0}',
  'settings.scripts.HeaderButtonsEditor.delete_value.8782b778': 'Delete {value0}',
  'settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8': 'Take off',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c':
    'Take {value0} off the menu',
  'settings.startup.computers': 'computers',
  'settings.transfer.itemsToApply': {
    one: '{count} item to apply',
    other: '{count} items to apply',
  },
  'settings.calendar.found': { one: '{count} calendar found.', other: '{count} calendars found.' },
  'settings.mcp.fetched': '{tools}, fetched {when}',
  'settings.sentence.2de766f4c2331579':
    'The saved values go into the request; they are never shown here. Allowing remembers this address for {value0} on this device, so it will not ask again here. Other devices will still ask.',
  'settings.sentence.c93c0ada01c57a48': '{value0} models available',
  'settings.sentence.cdb07f66a428a0ed': 'Not saved: {value0}',
  'settings.sentence.4f7ec121b15ac5e4': 'Shows nowhere · {value0}',
  'settings.sentence.7caf85c3282be170': 'still to find: {value0}',
  'settings.sentence.2d2a1f1b3800ab01': 'Made {value0}. Tick what to keep.',
  'settings.secrets.removeNamed':
    'Remove {name}? Any fetch call referring to it by name will stop working, and the stored value is gone from the keychain.',
  'settings.mcp.headersDescription':
    'One per line, as Name: value. Write a secret as {example}, a key kept under AI → General → Stored keys, so it stays out of the settings file.',
  'settings.sync.presentation.e159b06187d369a0': 'Paused',
  'settings.sync.presentation.857a66dd7a6dfe32': ' · {completed} of {total}',
  'settings.sync.presentation.265ec42c10960f4e': ' · Needs attention',
  'settings.sync.presentation.a3e3205316b64477': 'Server unavailable, retrying',
  'settings.sync.presentation.c70acece009d71d9': '{completed} of {total} files',
  'settings.sync.presentation.5c8b9e1ce0a2bc31': 'Syncing',
  'settings.sync.presentation.0d60f3335d21fa2b': {
    one: '{count} conflict copy',
    other: '{count} conflict copies',
  },
  'settings.sync.presentation.96f22a9119067884': {
    one: '{count} file not sent',
    other: '{count} files not sent',
  },
  'settings.sync.presentation.9e1b70e3f4abbe8e': 'Synced {when}',
  'settings.sync.presentation.c10529851ad89bd3': 'Not synced yet',
  'settings.sync.presentation.2512ef45cc838dc2':
    'Sync recovery required. Files and connection have been kept.',
  'settings.sync.presentation.fbcbda4833c5c0b7':
    'The server response was cut off before it finished. Try syncing again.',
  'settings.sync.presentation.fd2175ceceb4c39f':
    'This token is damaged or incomplete. Paste the whole token again.',
  'settings.sync.presentation.93754bdbbee0e2c4':
    'The server is not reachable. Check your connection and try again.',
  'settings.sync.presentation.f58e7749a37e75de': 'Access is closed. Ask for a new token.',
  'settings.sync.presentation.c3dbee340e1c8ed3':
    'The group is still being prepared. File exchange has not started.',
  'settings.sync.presentation.753e9b392eca8228':
    'The server is full. Your unsent files stay on this device.',
  'settings.sync.presentation.7584f523308d5d6d':
    'This file is too large for the server. It stays on this device.',
  'settings.sync.presentation.9036c8e0dc30cc74':
    'The server is full. The file stays here and can be sent after space is available.',
  'settings.sync.presentation.bbb4cbf36ea63cbd': 'This connection does not allow that action.',
  'settings.sync.presentation.110ec9023ae84ee7':
    'The server response could not be trusted; sync stopped. Local files were kept.',
  'settings.sync.presentation.9259b3f2e2f72c08': 'This folder or group is no longer available.',
  'settings.sync.presentation.0303e18246708180': 'Not connected',
  'settings.sync.presentation.fe7c4c6f414c4083': 'Group outside this connection',
  'settings.sync.presentation.97c769d2eaf4ca1c': 'Folder outside this connection',
  'settings.sync.presentation.f56643958aeae61b': 'Group: {name}',
  'settings.sync.presentation.7dd20272337b469c': 'Open version history · {name}',
  'settings.sync.presentation.cb44fe2561afccff': 'Whole vault',
  'settings.sync.presentation.5c802e6401aca4d2': 'Folder: {path}',
  'settings.sync.presentation.5fa7aac5375c5815': 'Ready',
  'settings.sync.presentation.b0f398a57ea3ca38': 'Server unavailable',
  'settings.sync.presentation.c1ebc7817870e5be': 'Needs attention',
  'settings.sync.presentation.9b7e4ca97f057cbc': 'Needs a token',
  'settings.sync.presentation.d403c686f6a10480': 'Connecting',
  'settings.sync.presentation.58b1510f8abae1f2': 'Access unavailable',
  'settings.sync.presentation.5514efec066cba3e': 'Updating access',
  'settings.sync.presentation.ae9cea791e9bc09c': 'Deleted on the server',
  'settings.sync.presentation.013c681e65af3ea9':
    'The server was restored from a backup — checking files',
  'settings.sync.presentation.43edbd9fcb4f94a4': 'Checking restored files',
  'settings.sync.presentation.ceb8c1fa2307911c':
    'Shared folder renamed on the server: {from} → {to}; sync stopped',
  'settings.sync.presentation.d0be29aeb27cd431': 'Folder moved to {path}; sync stopped',
  'settings.sync.presentation.b1241ef8763e3062': 'Folder is gone; sync stopped',
  'settings.sync.presentation.41920972f6474234':
    'Server folder or group unavailable; local files kept',
  'settings.sync.presentation.54f2a3375e5dd52d': 'Access closed; local files kept',
  'settings.sync.presentation.fc135b7008d458b4': '{stage}… {completed}/{total}{attention}',
  'settings.sync.presentation.a90a62a0bc219ded': 'Checking the vault… {completed}/{total}',
  'settings.sync.presentation.ec5aa287907706b6': 'Comparing files {completed}/{total}',
  'settings.sync.presentation.63ec9d9ac51fa025': 'Server response interrupted',
  'settings.sync.presentation.27a38f81837d5e05': {
    one: '{count} folder',
    other: '{count} folders',
  },
  'settings.sync.presentation.63352fdc2cd6bbbf': { one: '{count} file', other: '{count} files' },
  'settings.sync.presentation.7c907ab73773e102': {
    one: '{completed} of at least {count} folder',
    other: '{completed} of at least {count} folders',
  },
  'settings.sync.presentation.7438a7b7fe1ef4bb': {
    one: '{completed} of at least {count} file',
    other: '{completed} of at least {count} files',
  },
  'settings.sync.presentation.20a1cd5ccd38098a': {
    one: '{completed} of {count} folder',
    other: '{completed} of {count} folders',
  },
  'settings.sync.presentation.9a139983ae1196bc': {
    one: '{completed} of {count} file',
    other: '{completed} of {count} files',
  },
  'settings.sync.presentation.608ec17db8dff1ba': ' · {bytes} {unit} transferred',
  'settings.sync.presentation.4336b4a9e578c6ce': ' · {bytes} of {total} {unit}',
  'settings.sync.presentation.4a9aad432626cdc4': ' · less than 1 min left',
  'settings.sync.presentation.c42b56810e72964d': ' · about {minutes} min left',
  'settings.sync.presentation.11a6767d5674c7e4': 'Done',
  'settings.sync.presentation.88fe20810f158d65': 'Saved; local cleanup is still pending',
  'settings.sync.presentation.2011abd185905fbc': 'Kept on this device. Allow removal first',
  'settings.sync.presentation.cf6ecbdf93a4cbd4':
    'Open in an editor or currently in use. Close it and try again',
  'settings.sync.presentation.ba084f0f0f3f2d81': 'Unsent changes stay on this device. Sync first',
  'settings.sync.presentation.1450568cbc3989de': 'The version changed. Preview again',
  'settings.sync.presentation.bfad3113a6082ae4':
    'The file no longer matches this rule. Preview again',
  'settings.sync.presentation.c257dbbbf04763fe': 'Unavailable offline',
  'settings.sync.presentation.8d4a166ba65e8cac': 'This file is not available on the server',
  'settings.sync.presentation.6d48d4d60ba51073':
    'This version is not yet on the server. Sync first; the file stays here',
  'settings.sync.presentation.3b110b3b8a0affae':
    'Sync refused this file. Resolve its sync status first; it stays here',
  'settings.sync.presentation.3123f064bd232e76': 'This server does not support offloading',
  'settings.sync.presentation.4b9c0b68c8009214':
    'This device storage does not support safe offloading',
  'settings.sync.presentation.67e22f73b49e31ce': 'Not enough space to download safely',
  'settings.sync.presentation.8925063fc75cd16d':
    'Another file occupies the destination. Both files were kept',
  'settings.sync.presentation.e2f0da1e1e6f9fdb': 'This file cannot be offloaded',
  'settings.sync.presentation.a88ffdf4720bfc95': 'Already kept only on the server',
  'settings.sync.presentation.2cfe6717c6efa346': 'Executable files stay on this device',
  'settings.sync.presentation.f3912c33c1e7e094':
    'This connection needs an access review before offloading',
  'settings.sync.presentation.4d77018e2e63b109': 'Sync recovery is required. The file stays here',
  'settings.sync.presentation.54272d517782b52a': 'Checking the vault',
  'settings.sync.presentation.6a534e2d9b68ac18': 'Comparing files',
  'settings.sync.presentation.committing': 'Committing changes',
  'settings.sync.presentation.0b398fdee3be023a': 'Preparing folders',
  'settings.sync.presentation.f8cc26b4a73ec961': 'Receiving files',
  'settings.sync.presentation.37b345555d7ea6c1': 'Downloading',
  'settings.sync.presentation.8b898ca34ce71371': 'Uploading',
  'settings.sync.presentation.d9351cf978606788': 'Reading the token',
  'settings.sync.presentation.a11acbbb551a6ddc': 'Checking the server',
  'settings.sync.presentation.dc4552a7de803f44': 'Opening the folder',
  'settings.sync.presentation.dfe7d0dd9f350fd8': 'Preparing the connection',
  'settings.sync.presentation.be0e89cc19c4cf38':
    'Deleted on the server. Every file stays on this device.',
  'settings.sync.codeSource': 'Code from {host} · {when}',
  'settings.sync.privateQuestion': 'Private file · share with {scope}?',
  'settings.components.AiScopeEditor.full_vault_access.e59147d6': 'Full vault access',
  'settings.components.AiScopeEditor.the_agent_may_read_and.7215c412':
    'The agent may read and change every file in the vault.',
  'settings.components.AiScopeEditor.the_agent_sees_only_what.dd8d63d0':
    'The agent sees only what is listed below.',
  'settings.components.AiScopeEditor.counting_group_members.6cf29d46': 'Counting group members',
  'settings.components.AiScopeEditor.what_the_agent_can_reach.9e1cc9cb': 'What the agent can reach',
  'settings.components.AiScopeEditor.remove_value_from_scope.5306ceeb':
    'Remove {value0} from scope',
  'settings.components.AiScopeEditor.loading_group_members.64b5fef7': 'Loading group members',
  'settings.components.AiScopeEditor.show_more.f5c9bd13': 'Show more',
  'settings.components.AiScopeEditor.nothing_yet_the_agent_sees.83352aaa':
    'Nothing yet: the agent sees no files.',
  'settings.components.AiScopeEditor.add_to_what_the_agent.ba420695':
    'Add to what the agent can reach',
  'settings.components.AiScopeEditor.add_a_note_folder_group.0a52ba05':
    'Add a note, folder, group or pattern…',
  'settings.components.AiScopeEditor.could_not_count_group_members.58d42889':
    'Could not count group members. Reopen Access to try again.',
  'settings.components.AiScopeEditor.could_not_load_group_members.9a565298':
    'Could not load group members. Close and reopen the group to try again.',
  'settings.components.ToolModesEditor.show_core_tools.bea400e8': 'Show core tools',
  'settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03':
    'Show always-on tools that cannot be disabled.',
  'settings.components.ToolModesEditor.all_tools.81c151f9': 'All tools',
  'settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce':
    'Sets every tool below at once. Each can still be changed on its own after.',
  'settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee':
    'Set every tool to {value0}',
  'settings.components.ToolModesEditor.always_open.67b6ffc1': 'Always open',
  'settings.components.ToolModesEditor.when_value_is_open.37a2f90a': 'When {value0} is open',
  'settings.components.ToolModesEditor.change_what_value_is_said.5508c12f':
    'Change what {value0} is said to be for',
  'settings.components.ToolModesEditor.reset_to_default.bc5b45ae': 'Reset to default',
  'settings.components.ToolModesEditor.use_the_section_s_own.e02f836f':
    "Use the section's own description again",
  'settings.components.ToolModesEditor.done.11a6767d': 'Done',
  'settings.components.ToolModesEditor.value_tools.a2c9c9bb': '{value0} tools',
  'settings.components.ToolModesEditor.hide_its_tools.52db5aef': 'Hide its tools',
  'settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30':
    'Show its tools, each with its own choice',
  'settings.components.ToolModesEditor.all_in_this_section.3d4eba9d': 'All in this section',
  'settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a':
    'Set every tool in {value0} to {value1}',
  'settings.components.ToolModesEditor.use_this_server.8eb48b42': 'Use this server',
  'settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e':
    'Gives every tool of this server, each asking before it runs.',
  'settings.components.ToolModesEditor.always_on.f017032a': 'always on',
  'settings.components.ToolModesEditor.use_the_tool_s_own.520c244d':
    "Use the tool's own description again",
  'settings.components.ToolModesEditor.on_request.be820103': 'On request',
  'settings.components.ToolModesEditor.off.ca7981b4': 'Off',
  'settings.components.ToolModesEditor.ask.b8c209cd': 'Ask',
  'settings.components.ToolModesEditor.auto.02862497': 'Auto',

  'settings.metadata.354509b1c9ccade8':
    'Files, search and git history on folders this chat was given on a node. What it can reach is set per chat in Node access.',
  'settings.metadata.18a90996c684b6b3':
    'Open, list and search files; status, diffs and history in git.',
  'settings.metadata.e0b89715205e4ef5': 'Create, change, move, copy and delete files.',
  'settings.metadata.d442700773269772': 'List a folder’s worktrees and switch between them.',
  'settings.metadata.29a212809fa10bf3':
    'Give a task to a coding agent on a node, follow it, send it more and cancel it.',
  'settings.metadata.c7ad7ac4793fb440':
    'Read the runs the debugger recorded, mark their steps, add record points and write them up; read, save, import and send the project’s saved requests.',
  'settings.metadata.1fd38d5cbd2a997b': 'pattern',
  'settings.metadata.f2892578274d2e49': 'open note',
  'settings.metadata.034a0062488256f1': 'folder',
  'settings.scope.groupNotes': { one: 'group · {count} note', other: 'group · {count} notes' },
  'settings.calendar.urlPlaceholder': 'https://… or webcal://…',
  'settings.transfer.singleQr': 'Show the transfer as a QR code',
  'settings.transfer.multipleQr': {
    one: 'Show the transfer as {count} QR codes',
    other: 'Show the transfer as {count} QR codes',
  },
  'settings.metadata.bf774e203130976f': 'Add record point',
  'settings.metadata.ed11479db97b1ec2': 'Cancel node task',
  'settings.metadata.ce884b28082de708': 'Delegate to node',
  'settings.metadata.47cbd67f4decc509': 'Find in run',
  'settings.metadata.20c3a692f1425939': 'Follow a value',
  'settings.metadata.a63e38b5ef9d8acc': 'Follow up on node task',
  'settings.metadata.3dcb2cb134c18f1a': 'Import requests',
  'settings.metadata.a657f2eaf9177c2b': 'list node worktrees',
  'settings.metadata.3f577c263389d695': 'Mark in run',
  'settings.metadata.f40ad2a69f110e1a': 'node cp',
  'settings.metadata.4c55f1221ca27657': 'Node delegation destinations',
  'settings.metadata.19d5a1e505698a8d': 'node edit',
  'settings.metadata.58bab54373681382': 'node folders',
  'settings.metadata.0887cebecaa90ad8': 'node git blame',
  'settings.metadata.7d99864f0651cf16': 'node git branches',
  'settings.metadata.c6d22695c2b49792': 'node git diff',
  'settings.metadata.2e62cdbaa5ee98f0': 'node git log',
  'settings.metadata.74cd294db7d3e719': 'node git status',
  'settings.metadata.0c7411b73901f6c2': 'node ls',
  'settings.metadata.e5b0c93478880755': 'node mv',
  'settings.metadata.c5dfe7e400c6f227': 'node nodes',
  'settings.metadata.fe2b5c47256ac07e': 'node read',
  'settings.metadata.b0dc611264fca372': 'node replace',
  'settings.metadata.d3d7043d61bb21c8': 'Node repository blame',
  'settings.metadata.34feb0cfc058ccff': 'Node repository changes',
  'settings.metadata.dd2e41d38b7838e9': 'Node repository commit',
  'settings.metadata.074e769d80fde34e': 'Node repository commits',
  'settings.metadata.c4806722ba66e903': 'Node repository compare',
  'settings.metadata.ab004772e1b71ba8': 'Node repository file',
  'settings.metadata.6544b43fdfe3320e': 'Node repository grep',
  'settings.metadata.a9c6586ae9f11964': 'Node repository open',
  'settings.metadata.81ac4cdc952990d9': 'Node repository propose_edit',
  'settings.metadata.44812fcb9883ac9d': 'Node repository tree',
  'settings.metadata.b74af9f786625504': 'Node repository views',
  'settings.metadata.cc00c9b3261b6896': 'node rm',
  'settings.metadata.f864b17e206c9949': 'node search',
  'settings.metadata.01bce5e752a4e282': 'node worktree switch',
  'settings.metadata.82a9c46ffa478994': 'Commit',
  'settings.metadata.ca8a5f3bee55b125': 'Delete the worktree…',
  'settings.metadata.6c91d7b86793064a': 'node write',
  'settings.metadata.aa2463736b28728a': 'Note about a run',
  'settings.metadata.f659e2e6ad7c78ad': 'Read a saved request',
  'settings.metadata.bac5871a628ca72b': 'Read node task status',
  'settings.metadata.7616d1f9f0eb2abe': 'Recorded runs',
  'settings.metadata.62b2137489d32412': 'Result of a send',
  'settings.metadata.87c059b1fd800819': 'Run timeline',
  'settings.metadata.93f46c6131a98750': 'Save a request',
  'settings.metadata.49813efc30da7138': 'Saved requests',
  'settings.metadata.0d50b621a3f98f5d': 'Send a saved request',
  'settings.metadata.a4b757018683f41d': 'Value changes',
  'settings.metadata.ae1b1551ec65814d': 'Value shape',
  'settings.metadata.7a6f44b8094e0625': 'Value slice',
  'settings.metadata.da9b697a15683606': 'Create canvas',
  'settings.metadata.841ee7bd4aeb25a6': 'Define canvas walkthrough',
  'settings.metadata.aab4922458b14785': 'Edit canvas',
  'settings.metadata.97fd18d398003c79': 'Export whole canvas',
  'settings.metadata.1fe56b7b323305fc': 'Lay out canvas',
  'settings.metadata.6f53a1ddd68b0c2b': 'Look at canvas',
  'settings.metadata.2b046175f5077346': 'Read canvas',
  'settings.tools.openSection': 'Open {section}',
  'settings.ModelEditModal.default.21b111cb': 'Default',
  'settings.ModelEditModal.low.f793de20': 'Low',
  'settings.ModelEditModal.medium.8e588cd1': 'Medium',
  'settings.ModelEditModal.high.c4ebc6d4': 'High',
  'settings.ai.AgentEditorModal.none.dc937b59': 'None',
  'settings.ai.AgentEditorModal.follow_the_setting.ead899ca': 'Follow the setting',
  'settings.ai.AgentEditorModal.by_section.2c8a0eb5': 'By section',
  'settings.ai.AgentEditorModal.all_at_once.f9068371': 'All at once',
  'settings.ai.GeneralSettings.same_as_the_chat.3e206eff': 'Same as the chat',
  'settings.ai.GeneralSettings.off.ca7981b4': 'Off',
  'settings.ai.GeneralSettings.once.d88f6d83': 'Once',
  'settings.ai.GeneralSettings.twice.cc1b4c8d': 'Twice',
  'settings.ai.GeneralSettings.three_times.13b6376c': 'Three times',
  'settings.ai.GeneralSettings.five_times.ee32f27e': 'Five times',
  'settings.ai.GeneralSettings.not_configured.dd1841d2': 'Not configured',
  'settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311': 'Keep it, and add these',
  'settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8': 'Replace it with these',
  'settings.components.ToolModesEditor.mixed.f340b6d6': 'Mixed',
  'settings.metadata.6fd575b1876b0d59':
    'The properties block is on the first line, is closed, is valid YAML and names no property twice. A block that slipped down the note is moved back to the top; a property repeated with the same value is taken out.',
  'settings.metadata.36317c6ed2cd7dbe':
    'The listed properties are there and filled in. An entry may carry a default after a colon — "created: {{ctime}}" fills in the day the file was made, {{today}} is today — and only those are fixed.',
  'settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e':
    "This book's pages are laid out by the book, like a comic's: there is nothing to set for them. Zoom with Mod and plus or minus, a pinch, or the tab's menu.",
  'settings.components.reader.ReaderSettingsForm.layout.a5119091': 'Layout',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f':
    'Turn pages one at a time, or scroll through each chapter. E-ink mode keeps pages on this device.',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f':
    'Turn pages one at a time, or scroll through each chapter.',
  'settings.components.reader.ReaderSettingsForm.font.64d0b3ad': 'Font',
  'settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22': 'Fonts folder',
  'settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c':
    'A folder in the vault with font files: .ttf, .otf, .woff or .woff2. Each family in it is offered as a font above, and travels to your other devices with the vault. Obsidian Sync carries them with Sync all other types on. Empty: no fonts from the vault.',
  'settings.components.reader.ReaderSettingsForm.text_size.d68761cc': 'Text size',
  'settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1': 'Line spacing',
  'settings.components.reader.ReaderSettingsForm.margins.eea8d245': 'Margins',
  'settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b':
    'The space around the text and between columns.',
  'settings.components.reader.ReaderSettingsForm.column_width.86f4e582': 'Column width',
  'settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab':
    'The widest a column of text may grow.',
  'settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135': 'Two columns',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2':
    'Two pages side by side when the tab is wide enough.',
  'settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1': 'Theme colours',
  'settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee':
    "Draw the book in your theme's text and background colours, dark mode included. Off: the book's own colours, on a light page.",
  'settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d': "Book's own styles",
  'settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8':
    "The book's own layout: tables, indents, alignment, drop caps. Your text size, spacing, font and colours still win. Nothing outside the book is ever loaded.",
  'settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32':
    'Open PDF files in the Abele reader',
  'settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b':
    "PDFs open here instead of in Obsidian's own viewer, with pages to turn, the contents beside them and the place kept. Off: they open in Obsidian's viewer, and Open in Abele reader in a PDF's menu still opens one here.",
  'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f':
    'One continuous scroll, page under page, or pages turned one at a time.',
  'settings.components.reader.ReaderSettingsForm.page_size.bd69e66e': 'Page size',
  'settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb':
    "Automatic is the page's width when scrolling and the whole page with pages. Or fit the whole page, fit its width, or a fixed zoom.",
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc':
    'Two pages side by side',
  'settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6':
    'When the tab is wide enough, as a printed book lies open.',
  'settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd':
    'Dark pages in a dark theme',
  'settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3':
    "The page's light and dark swapped while Obsidian's theme is dark, so a white page does not glare. Pictures come out as negatives.",
  'settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f': 'Pen thickness',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925':
    'How thick the pen and the marker draw on a PDF. The button beside the colours under the page changes it too.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856':
    'Pen thickness on drawings',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a':
    'How thick the pen and the marker draw on a drawing or a picture drawn on. The button beside the colours on its bar changes it too.',
  'settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc':
    'E-ink, on this device',
  'settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337':
    'For a reader with an e-ink screen, such as a Boox. Kept on this device only: your phone and computer read as before.',
  'settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801': 'E-ink mode',
  'settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d':
    "Pages turned, never scrolled or slid, a PDF's too. Black text on white, nothing grey, thicker lines, nothing that moves or fades. Highlights drawn as lines whose shape tells the colour. A tap in the left or right third turns the page. The page buttons and keys turn it too.",
  'settings.components.reader.ReaderSettingsForm.full_refresh.9322071a': 'Full refresh',
  'settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f':
    'The page flashes black and then white every so many pages, which clears the faint ghost of earlier pages an e-ink screen leaves.',
  'settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e':
    'Show the keys the reader hears',
  'settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a':
    "Over the page, the name and code of the last key or button pressed, and whether it turned the page; the console logs each. For finding out what a reader's page buttons send when they do not turn the pages.",
  'settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986': 'Reading aloud',
  'settings.components.reader.ReaderSettingsForm.voice.87bf2bc0': 'Voice',
  'settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e':
    'The voices this device has; on an iPhone, the ones in Settings → Accessibility → Spoken Content. A voice chosen on another device that this one lacks reads as the default.',
  'settings.components.reader.ReaderSettingsForm.speed.c372fee9': 'Speed',
  'settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8':
    'Where books were left',
  'settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7':
    'Reading places file',
  'settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5':
    "A .json file in the vault that keeps where each book was left, so every device opens it there. Obsidian's file list does not show it. Obsidian Sync carries it with Sync all other types on, as it does chats. Changing the path moves the places to the new file. Empty: {value0}.",
  'settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4':
    'Every {value0} pages',
  'settings.components.reader.ReaderSettingsForm.never.6300ef80': 'Never',
  'settings.components.reader.ReaderSettingsForm.pages.9046da16': 'Pages',
  'settings.components.reader.ReaderSettingsForm.scrolling.9b976293': 'Scrolling',
  'settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0': "Theme's text font",
  'settings.components.reader.ReaderSettingsForm.serif.1b5e747e': 'Serif',
  'settings.components.reader.ReaderSettingsForm.sans_serif.07e77255': 'Sans-serif',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055': "The book's own",
  'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c':
    '{value0} (not in the fonts folder)',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807':
    "The font of the text. The theme's is the one your notes use; below the book's own are the fonts from your fonts folder.",
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358':
    "The font of the text. The theme's is the one your notes use. Put font files in the fonts folder to read in your own.",
  'settings.components.reader.ReaderSettingsForm.narrow.ba227109': 'Narrow',
  'settings.components.reader.ReaderSettingsForm.normal.a7248eeb': 'Normal',
  'settings.components.reader.ReaderSettingsForm.wide.147170e7': 'Wide',
  'settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6': 'Continuous scroll',
  'settings.components.reader.ReaderSettingsForm.automatic.d461a493': 'Automatic',
  'settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c': 'Whole page',
  'settings.components.reader.ReaderSettingsForm.page_width.217fbef1': 'Page width',
  'settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4':
    "The device's voice for the book's language",
  'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24':
    'A voice from another device',
  'settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037':
    'Highlights of this book',
  'settings.components.reader.BookNotesSettings.highlights.6e517828': 'Highlights',
  'settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7': 'Where they go',
  'settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64':
    'For this book alone. “As in settings” follows Settings → Books.',
  'settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e':
    "A note of each book's own, beside it, or one note for every book. A book can choose for itself from its Aa button.",
  'settings.components.reader.BookNotesSettings.note.d8da2c49': 'Note',
  'settings.components.reader.BookNotesSettings.note_for_all_books.105d496e': 'Note for all books',
  'settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6':
    "The note this book's highlights go to. Empty: {value0}.",
  'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d':
    "Made with the first highlight; each book's are told apart by their links. Empty: {value0}.",
  'settings.components.reader.BookNotesSettings.template.0575f29d': 'Template',
  'settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd':
    "A note to make this book's highlights note from. Empty: as in settings.",
  'settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc':
    'A note a new highlights note is made from. Between {literal0} and {literal1} is what each highlight adds, {literal2} being the highlight; or {literal3} and {literal4} to put the quote and your comment apart; also {literal5}, {literal6}, {literal7}, {literal8}, {literal9}. Empty: none.',
  'settings.components.reader.BookNotesSettings.none.dc937b59': 'None',
  'settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2':
    "A note of the book's own",
  'settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78':
    'One note for every book',
  'settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c':
    'As in settings ({value0})',
  'settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f': 'A note you name',
  'settings.reader.stroke.fine': 'Fine',
  'settings.reader.stroke.medium': 'Medium',
  'settings.reader.stroke.bold': 'Bold',
  'settings.GithubAccessReport.an_access_token.14f95c33': 'an access token',
  'settings.GithubConnectionEditor.add_git_connection.9e359dd8': 'Add Git connection',
  'settings.GithubConnectionEditor.edit_git_connection.1e73be5f': 'Edit Git connection',
  'settings.GithubConnectionEditor.service.d677190e': 'Service',
  'settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8':
    'Choose the service before entering its server address and token.',
  'settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1':
    'Full Forgejo address, including any port or deployment path.',
  'settings.GithubConnectionEditor.access_token.9a911b08': 'Access token',
  'settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b':
    'sample-org\nsample-org/project',
  'settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1':
    'owner/repo or a Forgejo link',
  'settings.GithubConnectionEditor.access_details.abe1adac': 'Access details',
  'settings.GithubConnectionEditor.forgejo.f4e62146': 'Forgejo',
  'settings.GithubConnectionEditor.signed_in_as_value.682769b2': 'Signed in as {value0}',
  'settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a':
    'The host did not accept this token (401).',
  'settings.GithubConnectionEditor.the_account_could_not_be.71de8f27':
    'The account could not be checked. {value0}',
  'settings.GithubConnectionEditor.public_access_without_a_token.35b758c0':
    'Public access without a token',
  'settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc':
    'Choose a repository to check read access.',
  'settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8':
    'The connection token changed. Check access again.',
  'settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376':
    'The stored token belongs to the previous server. Enter a new token for this address.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3':
    'Give owner/repo or a repository link on this connection’s server.',
  'settings.GithubConnectionEditor.asking_forgejo.f46aa9ff': 'Asking Forgejo…',
  'settings.GithubSettings.git_hosting.a3002011': 'Git hosting',
  'settings.GithubSettings.default.2ae2ecc2': 'Default · ',
  'settings.GithubSettings.edit_connection.047f9f95': 'Edit connection',
  'settings.GithubSettings.connection_actions.9e1bbb65': 'Connection actions',
  'settings.GithubSettings.public_access_without_a_token.35b758c0': 'Public access without a token',
  'settings.GithubSettings.forgejo.f4e62146': 'Forgejo',
  'settings.GithubSettings.token_unavailable_on_this_device.0bd03b33':
    'Token unavailable on this device',
  'settings.GithubSettings.the_token_has_expired.0b52627f': 'The token has expired',
  'settings.GithubSettings.the_server_did_not_accept.1d7560a4':
    'The server did not accept the token at the last access check',
  'settings.GithubSettings.the_last_access_check_failed.72f4e393': 'The last access check failed',
  'settings.GithubSettings.some_repository_access_checks_failed.1b573ceb':
    'Some repository access checks failed',
  'settings.GithubSettings.access_checked.d2518d23': 'Access checked',
  'settings.GithubSettings.not_checked_yet.881d23f6': 'Not checked yet',
  'settings.GithubSettings.check_access.abb9a172': 'Check access',
  'settings.GithubSettings.make_default_for_value.ded3e105': 'Make default for {value0}',
  'settings.git.serverAddressError': 'Only the address: no login, query or # part',
  'settings.git.noteLabel': 'note',
  'settings.transfer.oneKeyToStore': 'One key to store for the selected items.',
  'settings.git.nativeAddress': 'Full {service} address, including any port or deployment path.',
  'settings.git.useCodeberg': 'Use Codeberg',
  'settings.git.useCodebergTooltip': 'Use Codeberg as the Forgejo server',
  'settings.git.nativeRepoLink': 'owner/repo or a {service} link',
  'settings.git.gitea': 'Gitea',
  'settings.git.githubId': 'github',
  'settings.git.askingNative': 'Asking {service}…',
  'settings.git.accessCheckCancelled': 'This access check was cancelled.',
  'settings.git.repositoryConnections': 'Git connections',
  'settings.metadata.ca4a628311f7879a': 'Git repositories',
  'settings.metadata.b9227122bad532e6': 'Repository tabs',
  'debuggerAccess.title': 'Agent debugger access',
  'debuggerAccess.request': 'Let the agent use the debugger in {folder}',
  'debuggerAccess.chatFolder': 'this chat’s folder',
  'debuggerAccess.scope': 'This run and program only. Expressions still require separate approval.',
  'debuggerAccess.allowed': 'Debugger access allowed. The agent can retry its call.',
  'debuggerAccess.denied': 'Debugger access denied.',
  'debuggerAccess.expiredRequest': 'This request expired. Ask the agent to try again.',
  'debuggerAccess.allow': 'Allow',
  'debuggerAccess.deny': 'Deny',
  'debuggerAccess.issued': 'Grants issued by you on this device. Access ends when its run ends.',
  'debuggerAccess.issuerOnly':
    'Other owners’ grants are hidden. Only the owner who issued a grant can revoke or delete it.',
  'debuggerAccess.refresh': 'Refresh',
  'debuggerAccess.updateNode': 'Update this node to manage agent debugger access.',
  'debuggerAccess.empty': 'No debugger grants issued by you.',
  'debuggerAccess.revoke': 'Revoke debugger access',
  'debuggerAccess.deleteTip':
    'Delete this grant. Only grants you issued can be deleted. Operation history is retained.',
  'debuggerAccess.grantsUnavailable': 'Debugger grants unavailable',
  'debuggerAccess.changeFailed': 'Debugger grant could not be changed',
  'debuggerAccess.state.revoked': 'Revoked',
  'debuggerAccess.state.expired': 'Expired',
  'debuggerAccess.state.active': 'Active',
  'debuggerAccess.grantDescription':
    '{state} · {actions} · {mode} · {conversation} · Expires {expires}',
  'debuggerAccess.refreshRequests': 'Refresh debugger requests',
  'debuggerAccess.unavailable': 'Debugger access unavailable',
  'debuggerAccess.stale':
    'This debugger request is no longer pending. Pending requests have been refreshed.',
  'debuggerAccess.action.read': 'read',
  'debuggerAccess.action.step': 'step',
  'debuggerAccess.action.continue': 'continue',
  'debuggerAccess.action.pause': 'pause',
  'debuggerAccess.action.breakpoints': 'breakpoints',
  'debuggerAccess.action.launch': 'launch',
  'debuggerAccess.action.attach': 'attach',
  'debuggerAccess.action.detach': 'detach',
  'debuggerAccess.action.terminate': 'terminate',
  'debuggerAccess.action.expressions': 'expressions',
  'debuggerAccess.action.evaluate': 'evaluate / set variable',
  'debuggerAccess.mode.ask': 'ask',
  'debuggerAccess.mode.allowAll': 'allow all',
  'settings.git.reloadService': 'Reload from the Git service',
  'settings.git.openBrowser': 'Open this in the browser',
  'settings.metadata.gitHosting': 'Git hosting',
  'maps.viewName': 'Abele map',
  'maps.coordinates': 'Coordinates property',
  'maps.markerIcon': 'Marker icon',
  'maps.markerColor': 'Marker color',
  'maps.center': 'Center coordinates',
  'maps.defaultZoom': 'Default zoom',
  'maps.minZoom': 'Minimum zoom',
  'maps.maxZoom': 'Maximum zoom',
  'maps.mapHeight': 'Embedded height',
  'maps.groupNearby': 'Group nearby places',
  'maps.mapTiles': 'Map tiles',
  'maps.mapTilesDark': 'Map tiles in dark mode',
  'maps.copied': 'Coordinates copied',
  'maps.copyFailed': 'Could not copy coordinates',
  'maps.delete': 'Delete note',
  'maps.createFailed': 'Could not create the note',
  'maps.saveFailed': 'Could not save backgrounds',
  'maps.locationDenied': 'Location permission denied',
  'maps.locationTimeout': 'Location request timed out',
  'maps.locationUnavailable': 'Location information unavailable',
  'maps.locating': 'Finding where you are…',
  'commands.copy-current-map-location': 'Copy current location coordinates',
  'maps.zoomIn': 'Zoom in',
  'maps.zoomOut': 'Zoom out',
  'maps.north': 'Point north',
  'maps.locationOff': 'Location is off for Obsidian',
  'maps.following': 'Following you. Press to stop',
  'maps.showLocation': 'Show my location',
  'maps.exitFull': 'Exit full screen',
  'maps.full': 'Full screen',
  'maps.fitPlaces': 'Fit all places',
  'maps.defaultBackground': 'Default',
  'maps.background': 'Background',
  'maps.tab': 'Open in new tab',
  'maps.split': 'Open to the right',
  'maps.window': 'Open in new window',
  'maps.card': 'Place card',
  'maps.copy': 'Copy coordinates',
  'maps.newHere': 'New note here',
  'maps.setCenter': "Make this the view's centre",
  'maps.manage': 'Manage backgrounds…',
  'maps.noCoordinates': 'No coordinates',
  'maps.unreadable': 'Coordinates cannot be read',
  'maps.formulaError': 'The formula failed',
  'maps.noProperty': 'Where are the coordinates?',
  'maps.pickProperty': "Pick the property or formula that holds each place's coordinates.",
  'maps.configure': 'Configure view',
  'maps.noRecords': 'No notes in this base yet',
  'maps.hold': 'Press and hold the map to add a place there.',
  'maps.rightClick': 'Right-click the map to add a place there.',
  'maps.filtered': 'No place matches the filters',
  'maps.filtersEmpty': 'The filters leave nothing to show.',
  'maps.filters': 'Filters',
  'maps.nothing': 'Nothing found',
  'maps.addCoordinates':
    'Add coordinates to a note, or pick another property in the view settings.',
  'maps.showNotes': 'Show the notes',
  'maps.loadFailed': 'The map could not load',
  'maps.offline': 'No connection to the map server. The places are still here.',
  'maps.retry': 'Try again',
  'maps.noWebgl': 'This device cannot draw maps',
  'maps.graphics': 'Graphics acceleration is off or unavailable here.',
  'maps.stopped': 'The map stopped drawing',
  'maps.lostContext': 'The graphics card let go of it, often after sleep.',
  'maps.drawAgain': 'Draw again',
  'maps.backgrounds': 'Backgrounds',
  'maps.up': 'Move up',
  'maps.down': 'Move down',
  'maps.edit': 'Edit',
  'maps.remove': 'Delete',
  'maps.add': 'Add',
  'maps.addBackground': 'Add a background',
  'maps.newBackground': 'New background',
  'maps.editBackground': 'Edit background',
  'maps.name': 'Name',
  'maps.light': 'Light',
  'maps.dark': 'Dark',
  'maps.cancel': 'Cancel',
  'maps.save': 'Save',
  'maps.giveName': 'Give it a name',
  'maps.needAddress': 'At least one address is needed',
  'maps.createNote': 'Create note',
  'maps.formulaWhy':
    'A formula cannot be written to. Choose a note property for coordinates before creating the note.',
  'maps.skipped': 'Notes not on the map: {count}',
  'maps.noneCoordinates': 'Notes without coordinates: {count}',
  'maps.copyValue': 'Copy {value}',
  'maps.saveZoom': 'Open this view at zoom {value}',
  'maps.placesHere': 'Places here: {count}',
  'maps.searchEmpty': 'No place matches “{query}”.',
  'maps.backgroundHint': 'Named backgrounds for Bases maps.',
  'maps.noBackgrounds': 'No backgrounds of your own',
  'maps.addressHint': 'A style address, or one or more tile templates drawn as layers.',
  'maps.darkHint': 'Optional. Without it the light one is used in a dark theme too.',
  'maps.fromMaps': 'Backgrounds of Obsidian Maps',
  'maps.copyBackgrounds': 'Copy backgrounds',
  'maps.importHint': 'Copy without changing Obsidian Maps settings.',
  'maps.tileLayers': 'Tile layers: {count}',
  'maps.style': 'Style',
  'maps.lightOnly': 'Light only; used in both themes',
  'maps.bothThemes': 'Light and dark',
  'maps.deleteFailed': 'Could not delete the note',
  'maps.fullUnavailable': 'Full screen is unavailable on this device',
  'maps.showList': 'Show as a list',
  'maps.listBeside': 'List beside the map',
  'maps.placeGone': 'This note is no longer available',
  'maps.attribution': 'Show map attribution',
  'maps.feedback': 'Map feedback',
  'maps.touchHelp': 'Use two fingers to move the map',
  'maps.scrollHelp': 'Use {key} + scroll to zoom the map',
  'maps.currentLocation': 'Current location',
  'maps.backList': 'Back to the list',
  'maps.cardGone': 'This note is gone',
  'maps.cardGoneText': 'It was deleted or moved since the map was drawn.',
  'maps.cardError': 'The note could not be read',
  'maps.cardErrorText': 'The map still has the place. Open the note to see what is wrong.',
  'maps.imageMissing': '{path} could not be loaded',
  'maps.openPicture': 'Open picture: {caption}',
  'maps.open': 'Open',
  'maps.openNote': 'Open the note',
  'maps.showMap': 'Show on the map',
  'maps.more': 'More',
  'maps.straightLine': '{distance} in a straight line',
  'maps.mapFace': 'Show the map',
  'maps.hideList': 'Hide the list',
  'maps.sortLabel': 'Sort: {order}',
  'maps.resort': 'The map has moved. Sort again from its new centre',
  'maps.placeCount': 'Places: {count}',
  'maps.listSearchEmpty': 'No place matches the search',
  'maps.listEmpty': 'No places with coordinates',
  'maps.sortBase': 'The base’s order',
  'maps.sortMe': 'Nearest to me',
  'maps.sortCentre': 'Nearest to the map centre',
  'maps.metres': '{value} m',
  'maps.kilometres': '{value} km',
  'maps.distanceCentre': 'Straight-line distance from the map centre',
  'maps.distanceMe': 'Straight-line distance from your location',
  'debug.open': 'Debug',
  'debug.run': 'Run a program',
  'debug.attach': 'Attach to a running program',
  'debug.checking': 'Checking debugger support…',
  'debug.offline': 'Reconnect to the node',
  'debug.off': 'The debugger is off on this node',
  'debug.update': 'Update the node for folder-owned debugging',
  'debug.install': 'The JavaScript debugger is not installed on the node',
  'debug.noFolder': 'Choose a node folder first',
  'debug.pathKind': 'A path in this folder',
  'debug.programPlaceholder': 'A JavaScript file to run under the debugger: src/main.js',
  'debug.programEmpty': 'Type the path of a JavaScript file in this folder',
  'debug.thisFolder': 'This folder',
  'debug.insideFolder': 'Runs from this folder',
  'debug.outsideFolder': 'Runs outside this folder: attaching asks first',
  'debug.executionTitle': 'Allow code execution in this folder?',
  'debug.executionMessage':
    'Allow code to run in {path}? This trusts the registered project and enables execution for this folder or worktree. Debugger programs and agents can execute here.',
  'debug.empty': 'Open Debug from a node folder or chat menu.',
  'debug.outsideTitle': 'Attach to a program outside this folder?',
  'debug.outsideMessage':
    '{command} runs from {path}, not from the selected folder. The debugger can pause it and read its values. Detaching later leaves it running.',
  'debug.sourceUpdate': 'Update the node to set breakpoints in this file',
  'debug.sourceMap':
    'The node could not find a source map linking this file to the running program. Build with source maps, then restart the program and attach again.',
  'debug.sourceChanged':
    'This file changed since the program started. Restore that content, or rebuild and restart the program.',
  'debug.sourceOutside': 'This file is outside the debug folder',
  'debug.sourceUnavailable': 'This file could not be admitted to the debugger',
  'debug.entryPlaceholder':
    'Search entry files or package scripts; or type a built JavaScript path',
  'debug.entryEmpty': 'No matching entry. You can type a built JavaScript path.',
  'debug.sourceConflict': 'This file conflicts with an admitted source',
  'debug.sourceLimit': 'The session source limit has been reached',
  'debug.sourceUnreadable': 'This file is unavailable or unreadable',
  'debug.launchTitle': 'Run a program',
  'debug.launchProgram': 'Program',
  'debug.launchProgramHint':
    'Path relative to this folder. For a TypeScript build, enter the built JavaScript entry (for example, dist/main.js).',
  'debug.launchArgs': 'Arguments',
  'debug.launchArgsHint':
    'Separate arguments with spaces; quote values containing spaces. No shell expressions are evaluated.',
  'debug.launchArgsInvalid': 'Close each quote and finish each escape in the arguments.',
  'debug.launchFailed': 'The program could not start: {detail}',
  'debug.launchExitedEarly': 'The program exited before the debugger could attach.',
  'debug.launchFailedPlain': 'The program could not start. Open Details for more information.',
  'debug.sourceDeclaration':
    'This declaration file contains no executable code. Open the implementation to set a breakpoint.',
  'debug.sourceTest':
    'This test file is not loaded by the running program. Start the test runner with debugging to stop here.',
  'debug.sourceGenerated':
    'This built file is not available here. Open its original source file to debug it.',
  'debug.breakpointDisabled': 'Breakpoint disabled',
  'debug.removeBreakpoints': 'Remove all breakpoints',
  'debug.breakpointOptions': 'Breakpoint options',
  'debug.caughtExceptions': 'Caught exceptions',
  'debug.uncaughtExceptions': 'Uncaught exceptions',
  'debug.editCondition': 'Edit condition',
  'debug.editLogMessage': 'Log message',
  'debug.editHitCount': 'Hit count',
  'debug.hitCountUnavailable': 'Hit count is not supported by this node',
  'debug.disableBreakpoint': 'Disable breakpoint',
  'debug.enableBreakpoint': 'Enable breakpoint',
  'debug.approvalPending': 'Waiting for approval in Debug',
  'debug.recordPointRefused': 'Record point save could not be confirmed: {reason}',
  'debug.breakpointUnbound':
    'The program has not loaded code for this line yet. Check its source map or wait for this code to load.',
  'debug.watchLastValue': 'Last value: {value}',
  'debug.logPoint': 'Log point: {message}',
  'node.delegation.ownerStopped': 'Stopped by you. Restart it from its chat.',
  'node.delegation.paused': 'Paused; can continue',
  'node.delegation.ownerAnswer':
    'Waiting for your approval. Answer the pending action on this card or open the child chat. The manager cannot answer for you.',
  'node.delegation.pausedPrompt':
    'Time limit reached while waiting for your answer. Answer the kept prompt, then continue the developer.',
  'node.delegation.pausedLimit':
    'Time limit reached. Send a message to continue in the same chat and worktree.',
  'node.manager.session': 'Session',
  'node.manager.sourceWorktree': 'Source worktree',
  'node.manager.command': 'Command',
  'node.manager.invalidCommand':
    'Supply exactly one of argv or command, and one project_id or worktree_id. Check timeout_ms and output_bytes ranges.',
  'node.manager.invalidIntegration':
    'Integration needs target and source worktree IDs, both branch names and fresh full expected head hashes.',
  'node.manager.invalidCancel': 'Supply session_id and run_id for the command to cancel.',
  'node.manager.branches': 'Branches',
  'node.manager.folder': 'Folder',
  'node.manager.sourceHead': 'Source head',
  'node.manager.targetHead': 'Target head',
  'node.manager.evidence': 'Exact approval details',
  'node.manager.exitCode': 'Exit code: {code}',
  'node.manager.output': 'Output',
  'node.manager.truncated': 'Earlier output was truncated.',
  'settings.metadata.nodeManagerRun': 'Run command',
  'settings.metadata.nodeManagerStatus': 'Check command',
  'settings.metadata.nodeManagerCancel': 'Cancel command',
  'settings.metadata.nodeManagerIntegrate': 'Integrate branch',
  'node.manager.pending': 'Waiting for approval',
  'node.manager.exited': 'Finished',
  'node.manager.timedOut': 'Time limit reached',
  'node.manager.denied': 'Denied',
  'node.error.backpressure': "The connection fell behind the node's output. Reconnect to catch up.",
  'node.manager.folderMissing': "This folder can't be used for commands on the node.",
  'node.manager.bypassDisabled':
    'The node requires approval because its Without asking mode is disabled.',
  'node.manager.integrateBypassUpdate':
    'This node cannot run integration without asking. A node update with owner-mode integration is required; nothing was submitted.',
  'node.manager.resultExit': '{state} · exit {code}',
  'node.manager.integrationLegacyApproval':
    'This node version still asks before integrating. Update the node to integrate without asking.',
  'node.manager.integrationContextUpdate':
    'Update the node to 0.4.49 or later to integrate from this chat without a manager session.',
  'settings.metadata.checkDiagram': 'Check diagram',
} as const
