import type { TranslationCatalog } from '../../catalogs'
export const lv = {
  'settings.metadata.tracePointRemove': 'Dzēst ieraksta punktu',
  'requests.file.formUnsupported': 'Šo formas lauku nevar attēlot Bruno failā',
  'requests.file.secretPending':
    'Vides saglabāšanā radās konflikts vai rezultāts vēl nav zināms; pirms atkārtošanas atsvaidziniet',
  'requests.file.secretChecked':
    'Iepriekšējā noslēpuma pārvietošana ir pārbaudīta; pirms atkārtošanas pārskatiet atjaunināto vidi',
  'requests.file.sensitiveUnavailable': 'Sensitīvu failu ierakstīšana nav pieejama',
  'requests.file.pendingEdit': 'Vispirms pārskatiet gaidošo faila labojumu',
  'requests.file.methodProblem': 'Jānorāda HTTP metode un adrese',
  'requests.file.headerProblem': 'Jānorāda galvenes nosaukums un kols',

  'requests.file.sending': 'sūta…',
  'requests.file.notSent': 'nav nosūtīts',
  'requests.file.openAnswer': 'Atvērt {name} ar atbildi',

  'requests.file.problem': 'Daļu faila neizdevās nolasīt',
  'requests.file.sendAll': 'Sūtīt visus pēc kārtas',
  'requests.file.open': 'Atvērt failu',
  'requests.file.line': '{line}. rinda: {text}',
  'requests.file.openLine': 'Atvērt failu {line}. rindā',
  'requests.file.at': '{file} · {line}. rinda',
  'requests.file.gone': '{file} vairs nav',
  'requests.capture.title': 'No atbildēm',
  'requests.env.exposed': 'noslēpums ierakstīts failā {file}',
  'requests.env.toKeys': 'Pārvietot uz atslēgām',
  'requests.capture.notSent': '{name} vēl nav nosūtīts',
  'requests.capture.sendFirst': 'Sūtīt {name}',
  'requests.capture.blocked': 'Vispirms sūtiet {name}: šis pieprasījums izmanto tā atbildi',
  'requests.file.saveCopy': 'Saglabāt kopiju pieprasījumos',
  'requests.file.openPanel': 'Atvērt pieprasījumos',
  'requests.file.scriptShown': 'Skripts ir parādīts kā pirmkods un netiek izpildīts.',

  'settings.ai.apiMode': 'API',
  'settings.ai.apiModeDescription':
    'Šī pakalpojumu sniedzēja API. Esošie savienojumi izmanto Chat Completions.',
  'settings.ai.chatCompletions': 'Chat Completions',
  'settings.ai.responses': 'Responses',

  'node.analysis.contentUnavailable': 'Faila saturs nav pieejams analīzei.',

  'node.analysis.nodeUnsupported': 'Šajā mezglā koda analīze nav pieejama.',
  'node.analysis.fileTooLarge': 'Fails ir pārāk liels analīzei (ierobežojums: 512 KiB).',
  'node.analysis.noServers': 'Neviens valodas serveris nepieņēma šo failu.',
  'node.analysis.noConnection': 'Nav pieejams savienojums ar šo mezglu.',
  'node.analysis.pastRevision': 'Šajā skatā ir atvērta iepriekšēja versija.',
  'node.analysis.comparison': 'Lai analizētu kodu, atveriet faila skatu.',
  'node.analysis.unsupportedFile': 'Koda analīze neatbalsta šo faila tipu.',
  'node.analysis.documentLimit':
    'Mezglā sasniegts analīzes dokumentu ierobežojums. Aizveriet citus koda failus un mēģiniet vēlreiz.',

  'node.loading.changes': 'Ielādē izmaiņas…',
  'node.loading.history': 'Ielādē vēsturi…',
  'node.loading.files': 'Ielādē failus…',
  'node.loading.updatingChanges': 'Atjaunina izmaiņas…',
  'node.loading.updatingFiles': 'Atjaunina failus…',
  'node.loading.slow': 'Vēl lasa failus… līdz šim {loaded}',

  'node.error.readingFile': 'Lasa {path}',
  'node.log.truncated': 'Tiek rādīta tikai žurnāla pēdējā daļa.',
  'node.log.missing': 'Šajā mezglā nav pieejamu žurnāla failu.',
  'node.log.unavailable': 'Mezgls nevarēja nolasīt žurnāla failus.',
  'node.log.unknownTime': 'Nezināms laiks',
  'node.state.offline': 'Mezgls ir bezsaistē.',
  'node.state.reconnecting': 'Mezgls ir bezsaistē. Atjauno savienojumu…',
  'node.state.slow': 'Mezgls atbild lēni. Gaida…',
  'node.action.retry': 'Mēģināt vēlreiz',
  'node.action.refresh': 'Atsvaidzināt',
  'node.action.reconnect': 'Savienot atkārtoti',
  'node.action.trust': 'Uzticēties šai mapei…',
  'node.action.pair': 'Pievienot vēlreiz',
  'node.action.settings': 'Mezgla iestatījumi',
  'node.action.update': 'Kā atjaunināt',
  'node.action.install': 'Kā instalēt',
  'node.error.copyDetails': 'Kopēt informāciju',
  'node.error.code': 'Kods',
  'node.error.what': 'Darbība',
  'node.error.where': 'Vieta',
  'node.error.when': 'Laiks',
  'node.error.original': 'Sākotnējā darbība',
  'node.log.title': 'Mezgla žurnāls',
  'node.log.all': 'Visas rindas',
  'node.log.warnings': 'Brīdinājumi un kļūdas',
  'node.log.filter': 'Kuras rindas',
  'node.log.copy': 'Kopēt redzamo',
  'node.log.offline': 'Žurnālu var lasīt, kad mezgls ir tiešsaistē. Zemāk ir iepriekš ielādētais.',
  'node.log.empty': 'Žurnālā nav ierakstu.',
  'node.log.loading': 'Ielādē mezgla žurnālu…',
  'node.error.ownerOnly': 'Tikai mezgla īpašnieks var uzticēties šai mapei.',
  'node.error.gitTimeout':
    'Git mezglā neatbildēja laikus. Dators, kurā darbojas mezgls, var būt aizņemts.',
  'node.error.operationTimeout':
    'Darbība mezglā netika pabeigta laikus. Dators, kurā darbojas mezgls, var būt aizņemts.',
  'node.error.connectionTimeout':
    'Savienojums ar mezglu netika izveidots laikus. Dators, kurā darbojas mezgls, var būt aizņemts.',
  'node.error.controlTimeout':
    'Lokālā mezgla vadība neatbildēja laikus. Dators, kurā darbojas mezgls, var būt aizņemts.',
  'node.error.tooOld': 'Šī mezgla versija neatbalsta šo darbību. Atjauniniet mezglu.',
  'node.error.providerMissing':
    'Nepieciešamais pakalpojuma sniedzējs mezglā nav pieejams. Pārbaudiet, vai tas ir instalēts un konfigurēts.',
  'node.file.waitingForNode': 'Fails tiks atvērts, kad mezgls atkal būs pieejams.',
  'node.file.retry': 'Mēģināt vēlreiz',
  'node.error.details': 'Sīkāka informācija',
  'node.analysis.restart': 'Restartēt analīzi',
  'node.analysis.stopped': 'apturēts: {reason}',

  'node.analysis.title': 'Koda analīze',
  'node.analysis.untrusted': 'mape nav uzticama',
  'node.analysis.notSetUp': 'šajā projektā nav iestatīts',
  'node.analysis.failed': 'kļūda',
  'node.analysis.starting': 'tiek palaists',
  'node.analysis.running': 'darbojas',
  'node.analysis.loading': 'Koda analīze tiek palaista…',
  'node.analysis.off': 'Šim failam koda analīze ir izslēgta',
  'node.analysis.error': 'Koda analīze neizdevās',
  'node.analysis.trustNeeded': 'Koda analīze: mape nav uzticama',
  'node.analysis.typescriptOnly': 'Koda analīze: tikai TypeScript. ESLint nav iestatīts.',
  'node.analysis.summary': 'Koda analīze: {names}',
  'node.analysis.trust': 'Uzticēties šai mapei…',
  'node.analysis.eslintHelp': 'Kā iestatīt ESLint',

  'node.manager.failed': 'Komanda neizdevās',
  'node.manager.applied': 'Izmaiņas piemērotas',
  'node.manager.cancelled': 'Atcelts',
  'node.manager.running': 'Darbojas',
  'node.commit.refresh': 'Atjaunot',
  'node.manager.contextUpdate':
    'Atjauniniet mezglu uz 0.4.47 vai jaunāku versiju, lai palaistu komandas no šīs sarunas.',
  'node.manager.notSubmitted': 'Komanda netika iesniegta izpildei: {reason}',
  'node.manager.permissionChanged': 'Komandu atļaujas ir mainījušās. Pieprasiet komandu vēlreiz.',

  'requests.refresh': 'Atjaunot pieprasījumus',
  'debug.launchUnknown':
    'Palaišanas rezultāts nav zināms. Atjauno savienojumu un pirms atkārtotas palaišanas pārbaudi atkļūdošanas sesijas.',
  'debug.launchMissing': 'Programma nav atrasta. Pārbaudi ceļu attiecībā pret mapi.',
  'debug.followNoMatches': 'Ierakstītajos soļos šī vērtība nav atrasta.',
  'node.chat.deleteHint':
    'Dzēst šo sesiju un tās vēsturi no mezgla? Faili tās mapē paliks nemainīti.',
  'node.search.invalidRegex': 'Pārbaudiet regulāro izteiksmi un mēģiniet vēlreiz.',
  'node.lsp.locations': 'Vietas kodā: {count}',
  'node.lsp.noLocations': 'Nav atbilstošu vietu',
  'node.lsp.count': 'Diagnostika: {count}',
  'node.lsp.loading': 'Analizē kodu…',
  'node.lsp.error': 'Koda analīze nav pieejama: {message}',
  'node.lsp.retry': 'Mēģināt vēlreiz',
  'node.lsp.untrusted': 'Valodu serveriem ir vajadzīga atļauja izpildīt projekta kodu šajā mapē.',
  'node.lsp.trust': 'Uzticēties mapei',
  'node.lsp.missing': 'Valodas serveris nav instalēts. Instalējiet mezglā:',
  'node.lsp.copy': 'Kopēt komandu',
  'node.lsp.install': 'Instalēt populāros serverus',
  'node.lsp.eslintMissing':
    'Šajā projektā ESLint nav instalēts vai konfigurēts. TypeScript analīze joprojām ir pieejama.',
  'node.lsp.noDiagnostics': 'Nav diagnostikas ziņojumu',
  'node.lsp.references': 'Meklēt {name} lietojumus',

  'debug.stopAtStart': 'Apturēt sākumā',
  'debug.pausedAtStart': 'Apturēts sākumā',
  'node.disconnectRevokeNotice':
    'Atvienot šo ierīci un atsaukt tās atslēgu mezglā? Citas ierīces paliks savienotas.',
  'node.tools.callPlace': 'ierīcē {device}',
  'node.tools.askedAgent': 'Lūdza {agent}',
  'node.tools.runner': 'Darbojas Obsidian ierīcē {device}',
  'node.tools.noRunner': 'Mezglam pašlaik nav pievienota neviena ierīce ar Obsidian',
  'node.tools.nodeAgent': 'Mezgla aģents',
  'node.tools.modes':
    'Izslēgts = nav pieejams. Jautāt = vajadzīgs apstiprinājums. Auto = izpilda patstāvīgi.',
  'node.tools.waiting': 'Gaida Obsidian',
  'node.tools.executing': 'Darbojas Obsidian',
  'node.tools.unknown':
    'Darbības rezultātu nevarēja apstiprināt. Pirms atkārtota pieprasījuma pārbaudiet skartos failus.',
  'node.actionDeniedByOwner': 'Lietotājs noraidīja šo darbību',
  'streamB.runSummary.move.done': 'Pārvietots',
  'streamB.runSummary.move.running': 'Pārvieto',
  'streamB.runSummary.move.waiting': 'Pieprasīta pārvietošana',
  'node.disconnectTokenNotice':
    'Noņemt šīs ierīces saglabāto savienojumu? Tās atslēga mezglā paliks aktīva. Lai liegtu turpmāku piekļuvi ar šo atslēgu, atsauciet ierīces atslēgu mezgla tokenu sarakstā.',
  'node.error.requestMissing': 'Šī pieprasījuma mezglā vairs nav.',
  'debug.frameSourceUnavailable': 'Šim kadram šajā mapē nav pieejams pirmkods.',
  'node.delegation.updateRequired':
    'Šis mezgls jāatjaunina, lai tas varētu pieņemt uzdevumus no tērzētavām',
  'node.files.directoryDeleteSummary': 'Dzēst mapi {path} ar {files} un {folders}?',
  'node.files.directoryMoveSummary':
    'Pārvietot mapi {path} ar {files} un {folders} uz {destination}?',
  'node.files.showFiles': 'Rādīt failus',
  'node.files.uncommitted': 'Nav kommitēts',
  'node.files.untracked': 'Netiek izsekots',
  'node.files.gitStatusUnavailable': 'Git statuss nav pieejams',
  'node.files.gitRecoveryWarning': 'Nekommitētu un neizsekotu saturu nevar atjaunot no Git.',
  'node.files.fileCount': { zero: '{count} failu', one: '{count} fails', other: '{count} faili' },
  'node.files.folderCount': { zero: '{count} mapju', one: '{count} mape', other: '{count} mapes' },
  'node.files.renameAction': 'Pārdēvēt',
  'node.files.moveAction': 'Pārvietot',
  'node.files.directoryConfirm': 'Dzēst mapi {path}? Tiks dzēsti visi tālāk norādītie ieraksti:',
  'node.files.directoryMoveConfirm':
    'Pārvietot mapi {path} uz {destination}? Tiks pārvietoti visi tālāk norādītie ieraksti:',
  'node.files.gitLock': 'Git darba koka bloķējums',
  'node.localRunning': 'AbeleNode darbojas šajā datorā',
  'node.files.nameOnly': 'Ievadiet faila nosaukumu bez mapēm.',
  'node.files.attachMessage':
    'Parādīt pārējos repozitorija darba kokus un atļaut failu rediģēšanu izvēlētajā kokā? Aģentu palaišanai joprojām vajadzīga atsevišķa atļauja.',
  'node.files.saveLocked': 'Saglabāšana šeit ir bloķēta',
  'node.files.newFile': 'Jauns fails…',
  'node.files.newFolder': 'Jauna mape…',
  'node.files.rename': 'Pārdēvēt…',
  'node.files.move': 'Pārvietot…',
  'node.files.delete': 'Dzēst…',
  'node.files.deleteConfirm': 'Dzēst {path}? Fails tiks noņemts no šīs mapes.',
  'node.files.allowEditing':
    'Atļaut šajā darba kokā veidot, rediģēt, pārvietot un dzēst failus? Tas neatļauj aģentu palaišanu.',
  'node.files.worktreeBusyTitle': 'Darba koks tiek izmantots',
  'node.files.worktreeBusy':
    'Šo darba koku izmanto: {holders}. Pirms dzēšanas apturiet tā sesijas.',
  'node.files.unknownHolder': 'cita darbība mezglā',
  'node.files.stopSessions': 'Apturēt šīs sesijas',
  'node.files.sessionsStopped':
    'Sesijas apturētas. Kad apturēšana pabeigta, vēlreiz izvēlieties darba koka dzēšanu.',
  'node.error.busy':
    'Šis resurss tiek izmantots. Uzgaidi, līdz pašreizējā darbība beidzas, un mēģini vēlreiz.',
  'node.error.busyStage':
    'Failus nevarēja pievienot indeksam, jo darba koks ir aizņemts. Uzgaidiet un mēģiniet vēlreiz.',
  'node.error.busyChat':
    'Jaunu tērzēšanu nevarēja sākt, jo mape vai darba koks ir aizņemts. Uzgaidiet un mēģiniet vēlreiz.',
  'node.error.busyRead':
    'Rediģēšana apturēta. Failu nevarēja atjaunināt, jo darba koks ir aizņemts. Atjauniniet pēc pašreizējās darbības beigām.',
  'node.error.workspaceDirty':
    'Darba kokā ir nekomitētas izmaiņas. Pirms dzēšanas komitējiet vai atmetiet tās.',
  'node.codeLineUnavailable': 'Saistītās rindas šajā failā vairs nepastāv.',
  'image.timeLimit.label': 'Attēlu ģenerēšanas laika ierobežojums',
  'image.timeLimit.unlimited': 'Bez ierobežojuma',
  'image.timeLimit.minutes': '{minutes} minūtes',
  'image.timeLimit.error':
    'Attēla pieprasījums sasniedza {minutes} minūšu ierobežojumu. Mainiet to sadaļā Iestatījumi → MI → Modeļi → Attēlu ģenerēšanas laika ierobežojums.',

  'node.delegation.activity': 'Darbība un pārskati',
  'node.delegation.done': 'Pabeigts',
  'node.delegation.working': 'Strādā',
  'node.delegation.unknown': 'Apturēts; rezultāts nav zināms',
  'maps.lightAddressExample': 'https://tiles.example.com/{z}/{x}/{y}.png',
  'maps.darkAddressExample': 'https://tiles.example.com/dark/{z}/{x}/{y}.png',
  'node.error.size': 'Pieprasījums ir pārāk liels. Samaziniet tā izmēru un mēģiniet vēlreiz.',
  'node.error.route':
    'Mezgla adrese tika noraidīta. Pārbaudiet pāra izveides uzaicinājumā atļauto adresi.',

  'node.error.tls':
    'Neizdevās droši sasniegt mezglu. Pārbaudiet adresi, sertifikātu un savienojumu.',
  'node.error.access': 'Mezgls liedza piekļuvi. Savienojiet pārī vēlreiz vai pārbaudiet atļaujas.',
  'node.error.unknownOutcome':
    'Rezultāts nav zināms. Pirms atkārtota mēģinājuma atsvaidziniet un pārbaudiet, kas notika.',
  'node.error.outputLimit':
    'Mezgls atgrieza pārāk daudz datu. Sašauriniet pieprasījumu vai izmantojiet lappuses.',
  'node.error.limit': 'Mezgls sasniedza ierobežojumu. Pirms atkārtota mēģinājuma uzgaidiet.',
  'node.error.debugger':
    'Atkļūdotājs nav pieejams. Pārbaudiet atkļūdošanas iestatījumus un izveidojiet savienojumu vēlreiz.',
  'node.error.generic':
    'Mezgls nevarēja pabeigt pieprasījumu. Pirms atkārtota mēģinājuma pārbaudiet informāciju.',
  'node.error.connection': 'Mezgls ir atvienots. Pārbaudiet savienojumu un izveidojiet to vēlreiz.',
  'node.error.pairing':
    'Neizdevās pabeigt pāra izveidi. Pārbaudiet uzaicinājumu un mēģiniet vēlreiz.',
  'node.error.identity':
    'Mezgls vai mērķis ir mainījies. Pārbaudiet identitāti un izveidojiet savienojumu vēlreiz.',
  'node.error.stale': 'Dati ir mainījušies. Pirms atkārtota mēģinājuma atsvaidziniet tos.',
  'node.error.staleResource':
    'Mape vai darba kopija ir mainījusies. Atsvaidziniet sarakstu un izvēlieties to vēlreiz.',
  'node.error.folderUnavailable':
    'Šī mape mezglā vairs nav pieejama. Iespējams, tā ir noņemta vai vairs nav repozitorijs.',
  'node.folderRefreshed':
    'Mape tika atsvaidzināta. Nospiediet Izveidot vēlreiz, lai izveidotu norādīto mapi.',
  'node.error.trust':
    'Šī mape nav uzticama. Pirms turpināšanas pārbaudiet uzticamības iestatījumus.',
  'node.error.unavailable': 'Šī funkcija nav pieejama. Pārbaudiet mezgla iestatījumus un versiju.',

  'kit.cancel': 'Atcelt',
  'kit.delete': 'Dzēst',
  'kit.deleteTooltip': 'Dzēst šo vienumu',
  'kit.cancelTooltip': 'Aizvērt bez izmaiņām',
  'kit.filename': 'faila nosaukums',
  'kit.create': 'Izveidot',
  'kit.submitTooltip': 'Turpināt ar šo tekstu',
  'kit.where': 'Atrašanās vieta',
  'kit.allLevels': 'Rādīt visus līmeņus',
  'kit.empty': 'Vēl nav vienumu',
  'kit.noMatches': 'Nav atbilstību',
  'kit.loading': 'Ielādē…',
  'kit.loadError': 'Neizdevās ielādēt vienumus',
  'kit.details': 'Sīkāka informācija',
  'kit.noEvents': 'Vēl nav notikumu',
  'kit.sourceMissing': 'Avots nav pieejams',
  'kit.saveError': 'Neizdevās saglabāt',
  'kit.progress': 'Norise',
  'kit.clear': 'Notīrīt atlasi',
  'kit.selectAll': 'Atlasīt visu',
  'kit.chooseNone': 'Noņemt atlasi visiem',
  'kit.chooseAll': 'Atlasīt visus vienumus',
  'kit.chooseIcon': 'Izvēlēties ikonu',
  'kit.searchIcons': 'Meklēt ikonas, piem., calendar',
  'kit.noIcon': 'Nav ikonas ar nosaukumu, kas līdzīgs “{query}”.',
  'kit.refreshing': 'Atjaunina…',
  'kit.objectMissing': 'Objekts nav pieejams',
  'kit.objectError': 'Neizdevās ielādēt objektu',
  'kit.waiting': 'Gaida jūsu atbildi',
  'kit.closeSearch': 'Aizvērt meklēšanu',
  'kit.folder': 'Mape',
  'kit.scope': 'Tvērums',
  'kit.unknown': 'Nezināms',
  'kit.removeNote': 'Izņemt šo piezīmi',
  'kit.copyPath': 'Kopēt pilnu ceļu',
  'kit.reveal': 'Rādīt failu pārlūkā',
  'kit.targetMissing': 'Mērķis nav pieejams',
  'kit.vaultRoot': 'Krātuves sakne',
  'kit.previousMonth': 'Iepriekšējais mēnesis',
  'kit.dateRange': 'Izvēlēties datumu diapazonu',
  'kit.nextMonth': 'Nākamais mēnesis',
  'kit.noQuote': 'Nav citēta teksta',
  'kit.collapseQuote': 'Sakļaut citātu',
  'kit.expandQuote': 'Izvērst citātu',
  'kit.exactTime': 'Precīzs laiks',
  'kit.working': 'Darbojas',
  'kit.done': 'Pabeigts',
  'kit.failed': 'Neizdevās',
  'kit.skipped': 'Atstāts nemainīts',
  'kit.errors': 'Kļūdas',
  'kit.moreBelow': 'Vairāk zemāk',
  'kit.selection': 'Atlase',
  'kit.moreActions': 'Citas darbības',
  'kit.showRest': 'Rādīt pārējo sarakstu',
  'kit.showMore': {
    zero: 'Rādīt vēl {count}',
    one: 'Rādīt vēl {count}',
    other: 'Rādīt vēl {count}',
  },
  'kit.underlineOn': 'Pasvītrojums ieslēgts',
  'kit.underlineOff': 'Pasvītrojums izslēgts',
  'kit.underline': 'Pasvītrot anotāciju',
  'kit.savingColour': 'Saglabā krāsu',
  'kit.selectionMissing': 'Atlase nav pieejama',
  'kit.noColour': 'Bez krāsas',
  'kit.savingNamedColour': 'Saglabā: {colour}…',
  'kit.colourDisabled': 'Šeit nevar mainīt krāsu',
  'kit.waveform': 'Viļņa forma',
  'kit.colour.grey': 'Pelēks',
  'kit.colour.red': 'Sarkans',
  'kit.colour.orange': 'Oranžs',
  'kit.colour.yellow': 'Dzeltens',
  'kit.colour.green': 'Zaļš',
  'kit.colour.cyan': 'Ciāns',
  'kit.colour.blue': 'Zils',
  'kit.colour.purple': 'Violets',
  'kit.colour.pink': 'Rozā',
  'settings.tabs.tasks': 'Uzdevumi',
  'settings.tabs.logs': 'Notikumu žurnāli',
  'settings.tabs.journals': 'Dienasgrāmatas',
  'settings.tabs.calendars': 'Kalendāri',
  'settings.tabs.finance': 'Finanses',
  'settings.tabs.timeTracking': 'Laika uzskaite',
  'settings.tabs.ai': 'MI aģents',
  'settings.tabs.scripts': 'Skripti',
  'settings.tabs.links': 'Saites',
  'settings.tabs.github': 'Git hostings',
  'settings.tabs.nodes': 'Mezgli',
  'settings.tabs.reader': 'Grāmatas',
  'settings.tabs.quickButton': 'Ātrā poga',
  'settings.tabs.headerButtons': 'Virsraksta pogas',
  'settings.tabs.linter': 'Piezīmju pārbaude',
  'settings.tabs.transfer': 'Pārsūtīšana',
  'settings.tabs.sync': 'Sinhronizācija',
  'settings.tabs.other': 'Citi',
  'settings.groups.notes': 'Piezīmes',
  'settings.groups.moneyTime': 'Nauda un laiks',
  'settings.groups.agents': 'Aģenti',
  'settings.groups.buttons': 'Pogas',
  'settings.groups.data': 'Dati',
  'settings.documentation': 'Dokumentācija',
  'settings.documentationTooltip': 'Aizvērt iestatījumus un lasīt par šo cilni',
  'settings.englishDocs': 'Dokumentācija ir angļu valodā',
  'kit.imageMissing': 'Attēls nav pieejams',
  'kit.loadingImage': 'Ielādē attēlu…',
  'kit.deviceMissing': 'Nav pieejams šajā ierīcē',
  'kit.hideDetail': 'Paslēpt: {label}',
  'kit.showDetail': 'Rādīt: {label}',
  'kit.description': 'apraksts',
  'kit.openSource': 'Atvērt avotu: {title}',
  'kit.retry': 'Mēģināt vēlreiz: {title}',
  'kit.moreIcons': 'Vēl {count} ikonas zemāk',
  'kit.image': 'attēls',
  'kit.imageMissingNamed': 'Attēls nav pieejams: {name}',
  'kit.previewImage': 'Priekšskatīt: {name}',
  'kit.inputLoading': 'Ielādē',
  'kit.partOf': '{shown} no {total}',
  'kit.workspace': 'Darbvieta: {name}',
  'kit.qrCode': 'QR kods',
  'kit.askSelection': 'Jautāt aģentam par šo jaunā sarunā',
  'kit.addSelection': 'Pievienot atvērtajai sarunai',
  'node.trust.title': 'Vai uzticēties šai mapei aģentu darbam?',
  'node.trust.message':
    'Aģenti varēs izpildīt komandas un mainīt failus mapē {path}. Uzticies šai mapei tikai tad, ja zini tās saturu. Aģenta darbam vari sekot sarunā un tur to apturēt.',
  'node.trust.allow': 'Uzticēties mapei',
  'node.chat.closeTab':
    'Aizvērt cilni — sesija paliek mezglā. Atver to mezgla panelī, lai sekotu darbam vai to apturētu.',
  'kit.noteSelection': 'Ievietot pēdējā atvērtajā piezīmē',
  'kit.linkSelection': 'Kopēt saiti uz šīm rindām',
  'kit.saving': 'Saglabā…',
  'commands.convert-drawings-to-canvases': 'Pārvērst vecos zīmējumus audeklos',
  'drawing.conversion-result':
    'Zīmējumi: pārveidoti {converted}, jau pārveidoti {existing}, kļūdas {failed}. Oriģināli saglabāti.',
  'commands.migrate-excalidraw-drawing': 'Pārvietot šo Excalidraw zīmējumu uz audeklu',
  'commands.migrate-excalidraw-vault': 'Pārvietot visus Excalidraw zīmējumus uz audekliem',
  'commands.new-canvas': 'Jauns audekls',
  'commands.open-canvas-viewer': 'Atvērt pašreizējo audeklu diagrammu skatītājā',
  'commands.open-changelog': 'Atvērt izmaiņu žurnālu',
  'commands.cycle-checkbox-state': 'Pārslēgt izvēles rūtiņas stāvokli',
  'commands.insert-columns': 'Ievietot kolonnas',
  'commands.column-options': 'Kolonnu opcijas',
  'commands.remove-columns': 'Noņemt kolonnas',
  'commands.add-text-comment': 'Pievienot komentāru',
  'commands.open-node-repository': 'Atvērt mezgla repozitoriju',
  'commands.chat-about-github-item': 'Apspriest šo GitHub vienumu',
  'commands.open-github-repository': 'Atvērt GitHub repozitoriju…',
  'commands.show-github-notifications': 'Rādīt GitHub paziņojumus',
  'commands.open-github-link': 'Atvērt GitHub saiti vai vienumu',
  'commands.copy-link-to-lines': 'Kopēt saiti uz atlasītajām rindām',
  'commands.linter-open': 'Atvērt linteri',
  'commands.linter-lint-note': 'Pārbaudīt pašreizējo piezīmi ar linteri',
  'commands.linter-lint-folder': 'Pārbaudīt mapi ar linteri…',
  'commands.linter-lint-vault': 'Pārbaudīt krātuvi ar linteri',
  'commands.sync-now': 'Sinhronizēt tagad',
  'commands.sync-pause-resume': 'Pauzēt vai atsākt sinhronizāciju',
  'commands.sync-log': 'Atvērt sinhronizācijas iestatījumus',
  'commands.sync-deleted-files': 'Atvērt izdzēstos failus',
  'commands.reader-toggle-eink': 'Pārslēgt grāmatu e-tintes režīmu šajā ierīcē',
  'commands.reader-toggle-zen': 'Pārslēgt grāmatu Zen režīmu šajā ierīcē',
  'commands.open-requests': 'Atvērt pieprasījumus',
  'commands.import-requests': 'Importēt pieprasījumus no starpliktuves',
  'commands.new-presentation': 'Jauna prezentācija',
  'commands.open-presentation': 'Atvērt prezentāciju',
  'commands.preview-presentation': 'Priekšskatīt prezentāciju blakus redaktoram',
  'commands.play-presentation': 'Sākt prezentāciju',
  'commands.present-presentation': 'Rādīt prezentāciju ar prezentētāja skatu',
  'commands.agents': 'Aģenti',
  'ribbon.agents': 'Aģenti',
  'commands.comment-here': 'Komentēt šeit',
  'commands.show-ai-sidebar': 'Rādīt MI tērzēšanas sānu paneli',
  'commands.find-in-chat': 'Meklēt pašreizējā tērzēšanā',
  'commands.search-all-chats': 'Meklēt visās tērzēšanās',
  'commands.chat-close-tab': 'Aizvērt pašreizējo tērzēšanas cilni',
  'commands.chat-reopen-tab': 'Atvērt pēdējo aizvērto tērzēšanas cilni',
  'commands.chat-next-tab': 'Pāriet uz nākamo tērzēšanas cilni',
  'commands.chat-previous-tab': 'Pāriet uz iepriekšējo tērzēšanas cilni',
  'ribbon.show-ai-chat': 'Rādīt MI tērzēšanu',
  'commands.voice-input': 'Diktēt piezīmē',
  'commands.show-script-runs': 'Rādīt skriptu izpildes',
  'commands.open-documentation': 'Atvērt dokumentāciju',
  'commands.open-quick-menu': 'Atvērt ātro izvēlni',
  'commands.show-script-api': 'Rādīt skriptu API uzziņu',
  'commands.review-key-destinations': 'Pārskatīt atslēgu galamērķus',
  'commands.create-task': 'Izveidot jaunu uzdevumu',
  'commands.create-task-and-insert-link': 'Izveidot jaunu uzdevumu un ievietot pašreizējā piezīmē',
  'commands.find-and-replace':
    'Meklēt un aizstāt visu nosacījumiem atbilstošo piezīmju priekšdaļā un saturā',
  'commands.import-files': 'Importēt failus krātuvē',
  'commands.save-media': 'Saglabāt attālos multivides failus krātuvē',
  'commands.unused-media': 'Atrast un izdzēst neizmantotos multivides failus',
  'commands.deduplicate-media': 'Noņemt multivides pielikumu dublikātus',
  'commands.migrate-from-dataview': 'Pārvietot uzdevumus no Dataview',
  'commands.migrate-from-firefly': 'Pārvietot datus no Firefly III',
  'commands.create-transaction': 'Izveidot jaunu darījumu',
  'commands.create-transaction-and-insert-link':
    'Izveidot jaunu darījumu un ievietot pašreizējā piezīmē',
  'commands.show-timeline-sidebar': 'Rādīt laika skalas sānu paneli',
  'commands.migrate-dataview-fields': 'Pārvietot Dataview laukus',
  'commands.show-todo-sidebar': 'Rādīt uzdevumu sānu paneli',
  'commands.show-finance-sidebar': 'Rādīt finanšu sānu paneli',
  'commands.show-accounts-sidebar': 'Rādīt kontu sānu paneli',
  'commands.migrate-from-toggl': 'Pārvietot laika ierakstus no Toggl',
  'commands.show-time-tracking-sidebar': 'Rādīt laika uzskaites sānu paneli',
  'commands.start-timer': 'Sākt taimeri pašreizējai piezīmei',
  'commands.stop-timer': 'Apturēt aktīvo taimeri',
  'commands.paste-from-clipboard': 'Ielīmēt no starpliktuves kursora vietā',
  'commands.create-note-from-template': 'Izveidot piezīmi no veidnes',
  'commands.create-note-in-group': 'Izveidot piezīmi grupā',
  'commands.replace-note-with-template': 'Aizstāt pašreizējo piezīmi ar veidni',
  'commands.insert-template-at-cursor': 'Ievietot veidni kursora vietā',
  'commands.insert-gallery': 'Ievietot attēlu galeriju',
  'commands.convert-images-to-galleries': 'Pārveidot lapas attēlus galerijās',
  'commands.reindex-footnotes': 'Pārnumurēt zemsvītras piezīmes',
  'commands.insert-highlight': 'Ievietot krāsainu izcēlumu',
  'commands.remove-highlight': 'Noņemt krāsaino izcēlumu',
  'commands.set-cover-from-first-media': 'Iestatīt vāku no pirmā attēla vai video piezīmē',
  'commands.open-today-daily-note': 'Atvērt šodienas dienas piezīmi',
  'commands.create-css-snippet': 'Izveidot CSS fragmentu',
  'commands.reload-css-snippets': 'Pārlādēt CSS fragmentus',
  'commands.create-script': 'Izveidot skriptu',
  'ribbon.show-timeline-sidebar': 'Rādīt laika skalas sānu paneli',
  'ribbon.show-todo-sidebar': 'Rādīt uzdevumu sānu paneli',
  'ribbon.show-finance-sidebar': 'Rādīt finanšu sānu paneli',
  'ribbon.show-time-tracking': 'Rādīt laika uzskaiti',
  'ribbon.show-script-runs': 'Rādīt skriptu izpildes',
  'commands.open-node': 'Atvērt mezglu',
  'ribbon.node': 'Mezgls',
  'commands.toggle-zen-mode': 'Pārslēgt Zen režīmu',
  'commands.add-to-agent-context': 'Pievienot aģenta kontekstam',
  'commands.chat-about-current-note': 'Apspriest šo',
  'commands.attach-note-to-chat': 'Pievienot tērzēšanai',
  'commands.attach-chat-to-current-note': 'Pievienot tērzēšanu piezīmei',
  'commands.copy-note-wikilink': 'Kopēt vikisaiti',
  'commands.review-scripts': 'Pārskatīt skriptus, kas gaida apstiprinājumu',
  'commands.script': 'Skripts: {name}',
  'settings.nodes.title': 'Mezgli',
  'settings.nodes.description':
    'Datori, kuros aģents var strādāt jūsu labā: atveriet mezglu, izvēlieties projektu, vērojiet un atbildiet šeit. To atslēgas un vēsture paliek šajā ierīcē.',
  'settings.nodes.check': 'Pārbaudīt šīs ierīces savienojumu ar mezglu',
  'settings.nodes.open': 'Atvērt sesiju',
  'settings.nodes.openTip': 'Izvēlēties sesiju vai pārvaldīt projektus un darbvietas',
  'settings.nodes.more': 'Savienošana pārī, atkļūdotāja piekļuve, noņemšana',
  'settings.nodes.pairTitle': 'Savienot pārī mezglu citā datorā',
  'settings.nodes.pairDesc':
    'Attāls dators vai serveris, izmantojot tā uzaicinājumu. Ierīci, kurai piekļuve atsaukta, tāpat var savienot pārī no jauna.',
  'settings.nodes.pair': 'Savienot pārī',
  'settings.nodes.pairTip':
    'Skenēt vai ielīmēt uzaicinājumu; savienot pārī atkārtoti vai pārbaudīt mainītu mezgla atslēgu',
  'settings.nodes.addTitle': 'Pievienot mezglu šajā datorā',
  'settings.nodes.addDesc': 'Šeit darbojošos mezglu, izmantojot tā izsniegto marķieri.',
  'settings.nodes.add': 'Pievienot',
  'settings.nodes.addTip': 'Piešķirt mezglam nosaukumu un ielīmēt tā marķieri',
  'settings.nodes.traceTitle': 'Piezīmes par ierakstītām izpildēm',
  'settings.nodes.traceDesc':
    'Mape piezīmei par atkļūdotāja ierakstītu jūsu vai aģenta izpildi: krātuves mape vai datorā jebkura mape ar pilnu ceļu. Pati izpilde paliek mezglā.',
  'settings.nodes.traceExample': 'piem., Trace',
  'settings.nodes.traceFolder': 'Mape piezīmēm par ierakstītām izpildēm',
  'settings.nodes.chooseFolderTip': 'Izvēlēties mapi šajā datorā, krātuvē vai ārpus tās',
  'settings.nodes.chooseFolder': 'Izvēlēties mapi piezīmēm par ierakstītām izpildēm',
  'settings.nodes.name': 'Nosaukums',
  'settings.nodes.nameDesc': 'Šī mezgla nosaukums šajā ierīcē.',
  'settings.nodes.localPlaceholder': 'Lokālais mezgls',
  'settings.nodes.label': 'Mezgla nosaukums',
  'settings.nodes.address': 'Adrese',
  'settings.nodes.addressDesc': 'Tikai šī datora adrese; citu datoru savieno pārī.',
  'settings.nodes.url': 'Mezgla URL',
  'settings.nodes.token': 'Marķieris',
  'settings.nodes.tokenDesc':
    'Marķieris, ko izvada abele-node token create. Glabājas tikai šīs ierīces atslēgu saišķī.',
  'settings.nodes.pasteToken': 'Ielīmēt marķieri',
  'settings.nodes.installationToken': 'Mezgla instalācijas marķieris',
  'settings.nodes.cancel': 'Atcelt',
  'settings.nodes.cancelTip': 'Aizvērt, neko nepievienojot',
  'settings.nodes.authenticateTip':
    'Autentificēties un piesaistīt lokālā mezgla identitāti šai ierīcei',
  'settings.nodes.untitledChat': 'Nenosaukta tērzēšana',
  'settings.nodes.unavailable': 'Mezgls nav pieejams',
  'settings.nodes.added': 'Savienots. Atveriet sesiju šeit vai jaunās tērzēšanas izvēlnē.',
  'settings.nodes.connected': 'Savienots',
  'settings.nodes.connecting': 'Savienojas…',
  'settings.nodes.disconnected': 'Nav savienots',
  'settings.nodes.repair': 'Savienošana pārī / atkārtota savienošana',
  'settings.nodes.remove': 'Noņemt',
  'settings.nodes.removed':
    'Savienojums noņemts no šīs ierīces. Mezgla vēsture un dēmona akreditācijas dati nav mainīti.',
  'commands.insert-columns-two': 'Ievietot divas vienādas kolonnas',
  'commands.insert-columns-three': 'Ievietot trīs vienādas kolonnas',
  'commands.insert-columns-aside': 'Ievietot tekstu ar sānu sleju',
  'ribbon.agentsStatus': 'Aģenti · Jāpievērš uzmanība: {attention}. Strādā: {running}',
  'ribbon.agentsStatusIncomplete':
    'Aģenti · Jāpievērš uzmanība: {attention}. Strādā: {running} · Dažas sarunas neizdevās pārbaudīt',
  'settings.AiSettings.general.c910d474': 'Ģenerālis',
  'settings.AiSettings.models.d17d2d78': 'Modeļi',
  'settings.AiSettings.agents.279b44d2': 'Aģenti',
  'settings.AiSettings.prompts.5f2e66e6': 'Uzvednes',
  'settings.AttachmentRulesSettings.attachment_folders.4ec7937c': 'Pielikumu mapes',
  'settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d':
    'Faili, kas ielīmēti vai nomesti piezīmē kādā no šīm mapēm, tiek novirzīti uz mapi ar tās noteikumu nosaukumiem. Uzvar dziļākā mape.',
  'settings.AttachmentRulesSettings.add_a_rule.bed79361': 'Pievienojiet noteikumu',
  'settings.AttachmentRulesSettings.notes_in.af0c6387': 'Piezīmes iekšā',
  'settings.AttachmentRulesSettings.notes_folder.b8c1e974': 'Piezīmju mape',
  'settings.AttachmentRulesSettings.folder.74ccd433': 'Mape',
  'settings.AttachmentRulesSettings.remove_this_rule.00612239': 'Noņemiet šo noteikumu',
  'settings.AttachmentRulesSettings.attachments_go_to.7b114ade': 'Pielikumi dodas uz',
  'settings.AttachmentRulesSettings.attachment_folder.fce49098': 'Pielikumu mape',
  'settings.AttachmentRulesSettings.subfolder_name.f381c5ab': 'Apakšmapes nosaukums',
  'settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7':
    'Nav noteikumu: pielikumi seko Obsidiāna iestatījumam.',
  'settings.AttachmentRulesSettings.add_a_folder_rule.879a8360': 'Pievienojiet mapes noteikumu',
  'settings.AttachmentRulesSettings.same_folder_as_the_note.32781177': 'Tā pati mape kā piezīmei',
  'settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55':
    'Tālāk norādītajā mapē',
  'settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483':
    'Apakšmapē zem piezīmes mapes',
  'settings.AttachmentRulesSettings.whole_vault.cb44fe25': 'Visa velve',
  'settings.CalendarsSettings.calendars.e0b2b00c': 'Kalendāri',
  'settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b':
    'Notikumi no Google, iCloud, Outlook vai jebkura CalDAV servera, kas tiek rādīti blakus uzdevumiem: sānjoslas kalendārā, laika skalā un ikdienas piezīmē. Tikai lasāms — nekad nekas netiek ierakstīts kalendārā, un netiek veikta piezīme, ja vien to nepieprasāt no pasākuma.',
  'settings.CalendarsSettings.read_every_minutes.f4ca625e': 'Lasīt katru (minūtes)',
  'settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf':
    'Kad sākas Obsidiāns, tad bieži, kamēr tas ir atvērts. {value0} vismaz; Google pats atjaunina saiti tikai ik pēc dažām stundām.',
  'settings.CalendarsSettings.read_now.20d8b246': 'Lasiet tagad',
  'settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9':
    'Lasiet katru kalendāru, kas tiek parādīts vēlreiz, tūlīt',
  'settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f': 'Kalendārs vēl nav parādīts',
  'settings.CalendarsSettings.your_calendars.80ca6c5e': 'Jūsu kalendāri',
  'settings.CalendarsSettings.not_read.e4f441c4': 'Nav lasīts: ',
  'settings.CalendarsSettings.change_this_calendar.a6ced910': 'Mainīt šo kalendāru',
  'settings.CalendarsSettings.add_another_calendar.744b9f9c': 'Pievienojiet citu kalendāru',
  'settings.CalendarsSettings.no_calendars_yet.0097b3fe': 'Vēl nav neviena kalendāra',
  'settings.CalendarsSettings.a_secret_link_from_google.21e49135':
    'Slepena saite no Google, iCloud vai Outlook vai CalDAV konta.',
  'settings.CalendarsSettings.add_calendar.9067e0e8': 'Pievienojiet kalendāru',
  'settings.CalendarsSettings.add_a_calendar_to_show.6973ff63':
    'Pievienojiet kalendāru, ko rādīt blakus uzdevumiem',
  'settings.CalendarsSettings.name.dcd1d522': 'Nosaukums',
  'settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee':
    'Parādīts blakus katram notikumam.',
  'settings.CalendarsSettings.e_g_work.7f2ce0de': 'piem. {literal0}',
  'settings.CalendarsSettings.colour.3a9dfa58': 'Krāsa',
  'settings.CalendarsSettings.its_events_are_marked_with.16eafb54':
    'Tās notikumi ir atzīmēti ar to.',
  'settings.CalendarsSettings.connected_by.9952ce52': 'Savienoja ar',
  'settings.CalendarsSettings.a_secret_link_to_the.9b051a7d':
    'Slepena saite uz kalendāru vai CalDAV konts ar tā lietotājvārdu un paroli.',
  'settings.CalendarsSettings.link.a6a32dbc': 'Saite',
  'settings.CalendarsSettings.forget_the_link.45aee758': 'Aizmirstiet saiti',
  'settings.CalendarsSettings.server.aef7de28': 'Serveris',
  'settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72':
    'CalDAV adrese: {literal0} iCloud, {literal1} Fastmail, jūsu Nextcloud adrese Nextcloud.',
  'settings.CalendarsSettings.username.e3b89e9d': 'Lietotājvārds',
  'settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f':
    'iCloud gadījumā Apple konta e-pasta adrese.',
  'settings.CalendarsSettings.password.e7cf3ef4': 'Parole',
  'settings.CalendarsSettings.app_specific_password.ffcc8f77': 'Lietotnei noteikta parole',
  'settings.CalendarsSettings.forget_the_password.9d745dd0': 'Aizmirstiet paroli',
  'settings.CalendarsSettings.calendar.d5d0a30b': 'Kalendārs',
  'settings.CalendarsSettings.one_calendar_of_the_account.562ef915':
    'Viens konta kalendārs vai visi. Atrast kalendārus serverim jautā, kuri kalendāri ir.',
  'settings.CalendarsSettings.find_calendars.d59c2286': 'Atrodiet kalendārus',
  'settings.CalendarsSettings.set_the_server_the_username.111eaa0a':
    'Vispirms iestatiet serveri, lietotājvārdu un paroli',
  'settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb':
    'Jautājiet serverim, kuri kalendāri ir šim kontam',
  'settings.CalendarsSettings.delete.e2d0a549': 'Dzēst',
  'settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787':
    'Izdzēsiet šo kalendāru no iestatījumiem un tā atslēgu no atslēgu saišķa',
  'settings.CalendarsSettings.done.11a6767d': 'Gatavs',
  'settings.CalendarsSettings.close_this_window_changes_are.91342d87':
    'Aizveriet šo logu; izmaiņas tiek saglabātas, tiklīdz tās veicat',
  'settings.CalendarsSettings.delete_the_calendar.e601c301': 'Dzēst kalendāru',
  'settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0':
    'Vai dzēst {value0}? Tās notikumi pamet sarakstus, un tā {value1} tiek noņemta no atslēgu saišķa. Pats kalendārs nav aiztikts.',
  'settings.CalendarsSettings.google_the_calendar_s_settings.065b586e':
    'Google: kalendāra iestatījumi, "Slepenā adrese iCal formātā". iCloud: kopīgojiet kalendāru kā publisku kalendāru un kopējiet tā saiti. Outlook: publicējiet kalendāru un kopējiet ICS saiti. Saglabāts atslēgu saišķī — ikviens, kam ir saite, var lasīt kalendāru.',
  'settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48':
    'Attiecībā uz iCloud — lietotnei specifiska parole, kas izveidota vietnē account.apple.com, nevis paša konta parole. Saglabāts atslēgu saišķī, nekad iestatījumu failā.',
  'settings.CalendarsSettings.secret_link_ics.a3f8db65': 'Slepenā saite (ICS)',
  'settings.CalendarsSettings.caldav_account.bb860701': 'CalDAV konts',
  'settings.CalendarsSettings.the_value_could_not_be.3daaa765':
    '{value0} nevarēja saglabāt atslēgu ķēdē: {value1}',
  'settings.CalendarsSettings.asking_the_server.fb689559': 'Jautā serverim…',

  'settings.CalendarsSettings.the_account_has_no_calendar.a059bc95':
    'Kontā nav kalendāra ar pasākumiem.',
  'settings.CalendarsSettings.all_calendars_of_the_account.3b138d44': 'Visi konta kalendāri',
  'settings.CalendarsSettings.just_now.7ddb44d8': 'tikai tagad',
  'settings.CalendarsSettings.value_min_ago.c85acd7d': 'pirms {value0} min',
  'settings.CalendarsSettings.not_shown.a08f0f94': 'Nav parādīts',
  'settings.CalendarsSettings.reading.874bfa5b': 'Lasa…',
  'settings.CalendarsSettings.no_password_yet.11f1e05e': 'Paroles vēl nav',
  'settings.CalendarsSettings.no_link_yet.60e5be61': 'Vēl nav saites',
  'settings.CalendarsSettings.could_not_be_read.51a02791': 'Nevarēja izlasīt',
  'settings.CalendarsSettings.not_read_yet.fbe841ea': 'Vēl nav lasīts',
  'settings.CalendarsSettings.reading_the_calendars.b8ec37a1': 'Lasot kalendārus…',
  'settings.CalendarsSettings.value_of_the_calendars_could.c86147d0':
    '{value0} no kalendāriem nevarēja nolasīt; katrs saka, kāpēc zemāk.',
  'settings.CalendarsSettings.read_every_calendar_again_now.d8b13597':
    'Lasiet katru kalendāru vēlreiz tagad, nevis pēc nākamā intervāla.',
  'settings.FinanceSettings.transactions.3e5136fd': 'Darījumi',
  'settings.FinanceSettings.transaction_path_template.39b564b9': 'Darījuma ceļa veidne',
  'settings.FinanceSettings.template_for_new_transaction_file.0e3740ec':
    'Veidne jauniem darījumu faila ceļiem. Atstājiet tukšu, lai saglabātu esošos ceļus; jaunajiem darījumiem tiek izmantoti to nosaukumi krātuves saknē. Mainīgie: {literal0}, {literalDate}, {literal1}, {literal2}, {literal3}, {literal4}.',
  'settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45': 'piem. {literal1}',
  'settings.FinanceSettings.transaction_template_note.010eab6c': 'Darījuma veidnes piezīme',
  'settings.FinanceSettings.path_to_a_template_note.397b813a':
    'Ceļš uz veidnes piezīmi, ko izmanto, veidojot jaunas transakcijas.',
  'settings.FinanceSettings.path_to_template_note.18b70a08': 'Ceļš uz veidnes piezīmi',
  'settings.FinanceSettings.default_currency.67e65877': 'Noklusējuma valūta',
  'settings.FinanceSettings.default_currency_code_for_new.7d536f52':
    'Noklusējuma valūtas kods jauniem darījumiem.',
  'settings.FinanceSettings.e_g_eur.00afdaf5': 'piem. {literal0}',
  'settings.FinanceSettings.pinned_currencies.b882d6bc': 'Piespraustas valūtas',
  'settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698':
    'Komatatdalītas valūtas, lai sānjoslā rādītu bilances kopsavilkumus. Kārtība tiek saglabāta.',
  'settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64': 'piem. {literal0}',
  'settings.FinanceSettings.exchange_rates.a1875e41': 'Valūtas kursi',
  'settings.FinanceSettings.fetch_today_s_rates.c175748e': 'Iegūstiet šodienas likmes',
  'settings.FinanceSettings.once_a_day_from_a.73d47942':
    'Reizi dienā no publiska galda, kuram nav vajadzīga atslēga; nekas par krātuvi netiek nosūtīts. Tos izmanto vairāku valūtu summas un kontu secība pēc summām.',
  'settings.FinanceSettings.show_sums_in.86b3b3d2': 'Rādīt summas',
  'settings.FinanceSettings.the_currency_a_sum_of.42c9988d':
    'Valūta, kurā tiek parādīta vairāku valūtu summa.',
  'settings.FinanceSettings.rates.54dd2169': 'Likmes',
  'settings.FinanceSettings.fetch_today_s_rates_now.68e35189': 'Iegūstiet šodienas cenas tūlīt',
  'settings.FinanceSettings.firefly_iii_migration.59031cf7': 'Firefly III migrācija',
  'settings.FinanceSettings.firefly_iii_url.3050cc31': 'Firefly III URL',
  'settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a': 'Firefly III instances bāzes URL.',
  'settings.FinanceSettings.e_g_https_firefly_example.6999e343': 'piem. {literal1}',
  'settings.FinanceSettings.firefly_iii_token.45c3acb2': 'Firefly III žetons',
  'settings.FinanceSettings.personal_access_token_for_firefly.7deff96a':
    'Personal Access Token Firefly III API. Saglabāts atslēgu saišķī, nekad iestatījumu failā.',
  'settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788':
    'Ievadiet savu Firefly III marķieri',
  'settings.FinanceSettings.forget_the_token.961a44b9': 'Aizmirstiet žetonu',
  'settings.FinanceSettings.accounts_folder.8f9b5bf3': 'Kontu mape',
  'settings.FinanceSettings.folder_for_account_notes_created.dab1fa98':
    'Konta piezīmju mape, kas izveidota migrēšanas laikā.',
  'settings.FinanceSettings.enter_accounts_folder_path.93935780': 'Ievadiet kontu mapes ceļu',
  'settings.FinanceSettings.categories_folder.60253c7c': 'Kategoriju mape',
  'settings.FinanceSettings.folder_for_category_notes_created.9f0764fe':
    'Kategoriju piezīmju mape, kas izveidota migrēšanas laikā.',
  'settings.FinanceSettings.enter_categories_folder_path.306fac3f':
    'Ievadiet kategoriju mapes ceļu',
  'settings.FinanceSettings.fetching_today_s_rates.1182bcb9': 'Notiek šodienas tarifu iegūšana…',
  'settings.FinanceSettings.could_not_fetch_value.ae250f78': 'Nevarēja ienest: {value0}',
  'settings.FinanceSettings.not_fetched_yet.21ca804f': 'Vēl nav atnests.',
  'settings.FinanceSettings.could_not_update_since_value.9af0a0fc':
    'Nevarēja atjaunināt kopš {value0}{value1}',
  'settings.FinanceSettings.from_value_value.11c05045': 'No {value0}, {value1}',
  'settings.FinanceSettings.no_rate_for_value_left.b8718978':
    'Nav likmes {value0}: nav iekļautas summās',
  'settings.GithubAccessReport.token.d2089be6': 'Marķieris',
  'settings.GithubAccessReport.sent.c16bc82b': 'Nosūtīts',
  'settings.GithubAccessReport.not_sent.cd5f943d': 'Nav nosūtīts',
  'settings.GithubAccessReport.refused.66b87354': 'Atteicās',
  'settings.GithubAccessReport.skipped.12698ce1': 'Izlaists',
  'settings.GithubAccessReport.a_fine_grained_personal_access.04646cce':
    'smalks personiskās piekļuves marķieris',
  'settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc':
    'klasisks personīgās piekļuves marķieris',
  'settings.GithubAccessReport.an_oauth_token.4e87c03e': 'OAuth pilnvara',
  'settings.GithubAccessReport.a_github_app_s_token.911c13a3': 'GitHub lietotnes marķieris',
  'settings.GithubAccessReport.a_token_of_a_kind.7af25278': 'sava veida marķieris GitHub neatzīmē',
  'settings.GithubAccessReport.sent_with_every_request_value.a8affe59':
    'Nosūtīts ar katru pieprasījumu: {value0}, {value1} rakstzīmes.',
  'settings.GithubAccessReport.no_token_was_sent_with.8d5461bf':
    'Ar šiem pieprasījumiem netika nosūtīts neviens marķieris.',
  'settings.GithubAccessReport.token_is_set_for_value.2c01fdf9': 'Tokens ir iestatīts: {value0}',
  'settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e':
    'Repozitorijs: {value0}/{value1} vietnē {value2}',
  'settings.GithubAccessReport.belongs_to_value.d316930d': 'Pieder {value0}.',
  'settings.GithubAccessReport.expires_value.f820bc15': 'Beidzas {value0}.',
  'settings.GithubAccessReport.scopes_value.1d42883b': 'Darbības jomas: {value0}.',
  'settings.GithubAccessReport.api_value.011cfaea': 'API: {value0}',
  'settings.GithubAccessReport.needs_value.9e07998c': 'Nepieciešamība: {value0}',
  'settings.GithubAccessReport.github_said_value.cc7a0df5': 'GitHub teica: "{value0}"',
  'settings.GithubConnectionEditor.add_github_connection.a8b1ed9f':
    'Pievienojiet GitHub savienojumu',
  'settings.GithubConnectionEditor.edit_github_connection.ca1cc639': 'Rediģēt GitHub savienojumu',
  'settings.GithubConnectionEditor.account.7e1b0d56': 'Konts',
  'settings.GithubConnectionEditor.name.dcd1d522': 'Nosaukums',
  'settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0':
    'Šī savienojuma nosaukums neatkarīgi no konta, kas atklāts no tā pilnvaras.',
  'settings.GithubConnectionEditor.connection_name.686d4d5d': 'Savienojuma nosaukums',
  'settings.GithubConnectionEditor.server.aef7de28': 'Serveris',
  'settings.GithubConnectionEditor.empty_is_github_com_for.0f201123':
    'Tukšs ir github.com. Uzņēmumam izmantojiet pilnu adresi, ieskaitot jebkuru portu.',
  'settings.GithubConnectionEditor.github_com.3aeb0024': 'github.com',
  'settings.GithubConnectionEditor.token.d2089be6': 'Marķieris',
  'settings.GithubConnectionEditor.github_pat.94238580': 'github_pat_...',
  'settings.GithubConnectionEditor.forget_the_token.961a44b9': 'Aizmirstiet žetonu',
  'settings.GithubConnectionEditor.default_for_this_server.c7a4b365': 'Noklusējums šim serverim',
  'settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859':
    'Izmanto, ja neviena repozitorija īpašnieka preference neatlasa citu savienojumu.',
  'settings.GithubConnectionEditor.repository_owners.89c91e93': 'Krātuves īpašnieki',
  'settings.GithubConnectionEditor.one_per_line_sample_org.335517a9':
    'Viena katrā rindā: sample-org, sample-org/*, sample-* vai sample-org/project. Konkrētāki noteikumi uzvar.',
  'settings.GithubConnectionEditor.sample_org_nsample_org_project.9045ecd8':
    'sample-org\\nsample-org/project',
  'settings.GithubConnectionEditor.check_access.abb9a172': 'Pārbaudiet piekļuvi',
  'settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0':
    'Pārbauda tikai šo savienojumu. Atstājiet repozitoriju tukšu, lai atklātu kontu.',
  'settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009':
    'īpašnieks/repo vai GitHub saite',
  'settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799':
    'Sūtiet lasīšanas pieprasījumus ar šī melnraksta pilnvaru, to nesaglabājot',
  'settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327':
    'Cits savienojums izmanto to pašu kontu šajā serverī. Jūs joprojām varat to saglabāt.',
  'settings.GithubConnectionEditor.cancel.19766ed6': 'Atcelt',
  'settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff':
    'Atmetiet šo melnrakstu, nemainot iestatījumus vai atslēgu saišķi',
  'settings.GithubConnectionEditor.save.1509f561': 'Saglabāt',
  'settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364':
    'Saglabājiet šo savienojumu un tā pilnvaru, pēc tam aizveriet redaktoru',
  'settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6':
    'Saglabājot, marķieris tiks aizmirsts.',
  'settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e':
    'Šajā ierīcē tiek saglabāts marķieris. Ievadiet aizstājēju vai atstājiet tukšu, lai to saglabātu. Izmaiņas tiek saglabātas tikai ar Saglabāt.',
  'settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60':
    'Sinhronizētās atslēgas ir bloķētas; atbloķējiet tos, lai izmantotu marķieri, vai ievadiet jaunu.',
  'settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf':
    'Šajā ierīcē nav marķiera. Uzglabāts atslēgu saišķī tikai tad, kad saglabājat.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209':
    'Sniedziet īpašnieka/repo vai repozitorija saiti.',
  'settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d':
    'Šī repozitorija atrodas citā serverī. Tā vietā izvēlieties tā savienojumu.',
  'settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4':
    'Šī repozitorija atrodas citā servera adresē, shēmā vai portā. Izmantojiet šī savienojuma serveri.',
  'settings.GithubConnectionEditor.asking_github.5becc057': 'Jautā GitHub…',
  'settings.GithubConnectionEditor.the_access_check_failed.90fa9dca':
    'Piekļuves pārbaude neizdevās.',
  'settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c':
    'Atveriet GitHub, Forgejo un Gitea repozitorijus, problēmas, izmaiņu pieprasījumus, komitus un failus cilnēs, bet paziņojumus sānjoslā. Pieejamās darbības ir atkarīgas no pakalpojuma.',
  'settings.GithubSettings.open_github_links_in_obsidian.815b1959': 'Atvērt Git saites Obsidian',
  'settings.GithubSettings.a_click_on_a_supported.f005fa1f':
    'Atbalstīta repozitorija saite atveras cilnē. Citas saites un saites, uz kurām noklikšķina ar nospiestu Alt, atveras pārlūkā.',
  'settings.GithubSettings.default_repository.525a8366': 'Noklusējuma repozitorijs',
  'settings.GithubSettings.where_the_command_open_github.750aa580':
    'Kur komanda Open GitHub link or item meklē objektu, ja nav repozitorija cilnes konteksta. Norādiet owner/repo vai saiti; ja nosaukums nav viennozīmīgs, izvēlieties savienojumu.',
  'settings.GithubSettings.owner_repo.65e817ee': 'īpašnieks/repo',
  'settings.GithubSettings.pinned_repositories.03dccfeb': 'Piespraustas krātuves',
  'settings.GithubSettings.first_in_open_github_repository.067f8a9c':
    'Pirmie sarakstā Open GitHub repository…; tiek pārsūtīti kopā ar iestatījumiem. Piespraudiet repozitoriju šajā izvēlnē (Alt+Enter) vai repozitorija cilnes izvēlnē.',
  'settings.GithubSettings.nothing_pinned_yet.0b27e4d1': 'Vēl nekas nav piesprausts.',
  'settings.GithubSettings.unpin_this_repository.91038877': 'Atspraust šo krātuvi',
  'settings.GithubSettings.connections.dc273117': 'Savienojumi',
  'settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9':
    'Katram savienojumam ir savs pakalpojums, serveris un konts; izvēlieties noklusējuma savienojumu katram serverim. Pārlūkošanai izmantojiet tokenu ar repozitorija lasīšanas piekļuvi. GitHub paziņojumiem vajadzīgs klasiskais tokens ar notifications tiesībām.',
  'settings.GithubSettings.no_connections_public_github_com.534d40f4':
    'Nav savienojumu. Publiskās github.com krātuves tiek lasītas anonīmi.',
  'settings.GithubSettings.default.2a7e0b7b': ' · Noklusējums',
  'settings.GithubSettings.check.9d60841e': 'Pārbaudiet',
  'settings.GithubSettings.check_this_connection_s_account.64de4945':
    'Pārbaudiet šī savienojuma konta un repozitorija piekļuvi',
  'settings.GithubSettings.edit.464c4ffd': 'Rediģēt',
  'settings.GithubSettings.edit_this_connection_s_name.de8cb86e':
    'Rediģējiet šī savienojuma nosaukumu, servera, pilnvaras un īpašnieka preferences',
  'settings.GithubSettings.delete.e2d0a549': 'Dzēst',
  'settings.GithubSettings.remove_this_connection_after_confirmation.f3a7dd7f':
    'Pēc apstiprināšanas noņemiet šo savienojumu',
  'settings.GithubSettings.public_github_com_anonymous.c18bb859': 'Publisks github.com (anonīms)',
  'settings.GithubSettings.value_of_value_requests_remaining.037c7ebe':
    'Atlikušais pieprasījums: {value0} no {value1}{value2}',
  'settings.GithubSettings.quota_not_observed_yet_normally.b802706a':
    'Kvota vēl nav ievērota; parasti 60 pieprasījumi stundā tiek kopīgoti ar šo ierīci.',
  'settings.GithubSettings.add_connection.685f88ae': 'Pievienojiet savienojumu',
  'settings.GithubSettings.create_a_connection_with_its.a4245461':
    'Izveidojiet savienojumu ar savu atslēgu saišķa marķieri',
  'settings.GithubSettings.notifications.78801183': 'Paziņojumi',
  'settings.GithubSettings.a_fine_grained_personal_access.259d3619':
    'Precīza personiskās piekļuves pilnvara var nolasīt repozitorija saturu, taču GitHub nodrošina paziņojumus tikai klasiskajam pilnvaram ar paziņojumu tvērumu. Tālāk iestatiet paziņojumu pilnvaru saglabātajai vienai iesūtnei. Tas paliek saistīts ar serveri, kurā tas tika iestatīts.',
  'settings.GithubSettings.notifications_token.e314ce9b': 'Paziņojumu marķieris',
  'settings.GithubSettings.optional_a_classic_personal_access.0e7b2561':
    'Pēc izvēles. Klasisks personiskās piekļuves marķieris ar paziņojumu tvērumu, ko izmanto tikai paziņojumu panelis: GitHub neļauj sīkgraudainam pilnvaram lasīt paziņojumus. Tukšs: panelis izmanto noklusējuma savienojumu. Uzglabāts atslēgu saišķī.',
  'settings.GithubSettings.ghp.ff475c83': 'ghp_...',
  'settings.GithubSettings.forget_the_notifications_token.5f48625d':
    'Aizmirstiet paziņojumu marķieri',
  'settings.GithubSettings.pages.9046da16': 'Lapas',
  'settings.GithubSettings.how_a_github_tab_lays.f030133b':
    'Kā GitHub cilnē tiek parādīts, kas tajā tiek rādīts.',
  'settings.GithubSettings.page_width.217fbef1': 'Lapas platums',
  'settings.GithubSettings.how_wide_the_text_of.8d0e20a7':
    'Cik plašs ir cilnes teksts: sarunas, ziņojumu apstiprināšana, atveidotās atzīmes un mapju lapas. Atšķirības un kods vienmēr aizņem visu cilni.',
  'settings.GithubSettings.width_in_pixels.b3f8f713': 'Platums pikseļos',
  'settings.GithubSettings.from_value_to_value_a.87f8c5fb':
    'No {value0} līdz {value1}. Cilne, kas ir šaurāka par šo, izmanto to, kas tai ir.',
  'settings.GithubSettings.markdown_files_open_as.5541a0b8': 'Markdown faili tiek atvērti kā',
  'settings.GithubSettings.preview_rendered_and_a_link.7f27338b':
    'Priekšskatījums: tiek renderēts, un saite uz faila rindām atzīmē rindkopas, sarakstus vai kodu blokus, kuros tie ir. Kods: fails, kā tas ir uzrakstīts, rindiņu pa rindiņai. Slēdzis virs faila maina to šai cilnei.',
  'settings.GithubSettings.people.7db20897': 'Cilvēki',
  'settings.GithubSettings.who_wrote_an_issue_a.deb19dbb':
    'Kas uzrakstīja izdevumu, komentāru, atsauksmi vai apņemšanos ar savu attēlu. Vārdi un attēli tiek jautāti GitHub vienreiz un tiek glabāti šajā ierīcē nedēļu.',
  'settings.GithubSettings.show_people_by.989a820c': 'Parādīt cilvēkiem',
  'settings.GithubSettings.their_name_as_their_profile.2452b5a6':
    'Viņu vārds, kāds norādīts viņu profilā, vai viņu pieteikšanās. Otrs ir rīka padomos, un klikšķis vai pieskāriens personai maina abus turpat. Persona, kuras profilā nav vārda, tiek parādīta pēc pieteikšanās jebkurā gadījumā.',
  'settings.GithubSettings.kept_names_and_pictures.586c5b5f': 'Saglabāti vārdi un attēli',
  'settings.GithubSettings.clear.83b12c22': 'Notīrīt atlasi',
  'settings.GithubSettings.forget_every_kept_name_and.ddf1b164':
    'Aizmirstiet katru saglabāto vārdu un attēlu; tos atkal prasa, jo cilvēki tiek rādīti',
  'settings.GithubSettings.nothing_is_kept_yet.7287d9c8': 'Nekas vēl nav saglabāts',
  'settings.GithubSettings.code_search.ca5e7167': 'Kodu meklēšana',
  'settings.GithubSettings.search_the_code_of_the.1ce06300':
    'Meklējiet cilnē redzamās versijas kodu un cilnē atveriet definīciju. Šīs versijas repozitorijs tiek lejupielādēts vienu reizi sesijā un tiek meklēts šeit.',
  'settings.GithubSettings.largest_repository_to_download_mb.c4edc368':
    'Lielākā lejupielādējamā krātuve (MB)',
  'settings.GithubSettings.its_files_at_that_version.5d039cfc':
    'Failu kopējais izmērs šajā versijā. Lielākiem GitHub repozitorijiem izmanto servera meklēšanu noklusējuma zarā ar tokenu. Forgejo un Gitea ziņo par arhīva ierobežojumu.',
  'settings.GithubSettings.delete_github_connection.e4dfa050': 'Dzēst Git savienojumu',
  'settings.GithubSettings.delete_connection.e960651b': 'Dzēst savienojumu',
  'settings.GithubSettings.delete_value_its_local_token.b78722f1':
    'Vai dzēst {value0}? Tā vietējais marķieris tiks aizmirsts; citi savienojumi tiek saglabāti.',
  'settings.GithubSettings.remove_the_notifications_token_from.5b3f8312':
    'Vai noņemt paziņojumu pilnvaru no atslēgu saišķa? Paziņojumu panelis atgriežas pie galvenā marķiera.',
  'settings.GithubSettings.token_available_on_this_device.8141399a':
    'Token ir pieejams šajā ierīcē',
  'settings.GithubSettings.synced_keys_locked.1673153c': 'Sinhronizētās atslēgas ir bloķētas',
  'settings.GithubSettings.no_token_on_this_device.a87b4f4f': 'Šajā ierīcē nav marķiera',
  'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4':
    'Šī saikne mainījās citur. Aizveriet šo melnrakstu un rediģējiet tā pašreizējos iestatījumus.',
  'settings.GithubSettings.could_not_save_the_token.8edbb7d6':
    'Nevarēja saglabāt marķieri atslēgu saišķī. Nekas netika mainīts; mēģiniet vēlreiz.',
  'settings.GithubSettings.readable_line_width_like_notes.526184e3':
    'Lasāms līnijas platums, piemēram, piezīmes',
  'settings.GithubSettings.full_width.d34008d2': 'Pilns platums',
  'settings.GithubSettings.preview.324b134f': 'Priekšskatījums',
  'settings.GithubSettings.code.340f4630': 'Kods',
  'settings.GithubSettings.name.dcd1d522': 'Nosaukums',
  'settings.GithubSettings.login.9d6322c1': 'Pieteikties',
  'settings.GithubSettings.value_value_kept_on_this.ceefdd92': {
    zero: 'Šajā ierīcē saglabāto personu skaits: {count}. Notīriet sarakstu, lai vārdus un attēlus iegūtu no jauna, piemēram, ja kāds tos ir mainījis.',
    one: 'Šajā ierīcē saglabāta {count} persona. Notīriet sarakstu, lai vārdus un attēlus iegūtu no jauna, piemēram, ja kāds tos ir mainījis.',
    other:
      'Šajā ierīcē saglabātas {count} personas. Notīriet sarakstu, lai vārdus un attēlus iegūtu no jauna, piemēram, ja kāds tos ir mainījis.',
  },
  'settings.GithubSettings.none_kept_on_this_device.bfb58c42':
    'Neviens vēl nav saglabāts šajā ierīcē.',
  'settings.ImageModelEditModal.add_image_model.6b3a2d66': 'Pievienot attēla modeli',
  'settings.ImageModelEditModal.edit_image_model.ca72d086': 'Rediģēt attēla modeli',
  'settings.ImageModelEditModal.model_id.089ef2b6': 'Modeļa ID',
  'settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d':
    'API modeļa identifikators (piemēram, gpt-image-1, flux-pro).',
  'settings.ImageModelEditModal.e_g_gpt_image.c781dc87': 'piem. {literal0}',
  'settings.ImageModelEditModal.display_name.2b7f6a84': 'Parādāmais vārds',
  'settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Modeļa atlasītājā redzama izvēles etiķete.',
  'settings.ImageModelEditModal.e_g_gpt_image.5ae53afd': 'piem. {literal0}',
  'settings.ImageModelEditModal.size.1af85190': 'Izmērs',
  'settings.ImageModelEditModal.image_dimensions.1a4bb2f3': 'Attēla izmēri.',
  'settings.ImageModelEditModal.quality.1b2c08a8': 'Kvalitāte',
  'settings.ImageModelEditModal.output_format.93c53d37': 'Izvades formāts',
  'settings.ImageModelEditModal.delete_image_model.f28aaecc': 'Dzēst attēla modeli',
  'settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0':
    'Vai dzēst {value0}? Aģentiem, kas to izmanto, nebūs modeļa, kamēr tas nebūs pieejams\n        izvēlēts vēlreiz.',
  'settings.ImageModelEditModal.save.1509f561': 'Saglabāt',
  'settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Saglabājiet šos iestatījumus un aizveriet',
  'settings.ImageModelEditModal.delete.e2d0a549': 'Dzēst',
  'settings.ImageModelEditModal.remove_this_image_model_from.c139edec':
    'Noņemiet šo attēla modeli no nodrošinātāja',
  'settings.ImageModelEditModal.landscape.caa8642b': '1536 × 1024 (ainava)',
  'settings.ImageModelEditModal.portrait.29d9d2d0': '1024 × 1536 (portrets)',
  'settings.ImageModelEditModal.auto.02862497': 'Auto',
  'settings.ImageModelEditModal.low.f793de20': 'Zems',
  'settings.ImageModelEditModal.medium.8e588cd1': 'Vidēja',
  'settings.ImageModelEditModal.high.c4ebc6d4': 'Augsts',
  'settings.JournalsSettings.value_journal.cc8a4dd5': '{value0} žurnāls',
  'settings.JournalsSettings.journal_value.06b87038': 'Žurnāls #{value0}',
  'settings.JournalsSettings.remove_this_journal.c3a84c0a': 'Noņemiet šo žurnālu',
  'settings.JournalsSettings.default_journal.b54bf1fd': 'Noklusējuma žurnāls',
  'settings.JournalsSettings.journal_name.4a021433': 'Žurnāla nosaukums',
  'settings.JournalsSettings.journal_type_property_value_or.04441eaf':
    'Žurnāla tipa rekvizīta vērtība vai faila nosaukums RegExp',
  'settings.JournalsSettings.type_or_regexp.241a5ad0': 'Ierakstiet vai RegExp',
  'settings.JournalsSettings.date_property_name.8e90965d': 'Datuma īpašuma nosaukums',
  'settings.JournalsSettings.optional.59be7133': 'Pēc izvēles',
  'settings.JournalsSettings.new_journal_note_path_template.862462e1':
    'Jauna žurnāla piezīmes ceļa veidne',
  'settings.JournalsSettings.path_template.ec234daf': 'Ceļa veidne',
  'settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9':
    'Atkārtošanās perioda diena, kad tiek izveidota piezīme',
  'settings.JournalsSettings.optional_default_to_first.e58c831d':
    'Pēc izvēles. Pēc noklusējuma ir “pirmais”.',
  'settings.JournalsSettings.template_note_path.de4db36f': 'Veidnes piezīmes ceļš',
  'settings.JournalsSettings.journal_reccurence.8957b0f1': 'Žurnāla atkārtošanās',
  'settings.JournalsSettings.add_journal.f49ae75e': 'Pievienojiet žurnālu',
  'settings.JournalsSettings.add_another_journal.0d345224': 'Pievienojiet citu žurnālu',
  'settings.JournalsSettings.daily.b36c2611': 'Ikdienas',
  'settings.JournalsSettings.weekly.29751324': 'Iknedēļas',
  'settings.JournalsSettings.monthly.9b11f6b7': 'Ikmēneša',
  'settings.JournalsSettings.yearly.6e69b59e': 'Ik gadu',
  'settings.KeyDestinationsModal.review_key_destinations.2058c462': 'Pārskatīt atslēgu galamērķus',
  'settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597':
    'Izvēlieties atslēgu un adresātu. Apstiprinājums un HTTP atļauja ir vietēja šai ierīcei.',
  'settings.KeyDestinationsModal.saved_key.85ec79d9': 'Saglabāta atslēga',
  'settings.KeyDestinationsModal.recipient_address.454d0391': 'Saņēmēja adrese',
  'settings.KeyDestinationsModal.recipient_url.59ef2635': 'Adresāta URL',
  'settings.KeyDestinationsModal.new_key_name.0e18145f': 'Jauns atslēgas nosaukums',
  'settings.KeyDestinationsModal.new_key_value.7a7e9552': 'Jauna atslēgas vērtība',
  'settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477':
    'Aizsargāta uzglabāšana; tiek saglabāts tikai tad, kad apstiprināsit.',
  'settings.KeyDestinationsModal.key_permissions.1f24b6b7': 'Galvenās atļaujas',
  'settings.KeyDestinationsModal.let_value_be_sent_to.3057160b':
    'Ļaujiet {value0} nosūtīt uz {value1} no šīs ierīces',
  'settings.KeyDestinationsModal.remove_key_permission.60713985': 'Noņemiet atslēgas atļauju',
  'settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd':
    'Pārtraukt sūtīt {value0} uz {value1}; atslēga paliek saglabāta',
  'settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5':
    'Pakalpojumu galamērķi, lai apstiprinātu',
  'settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2':
    'Ļaujiet {value0} saņemt atslēgu no šīs ierīces {value1}',
  'settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3':
    'HTTP transports šajā ierīcē',
  'settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f':
    'Tikai nešifrēts transports; katrai atslēgai joprojām ir nepieciešama sava adresāta atļauja.',
  'settings.KeyDestinationsModal.remove_http_exception.ae72ff92': 'Noņemiet HTTP izņēmumu',
  'settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28':
    'Pārtraukt nešifrētas atslēgas pārsūtīšanu uz {value0}',
  'settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc': 'Atļaut atslēgu un adresi',
  'settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82':
    'Saglabāt šo atslēgas atļauju šajā ierīcē; tagad nekas nav nosūtīts',
  'settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d':
    ' — Nešifrēts: ikviens tīkla ceļā var nolasīt atslēgu.',
  'settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1':
    ' — Publiskais HTTP nevar saņemt atslēgas. Mainiet šo adresi uz HTTPS.',
  'settings.KeyDestinationsModal.choose_a_key.68bb8fb8': 'Izvēlieties atslēgu',
  'settings.KeyDestinationsModal.save_a_new_named_key.7982a2de':
    'Saglabāt jaunu ar nosaukumu atslēgu…',
  'settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb':
    ' Saglabājiet šo jauno atslēgu aizsargātā krātuvē.',
  'settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0':
    'Izvēlieties saglabāto atslēgu un ievadiet adresāta adresi.',
  'settings.KeyDestinationsModal.allowed_on_this_device.bac894b7': 'Atļauts šajā ierīcē',
  'settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda':
    'Nepieciešams apstiprinājums par šo ierīci',
  'settings.KeyDestinationsModal.allow_unencrypted_http.e905502b': 'Atļaut nešifrētu HTTP',
  'settings.KeyDestinationsModal.allow_on_this_device.a92ce243': 'Atļaut šajā ierīcē',
  'settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8':
    'Krātuves atslēgu nevar nosūtīt adresātam.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46':
    'Atļauts {value0} → {value1}. Mēģiniet vēlreiz ar sākotnējo skriptu; nekas netika nosūtīts automātiski.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642':
    'Atļauts {value0} → {value1}. Mēģiniet vēlreiz ar sākotnējo skriptu.',
  'settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad':
    'Noņemts {value0} → {value1}. Saglabātā atslēga un citas atļaujas paliek.',
  'settings.KeyDestinationsModal.confirmed_value_value.b96426a6':
    'Apstiprināts {value0} → {value1}.',
  'settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86':
    'HTTP izņēmums ir noņemts. Atslēgām nevar izmantot šo nešifrēto adresi.',
  'settings.LinksSettings.links_that_run_things.6849bb37': 'Saites, kas vada lietas',
  'settings.LinksSettings.each_one_is_an_obsidian.bcfd9260':
    'Katra no tām ir obsidian:// adrese, kas palaiž skriptu vai komandu, kad tā tiek atvērta — no grāmatzīmes, citas lietotnes vai saīsnes.',
  'settings.LinksSettings.untitled_link.be1c93df': 'Saite bez nosaukuma',
  'settings.LinksSettings.copy_the_link_s_address.331a3bd9': 'Kopējiet saites adresi',
  'settings.LinksSettings.change_this_link.f6aa89bf': 'Mainiet šo saiti',
  'settings.LinksSettings.add_another_link.a8b73866': 'Pievienojiet citu saiti',
  'settings.LinksSettings.no_links_yet.30d3e862': 'Vēl nav saišu',
  'settings.LinksSettings.a_name_for_the_address.f36bdc5a':
    'Adreses nosaukums un skripts vai komanda, ko tas palaiž.',
  'settings.LinksSettings.add_link.dfe9ca4d': 'Pievienot saiti',
  'settings.LinksSettings.add_a_link_and_set.5eb68448': 'Pievienojiet saiti un iestatiet to',
  'settings.LinksSettings.new_link.98ee0dfb': 'Jauna saite',
  'settings.LinksSettings.name.dcd1d522': 'Nosaukums',
  'settings.LinksSettings.the_part_of_the_address.2929fc21':
    'Adreses daļa aiz vārda=, ar vienkāršiem burtiem un defisēm.',
  'settings.LinksSettings.add_movie.2f79eca6': 'pievieno-filma',
  'settings.LinksSettings.runs.848f54e8': 'Skrien',
  'settings.LinksSettings.script.102acc10': 'Skripts',
  'settings.LinksSettings.choose_a_script.d8ff6dd0': 'Izvēlieties skriptu…',
  'settings.LinksSettings.search_the_scripts_for_the.e5119ad8':
    'Meklējiet skriptos to, kuru palaiž šī saite',
  'settings.LinksSettings.command.71316697': 'Pavēli',
  'settings.LinksSettings.search_the_commands_for_the.ebe2fa5b':
    'Meklējiet komandas, kuras palaiž šī saite',
  'settings.LinksSettings.wait_for_sync.8d3efbd1': 'Pagaidiet sinhronizāciju',
  'settings.LinksSettings.run_only_once_obsidian_sync.91ba259b':
    'Palaist tikai tad, kad Obsidian Sync ir atjauninājis krātuvi.',
  'settings.LinksSettings.address.56ef8f20': 'Adrese',
  'settings.LinksSettings.add_param_value_to_hand.2c89675e':
    'Pievienojiet &param=value, lai nodotu skriptam tā vērtības.',
  'settings.LinksSettings.delete.e2d0a549': 'Dzēst',
  'settings.LinksSettings.remove_this_link.d7173cb1': 'Noņemiet šo saiti',
  'settings.LinksSettings.done.11a6767d': 'Gatavs',
  'settings.LinksSettings.close_this_window_changes_are.91342d87':
    'Aizveriet šo logu; izmaiņas tiek saglabātas, tiklīdz tās veicat',
  'settings.LinksSettings.choose_a_command.58e501e1': 'Izvēlieties komandu…',
  'settings.LinksSettings.runs_the_script_value.c5e5c031': 'Palaiž skriptu {value0}',
  'settings.LinksSettings.runs_a_script_none_chosen.1b6f1723':
    'Palaiž skriptu — neviens vēl nav izvēlēts',
  'settings.LinksSettings.runs_the_command_value.c397fa11': 'Palaiž komandu {value0}',
  'settings.LinksSettings.runs_a_command_none_chosen.67edb64d':
    'Palaiž komandu — neviena vēl nav izvēlēta',
  'settings.LinksSettings.link_copied.d12860c2': 'Saite nokopēta',
  'settings.LintRuleModal.on.13001175': 'Ieslēgts',
  'settings.LintRuleModal.switched_off_the_rule_checks.db75c03b':
    'Izslēgts, kārtula neko nepārbauda.',
  'settings.LintRuleModal.how_bad.016a19df': 'Cik slikti',
  'settings.LintRuleModal.an_error_or_a_warning.ea93bb11':
    'Kļūda vai brīdinājums, kā parādīts sarakstā.',
  'settings.LintRuleModal.where_it_applies.39e44cbf': 'Kur tas attiecas',
  'settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53':
    'Palika tukša, visur. Saraksti ir atdalīti ar komatu.',
  'settings.LintRuleModal.only_in.aed9f516': 'Tikai iekšā',
  'settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac':
    'Mapes vai globusi, piemēram, Projects/*/Tasks.',
  'settings.LintRuleModal.everywhere.dcc10bfd': 'Visur',
  'settings.LintRuleModal.not_in.1bc8651b': 'Nav iekšā',
  'settings.LintRuleModal.folders_or_globs_left_alone.a5983464':
    'Mapes vai globusi, kas tajās atstāti vieni.',
  'settings.LintRuleModal.nowhere.7e32434d': 'Nekur',
  'settings.LintRuleModal.note_types.52d728fb': 'Piezīmju veidi',
  'settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66':
    'Tikai piezīmes, kuru veids ir viens no šiem.',
  'settings.LintRuleModal.any_type.b05fc1fe': 'Jebkura veida',
  'settings.LintRuleModal.having_a_property.07dd0569': 'Ir īpašums',
  'settings.LintRuleModal.only_notes_with_this_property.adbc72b9':
    'Tikai piezīmes ar šo īpašību — vienādas ar vērtību, kad tāda ir dota.',
  'settings.LintRuleModal.property.40040cb1': 'Īpašība',
  'settings.LintRuleModal.any_value.004f62d2': 'Jebkura vērtība',
  'settings.LintRuleModal.settings_of_the_rule.99e57b0c': 'Noteikuma iestatījumi',
  'settings.LintRuleModal.as_it_ships.be4ca4de': 'Kā tas tiek piegādāts',
  'settings.LintRuleModal.put_this_rule_back_the.6e2ebc57':
    'Ievietojiet šo noteikumu atpakaļ tādā veidā, kā spraudnis to nosūta',
  'settings.LintRuleModal.done.11a6767d': 'Gatavs',
  'settings.LintRuleModal.close_this_the_changes_are.459403b0':
    'Aizveriet šo; izmaiņas tiek saglabātas',
  'settings.LintRuleModal.error.54a0e8c1': 'Kļūda',
  'settings.LintRuleModal.warning.e981ddae': 'Brīdinājums',
  'settings.LinterSettings.the_linter_checks_notes_against.67baa82b':
    'Linter pārbauda piezīmju atbilstību tālāk norādītajiem noteikumiem — piezīmei pa vienam, mapei vai visai krātuvei — un savā cilnē uzskaita, kas tām neatbilst. Lielu daļu tur var salabot vienā piegājienā; pārējais atveras pie līnijas, lai salabotu ar roku.',
  'settings.LinterSettings.linter.99bede8d': 'Piezīmju pārbaude',
  'settings.LinterSettings.the_tab_with_what_the.e019607d':
    'Cilne ar pēdējās darbības laikā atrasto saturu.',
  'settings.LinterSettings.open_linter.72c54acd': 'Atvērt linteri',
  'settings.LinterSettings.close_the_settings_and_open.125786ff':
    'Aizveriet iestatījumus un atveriet lintera cilni',
  'settings.LinterSettings.folders_to_skip.ad324780': 'Mapes, kuras izlaist',
  'settings.LinterSettings.no_rule_looks_in_these.2a478951':
    'Tajos nav redzams neviens noteikums, ja vien piezīme vienā nav izvilkta pēc nosaukuma. Atdalīts ar komatu; mape vai globuss, piemēram, Archive/**.',
  'settings.LinterSettings.templates_attachments.2440bdba': 'Veidnes, Pielikumi',
  'settings.LinterSettings.rules.4228aeb0': 'Noteikumi',
  'settings.LinterSettings.each_can_be_switched_off.240786af':
    'Katru no tiem var izslēgt, pastāstīt, cik slikts ir atradums, paturēt dažus mapes vai piezīmju veidus un piešķirt savus iestatījumus.',
  'settings.LinterSettings.set_up_value.45578254': 'Iestatīt {value0}',
  'settings.LinterSettings.rules_of_your_own.f29b0461': 'Jūsu noteikumi',

  'settings.LinterSettings.no_script_rules_yet.37cf496e': 'Vēl nav skripta noteikumu.',
  'settings.LinterSettings.not_in_value.d95a4831': 'nav {value0}',
  'settings.LinterSettings.for_value_notes.670a9ee4': '{value0} piezīmēm',
  'settings.LinterSettings.is_set.c7d5e11f': ' ir iestatīts',
  'settings.LinterSettings.error.54a0e8c1': 'Kļūda',
  'settings.LinterSettings.warning.e981ddae': 'Brīdinājums',
  'settings.LogsSettings.logs_note_types.0793e6f2': 'Žurnāli piezīmju veidi',
  'settings.LogsSettings.optional_comma_separated_list_of.8730c2d2':
    'Neobligāts ar komatu atdalīts to piezīmju veidu saraksts, kas uzskatāmi par žurnāla piezīmēm.',
  'settings.LogsSettings.e_g_journal_log_daily.a54faefe': 'piem. {literal0}',
  'settings.ModelEditModal.add_model.7060e824': 'Pievienot modeli',
  'settings.ModelEditModal.edit_model.e76cc0ba': 'Rediģēt modeli',
  'settings.ModelEditModal.model_id.089ef2b6': 'Modeļa ID',
  'settings.ModelEditModal.api_model_identifier_e_g.5c0e2892':
    'API modeļa identifikators (piemēram, gpt-4o, claude-sonnet-4-20250514).',
  'settings.ModelEditModal.e_g_gpt_o.c6a41eb7': 'piem. {literal0}',
  'settings.ModelEditModal.display_name.2b7f6a84': 'Parādāmais vārds',
  'settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Modeļa atlasītājā redzama izvēles etiķete.',
  'settings.ModelEditModal.e_g_gpt_o.c9f23b2e': 'piem. {literal0}',
  'settings.ModelEditModal.context_window.7696d085': 'Konteksta logs',
  'settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14':
    'Maksimālais modeļa atbalstītais ievades marķieris.',
  'settings.ModelEditModal.max_output_tokens.397dda07': 'Maksimālais izvades marķieris',
  'settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9':
    'Maksimālais žetonu skaits vienā atbildē.',
  'settings.ModelEditModal.request_timeout_seconds.1b1b1d08': 'Pieprasīt taimautu (sekundēs)',
  'settings.ModelEditModal.wait_for_the_first_response.08adebcb':
    'Gaidiet pirmo atbildi vai nākamo daļu, nevis visu atbildi. 1–3600 sekundes; tukšs izmanto globālo taimautu. Attiecas uz tērzēšanu un fona darbu ar šo modeli.',
  'settings.ModelEditModal.global_timeout.542c2bf3': 'Globālais taimauts',
  'settings.ModelEditModal.reasoning.d8211e24': 'Spriešana',
  'settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996':
    'Iespējot spriešanu/domāšanu atbalstītajiem modeļiem.',
  'settings.ModelEditModal.thinking_effort.264c28cb': 'Domāšanas piepūle',
  'settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5':
    'Kontrolē, cik daudz argumentācijas modelis veic. Atstājiet pēc noklusējuma modeļa pašas uzvedības dēļ.',
  'settings.ModelEditModal.delete_model.b7828ba0': 'Dzēst modeli',
  'settings.ModelEditModal.delete_value_agents_using_it.c65217d0':
    'Vai dzēst {value0}? Aģentiem, kas to izmanto, nebūs modeļa, kamēr tas nebūs pieejams\n        izvēlēts vēlreiz.',
  'settings.ModelEditModal.save.1509f561': 'Saglabāt',
  'settings.ModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Saglabājiet šos iestatījumus un aizveriet',
  'settings.ModelEditModal.delete.e2d0a549': 'Dzēst',
  'settings.ModelEditModal.remove_this_model_from_the.2838dd4b':
    'Noņemiet šo modeli no pakalpojumu sniedzēja',
  'settings.ModelEditModal.enter_seconds_correct_this_value.508147a7':
    'Ievadiet 1–3600 sekundes. Pirms saglabāšanas labojiet šo vērtību.',
  'settings.OtherSettings.look.a0de5719': 'Skaties',
  'settings.OtherSettings.full_width_sidebars.bc7a2b4e': 'Pilna platuma sānjoslas',
  'settings.OtherSettings.make_sidebars_take_the_full.15d01abc':
    'Iestatiet, lai sānjoslas tālrunī aizņemtu pilnu ekrāna platumu.',
  'settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63':
    'Pusplatuma sānjoslas planšetdatorā',
  'settings.OtherSettings.make_sidebars_take_half_the.f915aa8e':
    'Iestatiet, ka sānu joslas aizņem pusi no planšetdatora ekrāna platuma.',
  'settings.OtherSettings.css_snippets_folder.0f718ada': 'CSS fragmentu mape',
  'settings.OtherSettings.vault_folder_with_css_files.063bfc1c':
    'Vault mape ar .css failiem, ko automātiski lietot kā stila fragmentus. Lai atspējotu, atstājiet tukšu.',
  'settings.OtherSettings.e_g_snippets.d1877812': 'piem. {literal0}',
  'settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19': 'Zīmējis Ābele notī',
  'settings.OtherSettings.each_one_in_place_of.7bc5aa3f': 'Katrs paša Obsidiāna zīmējuma vietā.',
  'settings.OtherSettings.own_drawing_of_properties.909062a8': 'Pašu īpašību rasējums',
  'settings.OtherSettings.in_a_note_s_properties.769ed541':
    'Piezīmes rekvizītos: maka atlikums blakus saitei uz to, skaitļu laukos izrakstītās summas un kartītes faila un faila rekvizītiem un vākam. Off ir paša Obsidiāna zīmējums.',
  'settings.OtherSettings.counter_properties.8ebc8e5b': 'Skaitītāja īpašības',
  'settings.OtherSettings.comma_separated_property_names_drawn.054f1654':
    'Ar komatu atdalīti rekvizītu nosaukumi, kas zīmēti kā skaitlis ar pogām – un +. Tukša vērtība tiek skaitīta kā 0. Nepieciešams savs rekvizītu zīmējums.',
  'settings.OtherSettings.e_g_reps_glasses.bcb26756': 'piem. {literal0}',
  'settings.OtherSettings.mermaid_viewer.0fee57c7': 'Zīmēt diagrammas',
  'settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa':
    'Zīmēt mermaid un pele blokus ar tālummaiņu, pārvietošanu un pilnekrāna skatu. Izslēdziet, lai rādītu pirmkodu.',
  'settings.OtherSettings.open_canvases_in_abele.0104f91b': 'Atvērtie audekli Ābelē',
  'settings.OtherSettings.open_diagrams_in_the_read.b48fc66f':
    'Atveriet diagrammas tikai lasāmā skatītājā, izmantojot detalizētas darbības. Izmantojiet Open in Obsidian Canvas tās galvenē, lai rediģētu diagrammu vietējā audeklā.',
  'settings.OtherSettings.editor_syntax_highlighting.9bbd35c2': 'Redaktora sintakses izcelšana',
  'settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd':
    'Izceliet vairāk norobežotu koda valodu avota un tiešā priekšskatījumā, izmantojot paša Obsidiāna motīvu. Vietējā izcelšana un renderētie bloki paliek nemainīgi. Papildu izcelšana ir ierobežota līdz blokiem ar 32 768 rakstzīmēm un 1000 rindiņām.',
  'settings.OtherSettings.opening_notes.d2eceee4': 'Sākuma piezīmes',
  'settings.OtherSettings.remember_where_notes_were_left.1010d0b2':
    'Atcerieties, kur tika atstātas piezīmes',
  'settings.OtherSettings.open_each_note_at_the.c4f04706':
    'Atveriet katru piezīmi pie ritināšanas un kursora, pie kuras tā tika atstāta un tika saglabāta šajā ierīcē. Saite uz virsrakstu vai bloku, meklēšanas rezultātu vai grāmatas izcēlumu joprojām nonāk savā vietā.',
  'settings.OtherSettings.maps.119e66d1': 'Kartes',
  'settings.OtherSettings.coordinates_property.afe852a5': 'Koordinē īpašumu',
  'settings.OtherSettings.note_property_holding_a_place.d3b2dd8b':
    'Atzīmējiet īpašumu, kas ieņem vietu kā "lat, lon". Aģentam tiek likts rakstīt šajā.',
  'settings.OtherSettings.coordinates.29abdbc9': 'koordinātas',
  'settings.OtherSettings.map_style.62a4d250': 'Kartes stils',
  'settings.OtherSettings.how_maps_in_notes_and.dc2e0608':
    'Kā izskatās kartes piezīmēs un tērzēšanas sarunās. Bezmaksas stiliem nav nepieciešama atslēga vai konts.',
  'settings.OtherSettings.style_url.221b2c65': 'Stila URL',
  'settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee':
    'Jūsu nodrošinātāja MapLibre style.json.',
  'settings.OtherSettings.the_plugin.cb8c07f4': 'Spraudnis',
  'settings.OtherSettings.changelog.ead07c84': 'Izmaiņu žurnāls',
  'settings.OtherSettings.see_what_changed_in_every.b28c48a6':
    'Skatiet, kas ir mainījies katrā spraudņa versijā, jaunākās vispirms.',
  'settings.OtherSettings.open_changelog.f8738613': 'Atvērt izmaiņu žurnālu',
  'settings.OtherSettings.open_the_plugin_changelog.f99c92b8': 'Atveriet spraudņa izmaiņu žurnālu',
  'settings.OtherSettings.keyboard_diagnostics.b559c4cd': 'Tastatūras diagnostika',
  'settings.OtherSettings.show_at_the_top_of.2cad0798':
    'Parādiet ekrāna augšdaļā, ko lietotne ziņo par ekrāna tastatūru — ekrānuzņēmumam, kad zem tās tiek parādīts dialoglodziņš. Paliek šajā ierīcē.',
  'settings.OtherSettings.date_properties.9201e6b8': 'Datuma rekvizīti',
  'settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640':
    'Ar komatu atdalīti rekvizītu nosaukumi, kas zīmēti kā datums ar pogām dienu atpakaļ un atpakaļ, cik tālu tas ir, un poga līdz tā ikdienas piezīmei. Nepieciešams savs rekvizītu zīmējums.',
  'settings.OtherSettings.priority_properties.21f4bae9': 'Prioritārie rekvizīti',
  'settings.OtherSettings.comma_separated_property_names_drawn.b31eb248':
    'Ar komatu atdalīti rekvizītu nosaukumi, kas zīmēti kā uzdevuma prioritāte — zema, vidēja vai augsta, ar pogām, lai to paceltu un pazeminātu. Nepieciešams savs rekvizītu zīmējums.',
  'settings.OtherSettings.label_properties.7ad8c49d': 'Etiķetes īpašības',
  'settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7':
    'Ar komatu atdalīti rekvizītu nosaukumi, kas zīmēti kā etiķetes, pievienoti no tiem, kas jau izmantoti krātuvē vai ierakstīti. Nepieciešams savs rekvizītu zīmējums.',
  'settings.OtherSettings.group_properties.23d1a496': 'Grupas rekvizīti',
  'settings.OtherSettings.comma_separated_property_names_that.cb39dad8':
    'Ar komatu atdalīti rekvizītu nosaukumi, kuriem blakus sarakstam ir poga, pievienojot vienu no piezīmēm, kas jau tiek izmantotas kā grupas. Saraksts joprojām tiek ierakstīts kā parasti. Nepieciešams savs rekvizītu zīmējums.',
  'settings.QuickButtonSettings.a_round_button_at_the.aa095d26':
    'Apaļa poga tālruņa ekrāna malā. Tas atver ātro darbību izvēlni visam, kas ir priekšā: jūsu darbības tālāk, piezīmes galvenes pogas un tas, ko tur piedāvā spraudnis — grāmatas meklēšana un izcēlumi, piezīmju taimeris un tērzēšana. Lasīšanas vai rakstīšanas laikā tas tiek novērsts. Velciet to, lai to pārvietotu; tas saglabā sānu un augstumu, kādā tas ir atstāts.',
  'settings.QuickButtonSettings.show_the_quick_button.65b455f7': 'Parādiet ātro pogu',
  'settings.QuickButtonSettings.on_a_phone_it_is.0737337d':
    'Telefonā. Tā ir koncepcija, tāpēc tā tiek izslēgta.',
  'settings.QuickButtonSettings.also_on_a_tablet.5f696152': 'Arī planšetdatorā',
  'settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d':
    'Parādiet to gan planšetdatorā, gan tālrunī.',
  'settings.QuickButtonSettings.side.630ef00b': 'Sānu',
  'settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46':
    'Ekrāna mala, kurā tas atrodas. Velkot to pāri, tas mainās.',
  'settings.QuickButtonSettings.height.bfe2eca4': 'Augstums',
  'settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1':
    'Velkot augstāk nekā tā atrodas, virs katra ekrāna apakšējās joslas.',
  'settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94':
    'Kur tas atrodas: tieši virs katra ekrāna apakšējās joslas.',
  'settings.QuickButtonSettings.put_it_back.55057d7e': 'Ielieciet to atpakaļ',
  'settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b':
    'Pārvietojiet to atpakaļ uz leju, kur tas atrodas',
  'settings.QuickButtonSettings.it_is_already_where_it.36b74557':
    'Tas jau ir tur, kur tas atpūšas; velciet to, lai to paceltu',
  'settings.QuickButtonSettings.your_actions.6c06c355': 'Jūsu darbības',
  'settings.QuickButtonSettings.at_the_top_of_the.b6848b73':
    'Izvēlnes augšdaļā, šādā secībā. Komanda parādās tikai tur, kur tā var darboties, tāpēc piezīmēm paredzētā komanda netiek piedāvāta virs grāmatas.',
  'settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002': 'Vēl nekas no sava.',
  'settings.QuickButtonSettings.name_in_the_menu.feca41eb': 'Vārds izvēlnē',
  'settings.QuickButtonSettings.choose_the_icon_it_has.e8357476':
    'Izvēlnē izvēlieties ikonu, kas tai ir',
  'settings.QuickButtonSettings.already_the_first.eab62d41': 'Jau pirmais',
  'settings.QuickButtonSettings.move_it_up_the_menu.20938d10': 'Pārvietojiet to uz augšu izvēlnē',
  'settings.QuickButtonSettings.already_the_last.a6ec4b12': 'Jau pēdējais',
  'settings.QuickButtonSettings.move_it_down_the_menu.dc508335': 'Pārvietojiet to uz leju izvēlnē',
  'settings.QuickButtonSettings.take_it_out_of_the.4a64934c': 'Izņemiet to no izvēlnes',
  'settings.QuickButtonSettings.add_a_command.b907f252': 'Pievienojiet komandu',
  'settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7':
    'Meklējiet Obsidian komandas — jebkuru spraudni —, lai to ievietotu izvēlnē',
  'settings.QuickButtonSettings.add_a_script.c4526bc4': 'Pievienojiet skriptu',
  'settings.QuickButtonSettings.search_your_scripts_for_one.df40b370':
    'Meklējiet skriptos, lai tos ievietotu izvēlnē',
  'settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a': 'Izņemiet no ēdienkartes',
  'settings.QuickButtonSettings.take_value_out_of_the.f628c5a3':
    'Vai izņemt {value0} no ātrās izvēlnes? Pati komanda vai skripts paliek.',
  'settings.QuickButtonSettings.right.883361d5': 'Pareizi',
  'settings.QuickButtonSettings.left.58eb9032': 'Pa kreisi',
  'settings.QuickButtonSettings.unnamed.e504e615': 'Bez nosaukuma',
  'settings.QuickButtonSettings.command_value.b7bcffe4': 'Komanda: {value0}',
  'settings.QuickButtonSettings.script_value.804f5354': 'Skripts: {value0}',
  'settings.ReaderSettings.epub_books_in_the_vault.7574b8de':
    'Glabā esošās EPUB grāmatas tiek atvērtas savā lasītāja cilnē, un to var izdarīt arī PDF faili. Šīs izvēles attiecas uz katru grāmatu, un tās var mainīt arī grāmatas cilnē, izmantojot pogu Aa.',
  'settings.SavedKeyRequestModal.send_saved_keys.618ddec9': 'Vai nosūtīt saglabātās atslēgas?',
  'settings.SavedKeyRequestModal.key.99a52df3': 'Atslēga',
  'settings.SavedKeyRequestModal.keys.f0d66a79': 'Atslēgas',
  'settings.SavedKeyRequestModal.sent_to.4e7201c7': 'Nosūtīts uz',

  'settings.SavedKeyRequestModal.cancel.19766ed6': 'Atcelt',
  'settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8':
    'Nesūtiet neko un atstājiet atļaujas tādas, kādas tās ir',
  'settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17': 'Atļaut adresi un nosūtīt',
  'settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3':
    'Atcerieties {value0} par šīm atslēgām šajā ierīcē un pēc tam nosūtiet pieprasījumu',
  'settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82':
    'Nevarēja saglabāt šo atslēgas atļauju, tāpēc nekas netika nosūtīts. Pārbaudiet galvenos galamērķus un mēģiniet vēlreiz.',
  'settings.ScriptsSettings.library.dc20b3d5': 'Bibliotēka',
  'settings.ScriptsSettings.every_script_in_the_folder.8e2a3585':
    'Katrs mapē esošais skripts un tā darbība',
  'settings.ScriptsSettings.selection_menus.22601a32': 'Izvēles izvēlnes',
  'settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4':
    'Neatkarīgi izvēlieties grāmatu un tērzēšanas skriptus',
  'settings.ScriptsSettings.header_buttons.1d80ae78': 'Virsraksta pogas',
  'settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e':
    'Pogas piezīmju galvenēs, kas izpilda skriptu',
  'settings.ScriptsSettings.automations.ad1fb9ec': 'Automatizācijas',
  'settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66':
    'Skripti, kas darbojas paši, kad uzdevums vai piezīme mainās',
  'settings.ScriptsSettings.startup.65d48235': 'Startēšana',
  'settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc':
    'Skripti, kas tiek palaisti katru reizi, kad tiek palaists Obsidian',
  'settings.ScriptsSettings.general.c910d474': 'Ģenerālis',
  'settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d':
    'Ieslēdziet skriptus un izvēlieties to mapi',
  'settings.ScriptsSettings.books.9da7f76b': 'Grāmatas',
  'settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97':
    'Skripti par grāmatā atlasītajiem vārdiem',
  'settings.ScriptsSettings.chats.ef5b4049': 'Tērzēšana',
  'settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b':
    'Skripti, kas izvēlēti tērzēšanā atlasītajiem vārdiem',
  'settings.SecretField.hide_the_key.46a22923': 'Paslēpt atslēgu',
  'settings.SecretField.show_the_key.90d90eb7': 'Parādiet atslēgu',
  'settings.SecretField.copy_the_key.30d7860a': 'Kopējiet atslēgu',
  'settings.SecretField.new_key.31ffdeb5': 'Jauna atslēga...',
  'settings.SecretField.save_key.b6e0aef2': 'Saglabāt atslēgu',
  'settings.SecretField.the_key.144976d8': 'Atslēga',
  'settings.SecretStoreSettings.synced_keys.a764d83d': 'Sinhronizētās atslēgas',
  'settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab':
    'Katra API atslēga un marķieris tiek glabāti vienā šifrētā krātuvē, kas tiek sinhronizēts ar spraudņa iestatījumiem. Katrai ierīcei ir nepieciešama tikai ieejas frāze, kas jāievada vienreiz. Bez tā krātuve nav lasāms nevienā ierīcē un jebkurā iestatījumu faila kopijā.',
  'settings.SecretStoreSettings.status.920e413c': 'Statuss',
  'settings.SecretStoreSettings.all_keys.9e5c5da4': 'Visas atslēgas',
  'settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da':
    'Katra atslēga, ko spraudnis izmanto šajā ierīcē: kam tas ir paredzēts, vai tas ir sinhronizēts, un veids, kā to parādīt vai kopēt.',
  'settings.SecretStoreSettings.show.0df6f1ca': 'Rādīt',
  'settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1':
    'Uzskaitiet visas šīs ierīces atslēgas',
  'settings.SecretStoreSettings.passphrase.e7611f05': 'Ieejas frāze',
  'settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e':
    'Vismaz 12 rakstzīmes. Ierakstīts katrā ierīcē, kurai vajadzētu būt atslēgām; nekas to nevar atgūt.',
  'settings.SecretStoreSettings.repeat_the_passphrase.4b93336c': 'Atkārtojiet ieejas frāzi',
  'settings.SecretStoreSettings.passphrase_again.47b97578': 'Atkal ieejas frāze',
  'settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573':
    'Atslēgas tiek pārvietotas uz krātuvi: {value0}',
  'settings.SecretStoreSettings.cancel.19766ed6': 'Atcelt',
  'settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492': 'Aizvērt bez izmaiņām',
  'settings.SecretStoreSettings.turn_on.5a1f096a': 'Ieslēgt',
  'settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24':
    'Šifrējiet šīs ierīces atslēgas krātuvē un sinhronizējiet tās',
  'settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910':
    'Pārvieto šīs ierīces atslēgas uz krātuvi zem jūsu izvēlētās ieejas frāzes.',
  'settings.SecretStoreSettings.set_up.4da10f1f': 'Iestatīt',
  'settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b':
    'Izvēlieties ieejas frāzi sinhronizētajām atslēgām',
  'settings.SecretStoreSettings.unlock_on_this_device.ec7699b7': 'Atbloķējiet šo ierīci',
  'settings.SecretStoreSettings.unlock.4ac709aa': 'Atbloķēt',
  'settings.SecretStoreSettings.open_the_store_here_and.879288fd':
    'Atveriet krātuvi šeit un ievietojiet tā atslēgas šīs ierīces atslēgu saišķī',
  'settings.SecretStoreSettings.new_passphrase.5cc14549': 'Jauna ieejas frāze',
  'settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e':
    'Katra otrā ierīce to pieprasa vienreiz, nākamreiz, kad iestatījumi to sasniegs.',
  'settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be':
    'Atkārtojiet jauno ieejas frāzi',
  'settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb': 'Atkal jauna ieejas frāze',
  'settings.SecretStoreSettings.change_the_passphrase.a9a3e51b': 'Mainiet ieejas frāzi',
  'settings.SecretStoreSettings.change.c0bf75bd': 'Mainīt',
  'settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af':
    'Vēlreiz šifrējiet krātuvi ar jauno ieejas frāzi',
  'settings.SecretStoreSettings.change_passphrase.a0ffb851': 'Mainiet ieejas frāzi',
  'settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29':
    'Atslēgas atkal tiek šifrētas. Citas ierīces turpina strādāt ar savām atslēgām un pieprasa jauno ieejas frāzi.',
  'settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286': 'Izvēlieties jaunu ieejas frāzi',
  'settings.SecretStoreSettings.remove_from_this_device.43b9a522': 'Noņemt no šīs ierīces',
  'settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0':
    'Ieejas frāze un katra atslēga krātuvē atstāj šo ierīci. Krātuve un citas ierīces tos glabā; vēlreiz atbloķējiet, lai tās atgūtu.',
  'settings.SecretStoreSettings.remove.c3812fc4': 'Noņemt',
  'settings.SecretStoreSettings.take_the_synced_keys_off.537f867f':
    'Noņemiet sinhronizētās atslēgas no šīs ierīces',
  'settings.SecretStoreSettings.turn_off.06f0e210': 'Izslēdziet',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0':
    'Krātuve atstāj iestatījumus. Katrai ierīcei, kas tika atbloķēta, atslēgas tiek glabātas savā atslēgu saišķī; jebkurai citai ierīcei tie būs jāievada ar roku.',
  'settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d':
    'Pārtrauciet atslēgu sinhronizāciju, saglabājot tās katrā ierīcē',
  'settings.SecretStoreSettings.start_over.5eed7e9f': 'Sāciet no jauna',
  'settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f':
    'Krātuve tiek noņemts no katras ierīces iestatījumiem, jaunai ierīcei ar jaunu ieejas frāzi. Šīs ierīces atslēgas paliek šeit.',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2':
    'No iestatījumiem noņemiet sinhronizētās atslēgas',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195':
    'Noņemiet sinhronizētās atslēgas no šīs ierīces',
  'settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae':
    'Krātuvē esošā ieejas frāze un {value0} atstāj šīs ierīces atslēgu saišķi. Funkcijas, kas tās izmanto, pārstāj darboties šeit, līdz tās atkal tiek atbloķētas.',
  'settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c': 'Izslēdziet sinhronizētās atslēgas',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814':
    'Krātuve atstāj iestatījumus katrā ierīcē. Ierīces, kas tika atbloķētas, saglabā atslēgas; jauna ierīce tos nesaņems.',
  'settings.SecretStoreSettings.the_store_is_removed_from.7d71216a':
    'Krātuve tiek noņemts no iestatījumiem visās ierīcēs, un tajā ir katra atslēga, kas nav neviena ierīcē. Šīs ierīces atslēgas paliek.',
  'settings.SecretStoreSettings.off.ca7981b4': 'Izslēgts',
  'settings.SecretStoreSettings.each_device_keeps_its_own.02c01692':
    'Katrai ierīcei ir savas atslēgas, kas ievadītas šajā ierīcē.',
  'settings.SecretStoreSettings.locked_on_this_device.e1223c06': 'Bloķēts šajā ierīcē',
  'settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954':
    'Citā ierīcē atslēgas glabājas krātuvē. Ievadiet tās ieejas frāzi, lai tie būtu arī šeit.',
  'settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4': 'Atbloķēts šajā ierīcē',
  'settings.SecretStoreSettings.out_of_date.c8f1506a': 'Novecojis',
  'settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603':
    'Ieejas frāze tika mainīta citā ierīcē. Šeit jau esošās atslēgas turpina darboties; ievadiet jauno ieejas frāzi, lai vēlreiz saņemtu izmaiņas.',
  'settings.SecretStoreSettings.damaged.3604e21d': 'Bojāts',
  'settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8':
    'Iestatījumu failā esošo krātuvi nevar atšifrēt, lai gan šai ierīcei ir pareizā ieejas frāze: failu mainīja kaut kas cits, nevis spraudnis. Šajā ierīcē jau esošās atslēgas turpina darboties.',
  'settings.SecretStoreSettings.value_in_the_store_a.02db016b':
    '{value0} krātuvē. Atslēga, kas pievienota vai mainīta jebkurā spraudņa vietā, tiek tajā ievietota un ar iestatījumiem sasniedz citas jūsu ierīces.',
  'settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8':
    'Šī ieejas frāze neatver krātuvi.',
  'settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983':
    'Jaunā ieejas frāze, kas iestatīta citā ierīcē.',
  'settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36':
    'Ieejas frāze, kas izvēlēta, kad tika ieslēgtas sinhronizētās atslēgas.',
  'settings.SecretStoreSettings.the_two_do_not_match.184006b7': 'Abi nesakrīt.',
  'settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6': 'Vismaz {value0} rakstzīmes.',
  'settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86':
    'Sinhronizētās atslēgas ir ieslēgtas: {value0} atslēgas krātuvē.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c':
    'Sinhronizētās atslēgas nevarēja ieslēgt',
  'settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b':
    'Atbloķēts: {value0} atslēgas šajā ierīcē.',
  'settings.SecretStoreSettings.the_store_could_not_be.be373a49': 'Krātuvi nevarēja atslēgt',
  'settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec':
    'Ieejas frāze ir mainīta. Citas ierīces to prasīs.',
  'settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1':
    'Ieejas frāzi nevarēja mainīt',
  'settings.SecretStoreSettings.the_keys_could_not_be.a70d217b':
    'No šīs ierīces nevarēja noņemt atslēgas',
  'settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f':
    'Sinhronizētās atslēgas nevarēja izslēgt',
  'settings.SecretStoreSettings.the_store_could_not_be.76043571': 'Krātuvi nevarēja izņemt',
  'settings.SecretsListModal.all_keys.9e5c5da4': 'Visas atslēgas',
  'settings.SecretsListModal.passphrase.e7611f05': 'Ieejas frāze',
  'settings.SecretsListModal.unlock.4ac709aa': 'Atbloķēt',
  'settings.SecretsListModal.open_the_store_here_and.6be7e00a':
    'Atveriet krātuvi šeit un uzskaitiet tā atslēgas',
  'settings.SecretsListModal.type_the_passphrase_first.397584ff':
    'Vispirms ierakstiet ieejas frāzi',
  'settings.SecretsListModal.the_synced_store_cannot_be.df30eba8':
    'Sinhronizēto krātuvi nevar atšifrēt, tāpēc tajā nevar iekļaut tikai tajā esošās atslēgas. Tālāk ir norādīti šīs ierīces atslēgas.',
  'settings.SecretsListModal.hide_the_key.46a22923': 'Paslēpt atslēgu',
  'settings.SecretsListModal.show_the_key.90d90eb7': 'Parādiet atslēgu',
  'settings.SecretsListModal.copy_the_key.30d7860a': 'Kopējiet atslēgu',
  'settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6':
    'Vēl nav atslēgu. Šeit ir norādīta atslēga, kas ievadīta jebkurā vietā spraudņa iestatījumos.',
  'settings.SecretsListModal.copy_all.96e3f09a': 'Kopēt visu',
  'settings.SecretsListModal.put_every_key_on_the.a26cf3c7':
    'Ievietojiet katru taustiņu starpliktuvē pēc brīdinājuma',
  'settings.SecretsListModal.no_key_is_set.f4f5b239': 'Nav iestatīta atslēga',
  'settings.SecretsListModal.copy_every_key.2f918de3': 'Kopējiet katru atslēgu',
  'settings.SecretsListModal.on_this_device.38b9d88c': 'Šajā ierīcē',
  'settings.SecretsListModal.synced.5da22fe4': 'Sinhronizēts',
  'settings.SecretsListModal.differs_from_keychain.922767e7': 'Atšķiras no atslēgu saišķa',
  'settings.SecretsListModal.only_in_the_store.9bb2ce40': 'Tikai krātuvē',
  'settings.SecretsListModal.not_in_the_store.507fd6ce': 'Nevis krātuvē',
  'settings.SecretsListModal.store_locked.d47ee0fe': 'Krātuve aizslēgts',
  'settings.SecretsListModal.not_set.4895f731': 'Nav iestatīts',
  'settings.SecretsListModal.this_device_s_keychain_holds.1b27e956':
    'Šīs ierīces atslēgu piekariņam ir cita vērtība, kas mainīta ārpus spraudņa. Krātuves vērtība ir izmantotā vērtība.',
  'settings.SecretsListModal.in_the_store_but_not.5e27c94a':
    'Krātuvē, bet ne šīs ierīces atslēgu saišķī. Spraudnis joprojām to izmanto.',
  'settings.SecretsListModal.set_on_this_device_and.db43f1dd':
    'Iestatiet šajā ierīcē, nevis krātuvē. Iestatiet to vēlreiz, lai ievietotu to tur.',
  'settings.SecretsListModal.not_used_by_any_setting.85faf2ac':
    'Netiek izmantots neviens šīs ierīces iestatījums',
  'settings.SecretsListModal.updated_value.51194723': 'Atjaunināts {value0}',
  'settings.SecretsListModal.every_key_that_is_set.19a2b157':
    'Katra iestatītā atslēga kā nosaukuma rindas = vērtība — paroļu pārvaldniekam vai ielīmēšanai citā lietotnē.',
  'settings.SecretsListModal.every_key_listed_here_value.a6aac65e':
    'Katra šeit norādītā atslēga — {value0} no tām — tiek ievietota starpliktuvē kā vienkāršs teksts, kur to var nolasīt jebkura šīs ierīces lietotne. ',
  'settings.SecretsListModal.it_is_cleared_from_the.06480e6f':
    'Tas tiek notīrīts no starpliktuves minūtes laikā, ja tas joprojām ir tur.',
  'settings.SecretsListModal.on_this_device_it_stays.57af8178':
    'Šajā ierīcē tas paliek tur, līdz tiek kopēts kaut kas cits.',
  'settings.SecretsListModal.synced_keys_are_out_of.408b671b':
    'Sinhronizētās atslēgas šeit ir novecojušas',
  'settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24':
    'Sinhronizētās atslēgas šajā ierīcē ir bloķētas',
  'settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8':
    'Šī ieejas frāze neatver krātuvi.',
  'settings.SecretsListModal.the_store_may_hold_keys.5b2f6105':
    'Krātuvē var būt atslēgas, kuru šai ierīcei nav. Arī viņu vārdi ir šifrēti, tāpēc tie tiek parādīti sarakstā, tiklīdz tas ir atbloķēts.',
  'settings.SecretsListModal.the_store_could_not_be.bafdcd54': 'Krātuvi nevarēja atslēgt.',
  'settings.SyncSettings.waiting_for_you.9f760ab2': 'Gaida tevi',
  'settings.SyncSettings.code_that_came_from_another.89b6b46f':
    'Kods, kas nāca no citas ierīces, un privāti faili, uz kuriem ir saistīta koplietotā piezīme.',

  'settings.SyncSettings.view_the_exact_incoming_version.6497a546':
    'Skatiet precīzu ienākošo versiju',

  'settings.SyncSettings.allow_or_deny_this_file.5d819259':
    'Atļaut vai aizliegt šo failu šim savienojumam',
  'settings.SyncSettings.connections.dc273117': 'Savienojumi',
  'settings.SyncSettings.each_connection_works_on_its.4a88585e':
    'Katrs savienojums darbojas atsevišķi. Atvienojot, visi faili tiks saglabāti šajā ierīcē.',
  'settings.SyncSettings.no_connections_yet.8697571e': 'Pagaidām nav savienojumu',
  'settings.SyncSettings.paste_a_token_or_scan.257b9a79':
    'Lai izveidotu savienojumu, ielīmējiet marķieri vai skenējiet QR kodu.',
  'settings.SyncSettings.sync_this_connection_now.52cd5ea4': 'Sinhronizējiet šo savienojumu tūlīt',
  'settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85':
    'Pārtraukt, kopīgot, izdzēstos failus, atvienot',
  'settings.SyncSettings.connect_to_a_server.232ac7de': 'Izveidojiet savienojumu ar serveri',
  'settings.SyncSettings.by_a_token_you_were.d2dab8e7':
    'Ar žetonu jums tika piešķirts, ielīmēts vai skenēts.',
  'settings.SyncSettings.connect.c0e20f6d': 'Savienot…',
  'settings.SyncSettings.paste_a_token_for_a.256b8463':
    'Ielīmējiet servera, mapes vai grupas marķieri',
  'settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6':
    'Tiek atvērta failu apmaiņa. Savienojumi, kuriem jāpievērš uzmanība, savus failus glabā šeit.',
  'settings.SyncSettings.sync_is_opening_if_it.1225ed54':
    'Tiek atvērta sinhronizācija. Ja to nevar atvērt, restartējiet Obsidian un mēģiniet vēlreiz.',
  'settings.SyncSettings.the_whole_vault.0a409543': 'visa velve',
  'settings.SyncSettings.deleted_value_from_the_server.70376e92':
    'Izdzēsts no servera {value0}. Tās faili paliek šajā ierīcē.',
  'settings.SyncSettings.keep_syncing_into_the_same.12873e9a':
    'Turpiniet sinhronizāciju tajā pašā vietējā mapē',
  'settings.SyncSettings.follow_moved_folder.bba3cc92': 'Sekojiet pārvietotajai mapei',
  'settings.SyncSettings.restore_from_the_server.6186b8b7': 'Atjaunot no servera',
  'settings.SyncSettings.resume.d640c742': 'Atsākt',
  'settings.SyncSettings.pause.858e4ba7': 'Pauze',
  'settings.SyncSettings.share.51fc2d24': 'Kopīgot…',
  'settings.SyncSettings.deleted_files.5352e2e9': 'Dzēsti faili',
  'settings.SyncSettings.what_this_device_syncs.979d00ce': 'Ko šī ierīce sinhronizē',
  'settings.SyncSettings.disconnect.f1142965': 'Atvienot…',
  'settings.SyncSettings.delete_from_the_server.b3acd04d': 'Dzēst no servera…',
  'settings.SyncSettings.delete_from_the_server_read.5f7e4370': 'Dzēst no servera: tikai lasāms',
  'settings.SyncSettings.delete_from_the_server_unavailable.516a170e':
    'Dzēst no servera: nav pieejams; pārbaudiet servera savienojumu un versiju',
  'settings.SyncSettings.the_file_could_not_be.accad798':
    'Failu nevarēja atvērt. Tās saturs ir saglabāts. Mēģiniet vēlreiz, kad serveris būs pieejams.',
  'settings.SyncSettings.incoming_changes_could_not_be.24745c6e':
    'Ienākošās izmaiņas nevarēja atvērt. Atkārtoti atveriet sinhronizācijas iestatījumus, lai mēģinātu vēlreiz.',
  'settings.TaskLabelsSettings.labels.934b8899': 'Etiķetes',
  'settings.TaskLabelsSettings.labels_are_read_from_a.310aa3b6':
    'Etiķetes tiek nolasītas no uzdevuma rekvizīta, vienas vērtības vai to saraksta. Katrai etiķetei var būt krāsa; pārējās ir pelēkas.',
  'settings.TaskLabelsSettings.label_property.2b08cac9': 'Etiķetes īpašums',
  'settings.TaskLabelsSettings.the_task_property_labels_are.5b8a2eb7':
    'Uzdevuma rekvizītu etiķetes tiek lasītas no (noklusējuma: "iezīmes").',
  'settings.TaskLabelsSettings.priority_property.1588ceb0': 'Prioritārais īpašums',
  'settings.TaskLabelsSettings.the_task_property_priority_is.19d87f4b':
    'Uzdevuma rekvizīta prioritāte tiek nolasīta un rakstīta (noklusējums: "prioritāte"). Nemaina to, kuriem rekvizītiem ir logrīki.',
  'settings.TaskLabelsSettings.priority.3092a5f0': 'prioritāte',
  'settings.TaskLabelsSettings.add_a_label.43db67d6': 'Pievienojiet etiķeti',
  'settings.TaskLabelsSettings.to_colour_a_label_before.7f8888f5':
    'Lai nokrāsotu etiķeti, pirms to veic kāds uzdevums.',
  'settings.TaskLabelsSettings.label.0e66373f': 'Etiķete',
  'settings.TaskLabelsSettings.add.9fd728c6': 'Pievienot',
  'settings.TaskLabelsSettings.add_this_label_to_the.b2c3c5b9': 'Pievienojiet šo etiķeti sarakstam',
  'settings.TasksSettings.tasks_folder.9c703cd1': 'Uzdevumu mape',
  'settings.TasksSettings.optional_folder_path_to_store.68deedd3':
    'Neobligāts ceļš uz uzdevumu failu mapi (noklusējums: "Tasks").',
  'settings.TasksSettings.enter_tasks_folder_path.685fec4a': 'Ievadiet uzdevumu mapes ceļu',
  'settings.TasksSettings.tasks_time_choices.97d2bb52': 'Uzdevumu laika izvēle',
  'settings.TasksSettings.optional_comma_separated_list_of.352a5929':
    'Neobligāts ar komatiem atdalīts uzdevumu laika variantu saraksts (piemēram, "09:00,12:00,18:00").',
  'settings.TasksSettings.e_g.4c04e29e': 'piem. {literal0}',
  'settings.TasksSettings.tasks_date_choices.56987dbf': 'Uzdevumu datuma izvēle',
  'settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e':
    'Neobligāts ar komatiem atdalīts uzdevumu datumu variantu saraksts (piemēram, "Today,Tomorrow,Next Week").',
  'settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0': 'piem. {literal0}',
  'settings.TasksSettings.tasks_recurrence_choices.5933e491': 'Uzdevumu atkārtošanās izvēles',
  'settings.TasksSettings.optional_comma_separated_list_of.f364b641':
    'Neobligāts ar komatiem atdalīts uzdevumu atkārtošanās variantu saraksts (piemēram, "Daily,Weekly,Monthly").',
  'settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3': 'piem. {literal0}',
  'settings.TasksSettings.busy_day_threshold.ebd745bf': 'Noslogotas dienas slieksnis',
  'settings.TasksSettings.number_of_tasks_in_a.def227ff':
    'Uzdevumu skaits dienā, lai to uzskatītu par "saņemtu dienu".',
  'settings.TasksSettings.e_g.8c2fb766': 'piem. {literal0}',
  'settings.TasksSettings.week_starts_on_monday.1e6c3ee3': 'Nedēļa sākas pirmdien',
  'settings.TasksSettings.set_the_first_day_of.0426b53c':
    'Datuma aprēķiniem iestatiet nedēļas pirmo dienu.',
  'settings.TasksSettings.birth_date.5164b245': 'Dzimšanas datums',
  'settings.TasksSettings.where_the_life_layout_of.291ea708':
    'Kur kalendāra bāzes Life izkārtojums sāk skaitīt jūsu nedēļas. Izmanto katra bāze.',
  'settings.TasksSettings.life_expectancy.da8e9e4d': 'Dzīves ilgums',
  'settings.TasksSettings.the_years_the_life_layout.4cd598a4':
    'Gadi, kurus zīmē Life izkārtojums. Kalendāra bāze var pieprasīt savu skata opcijās.',
  'settings.TimeTrackingSettings.time_entry_path_template.b06163ff': 'Laika ievades ceļa veidne',
  'settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8':
    'Veidne jauniem laika ievades faila ceļiem. Mainīgie: {literal0}, {literal1}, {literal2}, {literalDate}.',
  'settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce': 'piem. {literal2}',
  'settings.TimeTrackingSettings.trackable_note_types.4b331926': 'Izsekojamie piezīmju veidi',
  'settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd':
    'Ar komatu atdalītu piezīmju veidi, kuru galvenē tiek rādīta taimera poga (piemēram, uzdevums, projekts).',
  'settings.TimeTrackingSettings.e_g_task.1c985447': 'piem. {literal0}',
  'settings.TimeTrackingSettings.track_all_notes.41a2243c': 'Izsekojiet visas piezīmes',
  'settings.TimeTrackingSettings.show_the_timer_button_in.983d0303':
    'Rādīt taimera pogu galvenē visām piezīmēm neatkarīgi no veida.',
  'settings.TransferSettings.send_to_another_device.71ef2876': 'Sūtīt uz citu ierīci',
  'settings.TransferSettings.tick_what_should_travel_what.be4e856b':
    'Atzīmējiet, ko vajadzētu ceļot. Izvēlētais var tikt izmantots kā QR kods, kā ielīmējams teksts vai kā nosūtāms fails.',
  'settings.TransferSettings.include_keys.f7508fd4': 'Iekļauts atslēgas',
  'settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9':
    'API atslēgas pārvietojas ar visu nepieciešamo. Pārsūtīšana ar atslēgu tiek bloķēta aiz vienreizēja koda, kas tiek parādīts šeit un ierakstīts otrā ierīcē.',
  'settings.TransferSettings.what_to_send.bceb988a': 'Ko sūtīt',
  'settings.TransferSettings.clear.83b12c22': 'Notīrīt atlasi',
  'settings.TransferSettings.select_all.1fc9a387': 'Atlasīt visu',
  'settings.TransferSettings.send_nothing.1bc92d8a': 'Neko nesūtīt',
  'settings.TransferSettings.send_everything_listed_here.f1ac2a00': 'Nosūtiet visu šeit norādīto',
  'settings.TransferSettings.send_everything_under_value.1db19fa3': 'Sūtīt visu zem {value0}',
  'settings.TransferSettings.send_value.c229d699': 'Sūtīt {value0}',
  'settings.TransferSettings.carries_a_key.0d090cb4': 'Nēsā ​​atslēgu',
  'settings.TransferSettings.send_all_of_the_value.f01a8818': 'Sūtīt visu {value0}',
  'settings.TransferSettings.nothing_here_can_be_transferred.49a46df4':
    'Šeit vēl neko nevar pārsūtīt.',
  'settings.TransferSettings.preview.324b134f': 'Priekšskatījums',
  'settings.TransferSettings.see_exactly_what_would_be.5a694fa9':
    'Skatiet tieši to, kas tiks nosūtīts',
  'settings.TransferSettings.choose_something_to_send_first.5fde4c03':
    'Izvēlieties kaut ko, ko nosūtīt vispirms',
  'settings.TransferSettings.send.f6f4688f': 'Sūtīt',
  'settings.TransferSettings.hand_what_you_chose_to.f4aa3506': 'Nododiet izvēlēto citai ierīcei',
  'settings.TransferSettings.receive_from_another_device.955f97bb': 'Saņemt no citas ierīces',
  'settings.TransferSettings.read_the_codes_the_other.7d52f77b':
    'Izlasiet kodus, ko rāda otra ierīce. Nekas nav rakstīts, kamēr neesat redzējis, kas ir atnācis.',
  'settings.TransferSettings.read_a_transfer.da2dcc0f': 'Nolasīt pārsūtījumu',
  'settings.TransferSettings.camera_a_photo_of_the.d9996865':
    'Kamera, koda fotoattēls, fails vai pats teksts.',
  'settings.TransferSettings.scan.ea1c510d': 'Skenēt',
  'settings.TransferSettings.read_a_transfer_from_another.60d1c2f6':
    'Nolasīt pārsūtījumu no citas ierīces',
  'settings.TransferSettings.notes.8a7525b1': 'Piezīmes',
  'settings.TransferSettings.money_and_time.ebb5a49d': 'Nauda un laiks',
  'settings.TransferSettings.agents.279b44d2': 'Aģenti',
  'settings.TransferSettings.buttons.d452583a': 'Pogas',
  'settings.TransferSettings.data.cec3a9b8': 'Dati',
  'settings.TransferSettings.nothing_selected_yet.d6f9822a': 'Vēl nekas nav atlasīts.',
  'settings.TransferSettings.fits_in_one_code.324a2a38': 'Ietilpst vienā kodā.',
  'settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4':
    'Paņem {value0} kodus, kas tiek rādīti viens pēc otra.',
  'settings.TransferSettings.takes_value_codes_too_many.304d8234':
    'Tiek izmantoti {value0} kodi — pārāk daudz, lai tos nofotografētu, tāpēc tas tiks izmantots kā teksts vai fails.',
  'settings.TransferSettings.applied_value.d4ffb612': 'Lietota {value0}.',
  'settings.TransferSettings.value_could_not_be_stored.cf4fe457':
    'Nevarēja saglabāt vērtību {value0} — nosaukums, ko šī krātuve tai izmanto, ir viens Obsidiāns.',
  'settings.TransferSettings.value_could_not_be_written.93eaa96e':
    'Nevarēja uzrakstīt vērtību {value0}.',
  'settings.ai.AgentEditorModal.agent_value.c67844d1': 'Aģents: {value0}',
  'settings.ai.AgentEditorModal.agent.11b39c93': 'Aģents',
  'settings.ai.AgentEditorModal.name.dcd1d522': 'Nosaukums',
  'settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51': 'Parādīts aģenta atlasītājā.',
  'settings.ai.AgentEditorModal.description.526e0087': 'Apraksts',
  'settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342':
    'Stāsta citiem aģentiem, kam šis ir paredzēts.',
  'settings.ai.AgentEditorModal.utility_agent.e8384fe8': 'Komunālais aģents',
  'settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc':
    'Paslēpts no tērzēšanas atlasītāja. Joprojām pieejams skriptiem, deleģēšanai un melnrakstiem\n              pārskats.',
  'settings.ai.AgentEditorModal.model.5e2c614c': 'Modelis',
  'settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab':
    'Modelis, kurā darbojas šis aģents.',
  'settings.ai.AgentEditorModal.fallback_model.ed293bb6': 'Atkāpšanās modelis',
  'settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0':
    'Tiek piedāvāts kā atkārtots mēģinājums, ja pieprasījums neizdodas. Tiek automātiski izmantots deleģētajos braucienos,\n              kur neviens nevar nospiest pogu.',
  'settings.ai.AgentEditorModal.background_model.905a0833': 'Fona modelis',
  'settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428':
    'Šī aģenta tērzēšanas sarunu nosaukšanai un sablīvēšanai. Atiestatīts, spraudņa mēroga fons\n              Modeļa iestatījums nosaka — un arī tur to atiestata pats tērzēšanas modelis.',
  'settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a':
    'Viņi lasa šī aģenta tērzēšanas sarunas šādā secībā, katrs ņemot vērā iepriekšējo\n              atgriezts: jūsu ziņojumi pirms aģenta, tā atbildes, pirms tie paliek, vai\n              gan. Aģents saka, ko domā; skripts izlemj. Tērzēšana var saglabāt savu sarakstu.',
  'settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9':
    'Bloki tiek savienoti secībā, starp tiem atstājot tukšu līniju. Izmantojiet {value0} šodienas datumam.',
  'settings.ai.AgentEditorModal.block_value.dd05ec6a': 'Bloķēt {value0}',
  'settings.ai.AgentEditorModal.move_up.c66feb5e': 'Pārvietojieties uz augšu',
  'settings.ai.AgentEditorModal.move_down.40bb50da': 'Pārvietojieties uz leju',
  'settings.ai.AgentEditorModal.remove.c3812fc4': 'Noņemt',
  'settings.ai.AgentEditorModal.path_to_note.ef6763e6': 'Piezīmes ceļš...',
  'settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2': 'Norādījumi šim aģentam...',
  'settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4':
    'Nav uzvedņu bloku. Šis aģents darbojas bez saviem norādījumiem.',
  'settings.ai.AgentEditorModal.add_text_block.4b0903f4': 'Pievienojiet teksta bloku',
  'settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8':
    'Pievienojiet šeit rakstīto instrukciju bloku',
  'settings.ai.AgentEditorModal.add_note_block.34512584': 'Pievienojiet piezīmju bloku',
  'settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7':
    'Pievienojiet bloku, kas nolasīts no piezīmes krātuvē',
  'settings.ai.AgentEditorModal.permission_mode.c7a8e6db': 'Atļauju režīms',
  'settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c':
    'Ko šis aģents var darīt, neprasot.',
  'settings.ai.AgentEditorModal.github_connections.e95944e1': 'GitHub savienojumi',
  'settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61':
    'Izslēgts: nav piekļuves. Jautāt: apstipriniet katru darbību interaktīvā tērzēšanā. Ieslēgts: izmantojiet bez prasīšanas. Katrā serverī sākas jauni savienojumi. Šīs izvēles neiespējo izslēgšanas rīku.',
  'settings.ai.AgentEditorModal.github_com.3aeb0024': 'github.com',
  'settings.ai.AgentEditorModal.unavailable_connection_value.795252e1':
    'Nav pieejams savienojums: {value0}',
  'settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef':
    'Šis aģents attiecas uz savienojumu, kas nav pieejams šajā ierīcē. Pārsūtiet savienojumu vai atstājiet to izslēgtu.',
  'settings.ai.AgentEditorModal.scope.b073f6c6': 'Tvērums',
  'settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74':
    'Kur šis aģents darbojas pēc noklusējuma. Deleģēts skrējiens arī saņem jebkuru tērzēšanu\n              bija atvērts.',
  'settings.ai.AgentEditorModal.tools.ea93d6a2': 'Rīki',
  'settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983':
    'Izslēgts = nav pieejams. Jautāt = nepieciešams apstiprinājums. Auto = darbojas atsevišķi. Failu rīki ir\n              vienmēr pieejams un to regulē iepriekš minētais atļaujas režīms.',
  'settings.ai.AgentEditorModal.offer_tools.677c3882': 'Piedāvājiet rīkus',
  'settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7':
    'Pēc sadaļas: aģents katrā sadaļā redz vienu ierakstu ar to, kam tas ir paredzēts, un atver sadaļu, kad tas ir nepieciešams. Viss uzreiz: katrs iespējotais rīks tiek piedāvāts no paša sākuma.',
  'settings.ai.AgentEditorModal.skills.66d0f523': 'Prasmes',
  'settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3':
    'Kādas prasmes šis aģents var ielādēt pēc pieprasījuma.',

  'settings.ai.AgentEditorModal.delegation_depth.29ea0156': 'Deleģēšanas dziļums',
  'settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e':
    'Cik tālu šis aģents var deleģēt. 0 pilnībā noņem delegācijas rīku.',
  'settings.ai.AgentEditorModal.basic.0e35f6e9': 'Pamata',
  'settings.ai.AgentEditorModal.prompts.5f2e66e6': 'Uzvednes',
  'settings.ai.AgentEditorModal.memory.c3963aed': 'Atmiņa',
  'settings.ai.AgentEditorModal.access.ec5ba0ab': 'Piekļuve',
  'settings.ai.AgentEditorModal.delegation.a6d910ba': 'Delegācija',
  'settings.ai.AgentEditorModal.text.71988c4d': 'Teksts',
  'settings.ai.AgentEditorModal.note.d8da2c49': 'Piezīme',
  'settings.ai.AgentEditorModal.all_skills.78abcbbf': 'Visas prasmes',
  'settings.ai.AgentEditorModal.no_skills.5083cd4b': 'Nav prasmju',
  'settings.ai.AgentEditorModal.only_selected.c1792bfe': 'Tikai atlasīts',
  'settings.ai.AgentEditorModal.cannot_delegate.6a16ca61': 'Nevar deleģēt',
  'settings.ai.AgentEditorModal.level.3292ae98': '1 līmenis',
  'settings.ai.AgentEditorModal.levels.8b7cdd29': '2 līmeņi',
  'settings.ai.AgentEditorModal.levels.93b1554a': '3 līmeņi',
  'settings.ai.AgentEditorModal.off.ca7981b4': 'Izslēgts',
  'settings.ai.AgentEditorModal.ask.b8c209cd': 'Jautāt',
  'settings.ai.AgentEditorModal.on.13001175': 'Ieslēgts',
  'settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c':
    'Ko šim aģentam lūdza atcerēties. Tikai šis aģents to redz: tas tiek pievienots tam\n      sistēmas uzvedne, kas noteikta atmiņas veidnē vispārējos AI iestatījumos. Aģents piebilst\n      un maina vienumus ar atcerēšanās rīku un noņem tos ar aizmirst; abus var pārslēgt\n      izslēgts cilnē Piekļuve.',
  'settings.ai.AgentMemoryEditor.added_value.29f396e2': 'Pievienota {value0}',
  'settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d': 'Aizmirstiet šo vienumu',
  'settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6':
    'Vēl nekas neatcerējās. Palūdziet aģentam tērzēšanā kaut ko atcerēties vai pievienojiet to šeit.',
  'settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77':
    'Kaut kas šim aģentam būtu jāatceras...',
  'settings.ai.AgentMemoryEditor.add.9fd728c6': 'Pievienot',
  'settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8':
    'Pievienojiet šo rindu aģenta atmiņai',
  'settings.ai.AgentsSettings.an_agent_is_a_model.148349b4':
    'Aģents ir modelis, instrukciju kopums un tas, ko tas drīkst darīt. Tērzēšana turpinās\n      viens; skripti un citi aģenti var deleģēt vienam.',
  'settings.ai.AgentsSettings.default.37a8eec1': 'noklusējuma',
  'settings.ai.AgentsSettings.utility.57ffcc28': 'lietderība',
  'settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501': 'Dublējiet šo aģentu',
  'settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82':
    'Pēdējo aģentu nevar izdzēst — tērzēšanai ir jādarbojas ar kaut ko',
  'settings.ai.AgentsSettings.delete_this_agent.0ba11bd2': 'Dzēst šo aģentu',
  'settings.ai.AgentsSettings.add_agent.d3e039d4': 'Pievienojiet aģentu',
  'settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1':
    'Izveidojiet aģentu un atveriet to rediģēšanai',
  'settings.ai.AgentsSettings.delete_agent.602cc4da': 'Dzēst aģentu',
  'settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4':
    'Vai dzēst {value0}? Tērzēšanas sarunas, kas tajā joprojām darbojas, atgriezīsies uz\n        noklusējuma aģents. Šo darbību nevar atsaukt.',
  'settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d':
    'Utilītas aģents nevar būt noklusējums — tas ir paslēpts no tērzēšanas',
  'settings.ai.AgentsSettings.already_the_default_agent.28842ed7': 'Jau noklusējuma aģents',
  'settings.ai.AgentsSettings.make_this_the_default_agent.4e646862':
    'Padariet šo par noklusējuma aģentu jaunām tērzēšanas sarunām',
  'settings.ai.AgentsSettings.no_model.f62c7d17': 'nav modeļa',
  'settings.ai.AgentsSettings.whole_vault.18d9a3b5': 'visa velve',
  'settings.ai.AgentsSettings.no_scope.cc0ca29a': 'nav darbības jomas',

  'settings.ai.GeneralSettings.ai_agent.b48c8be3': 'MI aģents',
  'settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425':
    'Iespējojiet AI aģenta funkcijas, tostarp tērzēšanas sānjoslu.',
  'settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23':
    'AI aģents ir izslēgts. Ieslēdziet to sadaļā Vispārīgi.',
  'settings.ai.GeneralSettings.keep_running_in_background_while.32440789':
    'Turpiniet darboties fonā, kamēr aģenti strādā',
  'settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2':
    'Atskaņojiet klusu audio, kamēr notiek pagrieziens. Var izmantot vairāk akumulatora; fona izpilde ir atkarīga no sistēmas.',
  'settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee':
    'Vienmēr turpiniet darboties fonā',
  'settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f':
    'Atskaņojiet klusu audio pat tad, ja aģenti ir dīkstāvē. Pēc noklusējuma izslēgts; var izmantot vairāk akumulatora.',
  'settings.ai.GeneralSettings.key_destinations.fe672569': 'Galvenie galamērķi',
  'settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee':
    'Pirms atslēgas nosūtīšanas pārskatiet ārpus šīs ierīces mainītās adreses.',
  'settings.ai.GeneralSettings.review.aff0766a': 'Pārskats',
  'settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591':
    'Pārskatiet un apstipriniet, kur šī ierīce sūta atslēgas',
  'settings.ai.GeneralSettings.chat_storage.b1ad73cf': 'Tērzēšanas krātuve',
  'settings.ai.GeneralSettings.chat_path_template.306fa23b': 'Tērzēšanas ceļa veidne',
  'settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e':
    'Ceļa veidne tērzēšanas failiem. Mainīgie: {value0}, {value1}.',
  'settings.ai.GeneralSettings.ai_chats.f579b34b': 'AI/tērzēšana',
  'settings.ai.GeneralSettings.rewind_space_mb.a3eaae55': 'Attīšanas vieta (MB)',
  'settings.ai.GeneralSettings.how_much_room_on_this.f5c80989':
    'Cik daudz vietas šajā ierīcē var aizņemt kopijas, lai tērzēšana atslogotu\n            faili, kuru aģents ir mainījis. Tērzēšanas sarunas, kas rakstītas vismaz nesen, vispirms pazaudē savu. 0 saglabā\n            nekas, un tērzēšanu nevar attīt atpakaļ.',
  'settings.ai.GeneralSettings.migrate_chats.cd7a094d': 'Migrēt tērzēšanas sarunas',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b':
    'Pārvietojiet esošos tērzēšanas failus, lai tie atbilstu pašreizējai ceļa veidnei.',
  'settings.ai.GeneralSettings.migrating.e3c84baf': 'Notiek migrēšana...',
  'settings.ai.GeneralSettings.migrate.f988ed29': 'Migrēt',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22':
    'Pārvietojiet esošos tērzēšanas failus, lai tie atbilstu iepriekš norādītajai veidnei',
  'settings.ai.GeneralSettings.comment_agent.42067bbf': 'Komentāru aģents',
  'settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0':
    'Kurš aģents atbild uz komentāru tērzēšanu. Tiek piedāvāti arī komunālie aģenti — viens\n            iesēts komentāriem ir viens.',
  'settings.ai.GeneralSettings.comment_folder.0f39b86a': 'Komentāru mape',
  'settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501':
    'Kur tiek saglabātas komentāru tērzēšanas sarunas',
  'settings.ai.GeneralSettings.ai_comments.e01654c6': 'AI/Komentāri',
  'settings.ai.GeneralSettings.skills.66d0f523': 'Prasmes',
  'settings.ai.GeneralSettings.skills_folder.bc563bf9': 'Prasmju mape',
  'settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b':
    'Prasmes šeit tiek piedāvātas katram aģentam. Citur tiek piedāvātas tikai prasmes tērzēšanas jomā; ielādējot citu prasmi, vispirms tiek jautāts. Joprojām ir spēkā aģenta prasmju izvēle.',
  'settings.ai.GeneralSettings.ai_skills.cebb9b9a': 'AI/prasmes',
  'settings.ai.GeneralSettings.integrations.090512d9': 'Integrācijas',
  'settings.ai.GeneralSettings.brave_search_api_key.309e5bff': 'Brave Search API atslēga',
  'settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5':
    'Droši uzglabāts atslēgu saišķī.',
  'settings.ai.GeneralSettings.secrets.d8707d41': 'Noslēpumi',

  'settings.ai.GeneralSettings.unnamed.9edb143e': '(bez nosaukuma)',
  'settings.ai.GeneralSettings.secret_name.5cdf573b': 'Slepenais vārds',
  'settings.ai.GeneralSettings.value.fb2e2c72': 'Vērtība...',
  'settings.ai.GeneralSettings.allowed_addresses.0479f7eb': 'Atļautās adreses',
  'settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c':
    'Pievienojiet adresi no pieprasījuma apstiprinājuma. Katrs saglabātās atslēgas pieprasījums joprojām jautā.',
  'settings.ai.GeneralSettings.remove.c3812fc4': 'Noņemt',
  'settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72':
    'Noņemiet šo adresi no atslēgas atļautā saraksta',
  'settings.ai.GeneralSettings.none_yet.adb85cf2': 'Vēl neviena',
  'settings.ai.GeneralSettings.remove_this_secret.42b31675': 'Noņemiet šo noslēpumu',
  'settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa':
    'Atcelt — atstāt saglabāto vērtību tādu, kāda tā ir',
  'settings.ai.GeneralSettings.add_secret.f57a23c6': 'Pievienojiet noslēpumu',
  'settings.ai.GeneralSettings.add_another_named_secret.16c8806f':
    'Pievienojiet vēl vienu nosauktu noslēpumu',
  'settings.ai.GeneralSettings.providers.996c32b3': 'Pakalpojumu sniedzēji',
  'settings.ai.GeneralSettings.base_url.70589413': 'Pamata URL',
  'settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e':
    'Ar OpenAI saderīgs API galapunkts.',
  'settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef': 'Iegūstiet modeļus no API',
  'settings.ai.GeneralSettings.add_model_manually.c42ee506': 'Pievienojiet modeli manuāli',

  'settings.ai.GeneralSettings.filter_models.e91fd9af': 'Filtrēt modeļus...',
  'settings.ai.GeneralSettings.reasoning.0c4d01e8': 'argumentācija',
  'settings.ai.GeneralSettings.no_models_yet.36604ff4': 'Vēl nav modeļu.',
  'settings.ai.GeneralSettings.add_another_provider.91f9cd40':
    'Pievienojiet citu pakalpojumu sniedzēju',
  'settings.ai.GeneralSettings.no_providers_yet.55327313': 'Pagaidām nav pakalpojumu sniedzēju',
  'settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8':
    'Jebkurš pakalpojums, kas runā OpenAI API: tā adrese, atslēga un modeļi.',
  'settings.ai.GeneralSettings.add_provider.8cd1856b': 'Pievienojiet pakalpojumu sniedzēju',
  'settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7':
    'Pievienojiet citu ar OpenAI saderīgu pakalpojumu sniedzēju',
  'settings.ai.GeneralSettings.background_model.eefa747e': 'Fona modelis',
  'settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa':
    'Tērzēšanas modeļi tiek izvēlēti katram aģentam cilnē Aģenti. Šis tiek izmantots\n          paša spraudņa fona darbs — tērzēšanas sarunu nosaukumu piešķiršana un garu sarunu blīvēšana.',
  'settings.ai.GeneralSettings.auxiliary_model.6c245762': 'Palīgmodelis',
  'settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143':
    'Izmanto tērzēšanas virsrakstiem un blīvēšanai. Ja nav iestatīts, katrā tērzēšanas sarunā tiek izmantots modelis\n            jau runā ar; aģents var nosaukt vienu no saviem, kas to uzvar.',
  'settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7': 'Secīgā palīgierīce',
  'settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159':
    'Palaidiet palīguzdevumus pēc galvenā modeļa pabeigšanas. Iespējot vietējiem modeļiem ar ierobežotu caurlaidspēju.',
  'settings.ai.GeneralSettings.when_a_request_fails.8adc1690': 'Kad pieprasījums neizdodas',
  'settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33':
    'Atkārtojas tikai kļūdas, kas pāriet pašas no sevis — ātruma ierobežojums, pārslogots pakalpojumu sniedzējs, pārtraukts savienojums. Noraidīta atslēga vai slikts pieprasījums netiek mēģināts vēlreiz.',
  'settings.ai.GeneralSettings.try_again_automatically.84c6a3e7': 'Mēģiniet vēlreiz automātiski',
  'settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd':
    'Cik daudz turpmāko mēģinājumu pēc pirmā.',
  'settings.ai.GeneralSettings.first_wait.548b0480': 'Vispirms pagaidiet',
  'settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb':
    'Sekundes pirms pirmā atkārtotā mēģinājuma. Katrs pēc tam to dubulto līdz minūtei.',
  'settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08': 'Pieprasīt taimautu (sekundēs)',
  'settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5':
    'Pagaidiet, līdz modelis izveido savienojumu vai nosūtīs nākamo atbildes daļu, nevis visu atbildi. 1–3600 sekundes; tukšs atjauno 60. Izmanto tērzēšanai un fona modeļiem bez sava taimauta.',
  'settings.ai.GeneralSettings.voice_input.8748f239': 'Balss ievade',
  'settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a':
    'Diktējiet tērzēšanā vai piezīmē ar komandu “Diktēt piezīmē”. OpenRouter nav transkripcijas galapunkta, tāpēc audio tiek pārraidīts uz modeli, kas dzird — šie divi tika izvēlēti, lai noteiktu cenu, lai darbotos Eiropā un neapmācītos par to, kas tiek nosūtīts.',
  'settings.ai.GeneralSettings.model.5e2c614c': 'Modelis',
  'settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f': 'Kas runu pārvērš tekstā.',
  'settings.ai.GeneralSettings.model_id.7789530b': 'Modeļa id',
  'settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177':
    'Jebkurš modelis, kas pieņem audio, kā to nosauc tā nodrošinātājs.',
  'settings.ai.GeneralSettings.vendor_model.ba723767': 'pārdevējs/modelis',
  'settings.ai.GeneralSettings.endpoint.3df9726c': 'Galapunkts',
  'settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7':
    'Atstāts tukšs, OpenRouter tērzēšana ir pabeigta.',
  'settings.ai.GeneralSettings.language.a4fe6526': 'Valoda',
  'settings.ai.GeneralSettings.told_to_the_model_as.35170cef':
    'Pastāstīja modelei kā mājienu. Atstāt tukšu, tas tiek izvadīts no audio.',
  'settings.ai.GeneralSettings.russian.5bcc40ad': 'krievu valoda',
  'settings.ai.GeneralSettings.client_name.b6626cd7': 'Klienta vārds',
  'settings.ai.GeneralSettings.default.21b111cb': 'Noklusējums',
  'settings.ai.GeneralSettings.openrouter_api_key.89616b71': 'OpenRouter API atslēga',
  'settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21':
    'Saglabāts atslēgu saišķī, koplietots ar attēlu ģenerēšanu.',
  'settings.ai.GeneralSettings.image_generation.8f4716e6': 'Attēlu ģenerēšana',
  'settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226':
    'Īss identifikators, ko izmanto modeļa atslēgās (piemēram, openai, openrouter).',
  'settings.ai.GeneralSettings.e_g_openai.e3ce2f3c': 'piem. {literal0}',
  'settings.ai.GeneralSettings.api_type.72e7cc4c': 'API tips',
  'settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d':
    'OpenAI izmanto /v1/images/generations, OpenRouter izmanto tērzēšanas pabeigšanas.',
  'settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3':
    'Pēc noklusējuma atstājiet tukšu: ',
  'settings.ai.GeneralSettings.add_model.b2609f7d': 'Pievienojiet modeli',
  'settings.ai.GeneralSettings.add_another_image_provider.fac89d72':
    'Pievienojiet citu attēlu nodrošinātāju',
  'settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca': 'Vēl nav attēlu nodrošinātāju',
  'settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb':
    'Pakalpojums, kas veido attēlus no vārdiem, lai aģents varētu zīmēt.',
  'settings.ai.GeneralSettings.add_image_provider.858726bf': 'Pievienojiet attēlu nodrošinātāju',
  'settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9':
    'Pievienojiet citu attēlu ģenerēšanas nodrošinātāju',
  'settings.ai.GeneralSettings.default_image_model.164d9980': 'Noklusējuma attēla modelis',
  'settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88':
    'Izmanto, ja aģents nenorāda modeli.',
  'settings.ai.GeneralSettings.prompts.5f2e66e6': 'Uzvednes',
  'settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4':
    'Ko spraudnis saka modeļiem savam darbam. Katrs sākas kā savs spraudnis; mainiet tikai vienu, lai mainītu darba rezultātu.',
  'settings.ai.GeneralSettings.tool_descriptions.eb258712': 'Instrumentu apraksti',
  'settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136':
    'Ko katrs rīks stāsta modelim par sevi, un to dalās katrs aģents. To, kādus rīkus aģents drīkst izmantot, nosaka katram aģentam.',
  'settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106':
    '{value0} ir mainīts no paša spraudņa',
  'settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39':
    'Mainiet to, ko rīki stāsta modelim',
  'settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab':
    'Mainīts no paša spraudņa vārdiem',
  'settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921': 'Mainiet uzvedni {value0}',
  'settings.ai.GeneralSettings.use_the_default.76f7faf5': 'Izmantojiet noklusēto',
  'settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb':
    'Atgriezieties pie paša spraudņa vārdiem',
  'settings.ai.GeneralSettings.cancel.19766ed6': 'Atcelt',
  'settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492': 'Aizvērt bez izmaiņām',
  'settings.ai.GeneralSettings.save.1509f561': 'Saglabāt',
  'settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d':
    'Izmantojiet šos vārdus no šī brīža',
  'settings.ai.GeneralSettings.done.11a6767d': 'Gatavs',
  'settings.ai.GeneralSettings.close_this_window.3f02fc8e': 'Aizveriet šo logu',
  'settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9':
    'Migrētas {value0} tērzēšanas sarunas',
  'settings.ai.GeneralSettings.migration_failed_value.109b5f7f': 'Migrācija neizdevās: {value0}',
  'settings.ai.GeneralSettings.default_agent.94da52ec': 'Noklusējuma aģents',
  'settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9':
    'Ievadiet 1–3600 sekundes. Šī vērtība nav saglabāta.',
  'settings.ai.GeneralSettings.something_else.b4768d66': 'Kaut kas cits…',
  'settings.ai.GeneralSettings.remove_secret.1422ca6e': 'Noņemt noslēpumu',

  'settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101':
    '{value0} ir saglabāts atslēgu piekarē',
  'settings.ai.GeneralSettings.agent_memory.f3cd4df6': 'Aģenta atmiņa',
  'settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab':
    'Kā tas, kas aģentam tika lūgts atcerēties, tiek pievienots tā sistēmas uzvednei; {value0} ir vieta, kur tiek pārvietoti vienumi.',
  'settings.ai.GeneralSettings.chat_titles.950a9874': 'Tērzēšanas nosaukumi',
  'settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a':
    'Nosauc tērzēšanas sarunu no tās pirmajiem ziņojumiem; {value0} ir vieta, kur viņi dodas.',
  'settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9': 'Tērzēšanas nosaukumi, sistēma',
  'settings.ai.GeneralSettings.what_the_model_that_names.4a08978e':
    'Modelim, kas nosauc tērzēšanu, tas ir pateikts.',
  'settings.ai.GeneralSettings.chat_recap.adaaf80a': 'Tērzēšanas kopsavilkums',
  'settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c':
    'Teikums tērzēšanas kartītē zem piezīmes tika mainīts; {value0} ir vieta, kur tiek nosūtīti ziņojumi.',
  'settings.ai.GeneralSettings.chat_summary.b82dab10': 'Tērzēšanas kopsavilkums',
  'settings.ai.GeneralSettings.the_short_line_under_a.c81696a8':
    'Īsā rindiņa zem tērzēšanas nosaukuma vēsturē; {value0} ir vieta, kur tiek nosūtīti ziņojumi.',
  'settings.ai.GeneralSettings.compacting.df77799c': 'Blīvēšana',
  'settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886':
    'Kā tiek apkopota gara saruna, lai tā varētu turpināties; {value0} ir vieta, kur tā ir pieejama.',
  'settings.ai.InterceptorList.interceptors.803987ac': 'Pārtvērēji',
  'settings.ai.InterceptorList.off.ca7981b4': 'Izslēgts',
  'settings.ai.InterceptorList.close_its_settings.de0fd0fb': 'Aizveriet tā iestatījumus',
  'settings.ai.InterceptorList.edit_what_it_reads_and.86412c66':
    'Rediģējiet to, kas tajā ir lasāms un kā',
  'settings.ai.InterceptorList.on_runs_in_its_turn.baf521d9': 'Ieslēgts: darbojas pēc kārtas',
  'settings.ai.InterceptorList.off_skipped_keeps_its_place.28162216':
    'Izslēgts: izlaists, saglabā savu vietu',
  'settings.ai.InterceptorList.move_or_remove.ca447e47': 'Pārvietot vai noņemt',
  'settings.ai.InterceptorList.who_reads_an_agent_says.0ff03e5e':
    'Kas lasa: aģents saka, ko domā, scenārijs izlemj.',
  'settings.ai.InterceptorList.add_interceptor.36b0eb2d': 'Pievienojiet pārtvērēju',
  'settings.ai.InterceptorList.add_one_at_the_end.98a5c813':
    'Pievienojiet vienu beigās; tas darbojas pēdējais',
  'settings.ai.InterceptorList.an_agent_or_a_script.92a06c1a':
    'Aģents vai skripts, kas tiek lasīts pirmais',
  'settings.ai.InterceptorList.everything.75304cf7': 'Viss',
  'settings.ai.InterceptorList.they_run_in_this_order.7b624feb':
    'Viņi darbojas šādā secībā, katram ņemot vērā to, ko atgrieza iepriekš. Aģents nolasa pēdējās tekstu.',
  'settings.ai.InterceptorList.script_value_missing.31a4f5d0': 'Skripts: {value0} · trūkst',
  'settings.ai.InterceptorList.missing_agent.4eeff6c3': 'Pazudis aģents',
  'settings.ai.InterceptorList.nobody.3fad99b5': 'Neviens',
  'settings.ai.InterceptorList.move_up.c66feb5e': 'Pārvietojieties uz augšu',
  'settings.ai.InterceptorList.move_down.40bb50da': 'Pārvietojieties uz leju',
  'settings.ai.InterceptorList.remove.c3812fc4': 'Noņemt',
  'settings.ai.InterceptorSettings.interceptor.e7123168': 'Pārtvērējs',
  'settings.ai.InterceptorSettings.checks.de07d072': 'Pārbaudes',
  'settings.ai.InterceptorSettings.only_messages_matching.a6b95968': 'Tikai atbilstošās ziņas',
  'settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb':
    'Regulāra izteiksme, tukša vai kā /pattern/flags, tiek izmēģināta neatkarīgi no atzīmētā. Pārējās iziet nekontrolētas. Tukšs nozīmē visu.',

  'settings.ai.InterceptorSettings.reply_only.df23f4c5': 'Atbildēt tikai',
  'settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839':
    'Nosūtiet savus ziņojumus nemainītus tieši galvenajam aģentam. Pārtvērējs var atbildēt blakus katram ziņojumam, to neturot, nepārrakstot vai lemjot par rīku apstiprināšanu.',
  'settings.ai.InterceptorSettings.interceptor_context.4b7f6f53': 'Pārtvērēja konteksts',
  'settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856':
    'Cik lielu daļu sarunas redz pārtvērējs.',
  'settings.ai.InterceptorSettings.everything.75304cf7': 'Viss',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec':
    'Jūsu ziņojumi, pirms aģents tos izlasa.',
  'settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d':
    'Aģenta atbildes, kad tas ir pabeigts. Atbildes vietu ieņem jauns teksts no pārtvērēja; oriģināls paliek vienas preses attālumā.',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706':
    'Jūsu ziņojumi, pirms aģents tos izlasa, un atbildes, kad tas ir pabeigts. Atbildes vietu ieņem jauns teksts no pārtvērēja.',
  'settings.ai.McpServerModal.add_mcp_server.0e3e58f9': 'Pievienojiet MCP serveri',
  'settings.ai.McpServerModal.edit_mcp_server.35d90caa': 'Rediģēt MCP serveri',
  'settings.ai.McpServerModal.name.dcd1d522': 'Nosaukums',
  'settings.ai.McpServerModal.e_g_context.e900fc3c': 'piem. {literal0}',
  'settings.ai.McpServerModal.another_server_already_has_this.8e96ea34':
    'Šis nosaukums jau ir citam serverim. No tā izriet rīku nosaukumi, tāpēc tam ir jāatšķiras.',
  'settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59':
    'Servera MCP galapunkts, sasniegts, izmantojot HTTP.',
  'settings.ai.McpServerModal.on.13001175': 'Ieslēgts',
  'settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37':
    'Off patur to šeit un nedod savus rīkus nevienam aģentam.',
  'settings.ai.McpServerModal.token.d2089be6': 'Marķieris',
  'settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3':
    'Tiek nosūtīts kā Authorization: Bearer. Glabājas atslēgu saišķī, nekad iestatījumu failā.',
  'settings.ai.McpServerModal.optional.59be7133': 'Pēc izvēles',
  'settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436':
    'Saglabājot, aizmirstiet saglabāto marķieri',
  'settings.ai.McpServerModal.headers.194e9fe6': 'Virsraksti',
  'settings.ai.McpServerModal.tools.ea93d6a2': 'Rīki',
  'settings.ai.McpServerModal.what_agents_are_told_is.7591a661':
    'Aģentiem tiek teikts, ka šis saraksts ir tāds, kāds tas tika iegūts. Tas mainās tikai tad, kad to paņemat\n          atkal šeit un saglabājiet.',
  'settings.ai.McpServerModal.fetch_tools.4788d40d': 'Atnest rīkus',
  'settings.ai.McpServerModal.connect_to_the_server_and.db04f00f':
    'Izveidojiet savienojumu ar serveri un izlasiet tā piedāvātos rīkus',
  'settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f':
    'Vispirms ir nepieciešams servera URL',
  'settings.ai.McpServerModal.save.1509f561': 'Saglabāt',
  'settings.ai.McpServerModal.keep_this_server_and_close.f4798cef':
    'Saglabājiet šo serveri un aizveriet',
  'settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc': 'Nepieciešams savs nosaukums un URL',
  'settings.ai.McpServerModal.delete.e2d0a549': 'Dzēst',
  'settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c':
    'Noņemt šo serveri; aģenti zaudē savus instrumentus',
  'settings.ai.McpServerModal.delete_mcp_server.1a969bef': 'Dzēst MCP serveri',
  'settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d':
    'Vai dzēst {value0}? Katrs aģents zaudē savus instrumentus.',

  'settings.ai.McpServerModal.also_the_start_of_its.6f23c597':
    'Arī tā rīku nosaukumu sākums: mcp_{value0}_<tool>.',
  'settings.ai.McpServerModal.fetching.8d0738c8': 'Notiek ienešana…',
  'settings.ai.McpServerModal.not_fetched_yet.d17fdec2': 'Vēl nav atnests',
  'settings.ai.McpSettings.servers_that_give_agents_more.67631550':
    'Serveri, kas aģentiem nodrošina vairāk rīku, tiek sasniegti, izmantojot HTTP — arī tālrunī. Nekas nav\n      sākās šajā ierīcē. Servera rīki sasniedz aģentu tikai tad, kad tie ir ieslēgti\n      šī aģenta piekļuves cilnē, un viņi jautā pirms katra zvana, ja vien nav iestatīts citādi.',
  'settings.ai.McpSettings.delete_this_server.e42cb344': 'Dzēst šo serveri',
  'settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef': 'Vēl nav MCP serveru.',
  'settings.ai.McpSettings.add_server.1099b2a9': 'Pievienot serveri',
  'settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42':
    'Pievienojiet MCP serveri pēc tā adreses',
  'settings.ai.McpSettings.delete_mcp_server.1a969bef': 'Dzēst MCP serveri',
  'settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d':
    'Vai dzēst {value0}? Katrs aģents zaudē savus instrumentus.',
  'settings.ai.McpSettings.off.ca7981b4': 'Izslēgts',
  'settings.ai.McpSettings.on.13001175': 'Ieslēgts',
  'settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f': 'Ieslēgts, rīki vēl nav iegūti',
  'settings.ai.ProviderSettings.unnamed_provider.1b003656': 'Nenosaukts pakalpojumu sniedzējs',
  'settings.ai.ProviderSettings.change_this_provider_and_its.6b743289':
    'Mainiet šo pakalpojumu sniedzēju un tā modeļus',
  'settings.ai.ProviderSettings.new_provider.38a96a6a': 'Jauns pakalpojumu sniedzējs',
  'settings.ai.ProviderSettings.name.dcd1d522': 'Nosaukums',
  'settings.ai.ProviderSettings.client_name.b6626cd7': 'Klienta vārds',
  'settings.ai.ProviderSettings.default.21b111cb': 'Noklusējums',
  'settings.ai.ProviderSettings.api_key.16f0ee47': 'API atslēga',
  'settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578':
    'Glabāts šīs ierīces atslēgu saišķī.',
  'settings.ai.ProviderSettings.models.d17d2d78': 'Modeļi',
  'settings.ai.ProviderSettings.delete.e2d0a549': 'Dzēst',
  'settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b':
    'Noņemiet šo pakalpojumu sniedzēju un tā modeļus',
  'settings.ai.ProviderSettings.done.11a6767d': 'Gatavs',
  'settings.ai.ProviderSettings.close_this_window_changes_are.91342d87':
    'Aizveriet šo logu; izmaiņas tiek saglabātas, tiklīdz tās veicat',
  'settings.ai.ToolDescriptions.value_of_value.ca6c5e5f': '{value0} no {value1}',
  'settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab':
    'Mainīts no paša spraudņa vārdiem',
  'settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d':
    'Mainiet to, ko {value0} norāda modelim',
  'settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7':
    'Ko šis rīks stāsta modelim par sevi.',
  'settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7': 'Ko {value0} norāda modelim',
  'settings.ai.ToolDescriptions.use_the_default.76f7faf5': 'Izmantojiet noklusēto',
  'settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb':
    'Atgriezieties pie paša spraudņa vārdiem',
  'settings.ai.ToolDescriptions.cancel.19766ed6': 'Atcelt',
  'settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492': 'Aizvērt bez izmaiņām',
  'settings.ai.ToolDescriptions.save.1509f561': 'Saglabāt',
  'settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d':
    'Izmantojiet šos vārdus no šī brīža',
  'settings.ai.interceptorList.reply_only.37786db8': 'tikai atbildēt',
  'settings.ai.options.ask_before_every_change.f5fb08f2': 'Jautājiet pirms katras izmaiņas',
  'settings.ai.options.edit_files_without_asking.08674c9f': 'Rediģējiet failus bez prasīšanas',
  'settings.ai.options.everything_without_asking.d14adf38': 'Viss bez prasīšanas',
  'settings.ai.options.value_utility.6fb6bae8': '{value0} · lietderība',
  'settings.ai.options.script_value_value.97c5d924': 'Skripts: {value0}{value1}',
  'settings.scripts.AutomationsEditor.automations.ad1fb9ec': 'Automatizācijas',

  'settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15': 'Vēl nav automatizācijas.',
  'settings.scripts.AutomationsEditor.off.ca7981b4': 'Izslēgts',
  'settings.scripts.AutomationsEditor.delete_this_automation.76539f9f': 'Dzēst šo automatizāciju',
  'settings.scripts.AutomationsEditor.run_this_automation.25a70adc': 'Palaidiet šo automatizāciju',
  'settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f':
    'Izslēgts, tas tiek iestatīts šeit, nedarbinot to.',
  'settings.scripts.AutomationsEditor.name.dcd1d522': 'Nosaukums',
  'settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc':
    'Kā to sauc šeit un skriptu palaišanas sarakstā.',
  'settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8': 'piem. {literal0}',
  'settings.scripts.AutomationsEditor.when.cf9c7aa2': 'Kad',
  'settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf':
    'Kam jānotiek, lai skripts darbotos.',
  'settings.scripts.AutomationsEditor.note_types.52d728fb': 'Piezīmju veidi',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4':
    'Atdalīts ar komatu. Tikai piezīmes, kuru veids frontmatter ir viens no šiem. Tukša ir jebkura piezīme.',
  'settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4': 'piem. {literal0}',
  'settings.scripts.AutomationsEditor.folders.c4d6bb20': 'Mapes',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774':
    'Atdalīts ar komatu. Tikai piezīmes jebkur zem viena no tām. Tukšs ir jebkur.',
  'settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d': 'piem. {literal0}',
  'settings.scripts.AutomationsEditor.property.40040cb1': 'Īpašība',
  'settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04':
    'Tikai piezīmes ar šo frontmatter īpašumu. Pēc izvēles.',
  'settings.scripts.AutomationsEditor.e_g_area.95b1c988': 'piem. {literal0}',
  'settings.scripts.AutomationsEditor.equals.f939ae3d': 'Vienāds',
  'settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f':
    '…turot šo vērtību vai kādu no tās vērtībām. Tukšs ir jebkura vērtība.',
  'settings.scripts.AutomationsEditor.e_g_home.a9f31279': 'piem. {literal0}',
  'settings.scripts.AutomationsEditor.script.102acc10': 'Skripts',
  'settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704':
    'Skripts tiek palaists automatizācija.',
  'settings.scripts.AutomationsEditor.choose_script.e582e7b2': 'Izvēlieties skriptu...',
  'settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d':
    'Meklējiet skriptos to, ko palaiž šī automatizācija',
  'settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9':
    'Šim skriptam nav nepieciešami parametri.',
  'settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590':
    'Ne vairāk kā ik pēc (sekundes)',
  'settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf':
    'Par vienu piezīmi. Izmaiņas starp tām beigās tiek apkopotas vienā piegājienā. 0 darbojas katrā izmaiņā.',
  'settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225':
    'Arī par izmaiņām no citām ierīcēm',
  'settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2':
    'Izslēgts, izmaiņas, kas tiek veiktas ar sinhronizāciju, šeit nedarbojas: tās jau tika izpildītas ierīcē, kurā tās tika veiktas.',
  'settings.scripts.AutomationsEditor.add_automation.537c3ee4': 'Pievienojiet automatizāciju',
  'settings.scripts.AutomationsEditor.add_another_automation.78aa262d':
    'Pievienojiet citu automatizāciju',
  'settings.scripts.AutomationsEditor.delete_automation.f71084e7': 'Dzēst automatizāciju',
  'settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0':
    'Vai dzēst {value0}? Tās skripts apstājas\n        skrien pats. Šo darbību nevar atsaukt.',
  'settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a': 'Vēl nav izvēlēts skripts',
  'settings.scripts.AutomationsEditor.no_description.06a69482': 'Nav apraksta.',
  'settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925':
    '{value0} · noklusējuma vērtība ir {value1}',
  'settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78': 'Virsraksta pogas',

  'settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4': 'Poga bez nosaukuma',

  'settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275':
    'Pārvietojieties agrāk - jau pirmais',
  'settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10':
    'Pārvietojieties uz priekšu galvenē',
  'settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45':
    'Pārvietoties vēlāk — jau pēdējais',
  'settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d':
    'Pārvietot vēlāk galvenē',
  'settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e': 'Mainiet šo pogu',
  'settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516': 'Pievienojiet citu pogu',
  'settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3':
    'Vēl nav nevienas galvenes pogas',
  'settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f':
    'Komanda vai skripts jūsu izvēlētajās piezīmēs.',
  'settings.scripts.HeaderButtonsEditor.add_button.c0f290f3': 'Pievienošanas poga',
  'settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8':
    'Pievienojiet galvenes pogu un iestatiet to',
  'settings.scripts.HeaderButtonsEditor.new_button.c499cbe3': 'Jauna poga',
  'settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80': 'Ko tas vada',
  'settings.scripts.HeaderButtonsEditor.runs.848f54e8': 'Skrien',
  'settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412':
    'Komanda no jebkuras vietas Obsidian vai kāds no jūsu skriptiem.',
  'settings.scripts.HeaderButtonsEditor.name.dcd1d522': 'Nosaukums',
  'settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef':
    'Tiek rādīts kā pogas rīka padoms un izvēlnē, kur tas neietilpst.',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b':
    'Tiek rādīts uz pogas vai kā tās rīka padoms, ja tā ir tikai ikona.',
  'settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.icon.a35abcd6': 'Ikona',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8':
    'Parādīts uz pogas galvenē.',
  'settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06':
    'Izvēlieties ikonu no visas komplekta, pēc attēla vai nosaukuma',
  'settings.scripts.HeaderButtonsEditor.command.71316697': 'Pavēli',
  'settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f': 'Pavēli pogai palaist.',
  'settings.scripts.HeaderButtonsEditor.choose_command.ea49d680': 'Izvēlieties komandu...',
  'settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77':
    'Meklējiet katrā Obsidiāna komandā to, kuru palaiž šī poga',
  'settings.scripts.HeaderButtonsEditor.icon_only.7a047008': 'Tikai ikona',
  'settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5':
    'Atstājiet nosaukumu no galvenes, jo galvene jau ir pilna.',
  'settings.scripts.HeaderButtonsEditor.script.102acc10': 'Skripts',
  'settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c': 'Skripts poga darbojas.',
  'settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2': 'Izvēlieties skriptu...',
  'settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4':
    'Meklējiet skriptos to, kuru palaiž šī poga',
  'settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9':
    'Šim skriptam nav nepieciešami parametri.',
  'settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1': 'Kur tas rāda',
  'settings.scripts.HeaderButtonsEditor.on_every_note.d761c688': 'Uz katras nots',
  'settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572':
    'Neatkarīgi no tā veida, tagiem vai mapes.',
  'settings.scripts.HeaderButtonsEditor.note_types.52d728fb': 'Piezīmju veidi',
  'settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.folders.c4d6bb20': 'Mapes',
  'settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.tags.1331275b': 'Tagi',
  'settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4':
    'Atdalīts ar komatu, ar vai bez #. Poga tiek rādīta arī piezīmēs ar kādu no tām vai zem tā ievietotu tagu.',
  'settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318': 'Arī citos failos',
  'settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c':
    'PDF, kanvas, grāmatas un citi faili, kas atvērti cilnē, ciktāl tas sasniedz mapes un atzīmes. Viņiem nav veida vai īpašību.',
  'settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87':
    'Tikai tad, kad tās īpašības',
  'settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754':
    'Piezīmei ir jābūt arī tās priekšgalā.',
  'settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb':
    'Rādiet to tikai uz piezīmēm, kuru priekšpuse ir piemērota, piemēram, statuss vai aizpildīšanas datums.',
  'settings.scripts.HeaderButtonsEditor.add_condition.60a0d835': 'Pievienot nosacījumu',
  'settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa':
    'Pieprasiet vēl vienu piezīmes īpašumu',
  'settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b': 'Nepieciešami nosacījumi',
  'settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1':
    'Neatkarīgi no tā, vai piezīmei ir jāatbilst visiem tālāk norādītajiem nosacījumiem vai jebkuram no tiem.',
  'settings.scripts.HeaderButtonsEditor.property.40040cb1': 'Īpašība',
  'settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56': 'piem. {literal0}',
  'settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189': 'Noņemiet šo nosacījumu',
  'settings.scripts.HeaderButtonsEditor.delete.e2d0a549': 'Dzēst',
  'settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9': 'Dzēst šo pogu',
  'settings.scripts.HeaderButtonsEditor.done.11a6767d': 'Gatavs',
  'settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87':
    'Aizveriet šo logu; izmaiņas tiek saglabātas, tiklīdz tās veicat',
  'settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880': 'Poga Dzēst galveni',
  'settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26':
    'Vai dzēst {value0}? Tas pazūd no katra\n        piezīmes galvene tas bija ieslēgts. Šo darbību nevar atsaukt.',
  'settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee': 'Komanda',
  'settings.scripts.HeaderButtonsEditor.a_script.1ccd820b': 'Skripts',
  'settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7': 'Vēl nav izvēlēta komanda',
  'settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a': 'Vēl nav izvēlēts skripts',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848':
    'Atdalīts ar komatu. Piezīmes, kuru veids ir frontmatter, parāda pogu.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3':
    'Nevienai piezīmei šajā krātuvē nav {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78':
    'Nevienai piezīmei šajā krātuvē nav veidu {value0}.',
  'settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815':
    '{value0} Izmantotie veidi: {value1}.',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44':
    'Atdalīts ar komatu. Piezīmes zem viena no tām parāda arī pogu. A * apzīmē ',
  'settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a':
    'jebkura viena mape, ** jebkuram dziļumam: {literal0}.',
  'settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9':
    'Šajā krātuvē nav mapes {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1':
    'Šajā krātuvē nav mapju {value0}.',
  'settings.scripts.HeaderButtonsEditor.is.fa51fd49': 'ir',
  'settings.scripts.HeaderButtonsEditor.is_not.e1bf1560': 'nav',
  'settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1': 'ir aizpildīts',
  'settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d': 'ir tukšs',
  'settings.scripts.HeaderButtonsEditor.all_of_them.29c88933': 'Visas tās',
  'settings.scripts.HeaderButtonsEditor.any_one.4013adf2': 'Jebkurš',
  'settings.scripts.HeaderButtonsEditor.no_description.06a69482': 'Nav apraksta.',
  'settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925':
    '{value0} · noklusējuma vērtība ir {value1}',
  'settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819':
    'Nosauciet frontmatter īpašumu; līdz tam šis nosacījums tiek ignorēts.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b':
    'Piezīmes, kuru {value0} ir aizpildīta.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a':
    'Piezīmes, kuru lauks {value0} ir tukšs vai trūkst.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0':
    'Piezīmes, kuru {value0} ir nekas cits kā "{value1}", nav iekļautas.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f':
    'Piezīmes, kuru {value0} ir "{value1}", vai satur to sarakstā.',
  'settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908':
    'Ierakstiet vērtību, kurai ir jābūt {value0}.',
  'settings.scripts.ScriptLibrary.library.dc20b3d5': 'Bibliotēka',

  'settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644':
    'Skripti ir izslēgti. Ieslēdziet tos sadaļā Vispārīgi, lai redzētu, kas mapē atrodas.',
  'settings.scripts.ScriptLibrary.filter.638e249f': 'Filtrs',
  'settings.scripts.ScriptLibrary.by_name_or_description.95a3575e': 'Pēc nosaukuma vai apraksta.',
  'settings.scripts.ScriptLibrary.e_g_archive.a525e8b2': 'piem. {literal0}',
  'settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0':
    'Neviens skripts tam neatbilst.',
  'settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa': 'Mapē vēl nav skriptu.',
  'settings.scripts.ScriptLibrary.refused.66b87354': 'Atteicās',
  'settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168': 'Gaida apstiprinājumu',
  'settings.scripts.ScriptLibrary.off.ca7981b4': 'Izslēgts',
  'settings.scripts.ScriptLibrary.toolbar.451aa51a': 'Rīkjosla',
  'settings.scripts.ScriptLibrary.startup.65d48235': 'Startēšana',
  'settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87':
    'Tas mainījās bez ieraksta šajā ierīcē: apskatiet to un apstipriniet to',
  'settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c':
    'Pārskatiet izpildes uzticamību šajā ierīcē, nepalaižot skriptu',
  'settings.scripts.ScriptLibrary.run_this_script_now.ef501cea': 'Palaidiet šo skriptu tūlīt',
  'settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b':
    'Pievienojiet galvenes pogu, kas palaiž šo skriptu',
  'settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d':
    'Vēl nav apraksta — pievienojiet {literal0} rindiņu faila augšdaļā.',
  'settings.scripts.ScriptLibrary.no_parameters.3a7003b7': 'Nav parametru',
  'settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d':
    'Rīkjoslā pēc tās {literal0} galvenes rindas',
  'settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed': 'Noņemiet to no rīkjoslas',
  'settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91':
    'Novietojiet to rīkjoslā: kreisajā lentē un virs tastatūras tālrunī',
  'settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b':
    'Darbojas palaišanas laikā pēc tās {literal0} galvenes rindas',
  'settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9':
    'Pārtrauciet to palaist, kad sāksies Obsidiāns',
  'settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac':
    'Palaidiet to katru reizi, kad sākas Obsidiāns',
  'settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6': 'Iespējot skriptus',
  'settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9':
    'Atļaut JavaScript skriptus, kas saglabāti krātuves mapē, reģistrēt kā komandas un AI rīkus.',
  'settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1': 'Sinhronizētā skripta politika',
  'settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f':
    'Personiskā sinhronizācija: līdz apstiprināšanai šajā ierīcē. Kopīgie un aģentu savienojumi: atteikties. Palaidiet skriptu manuāli, lai pārskatītu precīzus tā baitus. Trūkst izcelsmes ir nepieciešama atveseļošanās; apstiprinājumi nekad netiek sinhronizēti.',
  'settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d': 'Skriptu mape',
  'settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89':
    'Vault mape, kurā ir .js skripta faili.',
  'settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b': 'piem. {literal0}',
  'settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea':
    'Apstipriniet skriptus no citām ierīcēm',
  'settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac':
    '1 skripts gaida apstiprinājumu šajā ierīcē.',
  'settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9':
    '{value0} skripti gaida apstiprinājumu šajā ierīcē.',
  'settings.scripts.ScriptsGeneral.review.aff0766a': 'Pārskats',

  'settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27':
    'AI aģents → Noklusējuma rīka režīmi',

  'settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e':
    'Skripts, kas tiek parādīts vai mainīts bez ierakstīšanas šajā ierīcē — izmantojot Obsidian Sync, iCloud, Syncthing, git — gaida, līdz to apskatīsit un šeit apstiprināsiet. Līdz tam pogas, automatizācija, startēšana un aģenti to nedarbina. Skripti, kurus rakstāt šajā ierīcē, redaktorā vai caur Abele, tiek uzskatīti par apstiprinātiem. Ieslēdzot šo iestatījumu, tiek pieņemts katrs mapē esošais skripts, kāds tas ir tagad. Apstiprinājumi tiek glabāti tikai šajā ierīcē; izslēdzot to šeit, tās aizmirst, un tikai šai ierīcei.',
  'settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec':
    'Skripti atlasītajiem vārdiem',
  'settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f':
    'Skripti, kas ir piesprausti grāmatu atlases izvēlnei, šādā secībā. Līdz trim ir poga katrā; vairāk salocīt vienā izvēlnē. Citi skripti paliek sadaļā “Cits skripts…”.',
  'settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44':
    'Tērzēšanas atlases izvēlnei izvēlētie skripti neatkarīgi no grāmatām. Tērzēšanas palaišanas atbalsts vēl nav iespējots.',
  'settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7':
    'Vēl nav skriptu: vispirms pievienojiet to skriptu mapei.',
  'settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11':
    'Ēdienkartē vēl nav nekā.',
  'settings.scripts.SelectionScriptsSettings.script_value.804f5354': 'Skripts: {value0}',
  'settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0':
    'Skripts: {value0} — nav atrasts',
  'settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682': 'Vārds uz joslas',
  'settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4':
    'Izvēlieties ikonu, kas atrodas joslā',
  'settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41': 'Jau pirmais',
  'settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10':
    'Pārvietojiet to uz augšu izvēlnē',
  'settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12': 'Jau pēdējais',
  'settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335':
    'Pārvietojiet to uz leju izvēlnē',
  'settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889':
    'Izņemiet to no izvēlnes',
  'settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79':
    'Izvēlnē pēc savas galvenes ({value0}) pēc iepriekš minētajām. Pievienojiet to sarakstam, lai to pārdēvētu vai piešķirtu tam vietu.',
  'settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b': 'Pievienot sarakstam',
  'settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711':
    'Ievietojiet {value0} iepriekš minētajā sarakstā, lai to pārdēvētu vai pārvietotu',
  'settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4': 'Pievienojiet skriptu',
  'settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f':
    'Meklējiet skriptos, lai tos ievietotu izvēlnē',
  'settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec': 'Izņemiet ēdienkarti',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83':
    'Vai noņemt {value0} no izvēlnes vārdiem {value1}? Pats skripts paliek.{value2}',
  'settings.scripts.StartupScriptsEditor.startup.65d48235': 'Startēšana',
  'settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450':
    'Skripti tiek izpildīti katru reizi, kad tiek palaists Obsidian, viens pēc otra šādā secībā, kad krātuve ir atvērta. Skripts, kas ņem parametrus, iegūst noklusējuma iestatījumus; Tā, kurai nepieciešama vērtība bez noklusējuma, tiek izlaista. Ievietojiet šeit skriptu ar barošanas pogu uz tā kartes bibliotēkā.',
  'settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa':
    'Nepalaidiet startēšanas skriptus',
  'settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c':
    'Izlaiž visus, līdz tiek pārslēgts atpakaļ. Ja startēšanas skripts iesaldē Obsidian, tas tiek izlaists arī nākamreiz, kad tiek palaists Obsidian.',
  'settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7':
    'Vēl nav skriptu: vispirms pievienojiet to skriptu mapei.',
  'settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c':
    'Vēl nav startēšanas skriptu.',
  'settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39':
    'Skriptu mapē nav atrasts',
  'settings.scripts.StartupScriptsEditor.already_the_first.eab62d41': 'Jau pirmais',
  'settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e': 'Palaidiet to agrāk',
  'settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12': 'Jau pēdējais',
  'settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f': 'Palaidiet to vēlāk',
  'settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3':
    'Pārtrauciet to palaist startēšanas laikā',
  'settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f':
    'Darbojas startēšanas laikā pēc savas galvenes (@startup) pēc iepriekš minētajām, {value0}. Pievienojiet to sarakstam, lai piešķirtu tam vietu.',
  'settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b': 'Pievienot sarakstam',
  'settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74':
    'Ievietojiet {value0} iepriekš minētajā sarakstā, lai to pārvietotu vai izvēlētos tās ierīces',
  'settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4': 'Pievienojiet skriptu',
  'settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be':
    'Meklējiet skriptos, lai tie tiktu palaisti startēšanas laikā',
  'settings.scripts.StartupScriptsEditor.every_device.9b626893': 'Katra ierīce',
  'settings.scripts.StartupScriptsEditor.computers.680cb3c6': 'Datori',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2': 'Telefoni un planšetdatori',
  'settings.scripts.StartupScriptsEditor.every_device.17779e2b': 'katra ierīce',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d': 'tālruņi un planšetdatori',
  'settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7': 'Saglabāt tikai serverī',
  'settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724':
    'Ierīces vietējais noteikums. Tas darbojas tikai tad, kad priekšskatāt un apstiprināt; piespraustie, mainītie un atvērtie faili paliek šeit.',
  'settings.sync.ExternalFileRules.offload_folder.6566fece': 'Izkraušanas mape',
  'settings.sync.ExternalFileRules.empty_means_all_folders.c907d956': 'Tukšs nozīmē visas mapes.',
  'settings.sync.ExternalFileRules.all_folders.226fd0e5': 'Visas mapes',
  'settings.sync.ExternalFileRules.file_types.696bc9a7': 'Failu veidi',
  'settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a':
    'Komatatdalīti paplašinājumi. Tukšs nozīmē visus pielikumu veidus.',
  'settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d': 'pdf, epub, jpg',
  'settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb': 'Minimālais izmērs (MiB)',
  'settings.sync.ExternalFileRules.not_opened_for_days.42eb5259': 'Nav atvērts vairākas dienas',
  'settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0':
    '0 ignorē vecumu. Faili bez ierakstīta atvēruma tiek izslēgti, ja ir iestatīts vecums.',
  'settings.sync.ExternalFileRules.review_matching_files.f7400143': 'Pārskatiet atbilstošos failus',
  'settings.sync.ExternalFileRules.see_every_file_and_the.b398409d':
    'Pirms izmaiņu veikšanas skatiet katru failu un aptuveno vietu.',
  'settings.sync.ExternalFileRules.preview.324b134f': 'Priekšskatījums',
  'settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2':
    'Pirms izkraušanas norādiet atbilstošos failus un apskatiet vietu',
  'settings.sync.SelectiveSync.what_this_device_syncs.979d00ce': 'Ko šī ierīce sinhronizē',
  'settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522':
    'Piezīmes un audekli vienmēr ceļo. Viss pārējais ir šīs ierīces izvēle — tālrunis var izlaist video un joprojām saglabāt katru piezīmi.',
  'settings.sync.SelectiveSync.largest_file.5cd59717': 'Lielākais fails',
  'settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7':
    'Faili, kas ir lielāki par šo, tiek izlaisti megabaitos. Atstājiet to tukšu, lai paņemtu visu.',
  'settings.sync.SelectiveSync.no_limit.f7fcff0d': 'Nav ierobežojumu',
  'settings.sync.SelectiveSync.obsidian_settings.b1370814': 'Obsidiāna iestatījumi',
  'settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56': 'Mapes šī ierīce izlaiž',
  'settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89':
    'Šajā ierīcē nekas nav augšupielādēts vai lejupielādēts šeit norādītajā mapē. Citas ierīces joprojām to tur.',
  'settings.sync.SelectiveSync.skipped_by_this_device.a7679073': 'Šī ierīce izlaida.',
  'settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c':
    'Vēlreiz sinhronizējiet šo mapi šajā ierīcē',
  'settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be':
    'Šī ierīce sinhronizē katru mapi.',
  'settings.sync.SelectiveSync.skip_a_folder.1f3e8658': 'Izlaist mapi',
  'settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43':
    'Izvēlieties mapi, kas šai ierīcei jāatstāj atsevišķi.',
  'settings.sync.SelectiveSync.e_g_archive_video.b35fc660': 'piem. {literal0}',
  'settings.sync.SelectiveSync.skip.28d03596': 'Izlaist',
  'settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063':
    'Pārtraukt šīs mapes sinhronizēšanu šajā ierīcē',
  'settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698':
    'Nosauciet mapi, kuru vispirms izlaist',
  'settings.sync.SelectiveSync.images.be7e2f20': 'Attēli',
  'settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e':
    'Ekrānuzņēmumi, fotogrāfijas, zīmējumi un diagrammas.',
  'settings.sync.SelectiveSync.audio.bc1b8890': 'Audio',
  'settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181': 'Ieraksti un balss piezīmes.',
  'settings.sync.SelectiveSync.video.d534be82': 'Video',
  'settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb':
    'Smagākā lieta, ko parasti glabā velve.',
  'settings.sync.SelectiveSync.pdfs.211eae3f': 'PDF faili',
  'settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99':
    'Papīri, rokasgrāmatas un skenēti materiāli.',
  'settings.sync.SelectiveSync.everything_else.cd6c5f59': 'Viss pārējais',
  'settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625':
    'Pielikumi, kuru tips nav norādīts, un skriptu mape.',
  'settings.sync.SelectiveSync.app_settings.d43fb8a9': 'Lietotņu iestatījumi',
  'settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd':
    'Redaktors un failu darbība no app.json.',
  'settings.sync.SelectiveSync.appearance.3907fa7f': 'Izskats',
  'settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304':
    'Motīvs, tā fragmenti un fontu izvēle.',
  'settings.sync.SelectiveSync.hotkeys.c15f1530': 'Karstie atslēgas',
  'settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8': 'Jūsu piesaistītie saīsnes.',
  'settings.sync.SelectiveSync.core_plugins.f2e957b0': 'Galvenie spraudņi',
  'settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676':
    'Kuri no paša Obsidiāna spraudņiem ir ieslēgti.',
  'settings.sync.SelectiveSync.community_plugins.ab574402': 'Kopienas spraudņi',
  'settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f':
    'Paši spraudņi, tāpēc jaunā ierīce instalē to, kas darbojas šajā.',
  'settings.sync.SelectiveSync.plugin_settings.95d7fb37': 'Spraudņa iestatījumi',
  'settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b':
    'Ko katrs kopienas spraudnis satur savā data.json.',
  'settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee':
    'Šīs ierīces iestatījumi tiek glabāti pārdēvētajā konfigurācijas mapē {value0}, un sinhronizācijā vēl nav tādas: Obsidian iestatījumi paliek šajā ierīcē, bet serverī esošie iestatījumi tiek atstāti atsevišķi.',
  'settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882':
    'Cik daudz no konfigurācijas mapes ceļo. Darbvieta, diagramma un katra spraudņa kešatmiņa paliek tur, kur atrodas, katrā ierīcē.',
  'settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2':
    'Nekas netika mainīts: {value0}',
  'settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c': 'Kas tiks nosūtīts',
  'settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4': 'Nēsā ​​atslēgu',
  'settings.transfer.TransferPreviewModal.keys.f0d66a79': 'Atslēgas',
  'settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018':
    'Šeit parādīts maskēts; viņi ceļo pilnībā, tāpēc pārsūtīšana ir bloķēta.',
  'settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f': 'Nolasīt pārsūtījumu',
  'settings.transfer.TransferScanModal.use_the_camera.429bb22e': 'Izmantojiet kameru',
  'settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce':
    'Pavērsiet kameru pret kodiem citā ierīcē',
  'settings.transfer.TransferScanModal.take_a_photo.996e6a73': 'Uzņemiet fotoattēlu',
  'settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87':
    'Nofotografējiet kodu vai izvēlieties tā attēlu',
  'settings.transfer.TransferScanModal.open_a_file.3b31f677': 'Atveriet failu',
  'settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7':
    'Lasiet pārsūtīšanu, kas saglabāta kā fails citā ierīcē',
  'settings.transfer.TransferScanModal.paste_the_text.d98782e3': 'Ielīmējiet tekstu',
  'settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa':
    'Ielīmējiet pārsūtīšanu kā tekstu, nevis nolasiet kodu',
  'settings.transfer.TransferScanModal.abl.c834a09f': 'ABL1:…',
  'settings.transfer.TransferScanModal.codes_read.99b98121': 'nolasīti kodi',

  'settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908':
    'Vēl nekas nav lasīts. Otra ierīce parāda kodus; šis tos savāc jebkurā secībā.',
  'settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91':
    'Šim pārsūtīšanai ir atslēga, tāpēc tā ir bloķēta. Ievadiet kodu, kas parādīts otrā ierīcē.',
  'settings.transfer.TransferScanModal.characters.2ad81da8': '8 rakstzīmes',

  'settings.transfer.TransferScanModal.what_to_do_with_what.99215800':
    'Ko darīt ar to, kas jau ir šeit',
  'settings.transfer.TransferScanModal.keep_value.c1cdcb02': 'Saglabāt {value0}',
  'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a': 'Vēl nav šajā ierīcē',
  'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324':
    'Aizstāj šajā ierīcē jau esošo',
  'settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c': 'Jau šeit, tas pats',
  'settings.transfer.TransferScanModal.unlock.4ac709aa': 'Atbloķēt',
  'settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253':
    'Atveriet pārsūtījumu ar šo kodu',
  'settings.transfer.TransferScanModal.apply.31e392d1': 'Lietot',
  'settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186':
    'Šis pārsūtījums nesanāca vesels. Izlasi vēlreiz kodus.',
  'settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4':
    'Šis kods neatver šo pārsūtīšanu.',
  'settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0':
    'Viss, kas šeit nav minēts pārsūtījumā, tiek atstāts mierā.',
  'settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4':
    'Šeit nekas netiks noņemts: pārsūtīšana aptver visu.',
  'settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876':
    '{value0}: {value1}. Skripti, prasmes un uzvednes nekad netiek izdzēstas.',

  'settings.transfer.TransferScanModal.value_to_store_for_the.22f67128':
    '{value0}, lai saglabātu atlasītos vienumus.',
  'settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7':
    'Nav taustiņu, ko saglabāt atlasītajiem vienumiem.',
  'settings.transfer.TransferScanModal.just_now.7ddb44d8': 'tikai tagad',
  'settings.transfer.TransferScanModal.today_at_value.c0d04ee3': 'šodien par {value0}',
  'settings.transfer.TransferScanModal.already_applied.ca602d60': 'Jau pieteikts',
  'settings.transfer.TransferScanModal.applying.3329a9bb': 'Notiek pieteikšanās…',
  'settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead':
    'Ierakstiet tos šīs krātuves iestatījumos',
  'settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d':
    'Vispirms atzīmējiet kaut ko, lai pieteiktos',
  'settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e':
    'Šos iestatījumus nevarēja lietot.',
  'settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870':
    'Šeit nav kameras. Uzņemiet koda fotoattēlu vai ielīmējiet pārsūtīšanu kā tekstu.',
  'settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f':
    'Šajā failā nav pārsūtīšanas.',
  'settings.transfer.TransferScanModal.no_code_in_that_picture.34801264': 'Attēlā nav koda.',
  'settings.transfer.TransferSendModal.send_to_another_device.71ef2876': 'Sūtīt uz citu ierīci',
  'settings.transfer.TransferSendModal.name_for_the_other_device.33a35391':
    'Otras ierīces nosaukums',
  'settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846':
    'Serveris izveido tam savu ierīci, un krātuves ierīču sarakstā tā tiek rādīta ar šo nosaukumu.',
  'settings.transfer.TransferSendModal.other_device.76d065a6': 'Cita ierīce',
  'settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48':
    'Serverim tiek lūgta ierīce otrai pusei…',
  'settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7':
    'Ierakstiet to citā ierīcē',
  'settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606':
    'Pārsūtīt kodu {value0} no {value1}',
  'settings.transfer.TransferSendModal.previous_code.9073b55e': 'Iepriekšējais kods',
  'settings.transfer.TransferSendModal.next_code.2924d04c': 'Nākamais kods',
  'settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8':
    'Pārtrauciet pārvietoties pa kodiem',
  'settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219':
    'Pārvietojieties pa kodiem atsevišķi',
  'settings.transfer.TransferSendModal.make_the_codes.05fce439': 'Izveidojiet kodus',
  'settings.transfer.TransferSendModal.have_the_server_make_the.26277032':
    'Lieciet serverim izveidot otru ierīci un parādīt kodus',
  'settings.transfer.TransferSendModal.give_the_other_device_a.62f36130':
    'Vispirms piešķiriet otrai ierīcei nosaukumu',
  'settings.transfer.TransferSendModal.save_a_file.637ed29a': 'Saglabājiet failu',
  'settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0':
    'Saglabājiet pārsūtīšanu kā failu ārpus sinhronizācijas, lai nosūtītu tālāk, kā vēlaties',
  'settings.transfer.TransferSendModal.show_the_codes.1eb16a33': 'Parādiet kodus',

  'settings.transfer.TransferSendModal.copy_the_text.a9c0e598': 'Kopējiet tekstu',
  'settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d':
    'Kopējiet visu pārsūtīšanu, lai ielīmētu to citā ierīcē',
  'settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8':
    ' Iepriekš minētais kods to atbloķē otrā pusē.',
  'settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601':
    'Izlasiet kodu vai kopējiet tekstu.{value0}',
  'settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2': {
    zero: '{count} kodu, kas tiek rādīti pēc kārtas. Var arī kopēt tekstu un neizmantot kameru.{value1}',
    one: '{count} kods, kas tiek rādīts pēc kārtas. Var arī kopēt tekstu un neizmantot kameru.{value1}',
    other:
      '{count} kodi, kas tiek rādīti pēc kārtas. Var arī kopēt tekstu un neizmantot kameru.{value1}',
  },
  'settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f': {
    zero: 'Šai pārsūtīšanai vajadzīgo kodu skaits: {count}; to ir pārāk daudz, lai katru fotografētu. Kopējiet tekstu ziņojumā vai saglabājiet to failā un nosūtiet failu.{value1}',
    one: 'Šai pārsūtīšanai vajadzīgo kodu skaits: {count}; to ir pārāk daudz, lai katru fotografētu. Kopējiet tekstu ziņojumā vai saglabājiet to failā un nosūtiet failu.{value1}',
    other:
      'Šai pārsūtīšanai vajadzīgo kodu skaits: {count}; to ir pārāk daudz, lai katru fotografētu. Kopējiet tekstu ziņojumā vai saglabājiet to failā un nosūtiet failu.{value1}',
  },
  'settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659':
    'Nevarēja nokopēt tekstu. Izvēlieties to tālāk un kopējiet vai saglabājiet kā failu.',
  'settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c':
    'Pārsūtīšana nokopēta. Ielīmējiet to citā ierīcē.',
  'settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07':
    'Atveriet to citā ierīcē sadaļā “Lasīt pārsūtījumu”.',
  'settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2':
    'Saglabāts mapē {value0}. {value1}.',
  'settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d':
    'Saglabāts kā {value0} šīs krātuves slēptā mapē, ko nenes Abele Sync. ',
  'settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef':
    '{value0}, un izdzēsiet to, kad tas ir izlasīts.',
  'settings.transfer.TransferSendModal.could_not_save_it_value.14315a58':
    'Nevarēja to saglabāt: {value0}',
  'settings.rich.bc6ba5473fff4aa8':
    'Skripts, kura pirmajās rindiņās ir rakstīts {slot0}, ir noteikums: tas atdod {slot1} — sarakstu ar nepareizo informāciju un var atdot {slot2} — piezīmes jauno tekstu. Tas ir norādīts iepriekš kopā ar citiem. Dokumentācijas lapā Skripti tiek parādīts viens.',
  'settings.rich.ae545f75ff9437be': 'Šajā krātuvē nav prasmju. Prasmes ir piezīmes ar {slot0}.',
  'settings.rich.3cf5061d7d4aaae2':
    'Atslēgas un marķieri API pieprasījumiem. AI aģents ieneses zvanos izmanto {slot0}, kas tiek aizstāts ar faktisko vērtību. Droši uzglabāts atslēgu saišķī.',
  'settings.rich.59db234df027f515':
    'Skripti, kas darbojas paši, kad kaut kas notiek ar piezīmi: uzdevums ir pabeigts, kāda veida piezīme ir mainīta. Skripts lasa notikušo kā {slot0}. Parametri pieņem {slot1} un jebkuru piezīmes galveno lauku. Tie darbojas ierīcē, kurā tika veiktas izmaiņas; paša skripta raksti nekad vairs neiedarbina to pašu automatizāciju.',
  'settings.rich.5c124ccc61dc59ea':
    'Pogas virs piezīmes teksta, kas palaiž komandu vai skriptu jūsu izvēlētajās piezīmēs šādā secībā. Skriptam var piešķirt piezīmes vērtības: {slot0} vai jebkuru rekvizītu, {slot1}.',
  'settings.rich.225479f70a17e374':
    'Katrs skripts skriptu mapē. Skripts sevi apraksta komentāru blokā faila augšdaļā: {slot0}, {slot1}, {slot2} un {slot3} rinda katrai vajadzīgajai vērtībai. Spraudīte ievieto skriptu rīkjoslā: ikona datora kreisajā lentē un vieta rīkjoslā virs tastatūras tālrunī — {slot4} galvenē dara to pašu. Ieslēgšanas poga palaiž skriptu katru reizi, kad tiek palaists Obsidian; {slot5} savā galvenē dara to pašu, un cilne Startēšana sakārto tos.',
  'settings.rich.82dd523dc663e313':
    'Atklāti {slot0} skripti. Konfigurējiet rīku režīmus {slot1} vai vienai tērzēšanai atļauju modālā.',
  'settings.terms.keySaved': 'Atslēga saglabāta',
  'settings.terms.noKeyYet': 'Vēl nav atslēgas',
  'settings.terms.thisKey': 'šī atslēga',
  'settings.terms.none': 'neviens',
  'settings.terms.theSecret': 'noslēpums',
  'settings.terms.unnamedAutomation': 'šī nenosauktā automatizācija',
  'settings.terms.unnamedButton': 'šī nenosauktā poga',
  'settings.terms.password': 'parole',
  'settings.terms.link': 'saite',
  'settings.terms.book': 'grāmatu',
  'settings.terms.chat': 'tērzēšana',
  'settings.terms.missingSuffix': ' · pazudis',
  'settings.terms.resetsSuffix': ' · atiestata ',
  'settings.metadata.c99cb7557b2bd7cb': 'Lasīt datus',
  'settings.metadata.ba35eb1f0c41c920': 'Analizējiet datus',
  'settings.metadata.93b5e95f0841a6c1': 'Grāmatas svarīgākie punkti',
  'settings.metadata.9b9ab66d2dc6d4e6': 'Izcelt grāmatā',
  'settings.metadata.836cba1ac2f246a0': 'Mainiet izcēlumu',
  'settings.metadata.6bbd1e58f841181f': 'Noņemiet izcēlumu',
  'settings.metadata.1d5729de03eb270a': 'Grāmatzīme grāmatā',
  'settings.metadata.d9e8263863cd7c1a': 'Grāmatu cilnes',
  'settings.metadata.c8e5758cffa93be0': 'Grāmatas saturs',
  'settings.metadata.3e6c3299627e72e5': 'Lasīt grāmatu',
  'settings.metadata.efb806b8e248de86': 'Meklēt grāmatu',
  'settings.metadata.973b70df8c6835ab': 'Parādīt grāmatā',
  'settings.metadata.e1b19c0fcc092bb5': 'Saraksta grāmatas',
  'settings.metadata.3824a9f4dafe92c6': 'Audekls',
  'settings.metadata.ca58ee75a82eb866': 'Diagrammu dokumenti',
  'settings.metadata.1f104d4e483afe57': 'Kopēt failu',
  'settings.metadata.f1eb5a8241e4bf26': 'Izveidot failu',
  'settings.metadata.016fc69b8f33e22e': 'Skripta API dokumenti',
  'settings.metadata.e3de1e15d36b9e54': 'Izveidot skriptu',
  'settings.metadata.cf8c8078d8db9550': 'Pašreizējā atrašanās vieta',
  'settings.metadata.1e814554ca1b586f': 'Lasīt klāju',
  'settings.metadata.cf31f39501ec79cc': 'Prezentācijas',
  'settings.metadata.07bcab5dd6c2b3ac': 'Izveidojiet klāju',
  'settings.metadata.a34f02e3fb7f55ab': 'Rediģēt slaidu',
  'settings.metadata.ee9a26182331bd59': 'Pārbaudiet klāja piemērotību',
  'settings.metadata.4c3cd91f9873a96b': 'Atvērt prezentāciju',
  'settings.metadata.3ecb6f7da6cd8b57': 'Deleģēt aģentam',
  'settings.metadata.e1e5fe2043bd3003': 'Dzēst failu',
  'settings.metadata.072bcdf480cf935b': 'Rediģēt Word dokumentu',
  'settings.metadata.3a2860ece5a4ee0b': 'Vārds',
  'settings.metadata.d62c5e04e2041963': 'Word cilnes',
  'settings.metadata.fdbd5cb0402f63f0': 'Lasīt Word dokumentu',
  'settings.metadata.abcfc9b08f141d57': 'Meklēt Word dokumentā',
  'settings.metadata.8fc231e28ab03931': 'Lejupielādēt attēlu',
  'settings.metadata.d5501e84dd2baf5a': 'Lejupielādēt failu',
  'settings.metadata.c3df84ddf2927d7f': 'Paskaties uz zīmējumu',
  'settings.metadata.c769c50ec11b66ce': 'Rediģēt failu',
  'settings.metadata.5597753f9c2ffeb8': 'Rediģēt attēlu',
  'settings.metadata.b9aca9af90312aa4': 'Rediģēt atlasi',
  'settings.metadata.529285444d7e58bf': 'Novērtējiet JavaScript',
  'settings.metadata.e663529b7a08617b': 'Migrēt Excalidraw zīmējumus',
  'settings.metadata.014b08ed6d8976df': 'Ielādēt URL',
  'settings.metadata.d20890b1e4db1fa1': 'Atrodiet failus',
  'settings.metadata.a6bd489d95504499': 'Aizmirsti',
  'settings.metadata.0f44b5601ade4f85': 'Ģenerēt attēlu',
  'settings.metadata.1606207c55304e06': 'Ģeokods',
  'settings.metadata.bf4c6dda970987a0': 'Atrodiet vietas',
  'settings.metadata.06cc7177f48987cc': 'Izveidojiet maršrutu',
  'settings.metadata.abce462b78197fc5': 'Pārbaudīt skatu',
  'settings.metadata.1f728b52096a2eb0': 'Pūka piezīmes',
  'settings.metadata.f0c84f13ed58b1d6': 'Novērsiet plūksnas problēmas',
  'settings.metadata.ede087fd8f5ce83a': 'Saraksta darbvieta',
  'settings.metadata.535843b2c2fee0eb': 'Saraksta direktorijs',
  'settings.metadata.002cc66337cf3764': 'Pārvietot/pārdēvēt failu',
  'settings.metadata.7ac362063b9f2046': 'Mezgli',
  'settings.metadata.1e8d18f62f2d2a2f': 'Atveriet failu',
  'settings.metadata.c0d019c19251efca': 'Pieprasīt dokumentus',
  'settings.metadata.9a72221a27476f3e': 'Jautājumi',
  'settings.metadata.fb9b615c6b482637': 'Lasīt failu',
  'settings.metadata.6562fb21e7fbb468': 'Lasīt attēlu',
  'settings.metadata.7b4a3b51f8248d49': 'Lasīt žurnālus',
  'settings.metadata.75ce2bbc2da8977a': 'Lasiet atpakaļsaites',
  'settings.metadata.a50358c35c21caf0': 'Izlasiet Darījumus',
  'settings.metadata.6f987478bf258d46': 'Lasiet uzdevumus',
  'settings.metadata.8096a7bd9a09e11f': 'Atcerieties',
  'settings.metadata.95e154398a4bc009': 'Aizstāt',
  'settings.metadata.ddf641f9a5ee4177': 'Ierosināt atbildes pārskatīšanu',
  'settings.metadata.029320ad166c1807': 'Ekrānuzņēmums',
  'settings.metadata.40945d7914b5838d': 'Atbildes forma',
  'settings.metadata.17434a9251409137': 'Izlasiet iestatījumus',
  'settings.metadata.7fe866d491ae7890': 'Ierakstiet iestatījumus',
  'settings.metadata.6df1bb18a59ab97d': 'Prasme',
  'settings.metadata.118469284c824130': 'Veidņu dokumenti',
  'settings.metadata.f7b314c3f5d5dcea': 'Saraksta veidnes',
  'settings.metadata.23febe05ea52c943': 'Lietot veidni',
  'settings.metadata.d04fc7d7e19702f8': 'Meklēšana tīmeklī',
  'settings.metadata.d78cd87c20261047': 'Rakstīt failu',
  'settings.metadata.ff4e3889f363a511': 'Rakstīt darbgrāmatas šūnas',
  'settings.metadata.48d53635551c8fd4': 'Excel',
  'settings.metadata.9a8eb492fd32afbe': 'Darba burtnīcas lapas',
  'settings.metadata.51feedc6468c9521': 'Lasīt darbgrāmatas diapazonu',
  'settings.metadata.6b11523da566fd08': 'Meklēt darbgrāmatu',
  'settings.metadata.8463eb4799ceda94': 'Izveidojiet ZIP',
  'settings.metadata.ee52497854a67e54': 'Izlasiet GitHub failu',
  'settings.metadata.7ba6f2c8e75022bd': 'GitHub apņemas',
  'settings.metadata.c97212ae47ab4694': 'Grep kods versijā',
  'settings.metadata.eff04b0872a1b825': 'Izlasiet GitHub vienumu',
  'settings.metadata.9632f6701a8ca357': 'Izvelciet pieprasījuma failus',
  'settings.metadata.ff48a92c96b73fa8': 'Meklēt GitHub',
  'settings.metadata.f5db8240ba9c07c2': 'GitHub cilnes',
  'settings.metadata.0a876c393a858219': 'Rādīt cilnē GitHub',
  'settings.metadata.47659c3dccc86dc6': 'Lasīt failu',
  'settings.metadata.abc7e9892806b047': 'Faili',
  'settings.metadata.9608dd142d9b10d7': 'Rediģēt failu',
  'settings.metadata.997357233881bfb9': 'Rakstīt failu',
  'settings.metadata.6990d3217b7749c8': 'Izveidot failu',
  'settings.metadata.28e18dc9db382d81': 'Dzēst failu',
  'settings.metadata.f83e6d79cd9c3e10': 'Pārvietot failu',
  'settings.metadata.b60f1c7ad15c2b04': 'Kopēt failu',
  'settings.metadata.930a81591b83ad25': 'Saraksts direktorijā',
  'settings.metadata.15d12bc10296dc2d': 'Atrodiet failus',
  'settings.metadata.87bb59ba2f92f2a5': 'Darbvieta',
  'settings.metadata.d515d2ee195fa943': 'Lasīt attēlu',
  'settings.metadata.4190c0c7ec727064': 'Atvērt failu',
  'settings.metadata.693ba7f5f3d9f77d': 'Lietotnes skats',
  'settings.metadata.dc37f2f4529c4136': 'Pārbaudīt skatu',
  'settings.metadata.7711faa74a10416c': 'Meklēšana tīmeklī',
  'settings.metadata.2975104784a401e3': 'Web',
  'settings.metadata.3ac575dcce244f93': 'Lejupielādēt attēlu',
  'settings.metadata.9de4149fb9716cfc': 'Lejupielādēt failu',
  'settings.metadata.f911e414cf6bdfc5': 'GitHub',
  'settings.metadata.f7f0f6218e3ab3ce': 'Izlasiet izdevumu vai PR',
  'settings.metadata.046ceaf4f065a500': 'PR faili',
  'settings.metadata.d09648c6058a4c84': 'Apņemas',
  'settings.metadata.49c266baaaa70981': 'Meklēšana',
  'settings.metadata.b2cfbf5af10d5b5d': 'Rādīt cilnē',
  'settings.metadata.9da7f76bc81d2f4e': 'Grāmatas',
  'settings.metadata.119e66d117ae8f0c': 'Kartes',
  'settings.metadata.1c9c87eec07e453b': 'Ģenerēt attēlu',
  'settings.metadata.be7e2f20129365c2': 'Attēli',
  'settings.metadata.d9d12b04b3831c32': 'Rediģēt attēlu',
  'settings.metadata.6bea010c8fb418a4': 'Evals JS',
  'settings.metadata.8fdd2ee8475e29bc': 'Pamati',
  'settings.metadata.760ed96061ace03e': 'Deleģēt',
  'settings.metadata.a6d910ba93b7f894': 'Delegācija',
  'settings.metadata.c3963aedaac6c83c': 'Atmiņa',
  'settings.metadata.2e19427030d9d43c': 'Diagrammu dokumenti',
  'settings.metadata.7af023c43013b9a5': 'Dokumenti',
  'settings.metadata.5afdd3f5b60d4d59': 'Veidnes dokumenti',
  'settings.metadata.9d45317393ff2163': 'Lasīt žurnālus',
  'settings.metadata.19b88504fa831ce1': 'Piezīmju dati',
  'settings.metadata.8c87f5ea162d2e65': 'Lasīt atpakaļsaites',
  'settings.metadata.692a437039f64732': 'Lasīt darījumus',
  'settings.metadata.b696d75511dc16f2': 'Finanses',
  'settings.metadata.d340a6c01b6f5fee': 'Lasīt uzdevumus',
  'settings.metadata.b3a60e61a5233d05': 'Uzdevumi',
  'settings.metadata.a249b2df7cba7a38': 'Saraksta veidnes',
  'settings.metadata.56b564b75c7fdb48': 'Veidnes',
  'settings.metadata.a0859ef85c0a0934': 'Lietot veidni',
  'settings.metadata.6dc2a1098225593e': 'Skripta API dokumenti',
  'settings.metadata.74a883a037bc227f': 'Iestatījumi',
  'settings.metadata.ea59135c1811dd4d': 'Izveidot skriptu',
  'settings.metadata.8d0e6b4ab60543cf': 'Skripti',
  'settings.metadata.7000d0dc57ecf4be': 'Lasīt rezultātu',
  'settings.metadata.d9e66d2ce531344c': 'Mezglu faili',
  'settings.metadata.e93372533f323b2f': 'Mezgls',
  'settings.metadata.6ded9685b4a797e6': 'Lasiet failus un meklējiet',
  'settings.metadata.562123f8976fe819': 'Rediģēt failus',
  'settings.metadata.aec2f93d67b7c4c5': 'Darba koki',
  'settings.metadata.e90a0f8d49e203ea': 'Uzticēt darbu mezgla aģentam',
  'settings.metadata.b907a91b588b818c': 'Atkļūdotājs darbojas',
  'settings.metadata.befc6e918047c85b': 'Jūsu ziņas',
  'settings.metadata.f39b199601422405': 'Aģenta atbildes',
  'settings.metadata.b6c1d862f9f75ec3': 'Abi',
  'settings.metadata.0ca9f9fe82be9456': 'Tikai melnraksts',
  'settings.metadata.65c3ce1551b7fdc4': 'Pēdējās 4 ziņas',
  'settings.metadata.87e460223959d06f': 'Pēdējās 10 ziņas',
  'settings.metadata.27ba0224f1937dcd': 'Visa saruna',
  'settings.metadata.abc9eb2fc4a07abf':
    'Uz šo savienojumu ir nosūtīts lietotāja aģents. Tukšs saglabā noklusējuma vērtību. Mobilā straumēšana var to ignorēt.',
  'settings.metadata.fcc01b1454819dec': 'Seko tēmai',
  'settings.metadata.17ed08435ee39aec': 'Brīvība',
  'settings.metadata.e4378e9c551f7f9c': 'Gaišs',
  'settings.metadata.437b56da751ee02a': 'Pozitroni, klusi',
  'settings.metadata.60acc53f13a5d1bf': 'Tumšs',
  'settings.metadata.2620b9ac0d72c634': 'Fjords, tumši zils',
  'settings.metadata.3d5b0ed33cbfc204': 'Savs stils pēc URL',
  'settings.metadata.a57b3a3a34957437': 'Ir īpašības',
  'settings.metadata.fdd539aca215e393': 'Piezīme sākas ar rekvizītu bloku (--- tā pirmajā rindā).',
  'settings.metadata.a9aeaf057d72407f': 'Rekvizītus var lasīt',
  'settings.metadata.048c4415ef41ad0a': 'Nepieciešamās īpašības',
  'settings.metadata.ae43692b2a310b8e': 'Īpašības',
  'settings.metadata.079647a8b86e4378':
    'Atdalīts ar komatu. "nosaukums: noklusējuma", lai labojums to aizpildītu.',
  'settings.metadata.3c0c64e0fd626bca': 'Ir piezīmju veids',
  'settings.metadata.a628c83f6a069d90':
    'Piezīmē ir norādīts, kas tas ir tā veida īpašumā — uzdevums, persona, tikšanās. Izmantojot tipu sarakstu, vērtībai ir jābūt vienai no tām.',
  'settings.metadata.40040cb181f7f0ee': 'Īpašība',
  'settings.metadata.853362b96c0c33a4': 'Kur ir rakstīts veids.',
  'settings.metadata.2b04790e11e9360e': 'Atļautie veidi',
  'settings.metadata.fc2ba0dd4e23cdd0': 'Atdalīts ar komatu. Tukšs laiž cauri jebkuru vērtību.',
  'settings.metadata.21b111cbfe6e8fca': 'Noklusējums',
  'settings.metadata.0482acc3c6913a87':
    'Labojums ierakstījis piezīmē bez veida. Tukšs: nekas nav labots.',
  'settings.metadata.147e6bba43829675': 'Nav atzīmju',
  'settings.metadata.c03ca2fe828c431e':
    'Vault, kas neizmanto tagus: tagu rekvizītu izņem labojums; #tag tekstā ir parādīts, ka tas tiek apstrādāts ar roku.',
  'settings.metadata.d4743e63e45dde22': 'Atzīmes tekstā',
  'settings.metadata.587ccd181c91d2a8': 'Atrodiet arī tekstā ierakstītos #tags.',
  'settings.metadata.fdca3c91c0898bd4': 'Nevēlamas īpašības',
  'settings.metadata.a4ef39b33278f6ef':
    'Neviena no uzskaitītajiem īpašumiem tur nav. Labojums tos izņem.',
  'settings.metadata.0a26d2a3c07531d9': 'Atdalīts ar komatu.',
  'settings.metadata.29a015b0a78abcc6': 'Tukša rinda aiz rekvizītiem',
  'settings.metadata.56bae77505677e3c':
    'Tieši viena tukša rindiņa atrodas starp rekvizītiem un tekstu.',
  'settings.metadata.6ca1bd19ad8e5df4': 'Nav pirmā līmeņa virsraksta',
  'settings.metadata.a5b697a0a2aa9674':
    'Faila nosaukums ir nosaukums, tāpēc tekstam nav # virsraksta. Labojums noņem vienu, kas atkārto nosaukumu, un jebkuru citu padara virsrakstu ##.',
  'settings.metadata.93df69cc2eaf6ff1': 'Datumi, kas rakstīti kā datumi',
  'settings.metadata.7ef1f2a6ca083e8a':
    'Sarakstā norādīto īpašumu datums ir YYYY-MM-DD. Labojums pārraksta 2026-9-5, 05.09.2026 un [[2026-09-05]].',
  'settings.metadata.9024c197d84940e4': 'Saites',
  'settings.metadata.1d80ae7836ce9902': 'Virsraksta pogas',
  'settings.metadata.ad1fb9ec0cb3c7a4': 'Automatizācijas',
  'settings.metadata.c20c37564e3f3409': 'Dienasgrāmatas',
  'settings.metadata.e95944e1c3c81e4c': 'GitHub savienojumi',
  'settings.CalendarsSettings.value_h_ago.d5aa4bb8': '{value0} pirms h',
  'settings.CalendarsSettings.value_d_ago.0f70078c': '{value0} pirms d',
  'settings.CalendarsSettings.value_from_value_kept.419ae64a': '{value0} no {value1}, saglabāts',
  'settings.CalendarsSettings.value_read_value.6e58c8af': '{value0}, nolasīts {value1}',
  'settings.GithubSettings.account_not_checked.d2a6562d': 'Konts nav pārbaudīts',
  'settings.GithubSettings.token_expires_within_seven_days.1b81c28c':
    'Token beidzas septiņu dienu laikā',
  'settings.LinterSettings.in_value.b63d3a91': '{value0}',
  'settings.LinterSettings.where_value_value.e534e0d0': 'kur {value0}{value1}',
  'settings.LinterSettings.script_value.c5efe1d1': ' Skripts: {value0}.',
  'settings.LinterSettings.only_value.e2625151': ' Tikai {value0}.',

  'settings.SecretsListModal.value_set.f4c8f3b4': '{value0} komplekts',
  'settings.SecretsListModal.value_synced.1785a4d0': '{value0} sinhronizēts',
  'settings.TransferSettings.value_of_value.ca6c5e5f': '{value0} no {value1}',
  'settings.TransferSettings.value_selected.975acbfe': 'Atlasīts {value0}',

  'settings.ai.interceptorList.matching_value.b4ca1a61': 'atbilst {value0}',

  'settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986':
    '{value0}…{value1} ({value2} rakstzīmes)',
  'settings.transfer.TransferScanModal.value_at_value.92c9c89a': '{value0} un {value1}',
  'settings.count.item': {
    zero: '{count} vienumu',
    one: '{count} vienums',
    other: '{count} vienumi',
  },
  'settings.count.key': {
    zero: '{count} atslēgu',
    one: '{count} atslēga',
    other: '{count} atslēgas',
  },
  'settings.count.file': { zero: '{count} failu', one: '{count} fails', other: '{count} faili' },
  'settings.count.code': { zero: '{count} kodu', one: '{count} kods', other: '{count} kodi' },
  'settings.count.prompt': {
    zero: '{count} uzvedņu',
    one: '{count} uzvedne',
    other: '{count} uzvednes',
  },
  'settings.count.scopeEntry': {
    zero: '{count} tvēruma ierakstu',
    one: '{count} tvēruma ieraksts',
    other: '{count} tvēruma ieraksti',
  },
  'settings.count.event': {
    zero: '{count} notikumu',
    one: '{count} notikums',
    other: '{count} notikumi',
  },
  'settings.count.model': {
    zero: '{count} modeļu',
    one: '{count} modelis',
    other: '{count} modeļi',
  },
  'settings.count.button': { zero: '{count} pogu', one: '{count} poga', other: '{count} pogas' },
  'settings.count.tool': { zero: '{count} rīku', one: '{count} rīks', other: '{count} rīki' },

  'settings.parts.fa11c9afc868fc1e': ' · atiestata {value0}',

  'settings.parts.520a5d3ab1d92888': ' ir {value0}',
  'settings.parts.9edb143e79ddd491': '(bez nosaukuma)',

  'settings.parts.951aaf14e2b23dff':
    ' Tā {value0} galvene joprojām ievieto to šajā izvēlnē; noņemiet šo rindiņu no skripta, lai to paslēptu.',
  'settings.parts.195dc73d2db93bf8': 'Tas tiks noņemts',
  'settings.parts.778541341fcda9aa': 'Tie tiks noņemti',

  'settings.metadata.86ed522daec49399': 'AI ģenerālis',
  'settings.metadata.8748f23993a86245': 'Balss ievade',
  'settings.metadata.2c4aed90f68a9826': 'AI nodrošinātāji',
  'settings.metadata.d110fe793fa72de1': 'Attēlu nodrošinātāji',
  'settings.metadata.279b44d2ab4b40c0': 'Aģenti',
  'settings.metadata.22a7559f09bf8f82': 'MCP serveri',
  'settings.metadata.e5f4cb8707719fbd': 'Saglabātās atslēgas',
  'settings.metadata.5f2e66e6539797d0': 'Uzvednes',
  'settings.metadata.f46ee86a068c4c22': 'Skripta iestatījumi',
  'settings.metadata.66d0f523a379b2de': 'Prasmes',
  'settings.metadata.f6a1fdbcca54b2f8': 'Ātrās piezīmes',
  'settings.metadata.71fea45d263e0906': 'Uzdevums izpildīts',
  'settings.metadata.968a994a15bd991a': 'Uzdevums atkārtoti atvērts',
  'settings.metadata.a3e3e968c40e5951': 'Uzdevums izveidots',
  'settings.metadata.ba3078bec8c60a69': 'Uzdevums mainīts',
  'settings.metadata.98acf0d427bd63b5': 'Uzdevuma datums mainīts',
  'settings.metadata.d41c129fb8fdf353': 'Piezīme izveidota',
  'settings.metadata.e6a78804e128667f': 'Piezīme mainīta',
  'settings.metadata.4a33279d562ffb24': 'Piezīme pārdēvēta',
  'settings.metadata.81f7d1888d5a03be': 'Piezīme izdzēsta',
  'commands.external-file-evict': 'Glabāt tikai serverī',
  'commands.external-file-pin': 'Glabāt šajā ierīcē',
  'commands.external-file-hydrate': 'Lejupielādēt šajā ierīcē',
  'settings.ordinal.first': 'pirmais',
  'settings.ordinal.second': 'otrais',
  'settings.ordinal.third': 'trešais',
  'settings.ordinal.number': '{count}.',
  'settings.terms.script': 'skripts',
  'settings.CalendarsSettings.new_link.f9e84245': 'Jauna saite...',
  'settings.CalendarsSettings.save_the_link.7b19a248': 'Saglabājiet saiti',
  'settings.CalendarsSettings.the_link.f0fb533a': 'Saite',
  'settings.CalendarsSettings.new_password.1abebe85': 'Jauna parole...',
  'settings.CalendarsSettings.save_the_password.acd9c185': 'Saglabājiet paroli',
  'settings.CalendarsSettings.the_password.3f4e5252': 'Parole',
  'settings.FinanceSettings.new_token.564f08bc': 'Jauns marķieris...',
  'settings.FinanceSettings.save_the_token.8326f085': 'Saglabājiet marķieri',
  'settings.FinanceSettings.the_token.d22bffce': 'Žetons',
  'settings.GithubConnectionEditor.new_token.564f08bc': 'Jauns marķieris...',
  'settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882':
    'Izmantojiet šo marķieri, saglabājot savienojumu',
  'settings.GithubConnectionEditor.the_token.d22bffce': 'Žetons',
  'settings.GithubSettings.new_token.564f08bc': 'Jauns marķieris...',
  'settings.GithubSettings.save_the_notifications_token.d4a25b6f':
    'Saglabājiet paziņojumu marķieri',
  'settings.GithubSettings.the_notifications_token.266dfc35': 'Paziņojumu marķieris',
  'settings.ai.InterceptorList.runs_value.fe51da79': 'Darbojas {value0}',
  'settings.ai.McpServerModal.new_token.564f08bc': 'Jauns marķieris...',
  'settings.ai.McpServerModal.save_the_token.8326f085': 'Saglabājiet marķieri',
  'settings.ai.McpServerModal.the_token.d22bffce': 'Žetons',
  'settings.transfer.TransferPreviewModal.what_goes.39dde11f': 'kas iet',
  'settings.GithubSettings.delete_this_connection_and_forget.1a526c31':
    'Izdzēsiet šo savienojumu un aizmirstiet tā vietējo pilnvaru',
  'settings.GithubSettings.forget.a6bd489d': 'Aizmirsti',
  'settings.GithubSettings.remove_the_notifications_token_from.d1453607':
    'Noņemiet paziņojumu pilnvaru no atslēgu saišķa',
  'settings.ImageModelEditModal.delete_value.8782b778': 'Dzēst {value0}',
  'settings.ModelEditModal.delete_value.8782b778': 'Dzēst {value0}',
  'settings.QuickButtonSettings.take_out.a7fc33e3': 'Izņem ārā',
  'settings.QuickButtonSettings.take_value_out_of_the.8b01b719': 'Izņemiet {value0} no izvēlnes',
  'settings.SecretsListModal.put_every_key_on_the.8118968c':
    'Ievietojiet katru taustiņu starpliktuvē kā vienkāršu tekstu',
  'settings.ai.AgentsSettings.delete_value.8782b778': 'Dzēst {value0}',
  'settings.ai.McpServerModal.delete_value.8782b778': 'Dzēst {value0}',
  'settings.ai.McpSettings.delete_value.8782b778': 'Dzēst {value0}',
  'settings.scripts.AutomationsEditor.delete_value.8782b778': 'Dzēst {value0}',
  'settings.scripts.HeaderButtonsEditor.delete_value.8782b778': 'Dzēst {value0}',
  'settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8': 'Pacelieties',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c':
    'Izņemiet {value0} no izvēlnes',
  'settings.startup.computers': 'datoros',
  'settings.transfer.itemsToApply': {
    zero: 'Jāpiemēro {count} vienumu',
    one: 'Jāpiemēro {count} vienums',
    other: 'Jāpiemēro {count} vienumi',
  },
  'settings.calendar.found': {
    zero: 'Atrasti {count} kalendāru.',
    one: 'Atrasts {count} kalendārs.',
    other: 'Atrasti {count} kalendāri.',
  },
  'settings.mcp.fetched': '{tools}, iegūts {when}',
  'settings.sentence.2de766f4c2331579':
    'Saglabātās vērtības tiek ievietotas pieprasījumā; tās šeit nekad netiek rādītas. Atļauja šajā ierīcē iegaumē šo adresi atslēgām {value0}, tāpēc šeit vairs nejautās. Citās ierīcēs atļauja joprojām tiks prasīta.',
  'settings.sentence.c93c0ada01c57a48': 'Pieejamie modeļi: {value0}',
  'settings.sentence.cdb07f66a428a0ed': 'Nav saglabāts: {value0}',
  'settings.sentence.4f7ec121b15ac5e4': 'Nekur netiek rādīts · {value0}',
  'settings.sentence.7caf85c3282be170': 'vēl jāatrod: {value0}',
  'settings.sentence.2d2a1f1b3800ab01': 'Izveidots {value0}. Atzīmējiet, ko paturēt.',
  'settings.secrets.removeNamed':
    'Vai noņemt {name}? Visi fetch izsaukumi, kas izmanto šo nosaukumu, pārstās darboties, un saglabātā vērtība tiks dzēsta no atslēgu saišķa.',
  'settings.mcp.headersDescription':
    'Pa vienam katrā rindā formātā Name: value. Slepenai vērtībai izmantojiet {example}, atslēgu no sadaļas MI → Vispārīgi → Saglabātās atslēgas, lai tā nenonāktu iestatījumu failā.',
  'settings.sync.presentation.e159b06187d369a0': 'Pauzēts',
  'settings.sync.presentation.857a66dd7a6dfe32': ' · {completed} no {total}',
  'settings.sync.presentation.265ec42c10960f4e': ' · Nepieciešama uzmanība',
  'settings.sync.presentation.a3e3205316b64477':
    'Serveris nav pieejams. Notiek atkārtots mēģinājums',
  'settings.sync.presentation.c70acece009d71d9': '{completed} no {total} failiem',
  'settings.sync.presentation.5c8b9e1ce0a2bc31': 'Sinhronizācija',
  'settings.sync.presentation.0d60f3335d21fa2b': {
    zero: '{count} konflikta kopiju',
    one: '{count} konflikta kopija',
    other: '{count} konflikta kopijas',
  },
  'settings.sync.presentation.96f22a9119067884': {
    zero: 'Nav nosūtīts {count} failu',
    one: 'Nav nosūtīts {count} fails',
    other: 'Nav nosūtīti {count} faili',
  },
  'settings.sync.presentation.9e1b70e3f4abbe8e': 'Sinhronizēts {when}',
  'settings.sync.presentation.c10529851ad89bd3': 'Vēl nav sinhronizēts',
  'settings.sync.presentation.2512ef45cc838dc2':
    'Nepieciešama sinhronizācijas atkopšana. Faili un savienojums ir saglabāti.',
  'settings.sync.presentation.fbcbda4833c5c0b7':
    'Servera atbilde tika pārtraukta, pirms tā tika pabeigta. Mēģiniet sinhronizēt vēlreiz.',
  'settings.sync.presentation.fd2175ceceb4c39f':
    'Šis marķieris ir bojāts vai nepilnīgs. Vēlreiz ielīmējiet visu marķieri.',
  'settings.sync.presentation.93754bdbbee0e2c4':
    'Serveris nav sasniedzams. Pārbaudiet savienojumu un mēģiniet vēlreiz.',
  'settings.sync.presentation.f58e7749a37e75de': 'Piekļuve ir slēgta. Pieprasiet jaunu žetonu.',
  'settings.sync.presentation.c3dbee340e1c8ed3':
    'Grupa joprojām tiek gatavota. Failu apmaiņa nav sākusies.',
  'settings.sync.presentation.753e9b392eca8228':
    'Serveris ir pilns. Jūsu nenosūtītie faili paliek šajā ierīcē.',
  'settings.sync.presentation.7584f523308d5d6d':
    'Šis fails ir pārāk liels serverim. Tas paliek šajā ierīcē.',
  'settings.sync.presentation.9036c8e0dc30cc74':
    'Serveris ir pilns. Fails paliek šeit, un to var nosūtīt, kad būs pieejama vieta.',
  'settings.sync.presentation.bbb4cbf36ea63cbd': 'Šis savienojums neļauj veikt šo darbību.',
  'settings.sync.presentation.110ec9023ae84ee7':
    'Servera atbildei nevarēja uzticēties; sinhronizācija apturēta. Vietējie faili tika glabāti.',
  'settings.sync.presentation.9259b3f2e2f72c08': 'Šī mape vai grupa vairs nav pieejama.',
  'settings.sync.presentation.0303e18246708180': 'Nav savienots',
  'settings.sync.presentation.fe7c4c6f414c4083': 'Grupa ārpus šī savienojuma',
  'settings.sync.presentation.97c769d2eaf4ca1c': 'Mape ārpus šī savienojuma',
  'settings.sync.presentation.f56643958aeae61b': 'Grupa: {name}',
  'settings.sync.presentation.7dd20272337b469c': 'Atvērt versiju vēsturi · {name}',
  'settings.sync.presentation.cb44fe2561afccff': 'Visa velve',
  'settings.sync.presentation.5c802e6401aca4d2': 'Mape: {path}',
  'settings.sync.presentation.5fa7aac5375c5815': 'Gatavs',
  'settings.sync.presentation.b0f398a57ea3ca38': 'Serveris nav pieejams',
  'settings.sync.presentation.c1ebc7817870e5be': 'Nepieciešama uzmanība',
  'settings.sync.presentation.9b7e4ca97f057cbc': 'Nepieciešams žetons',
  'settings.sync.presentation.d403c686f6a10480': 'Savienojuma izveide',
  'settings.sync.presentation.58b1510f8abae1f2': 'Piekļuve nav pieejama',
  'settings.sync.presentation.5514efec066cba3e': 'Notiek piekļuves atjaunināšana',
  'settings.sync.presentation.ae9cea791e9bc09c': 'Izdzēsts serverī',
  'settings.sync.presentation.013c681e65af3ea9':
    'Serveris tika atjaunots no dublējuma — failu pārbaude',
  'settings.sync.presentation.43edbd9fcb4f94a4': 'Pārbauda atjaunotos failus',
  'settings.sync.presentation.ceb8c1fa2307911c':
    'Serverī pārdēvēta koplietotā mape: {from} → {to}; sinhronizācija apturēta',
  'settings.sync.presentation.d0be29aeb27cd431':
    'Mape pārvietota uz {path}; sinhronizācija apturēta',
  'settings.sync.presentation.b1241ef8763e3062': 'Mape ir pazudusi; sinhronizācija apturēta',
  'settings.sync.presentation.41920972f6474234':
    'Servera mape vai grupa nav pieejama; saglabāti vietējie faili',
  'settings.sync.presentation.54f2a3375e5dd52d': 'Piekļuve slēgta; saglabāti vietējie faili',
  'settings.sync.presentation.fc135b7008d458b4': '{stage}… {completed}/{total}{attention}',
  'settings.sync.presentation.a90a62a0bc219ded': 'Notiek krātuves pārbaude… {completed}/{total}',
  'settings.sync.presentation.ec5aa287907706b6': 'Failu {completed}/{total} salīdzināšana',
  'settings.sync.presentation.63ec9d9ac51fa025': 'Servera atbilde pārtraukta',
  'settings.sync.presentation.27a38f81837d5e05': {
    zero: '{count} mapju',
    one: '{count} mape',
    other: '{count} mapes',
  },
  'settings.sync.presentation.63352fdc2cd6bbbf': {
    zero: '{count} failu',
    one: '{count} fails',
    other: '{count} faili',
  },
  'settings.sync.presentation.7c907ab73773e102': {
    zero: '{completed} no vismaz {count} mapēm',
    one: '{completed} no vismaz {count} mapes',
    other: '{completed} no vismaz {count} mapēm',
  },
  'settings.sync.presentation.7438a7b7fe1ef4bb': {
    zero: '{completed} no vismaz {count} failiem',
    one: '{completed} no vismaz {count} faila',
    other: '{completed} no vismaz {count} failiem',
  },
  'settings.sync.presentation.20a1cd5ccd38098a': {
    zero: '{completed} no {count} mapēm',
    one: '{completed} no {count} mapes',
    other: '{completed} no {count} mapēm',
  },
  'settings.sync.presentation.9a139983ae1196bc': {
    zero: '{completed} no {count} failiem',
    one: '{completed} no {count} faila',
    other: '{completed} no {count} failiem',
  },
  'settings.sync.presentation.608ec17db8dff1ba': ' · {bytes} {unit} nodots',
  'settings.sync.presentation.4336b4a9e578c6ce': ' · {bytes} no {total} {unit}',
  'settings.sync.presentation.4a9aad432626cdc4': ' · palicis mazāk nekā 1 minūte',
  'settings.sync.presentation.c42b56810e72964d': ' · apmēram {minutes} min atlicis',
  'settings.sync.presentation.11a6767d5674c7e4': 'Gatavs',
  'settings.sync.presentation.88fe20810f158d65': 'Saglabāts; Vietējā tīrīšana joprojām notiek',
  'settings.sync.presentation.2011abd185905fbc': 'Uzglabāts šajā ierīcē. Vispirms ļaujiet noņemt',
  'settings.sync.presentation.cf6ecbdf93a4cbd4':
    'Atvērt redaktorā vai pašlaik tiek lietots. Aizveriet to un mēģiniet vēlreiz',
  'settings.sync.presentation.ba084f0f0f3f2d81':
    'Nenosūtītās izmaiņas paliek šajā ierīcē. Vispirms sinhronizējiet',
  'settings.sync.presentation.1450568cbc3989de': 'Versija mainījās. Priekšskatījums vēlreiz',
  'settings.sync.presentation.bfad3113a6082ae4':
    'Fails vairs neatbilst šim noteikumam. Priekšskatījums vēlreiz',
  'settings.sync.presentation.c257dbbbf04763fe': 'Nav pieejams bezsaistē',
  'settings.sync.presentation.8d4a166ba65e8cac': 'Šis fails nav pieejams serverī',
  'settings.sync.presentation.6d48d4d60ba51073':
    'Šī versija vēl nav serverī. Vispirms sinhronizējiet; fails paliek šeit',
  'settings.sync.presentation.3b110b3b8a0affae':
    'Sinhronizācija noraidīja šo failu. Vispirms atrisiniet tā sinhronizācijas statusu; tas paliek šeit',
  'settings.sync.presentation.3123f064bd232e76': 'Šis serveris neatbalsta izkraušanu',
  'settings.sync.presentation.4b9c0b68c8009214': 'Šī ierīces krātuve neatbalsta drošu izkraušanu',
  'settings.sync.presentation.67e22f73b49e31ce': 'Nepietiek vietas, lai droši lejupielādētu',
  'settings.sync.presentation.8925063fc75cd16d':
    'Cits fails aizņem galamērķi. Abi faili tika glabāti',
  'settings.sync.presentation.e2f0da1e1e6f9fdb': 'Šo failu nevar izlādēt',
  'settings.sync.presentation.a88ffdf4720bfc95': 'Jau glabājas tikai serverī',
  'settings.sync.presentation.2cfe6717c6efa346': 'Izpildāmie faili paliek šajā ierīcē',
  'settings.sync.presentation.f3912c33c1e7e094':
    'Pirms izkraušanas šim savienojumam ir jāpārbauda piekļuve',
  'settings.sync.presentation.4d77018e2e63b109':
    'Nepieciešama sinhronizācijas atkopšana. Fails paliek šeit',
  'settings.sync.presentation.54272d517782b52a': 'Pārbauda velvi',
  'settings.sync.presentation.6a534e2d9b68ac18': 'Failu salīdzināšana',
  'settings.sync.presentation.committing': 'Izmaiņu apstiprināšana',
  'settings.sync.presentation.0b398fdee3be023a': 'Mapju sagatavošana',
  'settings.sync.presentation.f8cc26b4a73ec961': 'Failu saņemšana',
  'settings.sync.presentation.37b345555d7ea6c1': 'Notiek lejupielāde',
  'settings.sync.presentation.8b898ca34ce71371': 'Notiek augšupielāde',
  'settings.sync.presentation.d9351cf978606788': 'Žetona lasīšana',
  'settings.sync.presentation.a11acbbb551a6ddc': 'Servera pārbaude',
  'settings.sync.presentation.dc4552a7de803f44': 'Mapes atvēršana',
  'settings.sync.presentation.dfe7d0dd9f350fd8': 'Savienojuma sagatavošana',
  'settings.sync.presentation.be0e89cc19c4cf38': 'Dzēsts serverī. Visi faili paliek šajā ierīcē.',
  'settings.sync.codeSource': 'Kods no {host} · {when}',
  'settings.sync.privateQuestion': 'Privāts fails · kopīgot ar {scope}?',
  'settings.components.AiScopeEditor.full_vault_access.e59147d6': 'Pilna piekļuve krātuvei',
  'settings.components.AiScopeEditor.the_agent_may_read_and.7215c412':
    'Aģents var lasīt un mainīt katru krātuvē esošo failu.',
  'settings.components.AiScopeEditor.the_agent_sees_only_what.dd8d63d0':
    'Aģents redz tikai tālāk norādīto.',
  'settings.components.AiScopeEditor.counting_group_members.6cf29d46':
    'Grupas dalībnieku skaitīšana',
  'settings.components.AiScopeEditor.what_the_agent_can_reach.9e1cc9cb': 'Ko aģents var sasniegt',
  'settings.components.AiScopeEditor.remove_value_from_scope.5306ceeb':
    'Izņemiet {value0} no darbības jomas',
  'settings.components.AiScopeEditor.loading_group_members.64b5fef7':
    'Notiek grupas dalībnieku ielāde',
  'settings.components.AiScopeEditor.show_more.f5c9bd13': 'Rādīt vairāk',
  'settings.components.AiScopeEditor.nothing_yet_the_agent_sees.83352aaa':
    'Vēl nekas: aģents neredz failus.',
  'settings.components.AiScopeEditor.add_to_what_the_agent.ba420695':
    'Pievienojiet tam, ko aģents var sasniegt',
  'settings.components.AiScopeEditor.add_a_note_folder_group.0a52ba05':
    'Pievienojiet piezīmi, mapi, grupu vai rakstu…',
  'settings.components.AiScopeEditor.could_not_count_group_members.58d42889':
    'Nevarēja saskaitīt grupas dalībniekus. Atkārtoti atveriet Access, lai mēģinātu vēlreiz.',
  'settings.components.AiScopeEditor.could_not_load_group_members.9a565298':
    'Nevarēja ielādēt grupas dalībniekus. Aizveriet un atkārtoti atveriet grupu, lai mēģinātu vēlreiz.',
  'settings.components.ToolModesEditor.show_core_tools.bea400e8': 'Rādīt galvenos rīkus',
  'settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03':
    'Rādīt vienmēr ieslēgtus rīkus, kurus nevar atspējot.',
  'settings.components.ToolModesEditor.all_tools.81c151f9': 'Visi instrumenti',
  'settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce':
    'Iestata visus tālāk norādītos rīkus vienlaikus. Katru pēc tam joprojām var mainīt atsevišķi.',
  'settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee':
    'Iestatiet katru instrumentu uz {value0}',
  'settings.components.ToolModesEditor.always_open.67b6ffc1': 'Vienmēr atvērts',
  'settings.components.ToolModesEditor.when_value_is_open.37a2f90a': 'Kad {value0} ir atvērts',
  'settings.components.ToolModesEditor.change_what_value_is_said.5508c12f':
    'Mainiet to, kas paredzēts {value0}',
  'settings.components.ToolModesEditor.reset_to_default.bc5b45ae':
    'Atiestatīt uz noklusējuma vērtību',
  'settings.components.ToolModesEditor.use_the_section_s_own.e02f836f':
    'Vēlreiz izmantojiet pašas sadaļas aprakstu',
  'settings.components.ToolModesEditor.done.11a6767d': 'Gatavs',
  'settings.components.ToolModesEditor.value_tools.a2c9c9bb': 'Rīki: {value0}',
  'settings.components.ToolModesEditor.hide_its_tools.52db5aef': 'Paslēpiet tā rīkus',
  'settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30':
    'Parādiet savus rīkus, katrs ar savu izvēli',
  'settings.components.ToolModesEditor.all_in_this_section.3d4eba9d': 'Viss šajā sadaļā',
  'settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a':
    'Iestatiet katru instrumentu {value0} uz {value1}',
  'settings.components.ToolModesEditor.use_this_server.8eb48b42': 'Izmantojiet šo serveri',
  'settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e':
    'Nodrošina katru šī servera rīku, katrs jautā pirms tā palaišanas.',
  'settings.components.ToolModesEditor.always_on.f017032a': 'vienmēr ieslēgts',
  'settings.components.ToolModesEditor.use_the_tool_s_own.520c244d':
    'Vēlreiz izmantojiet paša rīka aprakstu',
  'settings.components.ToolModesEditor.on_request.be820103': 'Pēc pieprasījuma',
  'settings.components.ToolModesEditor.off.ca7981b4': 'Izslēgts',
  'settings.components.ToolModesEditor.ask.b8c209cd': 'Jautāt',
  'settings.components.ToolModesEditor.auto.02862497': 'Auto',

  'settings.metadata.354509b1c9ccade8':
    'Faili, meklēšana un git vēsture mapēs, kuras šī tērzēšana tika sniegta mezglā. Tas, ko tas var sasniegt, ir iestatīts katrai tērzēšanai sadaļā Node access.',
  'settings.metadata.18a90996c684b6b3':
    'Atvērt, uzskaitīt un meklēt failus; statuss, atšķirības un vēsture git formātā.',
  'settings.metadata.e0b89715205e4ef5':
    'Izveidojiet, mainiet, pārvietojiet, kopējiet un dzēsiet failus.',
  'settings.metadata.d442700773269772': 'Norādiet mapes darbkokus un pārslēdzieties starp tiem.',
  'settings.metadata.29a212809fa10bf3':
    'Dodiet uzdevumu kodēšanas aģentam mezglā, sekojiet tam, nosūtiet to vairāk un atceliet to.',
  'settings.metadata.c7ad7ac4793fb440':
    'Izlasiet atkļūdotāja reģistrētās darbības, atzīmējiet to darbības, pievienojiet ieraksta punktus un pierakstiet tos; lasīt, saglabāt, importēt un nosūtīt projekta saglabātos pieprasījumus.',
  'settings.metadata.1fd38d5cbd2a997b': 'maska',
  'settings.metadata.f2892578274d2e49': 'atvērtā piezīme',
  'settings.metadata.034a0062488256f1': 'mapi',
  'settings.scope.groupNotes': {
    zero: 'grupa · {count} piezīmju',
    one: 'grupa · {count} piezīme',
    other: 'grupa · {count} piezīmes',
  },
  'settings.calendar.urlPlaceholder': 'https://… vai webcal://…',
  'settings.transfer.singleQr': 'Rādīt pārsūtījumu kā QR kodu',
  'settings.transfer.multipleQr': {
    zero: 'Rādīt pārsūtījumu kā QR kodus: {count}',
    one: 'Rādīt pārsūtījumu kā QR kodus: {count}',
    other: 'Rādīt pārsūtījumu kā QR kodus: {count}',
  },
  'settings.metadata.bf774e203130976f': 'Pievienot ierakstīšanas punktu',
  'settings.metadata.ed11479db97b1ec2': 'Atcelt uzdevumu mezglā',
  'settings.metadata.ce884b28082de708': 'Deleģēt uzdevumu mezglam',
  'settings.metadata.47cbd67f4decc509': 'Meklēt izpildē',
  'settings.metadata.20c3a692f1425939': 'Izsekot vērtībai',
  'settings.metadata.a63e38b5ef9d8acc': 'Turpināt uzdevumu mezglā',
  'settings.metadata.3dcb2cb134c18f1a': 'Importēt pieprasījumus',
  'settings.metadata.a657f2eaf9177c2b': 'Mezgla darbkopas',
  'settings.metadata.3f577c263389d695': 'Atzīmēt izpildē',
  'settings.metadata.f40ad2a69f110e1a': 'Failu kopēšana mezglā',
  'settings.metadata.4c55f1221ca27657': 'Mezgla uzdevumu galamērķi',
  'settings.metadata.19d5a1e505698a8d': 'Failu rediģēšana mezglā',
  'settings.metadata.58bab54373681382': 'Mezgla mapes',
  'settings.metadata.0887cebecaa90ad8': 'Git rindu autorība mezglā',
  'settings.metadata.7d99864f0651cf16': 'Git zari mezglā',
  'settings.metadata.c6d22695c2b49792': 'Git izmaiņas mezglā',
  'settings.metadata.2e62cdbaa5ee98f0': 'Git vēsture mezglā',
  'settings.metadata.74cd294db7d3e719': 'Git statuss mezglā',
  'settings.metadata.0c7411b73901f6c2': 'Mezgla failu saraksts',
  'settings.metadata.e5b0c93478880755': 'Failu pārvietošana mezglā',
  'settings.metadata.c5dfe7e400c6f227': 'Mezglu saraksts',
  'settings.metadata.fe2b5c47256ac07e': 'Failu lasīšana mezglā',
  'settings.metadata.b0dc611264fca372': 'Teksta aizstāšana mezglā',
  'settings.metadata.d3d7043d61bb21c8': 'Rindu autorība mezgla repozitorijā',
  'settings.metadata.34feb0cfc058ccff': 'Izmaiņas mezgla repozitorijā',
  'settings.metadata.dd2e41d38b7838e9': 'Izveidot komitu mezgla repozitorijā',
  'settings.metadata.074e769d80fde34e': 'Mezgla repozitorija komiti',
  'settings.metadata.c4806722ba66e903': 'Salīdzināt versijas mezgla repozitorijā',
  'settings.metadata.ab004772e1b71ba8': 'Mezgla repozitorija fails',
  'settings.metadata.6544b43fdfe3320e': 'Meklēt mezgla repozitorijā',
  'settings.metadata.a9c6586ae9f11964': 'Atvērt mezgla repozitoriju',
  'settings.metadata.81ac4cdc952990d9': 'Ierosināt izmaiņas mezgla repozitorijā',
  'settings.metadata.44812fcb9883ac9d': 'Mezgla repozitorija failu koks',
  'settings.metadata.b74af9f786625504': 'Mezgla repozitorija cilnes',
  'settings.metadata.cc00c9b3261b6896': 'Failu dzēšana mezglā',
  'settings.metadata.f864b17e206c9949': 'Failu meklēšana mezglā',
  'settings.metadata.01bce5e752a4e282': 'Pārslēgt mezgla darbkopu',
  'settings.metadata.82a9c46ffa478994': 'Komits',
  'settings.metadata.ca8a5f3bee55b125': 'Dzēst darba koku…',
  'settings.metadata.6c91d7b86793064a': 'Failu rakstīšana mezglā',
  'settings.metadata.aa2463736b28728a': 'Piezīme par izpildi',
  'settings.metadata.f659e2e6ad7c78ad': 'Lasīt saglabātu pieprasījumu',
  'settings.metadata.bac5871a628ca72b': 'Mezgla uzdevuma statuss',
  'settings.metadata.7616d1f9f0eb2abe': 'Ierakstītās izpildes',
  'settings.metadata.62b2137489d32412': 'Nosūtīšanas rezultāts',
  'settings.metadata.87c059b1fd800819': 'Izpildes laika skala',
  'settings.metadata.93f46c6131a98750': 'Saglabāt pieprasījumu',
  'settings.metadata.49813efc30da7138': 'Saglabātie pieprasījumi',
  'settings.metadata.0d50b621a3f98f5d': 'Nosūtīt saglabātu pieprasījumu',
  'settings.metadata.a4b757018683f41d': 'Vērtības izmaiņas',
  'settings.metadata.ae1b1551ec65814d': 'Vērtības struktūra',
  'settings.metadata.7a6f44b8094e0625': 'Vērtības fragments',
  'settings.metadata.da9b697a15683606': 'Izveidot audeklu',
  'settings.metadata.841ee7bd4aeb25a6': 'Iestatīt audekla apskates secību',
  'settings.metadata.aab4922458b14785': 'Rediģēt audeklu',
  'settings.metadata.97fd18d398003c79': 'Eksportēt visu audeklu',
  'settings.metadata.1fe56b7b323305fc': 'Izkārtot audekla elementus',
  'settings.metadata.6f53a1ddd68b0c2b': 'Apskatīt audeklu',
  'settings.metadata.2b046175f5077346': 'Lasīt audeklu',
  'settings.tools.openSection': 'Atvērt sadaļu «{section}»',
  'settings.ModelEditModal.default.21b111cb': 'Noklusējums',
  'settings.ModelEditModal.low.f793de20': 'Zems',
  'settings.ModelEditModal.medium.8e588cd1': 'Vidēja',
  'settings.ModelEditModal.high.c4ebc6d4': 'Augsts',
  'settings.ai.AgentEditorModal.none.dc937b59': 'Nav',
  'settings.ai.AgentEditorModal.follow_the_setting.ead899ca': 'Kā iestatījumos',
  'settings.ai.AgentEditorModal.by_section.2c8a0eb5': 'Pa sadaļām',
  'settings.ai.AgentEditorModal.all_at_once.f9068371': 'Visus reizē',
  'settings.ai.GeneralSettings.same_as_the_chat.3e206eff': 'Kā čatā',
  'settings.ai.GeneralSettings.off.ca7981b4': 'Izslēgts',
  'settings.ai.GeneralSettings.once.d88f6d83': 'Vienreiz',
  'settings.ai.GeneralSettings.twice.cc1b4c8d': 'Divreiz',
  'settings.ai.GeneralSettings.three_times.13b6376c': 'Trīs reizes',
  'settings.ai.GeneralSettings.five_times.ee32f27e': 'Piecas reizes',
  'settings.ai.GeneralSettings.not_configured.dd1841d2': 'Nav konfigurēts',
  'settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311':
    'Paturēt esošo un pievienot jauno',
  'settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8': 'Aizstāt esošo ar šo',
  'settings.components.ToolModesEditor.mixed.f340b6d6': 'Dažādi',
  'settings.metadata.6fd575b1876b0d59':
    'Īpašību bloks sākas pirmajā rindā, ir noslēgts, satur derīgu YAML un neatkārto īpašību nosaukumus. Bloks, kas nonācis zemāk piezīmē, tiek pārvietots uz sākumu; īpašības atkārtojums ar tādu pašu vērtību tiek noņemts.',
  'settings.metadata.36317c6ed2cd7dbe':
    'Norādītās īpašības ir pievienotas un aizpildītas. Aiz kola var norādīt noklusējuma vērtību: "created: {{ctime}}" ievieto faila izveides datumu, {{today}} — šodienas datumu. Labotas tiek tikai šīs īpašības.',
  'settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e':
    'Šīs grāmatas lappuses grāmata ir izkārtojusi kā komiksu: tām nav ko iestatīt. Tālummainiet ar Mod un plus vai mīnusu, šķipsnu vai cilnes izvēlni.',
  'settings.components.reader.ReaderSettingsForm.layout.a5119091': 'Izkārtojums',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f':
    'Pāršķiriet lapas pa vienai vai ritiniet katru nodaļu. E-tintes režīms saglabā lapas šajā ierīcē.',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f':
    'Pāršķiriet lapas pa vienai vai ritiniet katru nodaļu.',
  'settings.components.reader.ReaderSettingsForm.font.64d0b3ad': 'Fonts',
  'settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22': 'Fontu mape',
  'settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c':
    'Mape glabātavā ar fontu failiem: .ttf, .otf, .woff vai .woff2. Katra ģimene tajā tiek piedāvāta kā iepriekš minētais fonts un kopā ar krātuvi tiek pārvietots uz citām jūsu ierīcēm. Obsidian Sync tos pārnēsā ar visu pārējo veidu sinhronizāciju. Tukšs: nav fontu no krātuves.',
  'settings.components.reader.ReaderSettingsForm.text_size.d68761cc': 'Teksta lielums',
  'settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1': 'Līniju atstarpes',
  'settings.components.reader.ReaderSettingsForm.margins.eea8d245': 'Piemales',
  'settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b':
    'Atstarpe ap tekstu un starp kolonnām.',
  'settings.components.reader.ReaderSettingsForm.column_width.86f4e582': 'Kolonnas platums',
  'settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab':
    'Plašākā teksta kolonna var pieaugt.',
  'settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135': 'Divas kolonnas',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2':
    'Divas lapas blakus, ja cilne ir pietiekami plata.',
  'settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1': 'Tēmas krāsas',
  'settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee':
    'Zīmējiet grāmatu motīva teksta un fona krāsās, ieskaitot tumšo režīmu. Izslēgts: pašas grāmatas krāsas, uz gaišas lapas.',
  'settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d': 'Grāmatas stili',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8':
    'Pašas grāmatas izkārtojums: tabulas, atkāpes, līdzinājums, nolaižamie vāciņi. Jūsu teksta lielums, atstarpes, fonts un krāsas joprojām uzvar. Nekas ārpus grāmatas nekad netiek ielādēts.',
  'settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32':
    'Atveriet PDF failus programmā Abele lasītājs',
  'settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b':
    "PDF faili tiek atvērti šeit, nevis paša Obsidiāna skatītājā, ar lapām, kuras jāpāršķir, saturs ir blakus un vieta, kas tiek saglabāta. Izslēgts: tie tiek atvērti Obsidian's skatītājā, un Open in Abele Reader PDF izvēlnē joprojām atver vienu šeit.",
  'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f':
    'Viena nepārtraukta ritināšana, lapa zem lapas vai lapas pa vienai.',
  'settings.components.reader.ReaderSettingsForm.page_size.bd69e66e': 'Lapas izmērs',
  'settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb':
    'Automātiski ir lapas platums ritināšanas laikā un visa lapa ar lapām. Vai arī iekļaujiet visu lapu, pielāgojiet tās platumu vai fiksētu tālummaiņu.',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc':
    'Divas lapas blakus',
  'settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6':
    'Kad cilne ir pietiekami plata, kā drukāta grāmata ir atvērta.',
  'settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd':
    'Tumšas lapas tumšā tēmā',
  'settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3':
    'Lapas gaišā un tumšā krāsa ir mainīta, savukārt Obsidiāna tēma ir tumša, tāpēc balta lapa neatspīd. Bildes iznāk kā negatīvi.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f': 'Pildspalvas biezums',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925':
    'Cik bieza pildspalva un marķieris zīmē uz PDF. To maina arī poga blakus krāsām zem lapas.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856':
    'Pildspalvas biezums uz zīmējumiem',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a':
    'Cik bieza pildspalva un marķieris zīmē uz zīmējuma vai uzzīmēta attēla. To maina arī poga blakus krāsām tās joslā.',
  'settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc':
    'E-tinte šajā ierīcē',
  'settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337':
    'Lasītājam ar e-tintes ekrānu, piemēram, Boox. Uzglabāts tikai šajā ierīcē: tālrunis un dators tika lasīti tāpat kā iepriekš.',
  'settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801': 'E-tintes režīms',
  'settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d':
    'Lapas pagrieztas, nekad nav ritinātas vai bīdītas, arī PDF. Melns teksts uz balta, nekas pelēks, biezākas līnijas, nekas, kas kustas vai izbalē. Izceļ kā līnijas, kuru forma nosaka krāsu. Pieskaroties kreisajā vai labajā trešdaļā, tiek pagriezta lapa. To pagriež arī lapas pogas un taustiņi.',
  'settings.components.reader.ReaderSettingsForm.full_refresh.9322071a': 'Pilnīga atsvaidzināšana',
  'settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f':
    'Lapa mirgo melnā un pēc tam baltā krāsā ik pēc tik daudzām lapām, kas notīra iepriekšējo lapu vājo spoku, ko atstāj e-tintes ekrāns.',
  'settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e':
    'Parādiet atslēgas, ko lasītājs dzird',
  'settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a':
    'Lapā pēdējā nospiestā taustiņa vai pogas nosaukums un kods, kā arī tas, vai tas pārvēra lapu; konsole reģistrē katru. Lai uzzinātu, ko lasītāja lapu pogas sūta, kad tās nepāršķir lapas.',
  'settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986': 'Skaļi lasīšana',
  'settings.components.reader.ReaderSettingsForm.voice.87bf2bc0': 'Balss',
  'settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e':
    'Šīs ierīces balsis; iPhone tālrunī tie, kas atrodas sadaļā Iestatījumi → Pieejamība → Runātais saturs. Citā ierīcē izvēlēta balss, kuras šai ierīcei trūkst, tiek nolasīta kā noklusējuma balss.',
  'settings.components.reader.ReaderSettingsForm.speed.c372fee9': 'Ātrums',
  'settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8':
    'Kur palika grāmatas',
  'settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7':
    'Lasīšanas vietu fails',
  'settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5':
    '.json fails krātuvē, kas glabā vietu, kur tika atstāta katra grāmata, tāpēc katra ierīce to atver tur. Obsidiāna failu saraksts to nerāda. Obsidian Sync nodrošina to kopā ar visu pārējo veidu sinhronizāciju, tāpat kā tērzēšanu. Mainot ceļu, vietas tiek pārvietotas uz jauno failu. Tukšs: {value0}.',
  'settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4':
    'Ik pēc {value0} lappusēm',
  'settings.components.reader.ReaderSettingsForm.never.6300ef80': 'Nekad',
  'settings.components.reader.ReaderSettingsForm.pages.9046da16': 'Lapas',
  'settings.components.reader.ReaderSettingsForm.scrolling.9b976293': 'Ritināšana',
  'settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0': 'Tēmas teksta fonts',
  'settings.components.reader.ReaderSettingsForm.serif.1b5e747e': 'Serifs',
  'settings.components.reader.ReaderSettingsForm.sans_serif.07e77255': 'Sans-serif',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055': 'Kā grāmatā',
  'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c':
    '{value0} (nav fontu mapē)',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807':
    'Teksta fonts. Motīvs ir tas, ko izmanto jūsu piezīmes; zem grāmatas ir fonti no jūsu fontu mapes.',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358':
    'Teksta fonts. Motīvs ir tas, ko izmanto jūsu piezīmes. Ievietojiet fontu failus fontu mapē, lai tos lasītu savā.',
  'settings.components.reader.ReaderSettingsForm.narrow.ba227109': 'Šauras',
  'settings.components.reader.ReaderSettingsForm.normal.a7248eeb': 'Parastas',
  'settings.components.reader.ReaderSettingsForm.wide.147170e7': 'Platas',
  'settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6':
    'Nepārtraukta ritināšana',
  'settings.components.reader.ReaderSettingsForm.automatic.d461a493': 'Automātiski',
  'settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c': 'Visa lappuse',
  'settings.components.reader.ReaderSettingsForm.page_width.217fbef1': 'Lappuses platumā',
  'settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4':
    'Ierīces balss grāmatas valodai',
  'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24':
    'Balss no citas ierīces',
  'settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037':
    'Šīs grāmatas svarīgākie punkti',
  'settings.components.reader.BookNotesSettings.highlights.6e517828': 'Izceļ',
  'settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7': 'Kur viņi iet',
  'settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64':
    'Tikai šai grāmatai. “Kā iestatījumos” seko Iestatījumi → Grāmatas.',
  'settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e':
    'Piezīme par katru grāmatu, blakus tai, vai viena piezīme par katru grāmatu. Grāmata pati var izvēlēties no savas Aa pogas.',
  'settings.components.reader.BookNotesSettings.note.d8da2c49': 'Piezīme',
  'settings.components.reader.BookNotesSettings.note_for_all_books.105d496e':
    'Piezīme visām grāmatām',
  'settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6':
    'Piezīme, uz kuru attiecas šīs grāmatas svarīgākie punkti. Tukšs: {value0}.',
  'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d':
    'Izgatavots ar pirmo izcēlumu; katru grāmatu atšķir to saites. Tukšs: {value0}.',
  'settings.components.reader.BookNotesSettings.template.0575f29d': 'Veidne',
  'settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd':
    'Piezīme, no kuras izveidot šīs grāmatas svarīgāko notikumu piezīmi. Tukšs: tāpat kā iestatījumos.',
  'settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc':
    'Piezīme, no kuras tiek izveidota jauna piezīme. Starp {literal0} un {literal1} ir tas, ko katrs izcēlums papildina, un {literal2} ir galvenais; vai {literal3} un {literal4}, lai nošķirtu citātu un komentāru; arī {literal5}, {literal6}, {literal7}, {literal8}, {literal9}. Tukšs: nav.',
  'settings.components.reader.BookNotesSettings.none.dc937b59': 'Nav',
  'settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2':
    'Atsevišķa piezīme grāmatai',
  'settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78':
    'Viena piezīme visām grāmatām',
  'settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c':
    'Tāpat kā iestatījumos ({value0})',
  'settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f': 'Jūsu nosauktā piezīme',
  'settings.reader.stroke.fine': 'Plāna',
  'settings.reader.stroke.medium': 'Vidēja',
  'settings.reader.stroke.bold': 'Bieza',
  'settings.GithubAccessReport.an_access_token.14f95c33': 'piekļuves marķieris',
  'settings.GithubConnectionEditor.add_git_connection.9e359dd8': 'Pievienot Git savienojumu',
  'settings.GithubConnectionEditor.edit_git_connection.1e73be5f': 'Rediģēt Git savienojumu',
  'settings.GithubConnectionEditor.service.d677190e': 'Pakalpojums',
  'settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8':
    'Izvēlieties pakalpojumu pirms tā servera adreses un pilnvaras ievadīšanas.',
  'settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1':
    'Pilna Forgejo adrese, ieskaitot portu vai izvietošanas ceļu.',
  'settings.GithubConnectionEditor.access_token.9a911b08': 'Piekļuves pilnvara',
  'settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b':
    'sample-org\nsample-org/project',
  'settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1':
    'īpašnieks/repo vai Forgejo saite',
  'settings.GithubConnectionEditor.access_details.abe1adac': 'Piekļuves informācija',
  'settings.GithubConnectionEditor.forgejo.f4e62146': 'Forgejo',
  'settings.GithubConnectionEditor.signed_in_as_value.682769b2': 'Pierakstījies kā {value0}',
  'settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a':
    'Serveris nepieņēma šo pilnvaru (401).',
  'settings.GithubConnectionEditor.the_account_could_not_be.71de8f27':
    'Kontu nevarēja pārbaudīt. {value0}',
  'settings.GithubConnectionEditor.public_access_without_a_token.35b758c0':
    'Publiska piekļuve bez marķiera',
  'settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc':
    'Izvēlieties repozitoriju, lai pārbaudītu lasīšanas piekļuvi.',
  'settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8':
    'Savienojuma marķieris ir mainīts. Vēlreiz pārbaudiet piekļuvi.',
  'settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376':
    'Saglabātais marķieris pieder iepriekšējam serverim. Ievadiet jaunu šīs adreses marķieri.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3':
    'Norādiet īpašnieka/repo vai repozitorija saiti šī savienojuma serverī.',
  'settings.GithubConnectionEditor.asking_forgejo.f46aa9ff': 'Pieprasījums Forgejo…',
  'settings.GithubSettings.git_hosting.a3002011': 'Git hostings',
  'settings.GithubSettings.default.2ae2ecc2': 'Noklusējums · ',
  'settings.GithubSettings.edit_connection.047f9f95': 'Rediģēt savienojumu',
  'settings.GithubSettings.connection_actions.9e1bbb65': 'Savienojuma darbības',
  'settings.GithubSettings.public_access_without_a_token.35b758c0':
    'Publiska piekļuve bez marķiera',
  'settings.GithubSettings.forgejo.f4e62146': 'Forgejo',
  'settings.GithubSettings.token_unavailable_on_this_device.0bd03b33':
    'Tokens nav pieejams šajā ierīcē',
  'settings.GithubSettings.the_token_has_expired.0b52627f': 'Token ir beidzies',
  'settings.GithubSettings.the_server_did_not_accept.1d7560a4':
    'Pēdējā piekļuves pārbaudē serveris nepieņēma pilnvaru',
  'settings.GithubSettings.the_last_access_check_failed.72f4e393':
    'Pēdējā piekļuves pārbaude neizdevās',
  'settings.GithubSettings.some_repository_access_checks_failed.1b573ceb':
    'Dažas repozitoriju piekļuves pārbaudes neizdevās',
  'settings.GithubSettings.access_checked.d2518d23': 'Piekļuve pārbaudīta',
  'settings.GithubSettings.not_checked_yet.881d23f6': 'Vēl nav pārbaudīts',
  'settings.GithubSettings.check_access.abb9a172': 'Pārbaudiet piekļuvi',
  'settings.GithubSettings.make_default_for_value.ded3e105':
    'Izmantot pēc noklusējuma serverim {value0}',
  'settings.git.serverAddressError': 'Tikai adrese: bez lietotājvārda, vaicājuma vai daļas pēc #',
  'settings.git.noteLabel': 'piezīme',
  'settings.transfer.oneKeyToStore': 'Viena atslēga izvēlēto vienumu saglabāšanai.',
  'settings.git.nativeAddress': 'Pilna {service} adrese, ieskaitot portu un izvietošanas ceļu.',
  'settings.git.useCodeberg': 'Izmantot Codeberg',
  'settings.git.useCodebergTooltip': 'Izmantot Codeberg kā Forgejo serveri',
  'settings.git.nativeRepoLink': 'owner/repo vai {service} saite',
  'settings.git.gitea': 'Gitea',
  'settings.git.githubId': 'github',
  'settings.git.askingNative': 'Pieprasījums uz {service}…',
  'settings.git.accessCheckCancelled': 'Šī piekļuves pārbaude tika atcelta.',
  'settings.git.repositoryConnections': 'Git savienojumi',
  'settings.metadata.ca4a628311f7879a': 'Git repozitoriji',
  'settings.metadata.b9227122bad532e6': 'Repozitoriju cilnes',
  'debuggerAccess.title': 'Aģenta piekļuve atkļūdotājam',
  'debuggerAccess.request': 'Atļaut aģentam izmantot atkļūdotāju: {folder}',
  'debuggerAccess.chatFolder': 'šīs sarunas mape',
  'debuggerAccess.scope':
    'Tikai šai izpildei un programmai. Izteiksmju izpildei joprojām vajadzīgs atsevišķs apstiprinājums.',
  'debuggerAccess.allowed': 'Piekļuve atkļūdotājam atļauta. Aģents var atkārtot izsaukumu.',
  'debuggerAccess.denied': 'Piekļuve atkļūdotājam liegta.',
  'debuggerAccess.expiredRequest':
    'Pieprasījuma termiņš beidzies. Lūdziet aģentam mēģināt vēlreiz.',
  'debuggerAccess.allow': 'Atļaut',
  'debuggerAccess.deny': 'Noraidīt',
  'debuggerAccess.issued':
    'Jūsu šajā ierīcē piešķirtās atļaujas. Piekļuve beidzas līdz ar izpildes beigām.',
  'debuggerAccess.issuerOnly':
    'Citu īpašnieku atļaujas ir paslēptas. Atļauju var atsaukt vai dzēst tikai tās piešķīrējs.',
  'debuggerAccess.refresh': 'Atsvaidzināt',
  'debuggerAccess.updateNode':
    'Atjauniniet šo mezglu, lai pārvaldītu aģenta piekļuvi atkļūdotājam.',
  'debuggerAccess.empty': 'Jūs neesat piešķīris piekļuves atļaujas atkļūdotājam.',
  'debuggerAccess.revoke': 'Atsaukt piekļuvi atkļūdotājam',
  'debuggerAccess.deleteTip':
    'Dzēst šo atļauju. Var dzēst tikai paša piešķirtās atļaujas. Darbību vēsture tiek saglabāta.',
  'debuggerAccess.grantsUnavailable': 'Atkļūdotāja atļaujas nav pieejamas',
  'debuggerAccess.changeFailed': 'Neizdevās mainīt atkļūdotāja atļauju',
  'debuggerAccess.state.revoked': 'Atsaukta',
  'debuggerAccess.state.expired': 'Beigusies',
  'debuggerAccess.state.active': 'Aktīva',
  'debuggerAccess.grantDescription':
    '{state} · {actions} · {mode} · {conversation} · Beidzas {expires}',
  'debuggerAccess.refreshRequests': 'Atsvaidzināt atkļūdotāja pieprasījumus',
  'debuggerAccess.unavailable': 'Piekļuve atkļūdotājam nav pieejama',
  'debuggerAccess.stale':
    'Šis atkļūdotāja pieprasījums vairs negaida lēmumu. Gaidīšanas saraksts ir atsvaidzināts.',
  'debuggerAccess.action.read': 'lasīšana',
  'debuggerAccess.action.step': 'solis',
  'debuggerAccess.action.continue': 'turpināšana',
  'debuggerAccess.action.pause': 'pauze',
  'debuggerAccess.action.breakpoints': 'pārtraukumpunkti',
  'debuggerAccess.action.launch': 'palaišana',
  'debuggerAccess.action.attach': 'pievienošana',
  'debuggerAccess.action.detach': 'atvienošana',
  'debuggerAccess.action.terminate': 'izbeigšana',
  'debuggerAccess.action.expressions': 'izteiksmes',
  'debuggerAccess.action.evaluate': 'izteiksmes izpilde / mainīgā maiņa',
  'debuggerAccess.mode.ask': 'jautāt',
  'debuggerAccess.mode.allowAll': 'atļaut visu',
  'settings.git.reloadService': 'Pārlādēt no Git pakalpojuma',
  'settings.git.openBrowser': 'Atvērt pārlūkā',
  'settings.metadata.gitHosting': 'Git hostings',
  'maps.viewName': 'Abele karte',
  'maps.coordinates': 'Koordinātu īpašība',
  'maps.markerIcon': 'Punkta ikona',
  'maps.markerColor': 'Punkta krāsa',
  'maps.center': 'Centra koordinātas',
  'maps.defaultZoom': 'Sākuma tālummaiņa',
  'maps.minZoom': 'Minimālā tālummaiņa',
  'maps.maxZoom': 'Maksimālā tālummaiņa',
  'maps.mapHeight': 'Iegultās kartes augstums',
  'maps.groupNearby': 'Grupēt tuvējās vietas',
  'maps.mapTiles': 'Kartes slāņi',
  'maps.mapTilesDark': 'Slāņi tumšajā režīmā',
  'maps.copied': 'Koordinātas nokopētas',
  'maps.copyFailed': 'Neizdevās kopēt koordinātas',
  'maps.delete': 'Dzēst piezīmi',
  'maps.createFailed': 'Neizdevās izveidot piezīmi',
  'maps.saveFailed': 'Neizdevās saglabāt fonus',
  'maps.locationDenied': 'Atrašanās vietas atļauja liegta',
  'maps.locationTimeout': 'Atrašanās vietas pieprasījuma noildze',
  'maps.locationUnavailable': 'Atrašanās vieta nav pieejama',
  'maps.locating': 'Nosaka atrašanās vietu…',
  'commands.copy-current-map-location': 'Kopēt pašreizējās koordinātas',
  'maps.zoomIn': 'Tuvināt',
  'maps.zoomOut': 'Tālināt',
  'maps.north': 'Ziemeļi augšā',
  'maps.locationOff': 'Obsidian atrašanās vieta izslēgta',
  'maps.following': 'Seko jums. Nospiediet, lai apturētu',
  'maps.showLocation': 'Rādīt manu atrašanās vietu',
  'maps.exitFull': 'Iziet no pilnekrāna',
  'maps.full': 'Pilnekrāns',
  'maps.fitPlaces': 'Rādīt visas vietas',
  'maps.defaultBackground': 'Noklusējuma',
  'maps.background': 'Fons',
  'maps.tab': 'Atvērt jaunā cilnē',
  'maps.split': 'Atvērt pa labi',
  'maps.window': 'Atvērt jaunā logā',
  'maps.card': 'Vietas kartīte',
  'maps.copy': 'Kopēt koordinātas',
  'maps.newHere': 'Jauna piezīme šeit',
  'maps.setCenter': 'Iestatīt kā skata centru',
  'maps.manage': 'Pārvaldīt fonus…',
  'maps.noCoordinates': 'Nav koordinātu',
  'maps.unreadable': 'Koordinātas nav nolasāmas',
  'maps.formulaError': 'Formulas kļūda',
  'maps.noProperty': 'Kur ir koordinātas?',
  'maps.pickProperty': 'Izvēlieties īpašību vai formulu ar vietas koordinātām.',
  'maps.configure': 'Iestatīt skatu',
  'maps.noRecords': 'Šajā bāzē vēl nav piezīmju',
  'maps.hold': 'Turiet nospiestu karti, lai pievienotu vietu.',
  'maps.rightClick': 'Noklikšķiniet ar labo pogu, lai pievienotu vietu.',
  'maps.filtered': 'Nav vietu atbilstoši filtriem',
  'maps.filtersEmpty': 'Filtri izslēdz visas vietas.',
  'maps.filters': 'Filtri',
  'maps.nothing': 'Nekas nav atrasts',
  'maps.addCoordinates':
    'Pievienojiet koordinātas vai izvēlieties citu īpašību skata iestatījumos.',
  'maps.showNotes': 'Rādīt piezīmes',
  'maps.loadFailed': 'Karti nevarēja ielādēt',
  'maps.offline': 'Nav savienojuma ar kartes serveri. Vietas joprojām pieejamas.',
  'maps.retry': 'Mēģināt vēlreiz',
  'maps.noWebgl': 'Ierīce nevar attēlot kartes',
  'maps.graphics': 'Grafikas paātrinājums izslēgts vai nav pieejams.',
  'maps.stopped': 'Karte vairs netiek attēlota',
  'maps.lostContext': 'Grafikas konteksts zaudēts, piemēram, pēc miega režīma.',
  'maps.drawAgain': 'Pārzīmēt',
  'maps.backgrounds': 'Foni',
  'maps.up': 'Pārvietot augšup',
  'maps.down': 'Pārvietot lejup',
  'maps.edit': 'Rediģēt',
  'maps.remove': 'Dzēst',
  'maps.add': 'Pievienot',
  'maps.addBackground': 'Pievienot fonu',
  'maps.newBackground': 'Jauns fons',
  'maps.editBackground': 'Rediģēt fonu',
  'maps.name': 'Nosaukums',
  'maps.light': 'Gaišs',
  'maps.dark': 'Tumšs',
  'maps.cancel': 'Atcelt',
  'maps.save': 'Saglabāt',
  'maps.giveName': 'Norādiet nosaukumu',
  'maps.needAddress': 'Vajadzīga vismaz viena adrese',
  'maps.createNote': 'Izveidot piezīmi',
  'maps.formulaWhy':
    'Formulā nevar ierakstīt. Pirms piezīmes izveides izvēlieties koordinātu īpašību.',
  'maps.skipped': 'Piezīmes ārpus kartes: {count}',
  'maps.noneCoordinates': 'Piezīmes bez koordinātām: {count}',
  'maps.copyValue': 'Kopēt {value}',
  'maps.saveZoom': 'Atvērt ar tālummaiņu {value}',
  'maps.placesHere': 'Vietas šeit: {count}',
  'maps.searchEmpty': 'Nav vietu vaicājumam “{query}”.',
  'maps.backgroundHint': 'Nosaukti foni bāzu kartēm.',
  'maps.noBackgrounds': 'Nav savu fonu',
  'maps.addressHint': 'Stila adrese vai vairāki slāņos attēlojami flīžu šabloni.',
  'maps.darkHint': 'Neobligāti. Citādi tumšajā režīmā izmanto gaišo fonu.',
  'maps.fromMaps': 'Obsidian Maps foni',
  'maps.copyBackgrounds': 'Kopēt fonus',
  'maps.importHint': 'Kopēt, nemainot Obsidian Maps iestatījumus.',
  'maps.tileLayers': 'Flīžu slāņi: {count}',
  'maps.style': 'Stils',
  'maps.lightOnly': 'Tikai gaišs; abām tēmām',
  'maps.bothThemes': 'Gaišs un tumšs',
  'maps.deleteFailed': 'Neizdevās dzēst piezīmi',
  'maps.fullUnavailable': 'Pilnekrāns šajā ierīcē nav pieejams',
  'maps.showList': 'Rādīt sarakstā',
  'maps.listBeside': 'Saraksts blakus kartei',
  'maps.placeGone': 'Šī piezīme vairs nav pieejama',
  'maps.attribution': 'Rādīt kartes autorus',
  'maps.feedback': 'Atsauksmes par karti',
  'maps.touchHelp': 'Pārvietojiet karti ar diviem pirkstiem',
  'maps.scrollHelp': 'Izmantojiet {key} un ritināšanu kartes tālummaiņai',
  'maps.currentLocation': 'Pašreizējā atrašanās vieta',
  'maps.backList': 'Atpakaļ uz sarakstu',
  'maps.cardGone': 'Piezīme vairs nav pieejama',
  'maps.cardGoneText': 'Tā tika dzēsta vai pārvietota pēc kartes ielādes.',
  'maps.cardError': 'Neizdevās nolasīt piezīmi',
  'maps.cardErrorText': 'Vieta joprojām ir kartē. Atveriet piezīmi, lai to pārbaudītu.',
  'maps.imageMissing': 'Neizdevās ielādēt {path}',
  'maps.openPicture': 'Atvērt attēlu: {caption}',
  'maps.open': 'Atvērt',
  'maps.openNote': 'Atvērt piezīmi',
  'maps.showMap': 'Rādīt kartē',
  'maps.more': 'Vairāk',
  'maps.straightLine': '{distance} taisnā līnijā',
  'maps.mapFace': 'Rādīt karti',
  'maps.hideList': 'Paslēpt sarakstu',
  'maps.sortLabel': 'Kārtot: {order}',
  'maps.resort': 'Karte pārvietota. Kārtot no jaunā centra',
  'maps.placeCount': 'Vietas: {count}',
  'maps.listSearchEmpty': 'Meklējumam nav atbilstošu vietu',
  'maps.listEmpty': 'Nav vietu ar koordinātām',
  'maps.sortBase': 'Bāzes secība',
  'maps.sortMe': 'Tuvāk man',
  'maps.sortCentre': 'Tuvāk kartes centram',
  'maps.metres': '{value} m',
  'maps.kilometres': '{value} km',
  'maps.distanceCentre': 'Taisnā līnijā no kartes centra',
  'maps.distanceMe': 'Taisnā līnijā no jūsu atrašanās vietas',
  'debug.open': 'Atkļūdotājs',
  'debug.run': 'Palaist programmu',
  'debug.attach': 'Pievienoties palaistai programmai',
  'debug.checking': 'Pārbauda atkļūdotāja atbalstu…',
  'debug.offline': 'Atjaunojiet savienojumu ar mezglu',
  'debug.off': 'Atkļūdotājs šajā mezglā ir izslēgts',
  'debug.update': 'Atjauniniet mezglu atkļūdošanai bez tērzēšanas',
  'debug.install': 'Mezglā nav instalēts JavaScript atkļūdotājs',
  'debug.noFolder': 'Vispirms izvēlieties mezgla mapi',
  'debug.pathKind': 'Ceļš šajā mapē',
  'debug.programPlaceholder': 'JavaScript fails atkļūdošanai: src/main.js',
  'debug.programEmpty': 'Ievadiet JavaScript faila ceļu šajā mapē',
  'debug.thisFolder': 'Šī mape',
  'debug.insideFolder': 'Darbojas šajā mapē',
  'debug.outsideFolder': 'Darbojas ārpus šīs mapes: savienojums jāapstiprina',
  'debug.executionTitle': 'Atļaut koda izpildi šajā mapē?',
  'debug.executionMessage':
    'Atļaut koda izpildi mapē {path}? Reģistrētais projekts kļūs uzticams, un šajā mapē vai darba kokā varēs darboties atkļūdotāja programmas un aģenti.',
  'debug.empty': 'Atveriet atkļūdotāju mezgla mapes vai tērzēšanas izvēlnē.',
  'debug.outsideTitle': 'Pievienoties programmai ārpus šīs mapes?',
  'debug.outsideMessage':
    '{command} darbojas mapē {path}, nevis atlasītajā mapē. Atkļūdotājs var to apturēt un nolasīt vērtības. Pēc atvienošanas programma turpinās darboties.',
  'debug.sourceUpdate': 'Atjauniniet mezglu, lai šajā failā iestatītu pārtraukumpunktus',
  'debug.sourceMap':
    'Mezgls vēl nav sasaistījis šo failu ar palaisto programmu. Pārtraukumpunkti paliek gaidīšanas režīmā. Lai mēģinātu vēlreiz, pārstartējiet programmu vai pievienojiet atkļūdotāju no jauna. Ja tas nepalīdz, pārbaudiet programmas pirmkoda kartes.',
  'debug.sourceChanged':
    'Fails mainījās pēc programmas palaišanas. Atjaunojiet iepriekšējo saturu vai izveidojiet un palaidiet programmu no jauna.',
  'debug.sourceOutside': 'Fails atrodas ārpus atkļūdošanas mapes',
  'debug.filePending':
    'Noklikšķiniet uz rindas numura, lai iestatītu gaidošu pārtraukumpunktu. Lai to lietotu, sāciet šīs mapes atkļūdošanas sesiju vai pievienojiet atkļūdotāju jau palaistai programmai.',
  'debug.sourceUnavailable':
    'Failu neizdevās pievienot atkļūdotājam. Pārbaudiet savienojumu ar mezglu, pēc tam atveriet failu vēlreiz, lai mēģinātu no jauna.',
  'debug.entryPlaceholder':
    'Meklēt sākuma failus vai pakotnes skriptus; vai ievadīt kompilēta JavaScript ceļu',
  'debug.entryEmpty': 'Nav atbilstību. Varat ievadīt kompilēta JavaScript ceļu.',
  'debug.sourceConflict': 'Fails konfliktē ar jau pievienotu pirmkoda failu',
  'debug.sourceLimit': 'Sasniegts sesijas pirmkoda failu skaita ierobežojums',
  'debug.sourceUnreadable': 'Fails nav pieejams vai nav nolasāms',
  'debug.launchConfiguration': 'Izpildvide',
  'debug.launchRuntimeArgs': 'Izpildvides argumenti',
  'debug.launchRuntimeArgsHint': 'Nodoti Node pirms ievades faila, piemēram, --import=tsx.',
  'debug.launchCwd': 'Darba mape',
  'debug.launchCwdHint':
    'Attiecībā pret izvēlēto mapi. Atstājiet tukšu, lai izmantotu ievades failam tuvāko pakotnes mapi.',
  'debug.launchEnv': 'Vides mainīgie',
  'debug.launchEnvHint':
    'Viena KEY=value katrā rindā. Vērtības ir burtiskas un tiek saglabātas šajā ierīcē.',
  'debug.launchEnvInvalid': 'Norādiet vides mainīgos formātā KEY=value, pa vienam katrā rindā.',
  'debug.launchExitCode': 'Izejas kods: {code}',
  'debug.launchTitle': 'Palaist programmu',
  'debug.launchProgram': 'Programma',
  'debug.launchProgramHint':
    'Ceļš attiecībā pret šo mapi. Kompilētam TypeScript norādiet JavaScript sākuma failu (piemēram, dist/main.js).',
  'debug.launchArgs': 'Argumenti',
  'debug.launchArgsHint':
    'Atdaliet argumentus ar atstarpēm; vērtības ar atstarpēm lieciet pēdiņās. Čaulas izteiksmes netiek izpildītas.',
  'debug.launchArgsInvalid': 'Aizveriet pēdiņas un pabeidziet ekranēšanu argumentos.',
  'debug.launchFailed': 'Programmu neizdevās palaist: {detail}',
  'debug.launchExitedEarly': 'Programma beidza darbu, pirms atkļūdotājs varēja pievienoties.',
  'debug.launchFailedPlain':
    'Programmu neizdevās palaist. Atveriet sadaļu “Sīkāka informācija”, lai uzzinātu vairāk.',
  'debug.sourceDeclaration':
    'Deklarāciju failā nav izpildāma koda. Atveriet realizāciju, lai pievienotu pārtraukumpunktu.',
  'debug.sourceTest':
    'Palaistā programma neielādē šo testa failu. Palaidiet testus ar atkļūdošanu, lai šeit apstātos.',
  'debug.sourceGenerated':
    'Šis izveidotais fails šeit nav pieejams. Atkļūdošanai atveriet sākotnējo avota failu.',
  'debug.breakpointDisabled': 'Pārtraukumpunkts atspējots',
  'debug.removeBreakpoints': 'Noņemt visus pārtraukumpunktus',
  'debug.breakpointOptions': 'Pārtraukumpunkta darbības',
  'debug.caughtExceptions': 'Pārtvertie izņēmumi',
  'debug.uncaughtExceptions': 'Nepārtvertie izņēmumi',
  'debug.editCondition': 'Rediģēt nosacījumu',
  'debug.editLogMessage': 'Žurnāla ziņojums',
  'debug.editHitCount': 'Trāpījumu skaits',
  'debug.hitCountUnavailable': 'Šis mezgls neatbalsta trāpījumu skaitītāju',
  'debug.disableBreakpoint': 'Atspējot pārtraukumpunktu',
  'debug.enableBreakpoint': 'Iespējot pārtraukumpunktu',
  'debug.approvalPending': 'Gaida apstiprinājumu atkļūdotājā',
  'debug.recordPointRefused': 'Neizdevās apstiprināt ieraksta punkta saglabāšanu: {reason}',
  'debug.breakpointUnbound':
    'Programma vēl nav ielādējusi šīs rindas kodu. Pārbaudiet avota karti vai gaidiet koda ielādi.',
  'debug.watchLastValue': 'Pēdējā vērtība: {value}',
  'debug.logPoint': 'Žurnāla punkts: {message}',
  'node.delegation.ownerStopped': 'Jūs apturējāt. Sāciet vēlreiz no tā tērzēšanas.',
  'node.delegation.paused': 'Apturēts; var turpināt',
  'node.delegation.ownerAnswer':
    'Gaida jūsu atļauju. Atbildiet šajā kartītē vai atveriet deleģēto tērzēšanu. Pārvaldnieks nevar atbildēt jūsu vietā.',
  'node.delegation.pausedPrompt':
    'Gaidot jūsu atbildi, sasniegts laika limits. Atbildiet uz saglabāto pieprasījumu un turpiniet izstrādātāja darbu.',
  'node.delegation.pausedLimit':
    'Sasniegts laika limits. Nosūtiet ziņu, lai turpinātu tajā pašā tērzēšanā un darba kokā.',
  'node.manager.session': 'Sesija',
  'node.manager.sourceWorktree': 'Avota darba koks',
  'node.manager.command': 'Komanda',
  'node.manager.invalidCommand':
    'Norādiet argv vai command un vienu mērķi: project_id vai worktree_id. Pārbaudiet timeout_ms un output_bytes diapazonus.',
  'node.manager.invalidIntegration':
    'Integrācijai vajadzīgi avota un mērķa darba koki, abu zaru nosaukumi un to aktuālie pilnie komitu heši.',
  'node.manager.invalidCancel': 'Norādiet atceļamās komandas session_id un run_id.',
  'node.manager.branches': 'Zari',
  'node.manager.folder': 'Mape',
  'node.manager.sourceHead': 'Avota komits',
  'node.manager.targetHead': 'Mērķa komits',
  'node.manager.evidence': 'Precīza atļaujas informācija',
  'node.manager.exitCode': 'Izejas kods: {code}',
  'node.manager.output': 'Izvade',
  'node.manager.truncated': 'Agrākā izvade ir saīsināta.',
  'settings.metadata.nodeManagerRun': 'Palaist komandu',
  'settings.metadata.nodeManagerStatus': 'Pārbaudīt komandu',
  'settings.metadata.nodeManagerCancel': 'Atcelt komandu',
  'settings.metadata.nodeManagerIntegrate': 'Integrēt zaru',
  'node.manager.pending': 'Gaida apstiprinājumu',
  'node.manager.exited': 'Pabeigts',
  'node.manager.timedOut': 'Sasniegts laika ierobežojums',
  'node.manager.denied': 'Noraidīts',
  'node.error.backpressure':
    'Savienojums atpalika no mezgla izvades. Izveidojiet savienojumu vēlreiz, lai saņemtu atlikušos notikumus.',
  'node.manager.folderMissing': 'Šo mapi nevar izmantot komandām mezglā.',
  'node.manager.bypassDisabled':
    'Mezgls pieprasa apstiprinājumu, jo tā režīms bez jautāšanas ir izslēgts.',
  'node.manager.integrateBypassUpdate':
    'Šis mezgls nevar integrēt bez jautāšanas. Nepieciešams mezgla atjauninājums; pieprasījums nav nosūtīts.',
  'node.manager.resultExit': '{state} · kods {code}',
  'node.manager.integrationLegacyApproval':
    'Šī mezgla versija vēl jautā pirms integrēšanas. Atjauniniet mezglu, lai integrētu bez jautāšanas.',
  'node.manager.integrationContextUpdate':
    'Atjauniniet mezglu līdz versijai 0.4.49 vai jaunākai, lai integrētu no šīs sarunas bez pārvaldnieka sesijas.',
  'settings.metadata.checkDiagram': 'Pārbaudīt diagrammu',
} satisfies TranslationCatalog
