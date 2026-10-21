import type { TranslationCatalog } from '../../catalogs'
export const ru = {
  'requests.refresh': 'Обновить запросы',
  'debug.launchUnknown':
    'Результат запуска неизвестен. Подключитесь снова и проверьте сеансы отладки перед повторным запуском.',
  'debug.launchMissing': 'Программа не найдена. Проверьте путь относительно папки.',
  'debug.followNoMatches': 'В записанных шагах это значение не найдено.',
  'node.chat.deleteHint':
    'Удалить эту сессию и её историю с узла? Файлы в её папке останутся без изменений.',
  'node.search.invalidRegex': 'Проверьте регулярное выражение и повторите поиск.',
  'node.lsp.locations': 'Места в коде: {count}',
  'node.lsp.noLocations': 'Совпадений нет',
  'node.lsp.count': 'Диагностика: {count}',
  'node.lsp.loading': 'Проверка кода…',
  'node.lsp.error': 'Проверка кода недоступна: {message}',
  'node.lsp.retry': 'Повторить',
  'node.lsp.untrusted':
    'Для запуска языковых серверов нужно разрешить выполнение кода проекта в этой папке.',
  'node.lsp.trust': 'Доверять папке',
  'node.lsp.missing': 'Языковой сервер не установлен. Установите на ноде:',
  'node.lsp.copy': 'Скопировать команду',
  'node.lsp.install': 'Установить популярные серверы',
  'node.lsp.eslintMissing':
    'В проекте не установлен или не настроен ESLint. Проверка TypeScript остаётся доступной.',
  'node.lsp.noDiagnostics': 'Замечаний нет',
  'node.lsp.references': 'Найти использования {name}',

  'debug.stopAtStart': 'Остановиться при запуске',
  'debug.pausedAtStart': 'Остановлено при запуске',
  'node.disconnectRevokeNotice':
    'Отключить это устройство и отозвать его ключ на ноде? Остальные устройства останутся подключёнными.',
  'node.tools.callPlace': 'на {device}',
  'node.tools.askedAgent': 'Попросил {agent}',
  'node.tools.runner': 'Выполняется в Obsidian на устройстве {device}',
  'node.tools.noRunner': 'К ноде сейчас не подключено ни одного устройства с Obsidian',
  'node.tools.nodeAgent': 'Агент ноды',
  'node.tools.modes':
    'Выкл. — недоступно. Спрашивать — нужно одобрение. Авто — выполняется самостоятельно.',
  'node.tools.waiting': 'Ожидание Obsidian',
  'node.tools.executing': 'Выполняется в Obsidian',
  'node.tools.unknown':
    'Не удалось подтвердить результат действия. Проверьте затронутые файлы, прежде чем запрашивать его снова.',
  'node.actionDeniedByOwner': 'Пользователь отклонил действие',
  'streamB.runSummary.move.done': 'Перемещено',
  'streamB.runSummary.move.running': 'Перемещение',
  'streamB.runSummary.move.waiting': 'Запрошено перемещение',
  'node.disconnectTokenNotice':
    'Удалить сохранённое подключение этого устройства? Его ключ на ноде останется действующим. Чтобы запретить доступ с этим ключом, отзовите ключ устройства в списке токенов ноды.',
  'node.error.requestMissing': 'Этого запроса больше нет на ноде.',
  'debug.frameSourceUnavailable': 'Для этого кадра нет доступного исходного кода в этой папке.',
  'node.delegation.updateRequired':
    'Эту ноду нужно обновить, чтобы она могла принимать задачи из чатов',
  'node.files.directoryDeleteSummary': 'Удалить папку {path}: {files}, {folders}?',
  'node.files.directoryMoveSummary':
    'Переместить папку {path} ({files}, {folders}) в {destination}?',
  'node.files.showFiles': 'Показать файлы',
  'node.files.uncommitted': 'Не закоммичен',
  'node.files.untracked': 'Не отслеживается',
  'node.files.gitStatusUnavailable': 'Статус Git недоступен',
  'node.files.gitRecoveryWarning':
    'Содержимое незакоммиченных и неотслеживаемых файлов нельзя восстановить из Git.',
  'node.files.fileCount': {
    one: '{count} файл',
    few: '{count} файла',
    many: '{count} файлов',
    other: '{count} файла',
  },
  'node.files.folderCount': {
    one: '{count} папка',
    few: '{count} папки',
    many: '{count} папок',
    other: '{count} папки',
  },
  'node.files.renameAction': 'Переименовать',
  'node.files.moveAction': 'Переместить',
  'node.files.directoryConfirm': 'Удалить папку {path}? Будут удалены все перечисленные элементы:',
  'node.files.directoryMoveConfirm':
    'Переместить папку {path} в {destination}? Будут перемещены все перечисленные элементы:',
  'node.files.gitLock': 'Блокировка рабочего дерева Git',
  'node.localRunning': 'AbeleNode работает на этом компьютере',
  'node.files.nameOnly': 'Введите имя файла без папок.',
  'node.files.attachMessage':
    'Показать другие рабочие деревья репозитория и разрешить редактирование файлов в выбранном? Для запуска агентов по-прежнему нужно отдельное разрешение.',
  'node.files.saveLocked': 'Сохранение здесь заблокировано',
  'node.files.newFile': 'Новый файл…',
  'node.files.newFolder': 'Новая папка…',
  'node.files.rename': 'Переименовать…',
  'node.files.move': 'Переместить…',
  'node.files.delete': 'Удалить…',
  'node.files.deleteConfirm': 'Удалить {path}? Файл будет удалён из этой папки.',
  'node.files.allowEditing':
    'Разрешить создание, редактирование, перемещение и удаление файлов в этом рабочем дереве? Это не разрешает запуск агентов.',
  'node.files.worktreeBusyTitle': 'Рабочее дерево занято',
  'node.files.worktreeBusy':
    'Рабочее дерево используют: {holders}. Перед удалением остановите его сессии.',
  'node.files.unknownHolder': 'другая операция на узле',
  'node.files.stopSessions': 'Остановить эти сессии',
  'node.files.sessionsStopped':
    'Сессии остановлены. Когда они завершат остановку, снова выберите удаление рабочего дерева.',
  'node.error.busy': 'Ресурс занят. Дождитесь завершения текущей операции и повторите попытку.',
  'node.error.busyStage':
    'Не удалось добавить файлы в индекс: рабочее дерево занято. Дождитесь завершения текущего действия и повторите попытку. (resource_busy)',
  'node.error.busyChat':
    'Не удалось начать новый чат: папка или рабочее дерево занято. Дождитесь завершения текущего действия и повторите попытку. (resource_busy)',
  'node.error.busyRead':
    'Редактирование остановлено. Не удалось перечитать файл: рабочее дерево занято. Обновите его после завершения текущего действия. (resource_busy)',
  'node.error.workspaceDirty':
    'В рабочем дереве есть незакоммиченные изменения. Сохраните их в коммите или отмените перед удалением.',
  'node.codeLineUnavailable': 'Строки, на которые ведёт ссылка, больше не существуют в этом файле.',
  'image.timeLimit.label': 'Лимит времени генерации изображений',
  'image.timeLimit.unlimited': 'Без ограничения',
  'image.timeLimit.minutes': '{minutes} мин.',
  'image.timeLimit.error':
    'Запрос изображения достиг лимита {minutes} мин. Измените его в Настройки → ИИ → Модели → Лимит времени генерации изображений.',

  'node.delegation.activity': 'Ход работы и отчёты',
  'node.delegation.done': 'Готово',
  'node.delegation.working': 'Работает',
  'node.delegation.unknown': 'Остановлен; результат неизвестен',
  'maps.lightAddressExample': 'https://tiles.example.com/{z}/{x}/{y}.png',
  'maps.darkAddressExample': 'https://tiles.example.com/dark/{z}/{x}/{y}.png',
  'node.error.size': 'Запрос слишком большой. Уменьшите его размер и повторите попытку.',
  'node.error.route':
    'Адрес узла отклонён. Проверьте, какой адрес разрешён приглашением для сопряжения.',

  'node.error.tls':
    'Не удалось безопасно подключиться к узлу. Проверьте адрес, сертификат и соединение.',
  'node.error.access': 'Узел отказал в доступе. Повторите сопряжение или проверьте разрешения.',
  'node.error.unknownOutcome':
    'Результат неизвестен. Обновите данные и проверьте, что произошло, прежде чем повторять.',
  'node.error.outputLimit':
    'Узел вернул слишком много данных. Сузьте запрос или используйте постраничный вывод.',
  'node.error.limit': 'Узел достиг ограничения. Подождите перед повторной попыткой.',
  'node.error.debugger': 'Отладчик недоступен. Проверьте настройки отладки и подключитесь снова.',
  'node.error.generic':
    'Узел не смог выполнить запрос. Проверьте подробности перед повторной попыткой.',
  'node.error.connection': 'Узел отключён. Проверьте соединение и подключитесь снова.',
  'node.error.pairing':
    'Не удалось завершить сопряжение. Проверьте приглашение и повторите попытку.',
  'node.error.identity': 'Узел или цель изменились. Проверьте их подлинность и подключитесь снова.',
  'node.error.stale': 'Данные изменились. Обновите их перед повторной попыткой.',
  'node.error.staleResource':
    'Папка или рабочая копия изменилась. Обновите список и выберите её снова.',
  'node.error.folderUnavailable':
    'Эта папка больше недоступна на узле. Возможно, её удалили или она больше не является репозиторием.',
  'node.folderRefreshed':
    'Папка обновлена. Нажмите «Создать» ещё раз, чтобы создать указанную папку.',
  'node.error.trust':
    'Эта папка не является доверенной. Проверьте настройки доверия перед продолжением.',
  'node.error.unavailable': 'Эта функция недоступна. Проверьте настройки и версию узла.',

  'kit.cancel': 'Отмена',
  'kit.delete': 'Удалить',
  'kit.deleteTooltip': 'Удалить этот объект',
  'kit.cancelTooltip': 'Закрыть без изменений',
  'kit.filename': 'имя файла',
  'kit.create': 'Создать',
  'kit.submitTooltip': 'Продолжить с этим текстом',
  'kit.where': 'Расположение',
  'kit.allLevels': 'Показать все уровни',
  'kit.empty': 'Пока ничего нет',
  'kit.noMatches': 'Ничего не найдено',
  'kit.loading': 'Загрузка…',
  'kit.loadError': 'Не удалось загрузить список',
  'kit.details': 'Подробности',
  'kit.noEvents': 'Пока нет событий',
  'kit.sourceMissing': 'Источник недоступен',
  'kit.saveError': 'Не удалось сохранить',
  'kit.progress': 'Ход выполнения',
  'kit.clear': 'Снять выделение',
  'kit.selectAll': 'Выбрать всё',
  'kit.chooseNone': 'Снять выделение со всех',
  'kit.chooseAll': 'Выбрать все элементы',
  'kit.chooseIcon': 'Выбрать значок',
  'kit.searchIcons': 'Поиск значков, например calendar',
  'kit.noIcon': 'Нет значков с названием, похожим на «{query}».',
  'kit.refreshing': 'Обновление…',
  'kit.objectMissing': 'Объект недоступен',
  'kit.objectError': 'Не удалось загрузить объект',
  'kit.waiting': 'Ожидание вашего ответа',
  'kit.closeSearch': 'Закрыть поиск',
  'kit.folder': 'Папка',
  'kit.scope': 'Область',
  'kit.unknown': 'Неизвестно',
  'kit.removeNote': 'Убрать эту заметку',
  'kit.copyPath': 'Копировать полный путь',
  'kit.reveal': 'Показать в проводнике',
  'kit.targetMissing': 'Объект недоступен',
  'kit.vaultRoot': 'Корень хранилища',
  'kit.previousMonth': 'Предыдущий месяц',
  'kit.dateRange': 'Выбрать период',
  'kit.nextMonth': 'Следующий месяц',
  'kit.noQuote': 'Нет текста цитаты',
  'kit.collapseQuote': 'Свернуть цитату',
  'kit.expandQuote': 'Развернуть цитату',
  'kit.exactTime': 'Точное время',
  'kit.working': 'Выполняется',
  'kit.done': 'Готово',
  'kit.failed': 'Ошибка',
  'kit.skipped': 'Без изменений',
  'kit.errors': 'Ошибки',
  'kit.moreBelow': 'Продолжение ниже',
  'kit.selection': 'Выделение',
  'kit.moreActions': 'Другие действия',
  'kit.showRest': 'Показать оставшуюся часть списка',
  'kit.showMore': {
    one: 'Показать ещё {count}',
    few: 'Показать ещё {count}',
    many: 'Показать ещё {count}',
    other: 'Показать ещё {count}',
  },
  'kit.underlineOn': 'Подчёркивание включено',
  'kit.underlineOff': 'Подчёркивание выключено',
  'kit.underline': 'Подчеркнуть аннотацию',
  'kit.savingColour': 'Сохранение цвета',
  'kit.selectionMissing': 'Выделение недоступно',
  'kit.noColour': 'Без цвета',
  'kit.savingNamedColour': 'Сохранение: {colour}…',
  'kit.colourDisabled': 'Здесь нельзя изменить цвет',
  'kit.waveform': 'Звуковая волна',
  'kit.colour.grey': 'Серый',
  'kit.colour.red': 'Красный',
  'kit.colour.orange': 'Оранжевый',
  'kit.colour.yellow': 'Жёлтый',
  'kit.colour.green': 'Зелёный',
  'kit.colour.cyan': 'Голубой',
  'kit.colour.blue': 'Синий',
  'kit.colour.purple': 'Фиолетовый',
  'kit.colour.pink': 'Розовый',
  'settings.tabs.tasks': 'Задачи',
  'settings.tabs.logs': 'Журналы событий',
  'settings.tabs.journals': 'Дневники',
  'settings.tabs.calendars': 'Календари',
  'settings.tabs.finance': 'Финансы',
  'settings.tabs.timeTracking': 'Учёт времени',
  'settings.tabs.ai': 'ИИ-агент',
  'settings.tabs.scripts': 'Скрипты',
  'settings.tabs.links': 'Ссылки',
  'settings.tabs.github': 'Git-хостинг',
  'settings.tabs.nodes': 'Ноды',
  'settings.tabs.reader': 'Книги',
  'settings.tabs.quickButton': 'Быстрая кнопка',
  'settings.tabs.headerButtons': 'Кнопки заголовка',
  'settings.tabs.linter': 'Проверка заметок',
  'settings.tabs.transfer': 'Перенос',
  'settings.tabs.sync': 'Синхронизация',
  'settings.tabs.other': 'Другое',
  'settings.groups.notes': 'Заметки',
  'settings.groups.moneyTime': 'Деньги и время',
  'settings.groups.agents': 'Агенты',
  'settings.groups.buttons': 'Кнопки',
  'settings.groups.data': 'Данные',
  'settings.documentation': 'Документация',
  'settings.documentationTooltip': 'Закрыть настройки и прочитать об этой вкладке',
  'settings.englishDocs': 'Документация на английском языке',
  'kit.imageMissing': 'Изображение недоступно',
  'kit.loadingImage': 'Загрузка изображения…',
  'kit.deviceMissing': 'Недоступно на этом устройстве',
  'kit.hideDetail': 'Скрыть: {label}',
  'kit.showDetail': 'Показать: {label}',
  'kit.description': 'описание',
  'kit.openSource': 'Открыть источник: {title}',
  'kit.retry': 'Повторить: {title}',
  'kit.moreIcons': 'Ещё {count} значков ниже',
  'kit.image': 'изображение',
  'kit.imageMissingNamed': 'Изображение недоступно: {name}',
  'kit.previewImage': 'Просмотр: {name}',
  'kit.inputLoading': 'Загружаю',
  'kit.partOf': '{shown} из {total}',
  'kit.workspace': 'Рабочая область: {name}',
  'kit.qrCode': 'QR-код',
  'kit.askSelection': 'Спросить агента об этом в новом чате',
  'kit.addSelection': 'Добавить в открытый чат',
  'node.trust.title': 'Доверять этой папке для работы агентов?',
  'node.trust.message':
    'Агенты смогут запускать команды и менять файлы в {path}. Доверяйте папке, только если знаете её содержимое. За работой агента можно следить в чате и остановить его там.',
  'node.trust.allow': 'Доверять папке',
  'node.chat.closeTab':
    'Закрыть вкладку — сессия останется на узле. Откройте её из панели узла, чтобы следить за работой или остановить её.',
  'kit.noteSelection': 'Вставить в последнюю открытую заметку',
  'kit.linkSelection': 'Копировать ссылку на эти строки',
  'kit.saving': 'Сохранение…',
  'commands.convert-drawings-to-canvases': 'Преобразовать старые рисунки в холсты',
  'drawing.conversion-result':
    'Рисунки: преобразовано {converted}, уже преобразовано {existing}, ошибок {failed}. Оригиналы сохранены.',
  'commands.migrate-excalidraw-drawing': 'Перенести этот рисунок Excalidraw на холст',
  'commands.migrate-excalidraw-vault': 'Перенести все рисунки Excalidraw на холсты',
  'commands.new-canvas': 'Новый холст',
  'commands.open-canvas-viewer': 'Открыть текущий холст в просмотрщике диаграмм',
  'commands.open-changelog': 'Открыть историю изменений',
  'commands.cycle-checkbox-state': 'Переключить состояние флажка',
  'commands.insert-columns': 'Вставить столбцы',
  'commands.column-options': 'Параметры столбцов',
  'commands.remove-columns': 'Удалить столбцы',
  'commands.add-text-comment': 'Добавить комментарий',
  'commands.open-node-repository': 'Открыть репозиторий ноды',
  'commands.chat-about-github-item': 'Обсудить этот элемент GitHub',
  'commands.open-github-repository': 'Открыть репозиторий GitHub…',
  'commands.show-github-notifications': 'Показать уведомления GitHub',
  'commands.open-github-link': 'Открыть ссылку или элемент GitHub',
  'commands.copy-link-to-lines': 'Скопировать ссылку на выбранные строки',
  'commands.linter-open': 'Открыть линтер',
  'commands.linter-lint-note': 'Проверить текущую заметку линтером',
  'commands.linter-lint-folder': 'Проверить папку линтером…',
  'commands.linter-lint-vault': 'Проверить хранилище линтером',
  'commands.sync-now': 'Синхронизировать сейчас',
  'commands.sync-pause-resume': 'Приостановить или возобновить синхронизацию',
  'commands.sync-log': 'Открыть настройки синхронизации',
  'commands.sync-deleted-files': 'Открыть удалённые файлы',
  'commands.reader-toggle-eink': 'Переключить режим электронной бумаги для книг на этом устройстве',
  'commands.reader-toggle-zen': 'Переключить дзен-режим для книг на этом устройстве',
  'commands.open-requests': 'Открыть запросы',
  'commands.import-requests': 'Импортировать запросы из буфера обмена',
  'commands.new-presentation': 'Новая презентация',
  'commands.open-presentation': 'Открыть презентацию',
  'commands.preview-presentation': 'Предпросмотр презентации рядом с редактором',
  'commands.play-presentation': 'Запустить презентацию',
  'commands.present-presentation': 'Показать презентацию с экраном докладчика',
  'commands.agents': 'Агенты',
  'ribbon.agents': 'Агенты',
  'commands.comment-here': 'Прокомментировать здесь',
  'commands.show-ai-sidebar': 'Показать боковую панель чата с ИИ',
  'commands.find-in-chat': 'Найти в текущем чате',
  'commands.search-all-chats': 'Поиск по всем чатам',
  'commands.chat-close-tab': 'Закрыть текущую вкладку чата',
  'commands.chat-reopen-tab': 'Открыть последнюю закрытую вкладку чата',
  'commands.chat-next-tab': 'Перейти к следующей вкладке чата',
  'commands.chat-previous-tab': 'Перейти к предыдущей вкладке чата',
  'ribbon.show-ai-chat': 'Показать чат с ИИ',
  'commands.voice-input': 'Продиктовать в заметку',
  'commands.show-script-runs': 'Показать запуски скриптов',
  'commands.open-documentation': 'Открыть документацию',
  'commands.open-quick-menu': 'Открыть быстрое меню',
  'commands.show-script-api': 'Показать справочник API скриптов',
  'commands.review-key-destinations': 'Проверить адреса использования ключей',
  'commands.create-task': 'Создать новую задачу',
  'commands.create-task-and-insert-link': 'Создать новую задачу и вставить в текущую заметку',
  'commands.find-and-replace':
    'Найти и заменить в свойствах и содержимом всех заметок, соответствующих условиям',
  'commands.import-files': 'Импортировать файлы в хранилище',
  'commands.save-media': 'Сохранить удалённые медиафайлы в хранилище',
  'commands.unused-media': 'Найти и удалить неиспользуемые медиафайлы',
  'commands.deduplicate-media': 'Удалить дубликаты медиавложений',
  'commands.migrate-from-dataview': 'Перенести задачи из Dataview',
  'commands.migrate-from-firefly': 'Перенести данные из Firefly III',
  'commands.create-transaction': 'Создать новую транзакцию',
  'commands.create-transaction-and-insert-link':
    'Создать новую транзакцию и вставить в текущую заметку',
  'commands.show-timeline-sidebar': 'Показать боковую панель хронологии',
  'commands.migrate-dataview-fields': 'Перенести поля Dataview',
  'commands.show-todo-sidebar': 'Показать боковую панель задач',
  'commands.show-finance-sidebar': 'Показать боковую панель финансов',
  'commands.show-accounts-sidebar': 'Показать боковую панель счетов',
  'commands.migrate-from-toggl': 'Перенести записи времени из Toggl',
  'commands.show-time-tracking-sidebar': 'Показать боковую панель учёта времени',
  'commands.start-timer': 'Запустить таймер для текущей заметки',
  'commands.stop-timer': 'Остановить активный таймер',
  'commands.paste-from-clipboard': 'Вставить из буфера обмена в позицию курсора',
  'commands.create-note-from-template': 'Создать заметку из шаблона',
  'commands.create-note-in-group': 'Создать заметку в группе',
  'commands.replace-note-with-template': 'Заменить текущую заметку шаблоном',
  'commands.insert-template-at-cursor': 'Вставить шаблон в позицию курсора',
  'commands.insert-gallery': 'Вставить галерею изображений',
  'commands.convert-images-to-galleries': 'Преобразовать изображения на странице в галереи',
  'commands.reindex-footnotes': 'Перенумеровать сноски',
  'commands.insert-highlight': 'Вставить цветовое выделение',
  'commands.remove-highlight': 'Удалить цветовое выделение',
  'commands.set-cover-from-first-media':
    'Установить обложку из первого изображения или видео в заметке',
  'commands.open-today-daily-note': 'Открыть сегодняшнюю ежедневную заметку',
  'commands.create-css-snippet': 'Создать CSS-фрагмент',
  'commands.reload-css-snippets': 'Перезагрузить CSS-фрагменты',
  'commands.create-script': 'Создать скрипт',
  'ribbon.show-timeline-sidebar': 'Показать боковую панель хронологии',
  'ribbon.show-todo-sidebar': 'Показать боковую панель задач',
  'ribbon.show-finance-sidebar': 'Показать боковую панель финансов',
  'ribbon.show-time-tracking': 'Показать учёт времени',
  'ribbon.show-script-runs': 'Показать запуски скриптов',
  'commands.open-node': 'Открыть ноду',
  'ribbon.node': 'Нода',
  'commands.toggle-zen-mode': 'Переключить дзен-режим',
  'commands.add-to-agent-context': 'Добавить в контекст агента',
  'commands.chat-about-current-note': 'Обсудить это',
  'commands.attach-note-to-chat': 'Прикрепить к чату',
  'commands.attach-chat-to-current-note': 'Прикрепить чат к заметке',
  'commands.copy-note-wikilink': 'Скопировать вики-ссылку',
  'commands.review-scripts': 'Проверить скрипты, ожидающие подтверждения',
  'commands.script': 'Скрипт: {name}',
  'settings.nodes.title': 'Ноды',
  'settings.nodes.description':
    'Компьютеры, на которых агент может работать для вас: откройте ноду, выберите проект, наблюдайте за работой и отвечайте здесь. Их ключи и история остаются на этом устройстве.',
  'settings.nodes.check': 'Проверить соединение этого устройства с нодой',
  'settings.nodes.open': 'Открыть сессию',
  'settings.nodes.openTip': 'Выбрать сессию или управлять проектами и рабочими пространствами',
  'settings.nodes.more': 'Сопряжение, доступ к отладчику, удаление',
  'settings.nodes.pairTitle': 'Подключить ноду на другом компьютере',
  'settings.nodes.pairDesc':
    'Удалённый компьютер или сервер — по приглашению с него. Устройство с отозванным доступом подключается заново таким же способом.',
  'settings.nodes.pair': 'Подключить',
  'settings.nodes.pairTip':
    'Отсканировать или вставить приглашение; подключиться заново или проверить изменившийся ключ ноды',
  'settings.nodes.addTitle': 'Добавить ноду на этом компьютере',
  'settings.nodes.addDesc': 'Работающая здесь нода — по её токену.',
  'settings.nodes.add': 'Добавить',
  'settings.nodes.addTip': 'Задать имя ноды здесь и вставить её токен',
  'settings.nodes.traceTitle': 'Заметки о записанных запусках',
  'settings.nodes.traceDesc':
    'Папка для заметок о запусках, записанных отладчиком вами или агентом: папка хранилища или любая папка на компьютере по полному пути. Сама запись остаётся на ноде.',
  'settings.nodes.traceExample': 'например, Trace',
  'settings.nodes.traceFolder': 'Папка заметок о записанных запусках',
  'settings.nodes.chooseFolderTip': 'Выбрать папку на этом компьютере — в хранилище или вне его',
  'settings.nodes.chooseFolder': 'Выбрать папку заметок о записанных запусках',
  'settings.nodes.name': 'Имя',
  'settings.nodes.nameDesc': 'Как эта нода называется на этом устройстве.',
  'settings.nodes.localPlaceholder': 'Локальная нода',
  'settings.nodes.label': 'Имя ноды',
  'settings.nodes.address': 'Адрес',
  'settings.nodes.addressDesc':
    'Только адрес этого компьютера; другой компьютер подключается через сопряжение.',
  'settings.nodes.url': 'URL ноды',
  'settings.nodes.token': 'Токен',
  'settings.nodes.tokenDesc':
    'Токен, который выводит abele-node token create. Хранится только в связке ключей этого устройства.',
  'settings.nodes.pasteToken': 'Вставьте токен',
  'settings.nodes.installationToken': 'Токен установки ноды',
  'settings.nodes.cancel': 'Отмена',
  'settings.nodes.cancelTip': 'Закрыть, ничего не добавляя',
  'settings.nodes.authenticateTip':
    'Пройти аутентификацию и закрепить идентификатор локальной ноды на этом устройстве',
  'settings.nodes.untitledChat': 'Чат без названия',
  'settings.nodes.unavailable': 'Нода недоступна',
  'settings.nodes.added': 'Подключено. Откройте сессию здесь или в меню нового чата.',
  'settings.nodes.connected': 'Подключено',
  'settings.nodes.connecting': 'Подключение…',
  'settings.nodes.disconnected': 'Не подключено',
  'settings.nodes.repair': 'Сопряжение / повторное подключение',
  'settings.nodes.remove': 'Удалить',
  'settings.nodes.removed':
    'Соединение удалено с этого устройства. История ноды и учётные данные демона не изменены.',
  'commands.insert-columns-two': 'Вставить два равных столбца',
  'commands.insert-columns-three': 'Вставить три равных столбца',
  'commands.insert-columns-aside': 'Вставить текст с боковой колонкой',
  'ribbon.agentsStatus': 'Агенты · Требуют внимания: {attention}. Работают: {running}',
  'ribbon.agentsStatusIncomplete':
    'Агенты · Требуют внимания: {attention}. Работают: {running} · Некоторые беседы не удалось проверить',
  'settings.AiSettings.general.c910d474': 'Общий',
  'settings.AiSettings.models.d17d2d78': 'Модели',
  'settings.AiSettings.agents.279b44d2': 'Агенты',
  'settings.AiSettings.prompts.5f2e66e6': 'Промпты',
  'settings.AttachmentRulesSettings.attachment_folders.4ec7937c': 'Папки вложений',
  'settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d':
    'Файлы, вставленные или переброшенные в заметку в одной из этих папок, попадают в папку с именами ее правил. Побеждает самая глубокая папка.',
  'settings.AttachmentRulesSettings.add_a_rule.bed79361': 'Добавить правило',
  'settings.AttachmentRulesSettings.notes_in.af0c6387': 'Заметки в',
  'settings.AttachmentRulesSettings.notes_folder.b8c1e974': 'Папка заметок',
  'settings.AttachmentRulesSettings.folder.74ccd433': 'Папка',
  'settings.AttachmentRulesSettings.remove_this_rule.00612239': 'Удалить это правило',
  'settings.AttachmentRulesSettings.attachments_go_to.7b114ade': 'Вложения идут в',
  'settings.AttachmentRulesSettings.attachment_folder.fce49098': 'Папка вложений',
  'settings.AttachmentRulesSettings.subfolder_name.f381c5ab': 'Имя подпапки',
  'settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7':
    'Никаких правил: вложения соответствуют настройкам Obsidian.',
  'settings.AttachmentRulesSettings.add_a_folder_rule.879a8360': 'Добавить правило для папки',
  'settings.AttachmentRulesSettings.same_folder_as_the_note.32781177': 'Та же папка, что и заметка',
  'settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55':
    'В папке указанной ниже',
  'settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483':
    'В подпапке папки заметки',
  'settings.AttachmentRulesSettings.whole_vault.cb44fe25': 'Целое хранилище',
  'settings.CalendarsSettings.calendars.e0b2b00c': 'Календари',
  'settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b':
    'События из Google, iCloud, Outlook или любого сервера CalDAV отображаются рядом с задачами: в календаре боковой панели, на временной шкале и в ежедневных заметках. Только для чтения — в календарь ничего не записывается и не делается никаких заметок, если вы не попросите их сделать на мероприятии.',
  'settings.CalendarsSettings.read_every_minutes.f4ca625e': 'Интервал обновления (мин)',
  'settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf':
    'Когда Обсидиан запускается, то это часто пока он открыт. минимум {value0}; Сам Google обновляет ссылку только каждые несколько часов.',
  'settings.CalendarsSettings.read_now.20d8b246': 'Обновить сейчас',
  'settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9':
    'Обновить все отображаемые календари сейчас',
  'settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f': 'Календарь пока не отображается',
  'settings.CalendarsSettings.your_calendars.80ca6c5e': 'Ваши календари',
  'settings.CalendarsSettings.not_read.e4f441c4': 'Не загружено: ',
  'settings.CalendarsSettings.change_this_calendar.a6ced910': 'Изменить этот календарь',
  'settings.CalendarsSettings.add_another_calendar.744b9f9c': 'Добавить еще один календарь',
  'settings.CalendarsSettings.no_calendars_yet.0097b3fe': 'Календарей пока нет',
  'settings.CalendarsSettings.a_secret_link_from_google.21e49135':
    'Секретная ссылка из Google, iCloud или Outlook или учетная запись CalDAV.',
  'settings.CalendarsSettings.add_calendar.9067e0e8': 'Добавить календарь',
  'settings.CalendarsSettings.add_a_calendar_to_show.6973ff63':
    'Добавьте календарь, который будет отображаться рядом с задачами.',
  'settings.CalendarsSettings.name.dcd1d522': 'Имя',
  'settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee':
    'Отображается рядом с каждым событием.',
  'settings.CalendarsSettings.e_g_work.7f2ce0de': 'например {literal0}',
  'settings.CalendarsSettings.colour.3a9dfa58': 'Цвет',
  'settings.CalendarsSettings.its_events_are_marked_with.16eafb54': 'Этим отмечены его события.',
  'settings.CalendarsSettings.connected_by.9952ce52': 'Подключено',
  'settings.CalendarsSettings.a_secret_link_to_the.9b051a7d':
    'Секретная ссылка на календарь или учетная запись CalDAV с ее именем пользователя и паролем.',
  'settings.CalendarsSettings.link.a6a32dbc': 'Связь',
  'settings.CalendarsSettings.forget_the_link.45aee758': 'Забудьте ссылку',
  'settings.CalendarsSettings.server.aef7de28': 'Сервер',
  'settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72':
    'Адрес CalDAV: {literal0} для iCloud, {literal1} для Fastmail, адрес вашего Nextcloud для Nextcloud.',
  'settings.CalendarsSettings.username.e3b89e9d': 'Имя пользователя',
  'settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f':
    'Для iCloud — адрес электронной почты учетной записи Apple.',
  'settings.CalendarsSettings.password.e7cf3ef4': 'Пароль',
  'settings.CalendarsSettings.app_specific_password.ffcc8f77': 'Пароль для конкретного приложения',
  'settings.CalendarsSettings.forget_the_password.9d745dd0': 'Забудьте пароль',
  'settings.CalendarsSettings.calendar.d5d0a30b': 'Календарь',
  'settings.CalendarsSettings.one_calendar_of_the_account.562ef915':
    'Один календарь аккаунта или все. Поиск календарей спрашивает сервер, какие они есть.',
  'settings.CalendarsSettings.find_calendars.d59c2286': 'Найти календари',
  'settings.CalendarsSettings.set_the_server_the_username.111eaa0a':
    'Сначала установите сервер, имя пользователя и пароль',
  'settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb':
    'Спросите сервер, какие календари есть у этой учетной записи.',
  'settings.CalendarsSettings.delete.e2d0a549': 'Удалить',
  'settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787':
    'Удали этот календарь из настроек и его ключ из брелка',
  'settings.CalendarsSettings.done.11a6767d': 'Готово',
  'settings.CalendarsSettings.close_this_window_changes_are.91342d87':
    'Закройте это окно; изменения сохраняются по мере их внесения',
  'settings.CalendarsSettings.delete_the_calendar.e601c301': 'Удалить календарь',
  'settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0':
    'Удалить {value0}? Его события покидают списки, а его {value1} удаляется из цепочки для ключей. Сам календарь не трогается.',
  'settings.CalendarsSettings.google_the_calendar_s_settings.065b586e':
    'Google: настройки календаря, «Секретный адрес в формате iCal». iCloud: поделитесь календарем как общедоступным и скопируйте его ссылку. Outlook: опубликуйте календарь и скопируйте ссылку ICS. Хранится на брелке — календарь может прочитать любой, у кого есть ссылка.',
  'settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48':
    'Для iCloud — пароль для конкретного приложения, созданный на сайте account.apple.com, а не собственный пароль учетной записи. Хранится в связке ключей, а не в файле настроек.',
  'settings.CalendarsSettings.secret_link_ics.a3f8db65': 'Секретная ссылка (ICS)',
  'settings.CalendarsSettings.caldav_account.bb860701': 'Учетная запись CalDAV',
  'settings.CalendarsSettings.the_value_could_not_be.3daaa765':
    '{value0} не удалось сохранить в связке ключей: {value1}.',
  'settings.CalendarsSettings.asking_the_server.fb689559': 'Спросил сервер…',

  'settings.CalendarsSettings.the_account_has_no_calendar.a059bc95':
    'В аккаунте нет календаря с событиями.',
  'settings.CalendarsSettings.all_calendars_of_the_account.3b138d44': 'Все календари аккаунта',
  'settings.CalendarsSettings.just_now.7ddb44d8': 'прямо сейчас',
  'settings.CalendarsSettings.value_min_ago.c85acd7d': '{value0} мин. назад',
  'settings.CalendarsSettings.not_shown.a08f0f94': 'Не показано',
  'settings.CalendarsSettings.reading.874bfa5b': 'Чтение…',
  'settings.CalendarsSettings.no_password_yet.11f1e05e': 'Пароля еще нет',
  'settings.CalendarsSettings.no_link_yet.60e5be61': 'Ссылки пока нет',
  'settings.CalendarsSettings.could_not_be_read.51a02791': 'Не удалось прочитать',
  'settings.CalendarsSettings.not_read_yet.fbe841ea': 'Ещё не загружено',
  'settings.CalendarsSettings.reading_the_calendars.b8ec37a1': 'Загрузка календарей…',
  'settings.CalendarsSettings.value_of_the_calendars_could.c86147d0':
    'Не удалось прочитать {value0} календарей; каждый говорит, почему ниже.',
  'settings.CalendarsSettings.read_every_calendar_again_now.d8b13597':
    'Перечитывайте каждый календарь еще раз сейчас, а не через следующий интервал.',
  'settings.FinanceSettings.transactions.3e5136fd': 'Транзакции',
  'settings.FinanceSettings.transaction_path_template.39b564b9': 'Шаблон пути транзакции',
  'settings.FinanceSettings.template_for_new_transaction_file.0e3740ec':
    'Шаблон для новых путей к файлам транзакций. Оставьте пустым, чтобы сохранить существующие пути; новые транзакции используют свои названия в корне хранилища. Переменные: {literal0}, {literalDate}, {literal1}, {literal2}, {literal3}, {literal4}.',
  'settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45': 'например {literal1}',
  'settings.FinanceSettings.transaction_template_note.010eab6c': 'Заметка к шаблону транзакции',
  'settings.FinanceSettings.path_to_a_template_note.397b813a':
    'Путь к шаблону заметки, используемому при создании новых транзакций.',
  'settings.FinanceSettings.path_to_template_note.18b70a08': 'Путь к шаблону заметки',
  'settings.FinanceSettings.default_currency.67e65877': 'Валюта по умолчанию',
  'settings.FinanceSettings.default_currency_code_for_new.7d536f52':
    'Код валюты по умолчанию для новых транзакций.',
  'settings.FinanceSettings.e_g_eur.00afdaf5': 'например {literal0}',
  'settings.FinanceSettings.pinned_currencies.b882d6bc': 'Закрепленные валюты',
  'settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698':
    'Валюты, разделенные запятыми, для отображения сводной информации о балансе на боковой панели. Порядок сохранен.',
  'settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64': 'например {literal0}',
  'settings.FinanceSettings.exchange_rates.a1875e41': 'Курсы валют',
  'settings.FinanceSettings.fetch_today_s_rates.c175748e': 'Получить сегодняшние тарифы',
  'settings.FinanceSettings.once_a_day_from_a.73d47942':
    'Раз в день из общедоступного стола, для которого не нужен ключ; ничего о хранилище не отправляется. В них используются суммы нескольких валют и порядок счетов по суммам.',
  'settings.FinanceSettings.show_sums_in.86b3b3d2': 'Показать суммы в',
  'settings.FinanceSettings.the_currency_a_sum_of.42c9988d':
    'Валюта, в которой отображается сумма нескольких валют.',
  'settings.FinanceSettings.rates.54dd2169': 'Цены',
  'settings.FinanceSettings.fetch_today_s_rates_now.68e35189':
    'Получите сегодняшние тарифы прямо сейчас',
  'settings.FinanceSettings.firefly_iii_migration.59031cf7': 'Миграция Firefly III',
  'settings.FinanceSettings.firefly_iii_url.3050cc31': 'URL-адрес Firefly III',
  'settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a':
    'Базовый URL-адрес вашего экземпляра Firefly III.',
  'settings.FinanceSettings.e_g_https_firefly_example.6999e343': 'например {literal1}',
  'settings.FinanceSettings.firefly_iii_token.45c3acb2': 'Токен Firefly III',
  'settings.FinanceSettings.personal_access_token_for_firefly.7deff96a':
    'Токен личного доступа для API Firefly III. Хранится в связке ключей, а не в файле настроек.',
  'settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788':
    'Введите свой токен Firefly III',
  'settings.FinanceSettings.forget_the_token.961a44b9': 'Забудьте токен',
  'settings.FinanceSettings.accounts_folder.8f9b5bf3': 'Папка учетных записей',
  'settings.FinanceSettings.folder_for_account_notes_created.dab1fa98':
    'Папка для заметок учетной записи, созданная во время миграции.',
  'settings.FinanceSettings.enter_accounts_folder_path.93935780':
    'Введите путь к папке учетных записей',
  'settings.FinanceSettings.categories_folder.60253c7c': 'Папка категорий',
  'settings.FinanceSettings.folder_for_category_notes_created.9f0764fe':
    'Папка для заметок по категориям, созданная во время миграции.',
  'settings.FinanceSettings.enter_categories_folder_path.306fac3f':
    'Введите путь к папке категорий',
  'settings.FinanceSettings.fetching_today_s_rates.1182bcb9': 'Получение текущих цен…',
  'settings.FinanceSettings.could_not_fetch_value.ae250f78': 'Не удалось получить: {value0}.',
  'settings.FinanceSettings.not_fetched_yet.21ca804f': 'Еще не получено.',
  'settings.FinanceSettings.could_not_update_since_value.9af0a0fc':
    'Не удалось обновить с {value0}{value1}.',
  'settings.FinanceSettings.from_value_value.11c05045': 'От {value0}, {value1}',
  'settings.FinanceSettings.no_rate_for_value_left.b8718978':
    'Нет ставки для {value0}: не включено в суммы',
  'settings.GithubAccessReport.token.d2089be6': 'Токен',
  'settings.GithubAccessReport.sent.c16bc82b': 'Отправил',
  'settings.GithubAccessReport.not_sent.cd5f943d': 'Не отправлено',
  'settings.GithubAccessReport.refused.66b87354': 'Отказался',
  'settings.GithubAccessReport.skipped.12698ce1': 'Пропущено',
  'settings.GithubAccessReport.a_fine_grained_personal_access.04646cce':
    'детальный токен личного доступа',
  'settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc':
    'классический токен личного доступа',
  'settings.GithubAccessReport.an_oauth_token.4e87c03e': 'токен OAuth',
  'settings.GithubAccessReport.a_github_app_s_token.911c13a3': 'токен приложения GitHub',
  'settings.GithubAccessReport.a_token_of_a_kind.7af25278':
    'токен типа, который GitHub не отмечает',
  'settings.GithubAccessReport.sent_with_every_request_value.a8affe59':
    'Отправляется с каждым запросом: символов {value0}, {value1}.',
  'settings.GithubAccessReport.no_token_was_sent_with.8d5461bf':
    'С этими запросами токен не был отправлен.',
  'settings.GithubAccessReport.token_is_set_for_value.2c01fdf9': 'Токен установлен для: {value0}',
  'settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e':
    'Репозиторий: {value0}/{value1} на {value2}',
  'settings.GithubAccessReport.belongs_to_value.d316930d': 'Принадлежит {value0}.',
  'settings.GithubAccessReport.expires_value.f820bc15': 'Срок действия истекает {value0}.',
  'settings.GithubAccessReport.scopes_value.1d42883b': 'Области: {value0}.',
  'settings.GithubAccessReport.api_value.011cfaea': 'API: {value0}',
  'settings.GithubAccessReport.needs_value.9e07998c': 'Требуется: {value0}',
  'settings.GithubAccessReport.github_said_value.cc7a0df5': 'GitHub сказал: «{value0}»',
  'settings.GithubConnectionEditor.add_github_connection.a8b1ed9f': 'Добавить соединение с GitHub',
  'settings.GithubConnectionEditor.edit_github_connection.ca1cc639': 'Изменить соединение с GitHub',
  'settings.GithubConnectionEditor.account.7e1b0d56': 'Счет',
  'settings.GithubConnectionEditor.name.dcd1d522': 'Имя',
  'settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0':
    'Имя для этого подключения, независимое от учетной записи, обнаруженной по ее токену.',
  'settings.GithubConnectionEditor.connection_name.686d4d5d': 'Имя соединения',
  'settings.GithubConnectionEditor.server.aef7de28': 'Сервер',
  'settings.GithubConnectionEditor.empty_is_github_com_for.0f201123':
    'Пусто — github.com. Для Enterprise используйте его полный адрес, включая любой порт.',
  'settings.GithubConnectionEditor.github_com.3aeb0024': 'github.com',
  'settings.GithubConnectionEditor.token.d2089be6': 'Токен',
  'settings.GithubConnectionEditor.github_pat.94238580': 'github_pat_...',
  'settings.GithubConnectionEditor.forget_the_token.961a44b9': 'Забудьте токен',
  'settings.GithubConnectionEditor.default_for_this_server.c7a4b365':
    'По умолчанию для этого сервера',
  'settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859':
    'Используется, когда ни один из предпочтений владельца репозитория не выбирает другое соединение.',
  'settings.GithubConnectionEditor.repository_owners.89c91e93': 'Владельцы репозитория',
  'settings.GithubConnectionEditor.one_per_line_sample_org.335517a9':
    'По одному в строке: sample-org, sample-org/*, sample-* или sample-org/project. Более конкретные правила побеждают.',
  'settings.GithubConnectionEditor.sample_org_nsample_org_project.9045ecd8':
    'sample-org\\nsample-org/проект',
  'settings.GithubConnectionEditor.check_access.abb9a172': 'Проверить доступ',
  'settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0':
    'Проверяет только это соединение. Оставьте репозиторий пустым, чтобы обнаружить учетную запись.',
  'settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009':
    'владелец/репозиторий или ссылка на GitHub',
  'settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799':
    'Отправлять запросы на чтение с помощью токена этого черновика, не сохраняя его.',
  'settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327':
    'Другое соединение использует ту же учетную запись на этом сервере. Вы все еще можете сохранить его.',
  'settings.GithubConnectionEditor.cancel.19766ed6': 'Отмена',
  'settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff':
    'Отменить этот черновик, не меняя настройки или связку ключей.',
  'settings.GithubConnectionEditor.save.1509f561': 'Сохранить',
  'settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364':
    'Сохраните это соединение и его токен, затем закройте редактор.',
  'settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6':
    'Токен будет забыт при сохранении.',
  'settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e':
    'Токен хранится на этом устройстве. Введите замену или оставьте пустым, чтобы сохранить ее. Изменения сохраняются только с помощью Save.',
  'settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60':
    'Синхронизированные ключи заблокированы; разблокируйте их, чтобы использовать токен, или введите новый.',
  'settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf':
    'На этом устройстве нет токена. Сохраняется в связке ключей только при сохранении.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209':
    'Укажите владельца/репозиторий или ссылку на репозиторий.',
  'settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d':
    'Этот репозиторий находится на другом сервере. Вместо этого выберите его соединение.',
  'settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4':
    'Этот репозиторий находится на другом адресе, схеме или порту сервера. Используйте сервер этого соединения.',
  'settings.GithubConnectionEditor.asking_github.5becc057': 'Спрашиваю GitHub…',
  'settings.GithubConnectionEditor.the_access_check_failed.90fa9dca':
    'Проверка доступа не удалась.',
  'settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c':
    'Открывайте репозитории, задачи, пул-реквесты, коммиты и файлы GitHub, Forgejo и Gitea во вкладках, а уведомления — в боковой панели. Доступные действия зависят от сервиса.',
  'settings.GithubSettings.open_github_links_in_obsidian.815b1959':
    'Открывать ссылки Git в Obsidian',
  'settings.GithubSettings.a_click_on_a_supported.f005fa1f':
    'Поддерживаемая ссылка на репозиторий открывается во вкладке. Другие ссылки и ссылки с зажатой Alt открываются в браузере.',
  'settings.GithubSettings.default_repository.525a8366': 'Репозиторий по умолчанию',
  'settings.GithubSettings.where_the_command_open_github.750aa580':
    'Где команда Open GitHub link or item ищет объект, если нет контекста вкладки репозитория. Укажите owner/repo или ссылку; при неоднозначном имени выберите подключение.',
  'settings.GithubSettings.owner_repo.65e817ee': 'владелец/репо',
  'settings.GithubSettings.pinned_repositories.03dccfeb': 'Закрепленные репозитории',
  'settings.GithubSettings.first_in_open_github_repository.067f8a9c':
    'Первыми в Open GitHub repository…; переносятся с настройками. Закрепите репозиторий в этом списке (Alt+Enter) или в меню вкладки репозитория.',
  'settings.GithubSettings.nothing_pinned_yet.0b27e4d1': 'Еще ничего не закреплено.',
  'settings.GithubSettings.unpin_this_repository.91038877': 'Открепить этот репозиторий',
  'settings.GithubSettings.connections.dc273117': 'Соединения',
  'settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9':
    'У каждого подключения свой сервис, сервер и аккаунт; выберите основное для каждого сервера. Для просмотра нужен токен с доступом на чтение репозитория. Для уведомлений GitHub нужен классический токен с правом notifications.',
  'settings.GithubSettings.no_connections_public_github_com.534d40f4':
    'Никаких связей. Публичные репозитории github.com читаются анонимно.',
  'settings.GithubSettings.default.2a7e0b7b': ' · По умолчанию',
  'settings.GithubSettings.check.9d60841e': 'Проверять',
  'settings.GithubSettings.check_this_connection_s_account.64de4945':
    'Проверьте учетную запись этого подключения и доступ к хранилищу.',
  'settings.GithubSettings.edit.464c4ffd': 'Редактировать',
  'settings.GithubSettings.edit_this_connection_s_name.de8cb86e':
    'Измените имя, сервер, токен и настройки владельца этого соединения.',
  'settings.GithubSettings.delete.e2d0a549': 'Удалить',
  'settings.GithubSettings.remove_this_connection_after_confirmation.f3a7dd7f':
    'Удалить это соединение после подтверждения',
  'settings.GithubSettings.public_github_com_anonymous.c18bb859': 'Публичный github.com (анонимно)',
  'settings.GithubSettings.value_of_value_requests_remaining.037c7ebe':
    '{value0} из {value1} осталось запросов{value2}',
  'settings.GithubSettings.quota_not_observed_yet_normally.b802706a':
    'Квота еще не соблюдена; обычно это устройство разделяет 60 запросов в час.',
  'settings.GithubSettings.add_connection.685f88ae': 'Добавить соединение',
  'settings.GithubSettings.create_a_connection_with_its.a4245461':
    'Создайте соединение с собственным токеном связки ключей.',
  'settings.GithubSettings.notifications.78801183': 'Уведомления',
  'settings.GithubSettings.a_fine_grained_personal_access.259d3619':
    'Детализированный токен личного доступа может читать содержимое репозитория, но GitHub отправляет уведомления только классическому токену с областью уведомлений. Установите токен уведомлений ниже для сохраненного единственного почтового ящика. Он остается привязанным к серверу, на котором был установлен.',
  'settings.GithubSettings.notifications_token.e314ce9b': 'Токен уведомлений',
  'settings.GithubSettings.optional_a_classic_personal_access.0e7b2561':
    'Необязательный. Классический токен личного доступа с областью уведомлений, используемый только панелью уведомлений: GitHub не позволяет детальному токену читать уведомления. Пусто: панель использует соединение по умолчанию. Хранится в брелке.',
  'settings.GithubSettings.ghp.ff475c83': 'гхп_...',
  'settings.GithubSettings.forget_the_notifications_token.5f48625d': 'Забудьте токен уведомлений',
  'settings.GithubSettings.pages.9046da16': 'Страницы',
  'settings.GithubSettings.how_a_github_tab_lays.f030133b':
    'Как на вкладке GitHub представлено то, что она показывает.',
  'settings.GithubSettings.page_width.217fbef1': 'Ширина страницы',
  'settings.GithubSettings.how_wide_the_text_of.8d0e20a7':
    'Насколько широк текст вкладки: разговоры, сообщения о фиксации, отображаемая уценка и страницы папок. Различия и код всегда занимают всю вкладку.',
  'settings.GithubSettings.width_in_pixels.b3f8f713': 'Ширина в пикселях',
  'settings.GithubSettings.from_value_to_value_a.87f8c5fb':
    'От {value0} до {value1}. Вкладка уже, чем эта, использует то, что у нее есть.',
  'settings.GithubSettings.markdown_files_open_as.5541a0b8': 'Файлы Markdown открываются как',
  'settings.GithubSettings.preview_rendered_and_a_link.7f27338b':
    'Предварительный просмотр: отображается, и ссылка на строки файла отмечает абзацы, списки или блоки кода, которые их содержат. Код: файл в том виде, в каком он записан, построчно. Переключатель над файлом меняет его для этой вкладки.',
  'settings.GithubSettings.people.7db20897': 'Люди',
  'settings.GithubSettings.who_wrote_an_issue_a.deb19dbb':
    'Кто написал проблему, комментарий, обзор или коммит со своей фотографией. Имена и изображения запрашиваются на GitHub один раз и хранятся на этом устройстве в течение недели.',
  'settings.GithubSettings.show_people_by.989a820c': 'Показать людей по',
  'settings.GithubSettings.their_name_as_their_profile.2452b5a6':
    'Их имя, указанное в профиле, или их логин. Другой находится во всплывающей подсказке, и щелчок по человеку меняет их местами. Тот, чей профиль не имеет имени, в любом случае отображается при входе в систему.',
  'settings.GithubSettings.kept_names_and_pictures.586c5b5f': 'Сохранены имена и фотографии',
  'settings.GithubSettings.clear.83b12c22': 'Снять выделение',
  'settings.GithubSettings.forget_every_kept_name_and.ddf1b164':
    'Забудьте каждое сохраненное имя и фотографию; их снова просят, когда показываются люди',
  'settings.GithubSettings.nothing_is_kept_yet.7287d9c8': 'Ничего еще не сохранилось',
  'settings.GithubSettings.code_search.ca5e7167': 'Поиск кода',
  'settings.GithubSettings.search_the_code_of_the.1ce06300':
    'Найдите код версии, отображаемой на вкладке, и перейдите к определению изнутри вкладки. Репозиторий этой версии загружается один раз за сеанс и ищется здесь.',
  'settings.GithubSettings.largest_repository_to_download_mb.c4edc368':
    'Самый большой репозиторий для загрузки (МБ)',
  'settings.GithubSettings.its_files_at_that_version.5d039cfc':
    'Общий размер файлов этой версии. Для больших репозиториев GitHub используется серверный поиск по основной ветке с токеном. Forgejo и Gitea сообщают о превышении лимита архива.',
  'settings.GithubSettings.delete_github_connection.e4dfa050': 'Удалить подключение Git',
  'settings.GithubSettings.delete_connection.e960651b': 'Удалить соединение',
  'settings.GithubSettings.delete_value_its_local_token.b78722f1':
    'Удалить {value0}? Его локальный токен будет забыт; остальные связи сохраняются.',
  'settings.GithubSettings.remove_the_notifications_token_from.5b3f8312':
    'Удалить токен уведомлений из связки ключей? Панель уведомлений возвращается к основному токену.',
  'settings.GithubSettings.token_available_on_this_device.8141399a':
    'Токен доступен на этом устройстве',
  'settings.GithubSettings.synced_keys_locked.1673153c': 'Синхронизированные ключи заблокированы',
  'settings.GithubSettings.no_token_on_this_device.a87b4f4f': 'На этом устройстве нет токена',
  'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4':
    'Эта связь изменилась в другом месте. Закройте этот черновик и измените его текущие настройки.',
  'settings.GithubSettings.could_not_save_the_token.8edbb7d6':
    'Не удалось сохранить токен в связке ключей. Ничего не изменилось; Попробуйте еще раз.',
  'settings.GithubSettings.readable_line_width_like_notes.526184e3':
    'Читаемая ширина линии, как у заметок',
  'settings.GithubSettings.full_width.d34008d2': 'Полная ширина',
  'settings.GithubSettings.preview.324b134f': 'Предпросмотр',
  'settings.GithubSettings.code.340f4630': 'Код',
  'settings.GithubSettings.name.dcd1d522': 'Имя',
  'settings.GithubSettings.login.9d6322c1': 'Авторизоваться',
  'settings.GithubSettings.value_value_kept_on_this.ceefdd92': {
    one: 'На этом устройстве сохранён {count} пользователь. Очистите список, чтобы заново загрузить имена и фотографии — например, если кто-то их изменил.',
    few: 'На этом устройстве сохранены {count} пользователя. Очистите список, чтобы заново загрузить имена и фотографии — например, если кто-то их изменил.',
    many: 'На этом устройстве сохранено {count} пользователей. Очистите список, чтобы заново загрузить имена и фотографии — например, если кто-то их изменил.',
    other:
      'На этом устройстве сохранено {count} пользователя. Очистите список, чтобы заново загрузить имена и фотографии — например, если кто-то их изменил.',
  },
  'settings.GithubSettings.none_kept_on_this_device.bfb58c42':
    'На этом устройстве пока ничего не сохранилось.',
  'settings.ImageModelEditModal.add_image_model.6b3a2d66': 'Добавить модель изображения',
  'settings.ImageModelEditModal.edit_image_model.ca72d086': 'Редактировать модель изображения',
  'settings.ImageModelEditModal.model_id.089ef2b6': 'Идентификатор модели',
  'settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d':
    'Идентификатор модели API (например, gpt-image-1, flux-pro).',
  'settings.ImageModelEditModal.e_g_gpt_image.c781dc87': 'например {literal0}',
  'settings.ImageModelEditModal.display_name.2b7f6a84': 'Отображаемое имя',
  'settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Дополнительная метка, отображаемая в списке моделей.',
  'settings.ImageModelEditModal.e_g_gpt_image.5ae53afd': 'например {literal0}',
  'settings.ImageModelEditModal.size.1af85190': 'Размер',
  'settings.ImageModelEditModal.image_dimensions.1a4bb2f3': 'Размеры изображения.',
  'settings.ImageModelEditModal.quality.1b2c08a8': 'Качество',
  'settings.ImageModelEditModal.output_format.93c53d37': 'Выходной формат',
  'settings.ImageModelEditModal.delete_image_model.f28aaecc': 'Удалить модель изображения',
  'settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0':
    'Удалить {value0}? Агенты, использующие его, не будут иметь модели, пока она не будет\n        выбрал снова.',
  'settings.ImageModelEditModal.save.1509f561': 'Сохранить',
  'settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Сохраните эти настройки и закройте',
  'settings.ImageModelEditModal.delete.e2d0a549': 'Удалить',
  'settings.ImageModelEditModal.remove_this_image_model_from.c139edec':
    'Удалить эту модель изображения у провайдера',
  'settings.ImageModelEditModal.landscape.caa8642b': '1536×1024 (альбомная ориентация)',
  'settings.ImageModelEditModal.portrait.29d9d2d0': '1024×1536 (портрет)',
  'settings.ImageModelEditModal.auto.02862497': 'Авто',
  'settings.ImageModelEditModal.low.f793de20': 'Низкий',
  'settings.ImageModelEditModal.medium.8e588cd1': 'Середина',
  'settings.ImageModelEditModal.high.c4ebc6d4': 'Высокий',
  'settings.JournalsSettings.value_journal.cc8a4dd5': '{value0} журнал',
  'settings.JournalsSettings.journal_value.06b87038': 'Журнал № {value0}',
  'settings.JournalsSettings.remove_this_journal.c3a84c0a': 'Удалить этот журнал',
  'settings.JournalsSettings.default_journal.b54bf1fd': 'Журнал по умолчанию',
  'settings.JournalsSettings.journal_name.4a021433': 'Название журнала',
  'settings.JournalsSettings.journal_type_property_value_or.04441eaf':
    'Значение свойства типа журнала или имя файла RegExp',
  'settings.JournalsSettings.type_or_regexp.241a5ad0': 'Тип или регулярное выражение',
  'settings.JournalsSettings.date_property_name.8e90965d': 'Имя свойства даты',
  'settings.JournalsSettings.optional.59be7133': 'Необязательный',
  'settings.JournalsSettings.new_journal_note_path_template.862462e1':
    'Новый шаблон пути к заметке журнала',
  'settings.JournalsSettings.path_template.ec234daf': 'Шаблон пути',
  'settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9':
    'День периода повторения, когда создается заметка',
  'settings.JournalsSettings.optional_default_to_first.e58c831d':
    'Необязательный. По умолчанию «первый».',
  'settings.JournalsSettings.template_note_path.de4db36f': 'Путь к заметке шаблона',
  'settings.JournalsSettings.journal_reccurence.8957b0f1': 'Повторение журнала',
  'settings.JournalsSettings.add_journal.f49ae75e': 'Добавить журнал',
  'settings.JournalsSettings.add_another_journal.0d345224': 'Добавить еще один журнал',
  'settings.JournalsSettings.daily.b36c2611': 'Ежедневно',
  'settings.JournalsSettings.weekly.29751324': 'Еженедельно',
  'settings.JournalsSettings.monthly.9b11f6b7': 'Ежемесячно',
  'settings.JournalsSettings.yearly.6e69b59e': 'Ежегодно',
  'settings.KeyDestinationsModal.review_key_destinations.2058c462':
    'Проверить адреса использования ключей',
  'settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597':
    'Выберите ключ и получателя. Подтверждение и разрешение HTTP являются локальными для этого устройства.',
  'settings.KeyDestinationsModal.saved_key.85ec79d9': 'Сохраненный ключ',
  'settings.KeyDestinationsModal.recipient_address.454d0391': 'Адрес получателя',
  'settings.KeyDestinationsModal.recipient_url.59ef2635': 'URL-адрес получателя',
  'settings.KeyDestinationsModal.new_key_name.0e18145f': 'Новое имя ключа',
  'settings.KeyDestinationsModal.new_key_value.7a7e9552': 'Новое ключевое значение',
  'settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477':
    'Защищенное хранилище; сохраняется только после вашего подтверждения.',
  'settings.KeyDestinationsModal.key_permissions.1f24b6b7': 'Ключевые разрешения',
  'settings.KeyDestinationsModal.let_value_be_sent_to.3057160b':
    'Пусть {value0} будет отправлено на {value1} с этого устройства.',
  'settings.KeyDestinationsModal.remove_key_permission.60713985': 'Удалить ключевое разрешение',
  'settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd':
    'Прекратить отправку {value0} в {value1}; ключ остается сохраненным',
  'settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5':
    'Направления обслуживания для подтверждения',
  'settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2':
    'Пусть {value0} получит свой ключ по адресу {value1} с этого устройства.',
  'settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3':
    'HTTP-транспорт на этом устройстве',
  'settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f':
    'Только незашифрованный транспорт; каждому ключу по-прежнему требуется собственное разрешение получателя.',
  'settings.KeyDestinationsModal.remove_http_exception.ae72ff92': 'Удалить исключение HTTP',
  'settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28':
    'Прекратить передачу незашифрованных ключей на {value0}',
  'settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc': 'Разрешить ключ и адрес',
  'settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82':
    'Сохраните это разрешение ключа на этом устройстве; сейчас ничего не отправляется',
  'settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d':
    ' — Незашифрованный: любой на сетевом пути может прочитать ключ.',
  'settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1':
    ' — Публичный HTTP не может получать ключи. Измените этот адрес на HTTPS.',
  'settings.KeyDestinationsModal.choose_a_key.68bb8fb8': 'Выберите ключ',
  'settings.KeyDestinationsModal.save_a_new_named_key.7982a2de':
    'Сохранить новый именованный ключ…',
  'settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb':
    ' Сохраните этот новый ключ в защищенном хранилище.',
  'settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0':
    'Выберите сохраненный ключ и введите адрес получателя.',
  'settings.KeyDestinationsModal.allowed_on_this_device.bac894b7': 'Разрешено на этом устройстве',
  'settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda':
    'Требуется подтверждение на этом устройстве',
  'settings.KeyDestinationsModal.allow_unencrypted_http.e905502b': 'Разрешить незашифрованный HTTP',
  'settings.KeyDestinationsModal.allow_on_this_device.a92ce243': 'Разрешить на этом устройстве',
  'settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8':
    'Ключ хранилища не может быть отправлен получателю.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46':
    'Разрешено {value0} → {value1}. Повторите исходный скрипт; ничего не было отправлено автоматически.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642':
    'Разрешено {value0} → {value1}. Повторите исходный скрипт.',
  'settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad':
    'Удален {value0} → {value1}. Сохраненный ключ и другие разрешения остаются.',
  'settings.KeyDestinationsModal.confirmed_value_value.b96426a6':
    'Подтверждено {value0} → {value1}.',
  'settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86':
    'Исключение HTTP удалено. Ключи не могут использовать этот незашифрованный адрес.',
  'settings.LinksSettings.links_that_run_things.6849bb37': 'Ссылки, которые управляют вещами',
  'settings.LinksSettings.each_one_is_an_obsidian.bcfd9260':
    'Каждый из них представляет собой адрес obsidian://, который запускает скрипт или команду при открытии — из закладки, другого приложения или ярлыка.',
  'settings.LinksSettings.untitled_link.be1c93df': 'Ссылка без названия',
  'settings.LinksSettings.copy_the_link_s_address.331a3bd9': 'Скопируйте адрес ссылки',
  'settings.LinksSettings.change_this_link.f6aa89bf': 'Изменить эту ссылку',
  'settings.LinksSettings.add_another_link.a8b73866': 'Добавить еще ссылку',
  'settings.LinksSettings.no_links_yet.30d3e862': 'Ссылок пока нет',
  'settings.LinksSettings.a_name_for_the_address.f36bdc5a':
    'Имя адреса и скрипт или команда, которую он запускает.',
  'settings.LinksSettings.add_link.dfe9ca4d': 'Добавить ссылку',
  'settings.LinksSettings.add_a_link_and_set.5eb68448': 'Добавьте ссылку и настройте ее',
  'settings.LinksSettings.new_link.98ee0dfb': 'Новая ссылка',
  'settings.LinksSettings.name.dcd1d522': 'Имя',
  'settings.LinksSettings.the_part_of_the_address.2929fc21':
    'Часть адреса после name=, написанная простыми буквами и тире.',
  'settings.LinksSettings.add_movie.2f79eca6': 'добавить фильм',
  'settings.LinksSettings.runs.848f54e8': 'Бежит',
  'settings.LinksSettings.script.102acc10': 'Скрипт',
  'settings.LinksSettings.choose_a_script.d8ff6dd0': 'Выберите скрипт…',
  'settings.LinksSettings.search_the_scripts_for_the.e5119ad8':
    'Найдите скрипты, которые запускает эта ссылка.',
  'settings.LinksSettings.command.71316697': 'Команда',
  'settings.LinksSettings.search_the_commands_for_the.ebe2fa5b':
    'Найдите команды, которые запускает эта ссылка.',
  'settings.LinksSettings.wait_for_sync.8d3efbd1': 'Подождите синхронизации',
  'settings.LinksSettings.run_only_once_obsidian_sync.91ba259b':
    'Запускайте только после того, как Obsidian Sync обновит хранилище.',
  'settings.LinksSettings.address.56ef8f20': 'Адрес',
  'settings.LinksSettings.add_param_value_to_hand.2c89675e':
    'Добавьте &param=value, чтобы передать скрипту его значения.',
  'settings.LinksSettings.delete.e2d0a549': 'Удалить',
  'settings.LinksSettings.remove_this_link.d7173cb1': 'Удалить эту ссылку',
  'settings.LinksSettings.done.11a6767d': 'Готово',
  'settings.LinksSettings.close_this_window_changes_are.91342d87':
    'Закройте это окно; изменения сохраняются по мере их внесения',
  'settings.LinksSettings.choose_a_command.58e501e1': 'Выберите команду…',
  'settings.LinksSettings.runs_the_script_value.c5e5c031': 'Запускает скрипт {value0}',
  'settings.LinksSettings.runs_a_script_none_chosen.1b6f1723':
    'Запускает скрипт — пока ничего не выбрано',
  'settings.LinksSettings.runs_the_command_value.c397fa11': 'Запускает команду {value0}',
  'settings.LinksSettings.runs_a_command_none_chosen.67edb64d':
    'Запускает команду — пока ничего не выбрано',
  'settings.LinksSettings.link_copied.d12860c2': 'Ссылка скопирована',
  'settings.LintRuleModal.on.13001175': 'Вкл.',
  'settings.LintRuleModal.switched_off_the_rule_checks.db75c03b':
    'В выключенном состоянии правило ничего не проверяет.',
  'settings.LintRuleModal.how_bad.016a19df': 'Уровень проблемы',
  'settings.LintRuleModal.an_error_or_a_warning.ea93bb11':
    'Ошибка или предупреждение, как показано в списке.',
  'settings.LintRuleModal.where_it_applies.39e44cbf': 'Где это применимо',
  'settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53':
    'Осталось пусто, везде. Списки разделяются запятыми.',
  'settings.LintRuleModal.only_in.aed9f516': 'Только в',
  'settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac':
    'Папки или маски путей, например Projects/*/Tasks.',
  'settings.LintRuleModal.everywhere.dcc10bfd': 'Повсюду',
  'settings.LintRuleModal.not_in.1bc8651b': 'Не в',
  'settings.LintRuleModal.folders_or_globs_left_alone.a5983464':
    'Исключённые папки или маски путей.',
  'settings.LintRuleModal.nowhere.7e32434d': 'Нигде',
  'settings.LintRuleModal.note_types.52d728fb': 'Типы заметок',
  'settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66':
    'Только заметки, тип которых является одним из этих.',
  'settings.LintRuleModal.any_type.b05fc1fe': 'Любой тип',
  'settings.LintRuleModal.having_a_property.07dd0569': 'Наличие недвижимости',
  'settings.LintRuleModal.only_notes_with_this_property.adbc72b9':
    'Только заметки с этим свойством — равным значению, если оно задано.',
  'settings.LintRuleModal.property.40040cb1': 'Свойство',
  'settings.LintRuleModal.any_value.004f62d2': 'Любое значение',
  'settings.LintRuleModal.settings_of_the_rule.99e57b0c': 'Настройки правила',
  'settings.LintRuleModal.as_it_ships.be4ca4de': 'По умолчанию',
  'settings.LintRuleModal.put_this_rule_back_the.6e2ebc57':
    'Верните это правило в том виде, в каком его предоставляет плагин.',
  'settings.LintRuleModal.done.11a6767d': 'Готово',
  'settings.LintRuleModal.close_this_the_changes_are.459403b0': 'Закройте это; изменения сохранены',
  'settings.LintRuleModal.error.54a0e8c1': 'Ошибка',
  'settings.LintRuleModal.warning.e981ddae': 'Предупреждение',
  'settings.LinterSettings.the_linter_checks_notes_against.67baa82b':
    'Линтер проверяет заметки на соответствие приведенным ниже правилам — по одной заметке, папке или всему хранилищу — и перечисляет то, что им не соответствует, на собственной вкладке. Многое там можно исправить за один раз; остальное открывается на линии, чтобы исправить вручную.',
  'settings.LinterSettings.linter.99bede8d': 'Проверка заметок',
  'settings.LinterSettings.the_tab_with_what_the.e019607d':
    'Вкладка с тем, что нашел последний запуск.',
  'settings.LinterSettings.open_linter.72c54acd': 'Открыть линтер',
  'settings.LinterSettings.close_the_settings_and_open.125786ff':
    'Закройте настройки и откройте вкладку линтера',
  'settings.LinterSettings.folders_to_skip.ad324780': 'Папки, которые нужно пропустить',
  'settings.LinterSettings.no_rule_looks_in_these.2a478951':
    'В них не заглядывает ни одно правило, если только заметка в одном из них не указано по имени. через запятую; папка или глобальный объект, например Archive/**.',
  'settings.LinterSettings.templates_attachments.2440bdba': 'Шаблоны, Вложения',
  'settings.LinterSettings.rules.4228aeb0': 'Правила',
  'settings.LinterSettings.each_can_be_switched_off.240786af':
    'Каждую из них можно отключить, сообщить, насколько плохи результаты, сохранить в определенных папках или типах заметок и задать собственные настройки.',
  'settings.LinterSettings.set_up_value.45578254': 'Настройте {value0}',
  'settings.LinterSettings.rules_of_your_own.f29b0461': 'Ваши собственные правила',

  'settings.LinterSettings.no_script_rules_yet.37cf496e': 'Правила скрипта пока отсутствуют.',
  'settings.LinterSettings.not_in_value.d95a4831': 'нет в {value0}',
  'settings.LinterSettings.for_value_notes.670a9ee4': 'для заметок {value0}',
  'settings.LinterSettings.is_set.c7d5e11f': ' установлен',
  'settings.LinterSettings.error.54a0e8c1': 'Ошибка',
  'settings.LinterSettings.warning.e981ddae': 'Предупреждение',
  'settings.LogsSettings.logs_note_types.0793e6f2': 'Типы заметок журналов',
  'settings.LogsSettings.optional_comma_separated_list_of.8730c2d2':
    'Необязательный список типов заметок, разделенных запятыми, которые следует рассматривать как заметки журнала.',
  'settings.LogsSettings.e_g_journal_log_daily.a54faefe': 'например {literal0}',
  'settings.ModelEditModal.add_model.7060e824': 'Добавить модель',
  'settings.ModelEditModal.edit_model.e76cc0ba': 'Редактировать модель',
  'settings.ModelEditModal.model_id.089ef2b6': 'Идентификатор модели',
  'settings.ModelEditModal.api_model_identifier_e_g.5c0e2892':
    'Идентификатор модели API (например, gpt-4o, claude-sonnet-4-20250514).',
  'settings.ModelEditModal.e_g_gpt_o.c6a41eb7': 'например {literal0}',
  'settings.ModelEditModal.display_name.2b7f6a84': 'Отображаемое имя',
  'settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Дополнительная метка, отображаемая в списке моделей.',
  'settings.ModelEditModal.e_g_gpt_o.c9f23b2e': 'например {literal0}',
  'settings.ModelEditModal.context_window.7696d085': 'Контекстное окно',
  'settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14':
    'Максимальное количество входных токенов, которые поддерживает модель.',
  'settings.ModelEditModal.max_output_tokens.397dda07': 'Максимальное количество выходных токенов',
  'settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9':
    'Максимальное количество токенов в одном ответе.',
  'settings.ModelEditModal.request_timeout_seconds.1b1b1d08': 'Тайм-аут запроса (секунды)',
  'settings.ModelEditModal.wait_for_the_first_response.08adebcb':
    'Ждите первого ответа или следующего фрагмента, а не всего ответа. 1–3600 секунд; пустой использует глобальный тайм-аут. Применяется к чату и фоновой работе с этой моделью.',
  'settings.ModelEditModal.global_timeout.542c2bf3': 'Глобальный тайм-аут',
  'settings.ModelEditModal.reasoning.d8211e24': 'Рассуждение',
  'settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996':
    'Включите рассуждение/мышление для поддерживаемых моделей.',
  'settings.ModelEditModal.thinking_effort.264c28cb': 'Мыслительное усилие',
  'settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5':
    'Управляет объемом рассуждений модели. Оставьте значение по умолчанию для собственного поведения модели.',
  'settings.ModelEditModal.delete_model.b7828ba0': 'Удалить модель',
  'settings.ModelEditModal.delete_value_agents_using_it.c65217d0':
    'Удалить {value0}? Агенты, использующие его, не будут иметь модели, пока она не будет\n        выбрал снова.',
  'settings.ModelEditModal.save.1509f561': 'Сохранить',
  'settings.ModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Сохраните эти настройки и закройте',
  'settings.ModelEditModal.delete.e2d0a549': 'Удалить',
  'settings.ModelEditModal.remove_this_model_from_the.2838dd4b': 'Удалить эту модель у провайдера',
  'settings.ModelEditModal.enter_seconds_correct_this_value.508147a7':
    'Введите от 1 до 3600 секунд. Исправьте это значение перед сохранением.',
  'settings.OtherSettings.look.a0de5719': 'Смотреть',
  'settings.OtherSettings.full_width_sidebars.bc7a2b4e': 'Боковые панели во всю ширину',
  'settings.OtherSettings.make_sidebars_take_the_full.15d01abc':
    'Сделайте так, чтобы боковые панели занимали всю ширину экрана на телефоне.',
  'settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63':
    'Боковые панели половинной ширины на планшете',
  'settings.OtherSettings.make_sidebars_take_half_the.f915aa8e':
    'Сделайте так, чтобы боковые панели занимали половину ширины экрана на планшете.',
  'settings.OtherSettings.css_snippets_folder.0f718ada': 'Папка с фрагментами CSS',
  'settings.OtherSettings.vault_folder_with_css_files.063bfc1c':
    'Папка Vault с файлами .css для автоматического применения в качестве фрагментов стиля. Оставьте пустым, чтобы отключить.',
  'settings.OtherSettings.e_g_snippets.d1877812': 'например {literal0}',
  'settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19': 'Нарисовано Абеле в заметке',
  'settings.OtherSettings.each_one_in_place_of.7bc5aa3f':
    'Каждый вместо собственного рисунка Обсидиана.',
  'settings.OtherSettings.own_drawing_of_properties.909062a8': 'Собственное отображение свойств',
  'settings.OtherSettings.in_a_note_s_properties.769ed541':
    'В свойствах заметки: баланс кошелька рядом со ссылкой на него, суммы, рассчитанные в числовых полях, карточки для свойств Файла и Файлов и для обложки. Off — это собственный рисунок Obsidian.',
  'settings.OtherSettings.counter_properties.8ebc8e5b': 'Свойства счетчика',
  'settings.OtherSettings.comma_separated_property_names_drawn.054f1654':
    'Имена свойств, разделенные запятыми, отображаются в виде числа с помощью кнопок – и +. Пустое значение считается 0. Требуется собственное отображение свойств.',
  'settings.OtherSettings.e_g_reps_glasses.bcb26756': 'например {literal0}',
  'settings.OtherSettings.mermaid_viewer.0fee57c7': 'Зритель русалок',
  'settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa':
    'Рисуйте диаграммы русалок по ширине заметки, с масштабированием, перетаскиванием и полноэкранным просмотром вместо собственного рисунка Obsidian.',
  'settings.OtherSettings.open_canvases_in_abele.0104f91b': 'Открытые холсты в Абеле',
  'settings.OtherSettings.open_diagrams_in_the_read.b48fc66f':
    'Открывайте диаграммы в средстве просмотра только для чтения с пошаговыми инструкциями. Используйте «Открыть в Obsidian Canvas» в заголовке, чтобы редактировать диаграмму на собственном холсте.',
  'settings.OtherSettings.editor_syntax_highlighting.9bbd35c2': 'Подсветка синтаксиса редактора',
  'settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd':
    'Выделите больше языков с изолированным кодом в Source и Live Preview, используя собственную тему Obsidian. Собственная подсветка и отображаемые блоки остаются неизменными. Дополнительная подсветка ограничена блоками по 32 768 символов и 1000 строк.',
  'settings.OtherSettings.opening_notes.d2eceee4': 'Вступительные замечания',
  'settings.OtherSettings.remember_where_notes_were_left.1010d0b2':
    'Помните, где были оставлены заметки',
  'settings.OtherSettings.open_each_note_at_the.c4f04706':
    'Откройте каждую заметку по прокрутке и курсору, на котором она была оставлена, на этом устройстве. Ссылка на заголовок или блок, результат поиска или выделение книги по-прежнему занимает свое место.',
  'settings.OtherSettings.maps.119e66d1': 'Карты',
  'settings.OtherSettings.coordinates_property.afe852a5': 'Координаты объекта',
  'settings.OtherSettings.note_property_holding_a_place.d3b2dd8b':
    'Обратите внимание, что свойство имеет место как «широта, долгота». Агенту приказано написать в этом.',
  'settings.OtherSettings.coordinates.29abdbc9': 'координаты',
  'settings.OtherSettings.map_style.62a4d250': 'Стиль карты',
  'settings.OtherSettings.how_maps_in_notes_and.dc2e0608':
    'Как выглядят карты в заметках и чатах. Бесплатные стили не требуют ключа или учетной записи.',
  'settings.OtherSettings.style_url.221b2c65': 'URL-адрес стиля',
  'settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee':
    'MapLibre style.json вашего собственного провайдера.',
  'settings.OtherSettings.the_plugin.cb8c07f4': 'Плагин',
  'settings.OtherSettings.changelog.ead07c84': 'Журнал изменений',
  'settings.OtherSettings.see_what_changed_in_every.b28c48a6':
    'Посмотрите, что изменилось в каждой версии плагина, начиная с самой новой.',
  'settings.OtherSettings.open_changelog.f8738613': 'Открыть историю изменений',
  'settings.OtherSettings.open_the_plugin_changelog.f99c92b8': 'Откройте журнал изменений плагина',
  'settings.OtherSettings.keyboard_diagnostics.b559c4cd': 'Диагностика клавиатуры',
  'settings.OtherSettings.show_at_the_top_of.2cad0798':
    'Покажите вверху экрана, что приложение сообщает об экранной клавиатуре — для снимка экрана, когда под ней оказывается диалоговое окно. Остается на этом устройстве.',
  'settings.OtherSettings.date_properties.9201e6b8': 'Свойства даты',
  'settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640':
    'Имена свойств, разделенные запятыми, отображаются в виде даты с кнопками, указывающими день назад и вперед, расстояние до него и кнопкой для его ежедневной заметки. Требуется собственное отображение свойств.',
  'settings.OtherSettings.priority_properties.21f4bae9': 'Приоритетные объекты',
  'settings.OtherSettings.comma_separated_property_names_drawn.b31eb248':
    'Имена свойств, разделенные запятыми, отображаются в виде приоритета задачи: низкого, среднего или высокого, с кнопками для его повышения и понижения. Требуется собственное отображение свойств.',
  'settings.OtherSettings.label_properties.7ad8c49d': 'Свойства метки',
  'settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7':
    'Имена свойств, разделенные запятыми, нарисованные в виде меток, добавленные из уже использованных в хранилище или введенных. Требуется собственное отображение свойств.',
  'settings.OtherSettings.group_properties.23d1a496': 'Свойства группы',
  'settings.OtherSettings.comma_separated_property_names_that.cb39dad8':
    'Имена свойств, разделенные запятыми, рядом со списком которых появляется кнопка, добавляющая одну из заметок, уже используемых в качестве групп. Список по-прежнему набирается как обычно. Требуется собственное отображение свойств.',
  'settings.QuickButtonSettings.a_round_button_at_the.aa095d26':
    'Круглая кнопка на краю экрана телефона. Он открывает меню быстрых действий для всего, что находится впереди: ваши собственные действия внизу, кнопки заголовка заметки и то, что там предлагает плагин — поиск и выделение книг, таймер заметки и чат. Он не мешает, пока вы читаете или печатаете. Перетащите его, чтобы переместить; он сохраняет сторону и высоту, на которых он остался.',
  'settings.QuickButtonSettings.show_the_quick_button.65b455f7': 'Показать быструю кнопку',
  'settings.QuickButtonSettings.on_a_phone_it_is.0737337d':
    'По телефону. Это концепция, поэтому она начинается с выключенного состояния.',
  'settings.QuickButtonSettings.also_on_a_tablet.5f696152': 'Также на планшете',
  'settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d':
    'Показывайте его как на планшете, так и на телефоне.',
  'settings.QuickButtonSettings.side.630ef00b': 'Сторона',
  'settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46':
    'Край экрана, на котором он стоит. Перетаскивание меняет его.',
  'settings.QuickButtonSettings.height.bfe2eca4': 'Высота',
  'settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1':
    'Перетаскивается выше того места, где он находится, над нижней полосой каждого экрана.',
  'settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94':
    'Где оно находится: чуть выше нижней панели каждого экрана.',
  'settings.QuickButtonSettings.put_it_back.55057d7e': 'Положи это обратно',
  'settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b':
    'Переместите его обратно туда, где он находится.',
  'settings.QuickButtonSettings.it_is_already_where_it.36b74557':
    'Оно уже там, где оно покоится; перетащите его, чтобы поднять',
  'settings.QuickButtonSettings.your_actions.6c06c355': 'Ваши действия',
  'settings.QuickButtonSettings.at_the_top_of_the.b6848b73':
    'Вверху меню, в таком порядке. Команда появляется только там, где она может быть запущена, поэтому команда, предназначенная для заметок, не предлагается поверх книги.',
  'settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002': 'Ничего своего пока нет.',
  'settings.QuickButtonSettings.name_in_the_menu.feca41eb': 'Имя в меню',
  'settings.QuickButtonSettings.choose_the_icon_it_has.e8357476':
    'Выберите значок, который есть в меню.',
  'settings.QuickButtonSettings.already_the_first.eab62d41': 'Уже первый',
  'settings.QuickButtonSettings.move_it_up_the_menu.20938d10': 'Переместите это вверх по меню',
  'settings.QuickButtonSettings.already_the_last.a6ec4b12': 'Уже последний',
  'settings.QuickButtonSettings.move_it_down_the_menu.dc508335': 'Переместите его вниз по меню',
  'settings.QuickButtonSettings.take_it_out_of_the.4a64934c': 'Убери это из меню',
  'settings.QuickButtonSettings.add_a_command.b907f252': 'Добавить команду',
  'settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7':
    'Найдите команды Obsidian — любого плагина — и поместите их в меню.',
  'settings.QuickButtonSettings.add_a_script.c4526bc4': 'Добавить скрипт',
  'settings.QuickButtonSettings.search_your_scripts_for_one.df40b370':
    'Найдите в своих скриптах тот, который можно добавить в меню.',
  'settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a': 'Убрать из меню',
  'settings.QuickButtonSettings.take_value_out_of_the.f628c5a3':
    'Удалить {value0} из быстрого меню? Сама команда или скрипт остается.',
  'settings.QuickButtonSettings.right.883361d5': 'Справа',
  'settings.QuickButtonSettings.left.58eb9032': 'Левый',
  'settings.QuickButtonSettings.unnamed.e504e615': 'Безымянный',
  'settings.QuickButtonSettings.command_value.b7bcffe4': 'Команда: {value0}',
  'settings.QuickButtonSettings.script_value.804f5354': 'Скрипт: {value0}',
  'settings.ReaderSettings.epub_books_in_the_vault.7574b8de':
    'Книги EPUB в хранилище открываются на отдельной вкладке чтения, и PDF-файлы тоже могут. Эти варианты применяются к каждой книге, а также их можно изменить на вкладке книги с помощью кнопки Aa.',
  'settings.SavedKeyRequestModal.send_saved_keys.618ddec9': 'Отправить сохраненные ключи?',
  'settings.SavedKeyRequestModal.key.99a52df3': 'Ключ',
  'settings.SavedKeyRequestModal.keys.f0d66a79': 'Ключи',
  'settings.SavedKeyRequestModal.sent_to.4e7201c7': 'Отправлено в',

  'settings.SavedKeyRequestModal.cancel.19766ed6': 'Отмена',
  'settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8':
    'Ничего не отправляйте и оставьте разрешения как есть.',
  'settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17': 'Разрешить адрес и отправить',
  'settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3':
    'Запомните {value0} для этих ключей на этом устройстве, а затем отправьте запрос.',
  'settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82':
    'Не удалось сохранить это разрешение ключа, поэтому ничего не было отправлено. Проверьте основные пункты назначения и повторите попытку.',
  'settings.ScriptsSettings.library.dc20b3d5': 'Библиотека',
  'settings.ScriptsSettings.every_script_in_the_folder.8e2a3585':
    'Каждый скрипт в папке и что он делает',
  'settings.ScriptsSettings.selection_menus.22601a32': 'Меню выбора',
  'settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4':
    'Выбирайте скрипты для книг и чатов самостоятельно',
  'settings.ScriptsSettings.header_buttons.1d80ae78': 'Кнопки заголовка',
  'settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e':
    'Кнопки в заголовках заметок, запускающие скрипт',
  'settings.ScriptsSettings.automations.ad1fb9ec': 'Автоматизация',
  'settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66':
    'Скрипты, которые запускаются сами по себе при изменении задачи или заметки.',
  'settings.ScriptsSettings.startup.65d48235': 'Запускать',
  'settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc':
    'Скрипты, которые запускаются при каждом запуске Obsidian',
  'settings.ScriptsSettings.general.c910d474': 'Общий',
  'settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d':
    'Включите скрипты и выберите их папку.',
  'settings.ScriptsSettings.books.9da7f76b': 'Книги',
  'settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97':
    'Скрипты на слова, выбранные в книге',
  'settings.ScriptsSettings.chats.ef5b4049': 'Чаты',
  'settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b':
    'Скрипты, выбранные для слов, выбранных в чате',
  'settings.SecretField.hide_the_key.46a22923': 'Скрыть ключ',
  'settings.SecretField.show_the_key.90d90eb7': 'Покажи ключ',
  'settings.SecretField.copy_the_key.30d7860a': 'Скопируйте ключ',
  'settings.SecretField.new_key.31ffdeb5': 'Новый ключ...',
  'settings.SecretField.save_key.b6e0aef2': 'Сохранить ключ',
  'settings.SecretField.the_key.144976d8': 'Ключ',
  'settings.SecretStoreSettings.synced_keys.a764d83d': 'Синхронизированные ключи',
  'settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab':
    'Каждый ключ API и токен хранятся в одном зашифрованном хранилище, которое синхронизируется с настройками плагина. Каждому устройству требуется только парольная фраза, введенная один раз. Без него хранилище нечитабелен, на любом устройстве и в любой копии файла настроек.',
  'settings.SecretStoreSettings.status.920e413c': 'Статус',
  'settings.SecretStoreSettings.all_keys.9e5c5da4': 'Все ключи',
  'settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da':
    'Каждый ключ, который плагин использует на этом устройстве: для чего он нужен, синхронизируется ли он и способ его отображения или копирования.',
  'settings.SecretStoreSettings.show.0df6f1ca': 'Показать',
  'settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1':
    'Перечислите все клавиши на этом устройстве',
  'settings.SecretStoreSettings.passphrase.e7611f05': 'Парольная фраза',
  'settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e':
    'Минимум 12 символов. Вводится на каждом устройстве, на котором должны быть ключи; ничто не сможет его восстановить.',
  'settings.SecretStoreSettings.repeat_the_passphrase.4b93336c': 'Повторите парольную фразу',
  'settings.SecretStoreSettings.passphrase_again.47b97578': 'Введите пароль еще раз',
  'settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573':
    'Ключи переносятся в хранилище: {value0}',
  'settings.SecretStoreSettings.cancel.19766ed6': 'Отмена',
  'settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492': 'Закрыть без изменений',
  'settings.SecretStoreSettings.turn_on.5a1f096a': 'Включить',
  'settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24':
    'Зашифруйте ключи этого устройства в хранилище и синхронизируйте их.',
  'settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910':
    'Перемещает ключи, имеющиеся на этом устройстве, в хранилище под выбранной вами парольной фразой.',
  'settings.SecretStoreSettings.set_up.4da10f1f': 'Настроить',
  'settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b':
    'Выберите парольную фразу для синхронизированных ключей',
  'settings.SecretStoreSettings.unlock_on_this_device.ec7699b7':
    'Разблокировать на этом устройстве',
  'settings.SecretStoreSettings.unlock.4ac709aa': 'Разблокировать',
  'settings.SecretStoreSettings.open_the_store_here_and.879288fd':
    'Откройте хранилище здесь и поместите его ключи в брелок этого устройства.',
  'settings.SecretStoreSettings.new_passphrase.5cc14549': 'Новая парольная фраза',
  'settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e':
    'Каждое другое устройство запрашивает его один раз, в следующий раз настройки до него дойдут.',
  'settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be':
    'Повторите новую парольную фразу',
  'settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb': 'Еще раз новая парольная фраза',
  'settings.SecretStoreSettings.change_the_passphrase.a9a3e51b': 'Изменить парольную фразу',
  'settings.SecretStoreSettings.change.c0bf75bd': 'Изменять',
  'settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af':
    'Снова зашифруйте хранилище под новой парольной фразой.',
  'settings.SecretStoreSettings.change_passphrase.a0ffb851': 'Изменить парольную фразу',
  'settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29':
    'Ключи снова зашифрованы. Другие устройства продолжают работать со своими ключами и запрашивают новую парольную фразу.',
  'settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286': 'Выберите новую парольную фразу',
  'settings.SecretStoreSettings.remove_from_this_device.43b9a522': 'Удалить с этого устройства',
  'settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0':
    'Парольная фраза и все ключи в хранилище покидают это устройство. Хранилище и другие устройства сохраняют их; разблокируйте снова, чтобы вернуть их.',
  'settings.SecretStoreSettings.remove.c3812fc4': 'Удалить',
  'settings.SecretStoreSettings.take_the_synced_keys_off.537f867f':
    'Уберите синхронизированные ключи с этого устройства',
  'settings.SecretStoreSettings.turn_off.06f0e210': 'Отключить',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0':
    'Хранилище оставляет настройки. Каждое разблокированное устройство хранит свои ключи в собственной цепочке для ключей; любое другое устройство потребует их ввода вручную.',
  'settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d':
    'Прекратите синхронизировать ключи, сохранив их на каждом устройстве.',
  'settings.SecretStoreSettings.start_over.5eed7e9f': 'Начать сначала',
  'settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f':
    'Удаляет хранилище из настроек на каждом устройстве, для нового с новой парольной фразой. Ключи этого устройства останутся здесь.',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2':
    'Удалить синхронизированные ключи из настроек',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195':
    'Удалить синхронизированные ключи с этого устройства',
  'settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae':
    'Парольная фраза и {value0} в хранилище остаются в связке ключей этого устройства. Функции, использующие их, здесь перестают работать, пока они не будут снова разблокированы.',
  'settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c': 'Отключить синхронизацию ключей',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814':
    'Хранилище оставляет настройки на каждом устройстве. Разблокированные устройства сохраняют свои ключи; новое устройство их не получит.',
  'settings.SecretStoreSettings.the_store_is_removed_from.7d71216a':
    'Хранилище удален из настроек на каждом устройстве, со всеми ключами в нем, которые не держит ни одно устройство. Собственные ключи этого устройства остаются.',
  'settings.SecretStoreSettings.off.ca7981b4': 'Выкл.',
  'settings.SecretStoreSettings.each_device_keeps_its_own.02c01692':
    'Каждое устройство хранит свои собственные ключи, введенные на этом устройстве.',
  'settings.SecretStoreSettings.locked_on_this_device.e1223c06': 'Заблокировано на этом устройстве',
  'settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954':
    'Другое устройство хранит ключи в хранилище. Введите его парольную фразу, чтобы они тоже были здесь.',
  'settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4':
    'Разблокировано на этом устройстве',
  'settings.SecretStoreSettings.out_of_date.c8f1506a': 'Устарело',
  'settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603':
    'Парольная фраза была изменена на другом устройстве. Ключи, уже находящиеся здесь, продолжают работать; введите новую парольную фразу, чтобы снова получить изменения.',
  'settings.SecretStoreSettings.damaged.3604e21d': 'Поврежденный',
  'settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8':
    'Хранилище в файле настроек не расшифровывается, хотя парольная фраза у этого устройства правильная: файл был изменен не плагином. Ключи, уже имеющиеся на этом устройстве, продолжают работать.',
  'settings.SecretStoreSettings.value_in_the_store_a.02db016b':
    '{value0} в хранилище. Ключ, добавленный или измененный где-либо в плагине, попадает в него и достигает других ваших устройств с настройками.',
  'settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8':
    'Эта парольная фраза не открывает хранилище.',
  'settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983':
    'Новая фраза-пароль, установленная на другом устройстве.',
  'settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36':
    'Парольная фраза, выбранная при включении синхронизации ключей.',
  'settings.SecretStoreSettings.the_two_do_not_match.184006b7': 'Эти два понятия не совпадают.',
  'settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6': 'Минимум {value0} символов.',
  'settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86':
    'Синхронизация ключей включена: ключей в хранилище: {value0}.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c':
    'Синхронизированные ключи не удалось включить.',
  'settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b':
    'Разблокировано: ключей {value0} на этом устройстве.',
  'settings.SecretStoreSettings.the_store_could_not_be.be373a49':
    'Не удалось разблокировать хранилище',
  'settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec':
    'Парольная фраза изменена. Другие устройства будут запрашивать это.',
  'settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1':
    'Парольную фразу не удалось изменить',
  'settings.SecretStoreSettings.the_keys_could_not_be.a70d217b':
    'Не удалось удалить ключи с этого устройства.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f':
    'Синхронизированные ключи не удалось отключить.',
  'settings.SecretStoreSettings.the_store_could_not_be.76043571': 'Не удалось удалить хранилище',
  'settings.SecretsListModal.all_keys.9e5c5da4': 'Все ключи',
  'settings.SecretsListModal.passphrase.e7611f05': 'Парольная фраза',
  'settings.SecretsListModal.unlock.4ac709aa': 'Разблокировать',
  'settings.SecretsListModal.open_the_store_here_and.6be7e00a':
    'Откройте хранилище здесь и перечислите его ключи.',
  'settings.SecretsListModal.type_the_passphrase_first.397584ff': 'Сначала введите парольную фразу',
  'settings.SecretsListModal.the_synced_store_cannot_be.df30eba8':
    'Синхронизированное хранилище невозможно расшифровать, поэтому не могут быть перечислены только хранящиеся в нем ключи. Ниже приведены клавиши, которые есть на этом устройстве.',
  'settings.SecretsListModal.hide_the_key.46a22923': 'Скрыть ключ',
  'settings.SecretsListModal.show_the_key.90d90eb7': 'Покажи ключ',
  'settings.SecretsListModal.copy_the_key.30d7860a': 'Скопируйте ключ',
  'settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6':
    'Ключей пока нет. Здесь указан ключ, введенный в любом месте настроек плагина.',
  'settings.SecretsListModal.copy_all.96e3f09a': 'Скопировать все',
  'settings.SecretsListModal.put_every_key_on_the.a26cf3c7':
    'Поместите каждую клавишу в буфер обмена после предупреждения.',
  'settings.SecretsListModal.no_key_is_set.f4f5b239': 'Ключ не установлен',
  'settings.SecretsListModal.copy_every_key.2f918de3': 'Скопируйте каждый ключ',
  'settings.SecretsListModal.on_this_device.38b9d88c': 'На этом устройстве',
  'settings.SecretsListModal.synced.5da22fe4': 'Синхронизировано',
  'settings.SecretsListModal.differs_from_keychain.922767e7': 'Отличие от брелка',
  'settings.SecretsListModal.only_in_the_store.9bb2ce40': 'Только в хранилище',
  'settings.SecretsListModal.not_in_the_store.507fd6ce': 'Не в хранилище',
  'settings.SecretsListModal.store_locked.d47ee0fe': 'Хранилище заблокировано',
  'settings.SecretsListModal.not_set.4895f731': 'Не установлено',
  'settings.SecretsListModal.this_device_s_keychain_holds.1b27e956':
    'Связка ключей этого устройства содержит другое значение, измененное вне плагина. Значение хранилища — это используемое.',
  'settings.SecretsListModal.in_the_store_but_not.5e27c94a':
    'В хранилище но нет в брелке этого устройства. Плагин до сих пор использует его.',
  'settings.SecretsListModal.set_on_this_device_and.db43f1dd':
    'Устанавливал на это устройство а не в хранилище. Установите его еще раз, чтобы поместить его туда.',
  'settings.SecretsListModal.not_used_by_any_setting.85faf2ac':
    'Не используется ни одной настройкой на этом устройстве.',
  'settings.SecretsListModal.updated_value.51194723': 'Обновлено {value0}',
  'settings.SecretsListModal.every_key_that_is_set.19a2b157':
    'Каждый ключ установлен в виде строк имя = значение — для менеджера паролей или для вставки в другое приложение.',
  'settings.SecretsListModal.every_key_listed_here_value.a6aac65e':
    'Каждый ключ, указанный здесь — {value0} из них — попадает в буфер обмена в виде обычного текста, где его может прочитать любое приложение на этом устройстве. ',
  'settings.SecretsListModal.it_is_cleared_from_the.06480e6f':
    'Он удаляется из буфера обмена через минуту, если он еще там.',
  'settings.SecretsListModal.on_this_device_it_stays.57af8178':
    'На этом устройстве он остается там, пока не будет скопировано что-то еще.',
  'settings.SecretsListModal.synced_keys_are_out_of.408b671b':
    'Синхронизированные ключи здесь устарели.',
  'settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24':
    'Синхронизированные ключи заблокированы на этом устройстве.',
  'settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8':
    'Эта парольная фраза не открывает хранилище.',
  'settings.SecretsListModal.the_store_may_hold_keys.5b2f6105':
    'В хранилище могут храниться ключи, которых нет на этом устройстве. Их имена также зашифрованы, поэтому они отображаются в списке после разблокировки.',
  'settings.SecretsListModal.the_store_could_not_be.bafdcd54':
    'Не удалось разблокировать хранилище.',
  'settings.SyncSettings.waiting_for_you.9f760ab2': 'Ждем Вас',
  'settings.SyncSettings.code_that_came_from_another.89b6b46f':
    'Код, полученный с другого устройства, и личные файлы, на которые ссылается общая заметка.',

  'settings.SyncSettings.view_the_exact_incoming_version.6497a546':
    'Посмотреть точную входящую версию',

  'settings.SyncSettings.allow_or_deny_this_file.5d819259':
    'Разрешить или запретить этот файл для этого подключения',
  'settings.SyncSettings.connections.dc273117': 'Соединения',
  'settings.SyncSettings.each_connection_works_on_its.4a88585e':
    'Каждое соединение работает само по себе. При отключении все файлы на этом устройстве сохраняются.',
  'settings.SyncSettings.no_connections_yet.8697571e': 'Пока нет подключений',
  'settings.SyncSettings.paste_a_token_or_scan.257b9a79':
    'Вставьте токен или отсканируйте QR-код для подключения.',
  'settings.SyncSettings.sync_this_connection_now.52cd5ea4':
    'Синхронизируйте это соединение сейчас',
  'settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85':
    'Пауза, обмен, удаление файлов, отключение',
  'settings.SyncSettings.connect_to_a_server.232ac7de': 'Подключиться к серверу',
  'settings.SyncSettings.by_a_token_you_were.d2dab8e7':
    'По токену вам дали, вставили или отсканировали.',
  'settings.SyncSettings.connect.c0e20f6d': 'Соединять…',
  'settings.SyncSettings.paste_a_token_for_a.256b8463':
    'Вставьте токен для сервера, папки или группы.',
  'settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6':
    'Открывается обмен файлами. Здесь хранятся файлы соединений, требующих внимания.',
  'settings.SyncSettings.sync_is_opening_if_it.1225ed54':
    'Синхронизация открывается. Если он не открывается, перезапустите Obsidian и повторите попытку.',
  'settings.SyncSettings.the_whole_vault.0a409543': 'все хранилище',
  'settings.SyncSettings.deleted_value_from_the_server.70376e92':
    'Удален {value0} с сервера. Его файлы остаются на этом устройстве.',
  'settings.SyncSettings.keep_syncing_into_the_same.12873e9a':
    'Продолжайте синхронизироваться с той же локальной папкой',
  'settings.SyncSettings.follow_moved_folder.bba3cc92': 'Следовать за перемещенной папкой',
  'settings.SyncSettings.restore_from_the_server.6186b8b7': 'Восстановление с сервера',
  'settings.SyncSettings.resume.d640c742': 'Резюме',
  'settings.SyncSettings.pause.858e4ba7': 'Пауза',
  'settings.SyncSettings.share.51fc2d24': 'Делиться…',
  'settings.SyncSettings.deleted_files.5352e2e9': 'Удаленные файлы',
  'settings.SyncSettings.what_this_device_syncs.979d00ce': 'Что синхронизирует это устройство',
  'settings.SyncSettings.disconnect.f1142965': 'Отключить…',
  'settings.SyncSettings.delete_from_the_server.b3acd04d': 'Удалить с сервера…',
  'settings.SyncSettings.delete_from_the_server_read.5f7e4370': 'Удаление с сервера: только чтение',
  'settings.SyncSettings.delete_from_the_server_unavailable.516a170e':
    'Удаление с сервера: недоступно; проверьте подключение и версию сервера',
  'settings.SyncSettings.the_file_could_not_be.accad798':
    'Файл не удалось открыть. Его содержимое сохранено. Попробуйте еще раз, когда сервер будет доступен.',
  'settings.SyncSettings.incoming_changes_could_not_be.24745c6e':
    'Не удалось открыть входящие изменения. Снова откройте настройки синхронизации и повторите попытку.',
  'settings.TaskLabelsSettings.labels.934b8899': 'Этикетки',
  'settings.TaskLabelsSettings.labels_are_read_from_a.310aa3b6':
    'Метки считываются из свойства задачи, одного значения или их списка. Каждая этикетка может иметь цвет; остальные серые.',
  'settings.TaskLabelsSettings.label_property.2b08cac9': 'Свойство метки',
  'settings.TaskLabelsSettings.the_task_property_labels_are.5b8a2eb7':
    'Метки свойств задачи считываются из (по умолчанию: «метки»).',
  'settings.TaskLabelsSettings.priority_property.1588ceb0': 'Приоритетная недвижимость',
  'settings.TaskLabelsSettings.the_task_property_priority_is.19d87f4b':
    'Приоритет свойства задачи считывается и записывается (по умолчанию: «приоритет»). Не изменяет свойства виджетов.',
  'settings.TaskLabelsSettings.priority.3092a5f0': 'приоритет',
  'settings.TaskLabelsSettings.add_a_label.43db67d6': 'Добавить ярлык',
  'settings.TaskLabelsSettings.to_colour_a_label_before.7f8888f5':
    'Раскрашивать метку до того, как она будет выполнена какой-либо задачей.',
  'settings.TaskLabelsSettings.label.0e66373f': 'Этикетка',
  'settings.TaskLabelsSettings.add.9fd728c6': 'Добавить',
  'settings.TaskLabelsSettings.add_this_label_to_the.b2c3c5b9': 'Добавить этот ярлык в список',
  'settings.TasksSettings.tasks_folder.9c703cd1': 'Папка задач',
  'settings.TasksSettings.optional_folder_path_to_store.68deedd3':
    'Необязательный путь к папке для файлов задач (по умолчанию: "Tasks").',
  'settings.TasksSettings.enter_tasks_folder_path.685fec4a': 'Введите путь к папке задач',
  'settings.TasksSettings.tasks_time_choices.97d2bb52': 'Выбор времени выполнения задач',
  'settings.TasksSettings.optional_comma_separated_list_of.352a5929':
    'Необязательный список вариантов времени для задач через запятую (например, "09:00,12:00,18:00").',
  'settings.TasksSettings.e_g.4c04e29e': 'например {literal0}',
  'settings.TasksSettings.tasks_date_choices.56987dbf': 'Выбор даты задач',
  'settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e':
    'Необязательный список вариантов дат для задач через запятую (например, "Today,Tomorrow,Next Week").',
  'settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0': 'например {literal0}',
  'settings.TasksSettings.tasks_recurrence_choices.5933e491': 'Выбор повторения задач',
  'settings.TasksSettings.optional_comma_separated_list_of.f364b641':
    'Необязательный список вариантов повторения для задач через запятую (например, "Daily,Weekly,Monthly").',
  'settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3': 'например {literal0}',
  'settings.TasksSettings.busy_day_threshold.ebd745bf': 'Порог напряженного дня',
  'settings.TasksSettings.number_of_tasks_in_a.def227ff':
    'Количество задач в день, чтобы считать его «напряженным днем».',
  'settings.TasksSettings.e_g.8c2fb766': 'например {literal0}',
  'settings.TasksSettings.week_starts_on_monday.1e6c3ee3': 'Неделя начинается в понедельник',
  'settings.TasksSettings.set_the_first_day_of.0426b53c':
    'Установите первый день недели для расчета даты.',
  'settings.TasksSettings.birth_date.5164b245': 'Дата рождения',
  'settings.TasksSettings.where_the_life_layout_of.291ea708':
    'Где макет «Жизнь» базы календаря начинает отсчитывать ваши недели. Используется каждой базой.',
  'settings.TasksSettings.life_expectancy.da8e9e4d': 'Ожидаемая продолжительность жизни',
  'settings.TasksSettings.the_years_the_life_layout.4cd598a4':
    'Годы, которые рисует расклад «Жизнь». База календаря может запросить свою собственную в параметрах представления.',
  'settings.TimeTrackingSettings.time_entry_path_template.b06163ff': 'Шаблон пути ввода времени',
  'settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8':
    'Шаблон для новых путей к файлам записи времени. Переменные: {literal0}, {literal1}, {literal2}, {literalDate}.',
  'settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce': 'например {literal2}',
  'settings.TimeTrackingSettings.trackable_note_types.4b331926': 'Отслеживаемые типы заметок',
  'settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd':
    'Типы заметок, разделенных запятыми, в заголовке которых отображается кнопка таймера (например, задача, проект).',
  'settings.TimeTrackingSettings.e_g_task.1c985447': 'например {literal0}',
  'settings.TimeTrackingSettings.track_all_notes.41a2243c': 'Отслеживать все заметки',
  'settings.TimeTrackingSettings.show_the_timer_button_in.983d0303':
    'Показывать кнопку таймера в заголовке для всех заметок, независимо от типа.',
  'settings.TransferSettings.send_to_another_device.71ef2876': 'Отправить на другое устройство',
  'settings.TransferSettings.tick_what_should_travel_what.be4e856b':
    'Отметьте, что должно путешествовать. То, что вы выберете, может быть представлено в виде QR-кода, текста для вставки или файла для отправки.',
  'settings.TransferSettings.include_keys.f7508fd4': 'Включить ключи',
  'settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9':
    'Ключи API передаются вместе со всем, что в них нуждается. Передача с ключом блокируется одноразовым кодом, показанным здесь и введенным на другом устройстве.',
  'settings.TransferSettings.what_to_send.bceb988a': 'Что отправить',
  'settings.TransferSettings.clear.83b12c22': 'Снять выделение',
  'settings.TransferSettings.select_all.1fc9a387': 'Выбрать всё',
  'settings.TransferSettings.send_nothing.1bc92d8a': 'Ничего не отправлять',
  'settings.TransferSettings.send_everything_listed_here.f1ac2a00':
    'Отправьте все, что указано здесь',
  'settings.TransferSettings.send_everything_under_value.1db19fa3':
    'Отправьте все, что меньше {value0}',
  'settings.TransferSettings.send_value.c229d699': 'Отправить {value0}',
  'settings.TransferSettings.carries_a_key.0d090cb4': 'Носит с собой ключ',
  'settings.TransferSettings.send_all_of_the_value.f01a8818': 'Отправьте все {value0}',
  'settings.TransferSettings.nothing_here_can_be_transferred.49a46df4':
    'Здесь пока ничего нельзя перенести.',
  'settings.TransferSettings.preview.324b134f': 'Предпросмотр',
  'settings.TransferSettings.see_exactly_what_would_be.5a694fa9':
    'Посмотрите, что именно будет отправлено',
  'settings.TransferSettings.choose_something_to_send_first.5fde4c03':
    'Выберите, что отправить первым',
  'settings.TransferSettings.send.f6f4688f': 'Отправлять',
  'settings.TransferSettings.hand_what_you_chose_to.f4aa3506':
    'Передайте то, что вы выбрали, на другое устройство.',
  'settings.TransferSettings.receive_from_another_device.955f97bb': 'Получить с другого устройства',
  'settings.TransferSettings.read_the_codes_the_other.7d52f77b':
    'Прочтите коды, которые показывает другое устройство. Ничего не написано, пока вы не увидите то, что пришло.',
  'settings.TransferSettings.read_a_transfer.da2dcc0f': 'Прочитать передачу',
  'settings.TransferSettings.camera_a_photo_of_the.d9996865':
    'Камера, фотография кода, файла или самого текста.',
  'settings.TransferSettings.scan.ea1c510d': 'Сканировать',
  'settings.TransferSettings.read_a_transfer_from_another.60d1c2f6':
    'Прочитать передачу с другого устройства',
  'settings.TransferSettings.notes.8a7525b1': 'Заметки',
  'settings.TransferSettings.money_and_time.ebb5a49d': 'Деньги и время',
  'settings.TransferSettings.agents.279b44d2': 'Агенты',
  'settings.TransferSettings.buttons.d452583a': 'Кнопки',
  'settings.TransferSettings.data.cec3a9b8': 'Данные',
  'settings.TransferSettings.nothing_selected_yet.d6f9822a': 'Пока ничего не выбрано.',
  'settings.TransferSettings.fits_in_one_code.324a2a38': 'Подходит под один код.',
  'settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4':
    'Принимает коды {value0}, показанные один за другим.',
  'settings.TransferSettings.takes_value_codes_too_many.304d8234':
    'Принимает коды {value0} — слишком много, чтобы их можно было сфотографировать, поэтому они будут сохранены в виде текста или файла.',
  'settings.TransferSettings.applied_value.d4ffb612': 'Применено {value0}.',
  'settings.TransferSettings.value_could_not_be_stored.cf4fe457':
    'Не удалось сохранить {value0} — имя, которое использует для него это хранилище, Obsidian не примет.',
  'settings.TransferSettings.value_could_not_be_written.93eaa96e': '{value0} не удалось записать.',
  'settings.ai.AgentEditorModal.agent_value.c67844d1': 'Агент: {value0}',
  'settings.ai.AgentEditorModal.agent.11b39c93': 'Агент',
  'settings.ai.AgentEditorModal.name.dcd1d522': 'Имя',
  'settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51':
    'Отображается в средстве выбора агента.',
  'settings.ai.AgentEditorModal.description.526e0087': 'Описание',
  'settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342':
    'Сообщает другим агентам, для чего нужен этот.',
  'settings.ai.AgentEditorModal.utility_agent.e8384fe8': 'Служебный агент',
  'settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc':
    'Скрыто из окна выбора чата. Все еще доступно для скриптов, делегирования и черновика.\n              обзор.',
  'settings.ai.AgentEditorModal.model.5e2c614c': 'Модель',
  'settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab':
    'Модель, на которой работает этот агент.',
  'settings.ai.AgentEditorModal.fallback_model.ed293bb6': 'Резервная модель',
  'settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0':
    'Предлагается в качестве повторной попытки в случае сбоя запроса. Используется автоматически в делегированных запусках,\n              где никто не может нажать кнопку.',
  'settings.ai.AgentEditorModal.background_model.905a0833': 'Фоновая модель',
  'settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428':
    'Для именования и сжатия чатов этого агента. Unset, фон для всего плагина\n              Решающее значение имеет настройка модели, а если она не настроена, то и собственная модель чата.',
  'settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a':
    'Они читают чаты этого агента в указанном порядке, каждый с учетом предыдущего.\n              возвращенные: ваши сообщения до того, как это сделает агент, его ответы до того, как они останутся, или\n              оба. Агент говорит то, что думает; скрипт решает. Чат может хранить свой собственный список.',
  'settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9':
    'Блоки соединяются по порядку с пустой строкой между ними. Используйте {value0} для сегодняшней даты.',
  'settings.ai.AgentEditorModal.block_value.dd05ec6a': 'Заблокировать {value0}',
  'settings.ai.AgentEditorModal.move_up.c66feb5e': 'Вверх',
  'settings.ai.AgentEditorModal.move_down.40bb50da': 'Двигаться вниз',
  'settings.ai.AgentEditorModal.remove.c3812fc4': 'Удалить',
  'settings.ai.AgentEditorModal.path_to_note.ef6763e6': 'Путь к заметке...',
  'settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2':
    'Инструкция для этого агента...',
  'settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4':
    'Никаких блоков промптов. Этот агент запускается без собственных инструкций.',
  'settings.ai.AgentEditorModal.add_text_block.4b0903f4': 'Добавить текстовый блок',
  'settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8':
    'Добавить блок инструкций, написанных здесь',
  'settings.ai.AgentEditorModal.add_note_block.34512584': 'Добавить блок заметок',
  'settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7':
    'Добавить блок, прочитанный из заметки в хранилище',
  'settings.ai.AgentEditorModal.permission_mode.c7a8e6db': 'Режим разрешений',
  'settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c':
    'Что этот агент может сделать, не спрашивая.',
  'settings.ai.AgentEditorModal.github_connections.e95944e1': 'Подключения к GitHub',
  'settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61':
    'Выкл: нет доступа. Спрашивайте: одобряйте каждую операцию в интерактивном чате. Вкл.: использовать без запроса. Новые соединения начинаются с отключения на каждом сервере. Эти варианты не активируют инструмент «Выключить».',
  'settings.ai.AgentEditorModal.github_com.3aeb0024': 'github.com',
  'settings.ai.AgentEditorModal.unavailable_connection_value.795252e1':
    'Недоступное соединение: {value0}',
  'settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef':
    'Этот агент относится к соединению, которого нет на этом устройстве. Перенесите соединение или оставьте его выключенным.',
  'settings.ai.AgentEditorModal.scope.b073f6c6': 'Область',
  'settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74':
    'Где этот агент работает по умолчанию. Делегированный запуск также получает все, что говорят в чате.\n              делегированные ему полномочия были открыты.',
  'settings.ai.AgentEditorModal.tools.ea93d6a2': 'Инструменты',
  'settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983':
    'Выкл = недоступен. Спросить = необходимо одобрение. Авто = работает самостоятельно. Файловые инструменты\n              всегда доступен и регулируется режимом разрешений, указанным выше.',
  'settings.ai.AgentEditorModal.offer_tools.677c3882': 'Предлагайте инструменты',
  'settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7':
    'По разделам: агент видит одну запись в каждом разделе с указанием того, для чего она нужна, и открывает раздел, когда ему это нужно. Все сразу: каждый включенный инструмент предлагается с самого начала.',
  'settings.ai.AgentEditorModal.skills.66d0f523': 'Навыки',
  'settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3':
    'Какие навыки этот агент может загрузить по требованию.',

  'settings.ai.AgentEditorModal.delegation_depth.29ea0156': 'Глубина делегирования',
  'settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e':
    'Насколько далеко может делегировать этот агент. 0 полностью удаляет инструмент делегирования.',
  'settings.ai.AgentEditorModal.basic.0e35f6e9': 'Базовый',
  'settings.ai.AgentEditorModal.prompts.5f2e66e6': 'Промпты',
  'settings.ai.AgentEditorModal.memory.c3963aed': 'Память',
  'settings.ai.AgentEditorModal.access.ec5ba0ab': 'Доступ',
  'settings.ai.AgentEditorModal.delegation.a6d910ba': 'Делегация',
  'settings.ai.AgentEditorModal.text.71988c4d': 'Текст',
  'settings.ai.AgentEditorModal.note.d8da2c49': 'Заметка',
  'settings.ai.AgentEditorModal.all_skills.78abcbbf': 'Все навыки',
  'settings.ai.AgentEditorModal.no_skills.5083cd4b': 'Нет навыков',
  'settings.ai.AgentEditorModal.only_selected.c1792bfe': 'Только выбрано',
  'settings.ai.AgentEditorModal.cannot_delegate.6a16ca61': 'Не могу делегировать',
  'settings.ai.AgentEditorModal.level.3292ae98': '1 уровень',
  'settings.ai.AgentEditorModal.levels.8b7cdd29': '2 уровня',
  'settings.ai.AgentEditorModal.levels.93b1554a': '3 уровня',
  'settings.ai.AgentEditorModal.off.ca7981b4': 'Выкл.',
  'settings.ai.AgentEditorModal.ask.b8c209cd': 'Спрашивать',
  'settings.ai.AgentEditorModal.on.13001175': 'Вкл.',
  'settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c':
    'Что этого агента попросили запомнить. Его видит только этот агент: он добавляется в его системный промпт по шаблону памяти из общих настроек ИИ. Агент добавляет\n      и изменяет элементы с помощью инструмента «Запомнить» и удаляет их с помощью «Забыть»; оба можно отключить на вкладке «Доступ».',
  'settings.ai.AgentMemoryEditor.added_value.29f396e2': 'Добавлено {value0}',
  'settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d': 'Забудь этот предмет',
  'settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6':
    'Еще ничего не вспомнил. Попросите агента в чате что-то запомнить или добавьте сюда.',
  'settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77':
    'Кое-что этому агенту следует помнить...',
  'settings.ai.AgentMemoryEditor.add.9fd728c6': 'Добавить',
  'settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8':
    'Добавьте эту строку в память агента',
  'settings.ai.AgentsSettings.an_agent_is_a_model.148349b4':
    'Агент — это модель, набор инструкций и то, что ему разрешено делать. Чаты работают\n      один; скрипты и другие агенты могут делегировать полномочия одному из них.',
  'settings.ai.AgentsSettings.default.37a8eec1': 'по умолчанию',
  'settings.ai.AgentsSettings.utility.57ffcc28': 'служебный',
  'settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501': 'Дублировать этого агента',
  'settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82':
    'Последнего агента удалить нельзя — чат должен на чем-то запускаться',
  'settings.ai.AgentsSettings.delete_this_agent.0ba11bd2': 'Удалить этого агента',
  'settings.ai.AgentsSettings.add_agent.d3e039d4': 'Добавить агента',
  'settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1':
    'Создайте агента и откройте его для редактирования.',
  'settings.ai.AgentsSettings.delete_agent.602cc4da': 'Удалить агента',
  'settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4':
    'Удалить {value0}? Чаты, которые все еще работают на нем, вернутся к\n        агент по умолчанию. Это невозможно отменить.',
  'settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d':
    'Утилита не может быть агентом по умолчанию — она скрыта от чатов',
  'settings.ai.AgentsSettings.already_the_default_agent.28842ed7': 'Уже агент по умолчанию',
  'settings.ai.AgentsSettings.make_this_the_default_agent.4e646862':
    'Сделайте это агентом по умолчанию для новых чатов.',
  'settings.ai.AgentsSettings.no_model.f62c7d17': 'нет модели',
  'settings.ai.AgentsSettings.whole_vault.18d9a3b5': 'весь свод',
  'settings.ai.AgentsSettings.no_scope.cc0ca29a': 'без доступа',

  'settings.ai.GeneralSettings.ai_agent.b48c8be3': 'ИИ-агент',
  'settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425':
    'Включите функции AI-агента, включая боковую панель чата.',
  'settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23':
    'Агент ИИ выключен. Включите его в разделе «Общие».',
  'settings.ai.GeneralSettings.keep_running_in_background_while.32440789':
    'Продолжайте работать в фоновом режиме, пока работают агенты',
  'settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2':
    'Воспроизведение беззвучного звука во время хода. Может использовать больше батареи; фоновое выполнение зависит от системы.',
  'settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee':
    'Продолжайте работать в фоновом режиме всегда',
  'settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f':
    'Воспроизводите беззвучный звук, даже когда агенты бездействуют. По умолчанию выключено; может использовать больше батареи.',
  'settings.ai.GeneralSettings.key_destinations.fe672569': 'Ключевые направления',
  'settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee':
    'Проверьте адреса, измененные за пределами этого устройства, прежде чем отправлять туда ключи.',
  'settings.ai.GeneralSettings.review.aff0766a': 'Обзор',
  'settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591':
    'Просмотрите и подтвердите, куда это устройство отправляет ключи.',
  'settings.ai.GeneralSettings.chat_storage.b1ad73cf': 'Хранилище чата',
  'settings.ai.GeneralSettings.chat_path_template.306fa23b': 'Шаблон пути к чату',
  'settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e':
    'Шаблон пути для файлов чата. Переменные: {value0}, {value1}.',
  'settings.ai.GeneralSettings.ai_chats.f579b34b': 'ИИ/Чаты',
  'settings.ai.GeneralSettings.rewind_space_mb.a3eaae55': 'Пространство перемотки назад (МБ)',
  'settings.ai.GeneralSettings.how_much_room_on_this.f5c80989':
    'Сколько места на этом устройстве могут занять копии, которые можно вернуть в чат?\n            файлы изменил его агент. Чаты, написанные совсем недавно, теряют свои права первыми. 0 сохраняет\n            ничего, и чаты не могут перематываться назад.',
  'settings.ai.GeneralSettings.migrate_chats.cd7a094d': 'Перенос чатов',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b':
    'Переместите существующие файлы чата в соответствии с текущим шаблоном пути.',
  'settings.ai.GeneralSettings.migrating.e3c84baf': 'Миграция...',
  'settings.ai.GeneralSettings.migrate.f988ed29': 'Мигрировать',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22':
    'Переместите существующие файлы чата в соответствии с шаблоном выше.',
  'settings.ai.GeneralSettings.comment_agent.42067bbf': 'Агент комментариев',
  'settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0':
    'Какой агент отвечает на комментарии в чатах. Также предлагаются служебные агенты — тот, который\n            создан для комментариев, — один из них.',
  'settings.ai.GeneralSettings.comment_folder.0f39b86a': 'Папка комментариев',
  'settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501':
    'Где хранятся чаты комментариев',
  'settings.ai.GeneralSettings.ai_comments.e01654c6': 'ИИ/Комментарии',
  'settings.ai.GeneralSettings.skills.66d0f523': 'Навыки',
  'settings.ai.GeneralSettings.skills_folder.bc563bf9': 'Папка навыков',
  'settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b':
    'Навыки здесь предлагаются каждому агенту. В других местах предлагаются только навыки в рамках чата; при загрузке другого навыка сначала спрашивается. Выбор навыков агента по-прежнему применяется.',
  'settings.ai.GeneralSettings.ai_skills.cebb9b9a': 'ИИ/Навыки',
  'settings.ai.GeneralSettings.integrations.090512d9': 'Интеграции',
  'settings.ai.GeneralSettings.brave_search_api_key.309e5bff': 'API-ключ Brave Search',
  'settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5': 'Надежно хранится в брелке.',
  'settings.ai.GeneralSettings.secrets.d8707d41': 'Секреты',

  'settings.ai.GeneralSettings.unnamed.9edb143e': '(безымянный)',
  'settings.ai.GeneralSettings.secret_name.5cdf573b': 'Секретное имя',
  'settings.ai.GeneralSettings.value.fb2e2c72': 'Ценить...',
  'settings.ai.GeneralSettings.allowed_addresses.0479f7eb': 'Разрешенные адреса',
  'settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c':
    'Добавьте адрес из подтверждения запроса. Каждый запрос сохраненного ключа по-прежнему запрашивается.',
  'settings.ai.GeneralSettings.remove.c3812fc4': 'Удалить',
  'settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72':
    'Удалить этот адрес из списка разрешенных ключей',
  'settings.ai.GeneralSettings.none_yet.adb85cf2': 'Пока нет',
  'settings.ai.GeneralSettings.remove_this_secret.42b31675': 'Удалить этот секрет',
  'settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa':
    'Отмена — оставить сохраненное значение как есть',
  'settings.ai.GeneralSettings.add_secret.f57a23c6': 'Добавить секрет',
  'settings.ai.GeneralSettings.add_another_named_secret.16c8806f':
    'Добавить еще один именованный секрет',
  'settings.ai.GeneralSettings.providers.996c32b3': 'Провайдеры',
  'settings.ai.GeneralSettings.base_url.70589413': 'Базовый URL',
  'settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e':
    'Конечная точка API, совместимая с OpenAI.',
  'settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef': 'Получить модели из API',
  'settings.ai.GeneralSettings.add_model_manually.c42ee506': 'Добавить модель вручную',

  'settings.ai.GeneralSettings.filter_models.e91fd9af': 'Фильтровать модели...',
  'settings.ai.GeneralSettings.reasoning.0c4d01e8': 'рассуждение',
  'settings.ai.GeneralSettings.no_models_yet.36604ff4': 'Моделей пока нет.',
  'settings.ai.GeneralSettings.add_another_provider.91f9cd40': 'Добавить другого провайдера',
  'settings.ai.GeneralSettings.no_providers_yet.55327313': 'Пока нет провайдеров',
  'settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8':
    'Любой сервис, использующий OpenAI API: его адрес, ключ и модели.',
  'settings.ai.GeneralSettings.add_provider.8cd1856b': 'Добавить провайдера',
  'settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7':
    'Добавьте еще одного провайдера, совместимого с OpenAI.',
  'settings.ai.GeneralSettings.background_model.eefa747e': 'Фоновая модель',
  'settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa':
    'Модели чата выбираются для каждого агента на вкладке «Агенты». Этот используется для\n          собственная фоновая работа плагина — присвоение имен чатам и сжатие длинных разговоров.',
  'settings.ai.GeneralSettings.auxiliary_model.6c245762': 'Вспомогательная модель',
  'settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143':
    'Используется для заголовков чатов и уплотнения. Если не настроено, каждый чат использует ту модель, которую он использует.\n            уже разговариваю; агент может назвать один из своих, что выигрывает от этого.',
  'settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7': 'Последовательный вспомогательный',
  'settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159':
    'Запускайте вспомогательные задачи после завершения основной модели. Включите для локальных моделей с ограниченной пропускной способностью.',
  'settings.ai.GeneralSettings.when_a_request_fails.8adc1690': 'Когда запрос терпит неудачу',
  'settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33':
    'Повторяются только сбои, которые проходят сами — ограничение скорости, перегруженный провайдер, обрыв соединения. Отклоненный ключ или неправильный запрос не повторяется.',
  'settings.ai.GeneralSettings.try_again_automatically.84c6a3e7': 'Повторите попытку автоматически',
  'settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd':
    'Сколько еще попыток после первой.',
  'settings.ai.GeneralSettings.first_wait.548b0480': 'Сначала подожди',
  'settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb':
    'За секунды до первой повторной попытки. Каждый после удваивает его, вплоть до минуты.',
  'settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08': 'Тайм-аут запроса (секунды)',
  'settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5':
    'Подождите, пока модель подключится или отправит следующий фрагмент ответа, а не весь ответ. 1–3600 секунд; пусто восстанавливает 60. Используется для чатов и фоновых моделей без собственного таймаута.',
  'settings.ai.GeneralSettings.voice_input.8748f239': 'Голосовой ввод',
  'settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a':
    'Диктуйте в чат или в заметку с помощью команды «Диктовать в заметку». OpenRouter не имеет конечной точки транскрипции, поэтому звук передается на модель, которая слышит — эти две были выбраны из-за цены, для работы в Европе и для того, чтобы не тренироваться на том, что отправляется.',
  'settings.ai.GeneralSettings.model.5e2c614c': 'Модель',
  'settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f':
    'Что превращает речь в текст.',
  'settings.ai.GeneralSettings.model_id.7789530b': 'Идентификатор модели',
  'settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177':
    'Любая модель, поддерживающая звук, как ее называет провайдер.',
  'settings.ai.GeneralSettings.vendor_model.ba723767': 'провайдер/модель',
  'settings.ai.GeneralSettings.endpoint.3df9726c': 'Конечная точка',
  'settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7':
    'Оставлено пустым: завершение чата OpenRouter.',
  'settings.ai.GeneralSettings.language.a4fe6526': 'Язык',
  'settings.ai.GeneralSettings.told_to_the_model_as.35170cef':
    'Сказал модели в качестве подсказки. Если оставить пустым, он определяет это по аудио.',
  'settings.ai.GeneralSettings.russian.5bcc40ad': 'Русский',
  'settings.ai.GeneralSettings.client_name.b6626cd7': 'Имя клиента',
  'settings.ai.GeneralSettings.default.21b111cb': 'По умолчанию',
  'settings.ai.GeneralSettings.openrouter_api_key.89616b71': 'API-ключ OpenRouter',
  'settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21':
    'Хранится в связке ключей и используется совместно с созданием изображений.',
  'settings.ai.GeneralSettings.image_generation.8f4716e6': 'Генерация изображений',
  'settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226':
    'Короткий идентификатор, используемый в ключах модели (например, openai, openrouter).',
  'settings.ai.GeneralSettings.e_g_openai.e3ce2f3c': 'например {literal0}',
  'settings.ai.GeneralSettings.api_type.72e7cc4c': 'Тип API',
  'settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d':
    'OpenAI использует /v1/images/generations, OpenRouter использует автодополнение в чате.',
  'settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3': 'Оставьте пустым по умолчанию: ',
  'settings.ai.GeneralSettings.add_model.b2609f7d': 'Добавить модель',
  'settings.ai.GeneralSettings.add_another_image_provider.fac89d72':
    'Добавить другого провайдера изображений',
  'settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca':
    'Провайдеров изображений пока нет.',
  'settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb':
    'Сервис, который делает картинки из слов, чтобы агент мог ими рисовать.',
  'settings.ai.GeneralSettings.add_image_provider.858726bf': 'Добавить провайдера изображений',
  'settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9':
    'Добавить еще одного провайдера генерации изображений',
  'settings.ai.GeneralSettings.default_image_model.164d9980': 'Модель изображения по умолчанию',
  'settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88':
    'Используется, когда агент не указывает модель.',
  'settings.ai.GeneralSettings.prompts.5f2e66e6': 'Промпты',
  'settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4':
    'Что плагин говорит моделям за свою работу. Каждый из них запускается как собственный плагин; измените один только для того, чтобы изменить результат этой работы.',
  'settings.ai.GeneralSettings.tool_descriptions.eb258712': 'Описание инструментов',
  'settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136':
    'То, что каждый инструмент сообщает модели о себе, разделяется каждым агентом. Какие инструменты может использовать агент, устанавливается для каждого агента.',
  'settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106':
    '{value0} изменено по сравнению с собственным плагином.',
  'settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39':
    'Измените то, что инструменты сообщают модели',
  'settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab':
    'Изменено с собственных слов плагина',
  'settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921': 'Измените приглашение {value0}',
  'settings.ai.GeneralSettings.use_the_default.76f7faf5': 'Используйте значение по умолчанию',
  'settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb':
    'Вернитесь к собственным словам плагина',
  'settings.ai.GeneralSettings.cancel.19766ed6': 'Отмена',
  'settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492': 'Закрыть без изменений',
  'settings.ai.GeneralSettings.save.1509f561': 'Сохранить',
  'settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d':
    'Используйте эти слова с этого момента',
  'settings.ai.GeneralSettings.done.11a6767d': 'Готово',
  'settings.ai.GeneralSettings.close_this_window.3f02fc8e': 'Закрыть это окно',
  'settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9': 'Перенесено чатов: {value0}.',
  'settings.ai.GeneralSettings.migration_failed_value.109b5f7f':
    'Не удалось выполнить миграцию: {value0}',
  'settings.ai.GeneralSettings.default_agent.94da52ec': 'Агент по умолчанию',
  'settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9':
    'Введите от 1 до 3600 секунд. Это значение не было сохранено.',
  'settings.ai.GeneralSettings.something_else.b4768d66': 'Что-то еще…',
  'settings.ai.GeneralSettings.remove_secret.1422ca6e': 'Удалить секрет',

  'settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101':
    'Сохранено {value0} в связке ключей.',
  'settings.ai.GeneralSettings.agent_memory.f3cd4df6': 'Память агента',
  'settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab':
    'Как то, что агенту было предложено запомнить, добавляется в его системную промпт; {value0} – это место, куда помещаются элементы.',
  'settings.ai.GeneralSettings.chat_titles.950a9874': 'Заголовки чатов',
  'settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a':
    'Называет чат по его первым сообщениям; {value0} — это то место, куда они идут.',
  'settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9': 'Заголовки чатов, система',
  'settings.ai.GeneralSettings.what_the_model_that_names.4a08978e':
    'Что рассказывает модель, которая называет чаты.',
  'settings.ai.GeneralSettings.chat_recap.adaaf80a': 'Обзор чата',
  'settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c':
    'Предложение на карточке чата под заметкой изменено; {value0} – это место, куда отправляются сообщения.',
  'settings.ai.GeneralSettings.chat_summary.b82dab10': 'Обзор чата',
  'settings.ai.GeneralSettings.the_short_line_under_a.c81696a8':
    'Короткая строка под названием чата в истории; {value0} – это место, куда отправляются сообщения.',
  'settings.ai.GeneralSettings.compacting.df77799c': 'Уплотнение',
  'settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886':
    'Как подводится итог долгому разговору, чтобы он мог продолжаться; {value0} — вот куда оно идет.',
  'settings.ai.InterceptorList.interceptors.803987ac': 'Перехватчики',
  'settings.ai.InterceptorList.off.ca7981b4': 'Выкл.',
  'settings.ai.InterceptorList.close_its_settings.de0fd0fb': 'Закройте его настройки',
  'settings.ai.InterceptorList.edit_what_it_reads_and.86412c66':
    'Редактировать то, что он читает и как',
  'settings.ai.InterceptorList.on_runs_in_its_turn.baf521d9': 'Включено: работает в свою очередь',
  'settings.ai.InterceptorList.off_skipped_keeps_its_place.28162216':
    'Выкл.: пропускается, остается на своем месте',
  'settings.ai.InterceptorList.move_or_remove.ca447e47': 'Переместить или удалить',
  'settings.ai.InterceptorList.who_reads_an_agent_says.0ff03e5e':
    'Кто читает: агент говорит то, что думает, решает скрипт.',
  'settings.ai.InterceptorList.add_interceptor.36b0eb2d': 'Добавить перехватчик',
  'settings.ai.InterceptorList.add_one_at_the_end.98a5c813':
    'Добавьте один в конце; он работает последним',
  'settings.ai.InterceptorList.an_agent_or_a_script.92a06c1a':
    'Агент или скрипт, который читает первым',
  'settings.ai.InterceptorList.everything.75304cf7': 'Все',
  'settings.ai.InterceptorList.they_run_in_this_order.7b624feb':
    'Они выполняются в таком порядке, каждый получает то, что вернул предыдущий. Агент читает сообщение последнего.',
  'settings.ai.InterceptorList.script_value_missing.31a4f5d0': 'Скрипт: {value0} · отсутствует',
  'settings.ai.InterceptorList.missing_agent.4eeff6c3': 'Пропавший агент',
  'settings.ai.InterceptorList.nobody.3fad99b5': 'Никто',
  'settings.ai.InterceptorList.move_up.c66feb5e': 'Вверх',
  'settings.ai.InterceptorList.move_down.40bb50da': 'Двигаться вниз',
  'settings.ai.InterceptorList.remove.c3812fc4': 'Удалить',
  'settings.ai.InterceptorSettings.interceptor.e7123168': 'Перехватчик',
  'settings.ai.InterceptorSettings.checks.de07d072': 'Чеки',
  'settings.ai.InterceptorSettings.only_messages_matching.a6b95968':
    'Только соответствующие сообщения',
  'settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb':
    'Регулярное выражение, чистое или в виде /pattern/flags, проверяется на всем, что проверяется. Остальные проходят без проверки. Пустое означает все.',

  'settings.ai.InterceptorSettings.reply_only.df23f4c5': 'Только ответ',
  'settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839':
    'Отправляйте свои сообщения без изменений прямо главному агенту. Перехватчик может отвечать на каждое сообщение, не удерживая его, не переписывая и не принимая решения об одобрении инструмента.',
  'settings.ai.InterceptorSettings.interceptor_context.4b7f6f53': 'Контекст перехватчика',
  'settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856':
    'Какую часть разговора видит перехватчик.',
  'settings.ai.InterceptorSettings.everything.75304cf7': 'Все',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec':
    'Ваши сообщения, прежде чем агент их прочитает.',
  'settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d':
    'Ответы агента, как только оно закончится. Место ответа занимает новый текст от перехватчика; оригинал остается на расстоянии нажатия.',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706':
    'Ваши сообщения до того, как агент их прочитает, и его ответы после завершения. Место ответа занимает новый текст от перехватчика.',
  'settings.ai.McpServerModal.add_mcp_server.0e3e58f9': 'Добавить MCP-сервер',
  'settings.ai.McpServerModal.edit_mcp_server.35d90caa': 'Редактировать MCP-сервер',
  'settings.ai.McpServerModal.name.dcd1d522': 'Имя',
  'settings.ai.McpServerModal.e_g_context.e900fc3c': 'например {literal0}',
  'settings.ai.McpServerModal.another_server_already_has_this.8e96ea34':
    'Такое имя уже есть у другого сервера. От него происходят названия инструментов, поэтому они должны отличаться.',
  'settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59':
    'Конечная точка MCP сервера, доступная через HTTP.',
  'settings.ai.McpServerModal.on.13001175': 'Вкл.',
  'settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37':
    'Офф оставляет его здесь и не передает его инструменты ни одному агенту.',
  'settings.ai.McpServerModal.token.d2089be6': 'Токен',
  'settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3':
    'Отправляется как Authorization: Bearer. Хранится в связке ключей, никогда — в файле настроек.',
  'settings.ai.McpServerModal.optional.59be7133': 'Необязательный',
  'settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436':
    'Забудьте сохраненный токен при сохранении',
  'settings.ai.McpServerModal.headers.194e9fe6': 'Заголовки',
  'settings.ai.McpServerModal.tools.ea93d6a2': 'Инструменты',
  'settings.ai.McpServerModal.what_agents_are_told_is.7591a661':
    'Агентам сообщается этот список в том виде, в каком он был получен. Он меняется только тогда, когда вы его получаете\n          еще раз сюда и сохранитесь.',
  'settings.ai.McpServerModal.fetch_tools.4788d40d': 'Инструменты получения',
  'settings.ai.McpServerModal.connect_to_the_server_and.db04f00f':
    'Подключитесь к серверу и ознакомьтесь с предлагаемыми им инструментами.',
  'settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f':
    'Сначала нужен URL-адрес сервера',
  'settings.ai.McpServerModal.save.1509f561': 'Сохранить',
  'settings.ai.McpServerModal.keep_this_server_and_close.f4798cef':
    'Оставьте этот сервер и закройте',
  'settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc':
    'Требуется собственное имя и URL-адрес.',
  'settings.ai.McpServerModal.delete.e2d0a549': 'Удалить',
  'settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c':
    'Удалить этот сервер; агенты теряют свои инструменты',
  'settings.ai.McpServerModal.delete_mcp_server.1a969bef': 'Удалить MCP-сервер',
  'settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d':
    'Удалить {value0}? Каждый агент теряет свои инструменты.',

  'settings.ai.McpServerModal.also_the_start_of_its.6f23c597':
    'Также начало названий инструментов: mcp_{value0}_<tool>.',
  'settings.ai.McpServerModal.fetching.8d0738c8': 'Получение…',
  'settings.ai.McpServerModal.not_fetched_yet.d17fdec2': 'Еще не получено',
  'settings.ai.McpSettings.servers_that_give_agents_more.67631550':
    'Серверы, предоставляющие агентам больше инструментов, доступные через HTTP, а также по телефону. Ничего не\n      запустился на этом устройстве. Инструменты сервера достигают агента только после их включения в\n      вкладку «Доступ» этого агента, и они запрашивают информацию перед каждым вызовом, если не установлено иное.',
  'settings.ai.McpSettings.delete_this_server.e42cb344': 'Удалить этот сервер',
  'settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef': 'Серверов MCP пока нет.',
  'settings.ai.McpSettings.add_server.1099b2a9': 'Добавить сервер',
  'settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42':
    'Подключите MCP-сервер по его адресу',
  'settings.ai.McpSettings.delete_mcp_server.1a969bef': 'Удалить MCP-сервер',
  'settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d':
    'Удалить {value0}? Каждый агент теряет свои инструменты.',
  'settings.ai.McpSettings.off.ca7981b4': 'Выкл.',
  'settings.ai.McpSettings.on.13001175': 'Вкл.',
  'settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f':
    'Включено, инструменты еще не загружены',
  'settings.ai.ProviderSettings.unnamed_provider.1b003656': 'Неназванный провайдер',
  'settings.ai.ProviderSettings.change_this_provider_and_its.6b743289':
    'Изменить этого провайдера и его модели',
  'settings.ai.ProviderSettings.new_provider.38a96a6a': 'Новый провайдер',
  'settings.ai.ProviderSettings.name.dcd1d522': 'Имя',
  'settings.ai.ProviderSettings.client_name.b6626cd7': 'Имя клиента',
  'settings.ai.ProviderSettings.default.21b111cb': 'По умолчанию',
  'settings.ai.ProviderSettings.api_key.16f0ee47': 'API-ключ',
  'settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578':
    'Хранится в брелке этого устройства.',
  'settings.ai.ProviderSettings.models.d17d2d78': 'Модели',
  'settings.ai.ProviderSettings.delete.e2d0a549': 'Удалить',
  'settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b':
    'Удалить этого провайдера и его модели',
  'settings.ai.ProviderSettings.done.11a6767d': 'Готово',
  'settings.ai.ProviderSettings.close_this_window_changes_are.91342d87':
    'Закройте это окно; изменения сохраняются по мере их внесения',
  'settings.ai.ToolDescriptions.value_of_value.ca6c5e5f': '{value0} из {value1}',
  'settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab':
    'Изменено с собственных слов плагина',
  'settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d':
    'Измените то, что {value0} сообщает модели.',
  'settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7':
    'Что этот инструмент рассказывает модели о себе.',
  'settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7':
    'Что {value0} сообщает модели',
  'settings.ai.ToolDescriptions.use_the_default.76f7faf5': 'Используйте значение по умолчанию',
  'settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb':
    'Вернитесь к собственным словам плагина',
  'settings.ai.ToolDescriptions.cancel.19766ed6': 'Отмена',
  'settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492': 'Закрыть без изменений',
  'settings.ai.ToolDescriptions.save.1509f561': 'Сохранить',
  'settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d':
    'Используйте эти слова с этого момента',
  'settings.ai.interceptorList.reply_only.37786db8': 'только отвечать',
  'settings.ai.options.ask_before_every_change.f5fb08f2': 'Спрашивайте перед каждым изменением',
  'settings.ai.options.edit_files_without_asking.08674c9f': 'Редактируйте файлы, не спрашивая',
  'settings.ai.options.everything_without_asking.d14adf38': 'Все без вопросов',
  'settings.ai.options.value_utility.6fb6bae8': '{value0} · утилита',
  'settings.ai.options.script_value_value.97c5d924': 'Скрипт: {value0}{value1}',
  'settings.scripts.AutomationsEditor.automations.ad1fb9ec': 'Автоматизация',

  'settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15': 'Автоматизации пока нет.',
  'settings.scripts.AutomationsEditor.off.ca7981b4': 'Выкл.',
  'settings.scripts.AutomationsEditor.delete_this_automation.76539f9f': 'Удалить эту автоматизацию',
  'settings.scripts.AutomationsEditor.run_this_automation.25a70adc': 'Запустите эту автоматизацию',
  'settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f':
    'Выкл. оставляет его здесь, не запуская.',
  'settings.scripts.AutomationsEditor.name.dcd1d522': 'Имя',
  'settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc':
    'Как он называется здесь и в списке запускаемых скриптов.',
  'settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8': 'например {literal0}',
  'settings.scripts.AutomationsEditor.when.cf9c7aa2': 'Когда',
  'settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf':
    'Что должно произойти, чтобы скрипт запустился.',
  'settings.scripts.AutomationsEditor.note_types.52d728fb': 'Типы заметок',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4':
    'Через запятую. Только ноты, чья фронтальная часть является одной из этих. Пустой является любая нота.',
  'settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4': 'например {literal0}',
  'settings.scripts.AutomationsEditor.folders.c4d6bb20': 'Папки',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774':
    'Через запятую. Только заметки где-либо под одним из них. Пустота есть где угодно.',
  'settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d': 'например {literal0}',
  'settings.scripts.AutomationsEditor.property.40040cb1': 'Свойство',
  'settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04':
    'Только заметки с этим свойством. Необязательный.',
  'settings.scripts.AutomationsEditor.e_g_area.95b1c988': 'например {literal0}',
  'settings.scripts.AutomationsEditor.equals.f939ae3d': 'Равно',
  'settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f':
    '…удерживающий это значение или одно из его значений. Пусто — любое значение.',
  'settings.scripts.AutomationsEditor.e_g_home.a9f31279': 'например {literal0}',
  'settings.scripts.AutomationsEditor.script.102acc10': 'Скрипт',
  'settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704':
    'Скрипт, который запускается автоматизацией.',
  'settings.scripts.AutomationsEditor.choose_script.e582e7b2': 'Выбрать скрипт...',
  'settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d':
    'Найдите скрипты, которые запускает эта автоматизация.',
  'settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9':
    'Этот скрипт не принимает никаких параметров.',
  'settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590': 'Максимум каждые (секунды)',
  'settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf':
    'За одну заметку. Изменения между ними собираются в один прогон в конце. 0 запускается при каждом изменении.',
  'settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225':
    'Также для изменений с других устройств',
  'settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2':
    'Выключено: изменение, полученное при синхронизации, здесь ничего не вызывает: оно уже выполнено на устройстве, на котором оно было сделано.',
  'settings.scripts.AutomationsEditor.add_automation.537c3ee4': 'Добавить автоматизацию',
  'settings.scripts.AutomationsEditor.add_another_automation.78aa262d':
    'Добавить еще одну автоматизацию',
  'settings.scripts.AutomationsEditor.delete_automation.f71084e7': 'Удалить автоматизацию',
  'settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0':
    'Удалить {value0}? Его скрипт останавливается\n        работает сам по себе. Это невозможно отменить.',
  'settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a': 'Скрипт еще не выбран',
  'settings.scripts.AutomationsEditor.no_description.06a69482': 'Нет описания.',
  'settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925':
    '{value0} · по умолчанию равно {value1}',
  'settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78': 'Кнопки заголовка',

  'settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4': 'Безымянная кнопка',

  'settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275':
    'Переместить раньше — уже первый',
  'settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10':
    'Переместить ранее в заголовок',
  'settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45':
    'Переместить позже — уже последний',
  'settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d':
    'Перенести позже в шапку',
  'settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e': 'Изменить эту кнопку',
  'settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516': 'Добавить еще одну кнопку',
  'settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3':
    'Кнопок в заголовке пока нет',
  'settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f':
    'Команда или скрипт в выбранных вами заметках.',
  'settings.scripts.HeaderButtonsEditor.add_button.c0f290f3': 'Добавить кнопку',
  'settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8':
    'Добавьте кнопку заголовка и настройте ее',
  'settings.scripts.HeaderButtonsEditor.new_button.c499cbe3': 'Новая кнопка',
  'settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80': 'Что он запускает',
  'settings.scripts.HeaderButtonsEditor.runs.848f54e8': 'Бежит',
  'settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412':
    'Команда из любого места Obsidian или одного из ваших скриптов.',
  'settings.scripts.HeaderButtonsEditor.name.dcd1d522': 'Имя',
  'settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef':
    'Отображается как во всплывающей подсказке кнопки, так и в меню, куда она не помещается.',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b':
    'Отображается на кнопке или в виде ее всплывающей подсказки, если она представляет собой только значок.',
  'settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.icon.a35abcd6': 'Икона',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8':
    'Отображается на кнопке в шапке.',
  'settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06':
    'Выбирайте иконку из всего набора, по картинке или по названию.',
  'settings.scripts.HeaderButtonsEditor.command.71316697': 'Команда',
  'settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f':
    'Команда запуска кнопки.',
  'settings.scripts.HeaderButtonsEditor.choose_command.ea49d680': 'Выберите команду...',
  'settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77':
    'Найдите в каждой команде Obsidian ту, которую запускает эта кнопка.',
  'settings.scripts.HeaderButtonsEditor.icon_only.7a047008': 'Только значок',
  'settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5':
    'Оставьте имя в заголовке, поскольку заголовок уже заполнен.',
  'settings.scripts.HeaderButtonsEditor.script.102acc10': 'Скрипт',
  'settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c':
    'Скрипт, который запускает кнопка.',
  'settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2': 'Выбрать скрипт...',
  'settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4':
    'Найдите в скриптах тот, который запускает эта кнопка.',
  'settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9':
    'Этот скрипт не принимает никаких параметров.',
  'settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1': 'Где это показано',
  'settings.scripts.HeaderButtonsEditor.on_every_note.d761c688': 'На каждой ноте',
  'settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572':
    'Независимо от его типа, тегов или папки.',
  'settings.scripts.HeaderButtonsEditor.note_types.52d728fb': 'Типы заметок',
  'settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.folders.c4d6bb20': 'Папки',
  'settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.tags.1331275b': 'Теги',
  'settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4':
    'Через запятую, с # или без него. Заметки с одним из них или вложенным под ним тегом также отображают эту кнопку.',
  'settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318': 'Также в других файлах',
  'settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c':
    'PDF-файлы, холсты, книги и другие файлы открываются во вкладке, насколько достигают ее папки и теги. У них нет типа или свойств.',
  'settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87':
    'Только тогда, когда его свойства',
  'settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754':
    'В заметке они также должны быть в заглавной части.',
  'settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb':
    'Покажите его только в заметках, чья заглавная тема подходит, например, к статусу или заполненной дате.',
  'settings.scripts.HeaderButtonsEditor.add_condition.60a0d835': 'Добавить условие',
  'settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa':
    'Запросить еще одно свойство заметки',
  'settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b': 'Необходимые условия',
  'settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1':
    'Должна ли заметка соответствовать всем приведенным ниже условиям или любому из них.',
  'settings.scripts.HeaderButtonsEditor.property.40040cb1': 'Свойство',
  'settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56': 'например {literal0}',
  'settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189': 'Удалить это условие',
  'settings.scripts.HeaderButtonsEditor.delete.e2d0a549': 'Удалить',
  'settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9': 'Удалить эту кнопку',
  'settings.scripts.HeaderButtonsEditor.done.11a6767d': 'Готово',
  'settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87':
    'Закройте это окно; изменения сохраняются по мере их внесения',
  'settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880': 'Удалить кнопку заголовка',
  'settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26':
    'Удалить {value0}? Оно исчезает из каждого\n        заголовок заметки, в котором оно было. Это невозможно отменить.',
  'settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee': 'Команда',
  'settings.scripts.HeaderButtonsEditor.a_script.1ccd820b': 'Скрипт',
  'settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7': 'Команда еще не выбрана',
  'settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a': 'Скрипт еще не выбран',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848':
    'Через запятую. В заметках, чье вступление к типу является одним из этих, отображается кнопка.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3':
    'Ни одна заметка в этом хранилище не имеет типа {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78':
    'Ни одна заметка в этом хранилище не имеет типа {value0}.',
  'settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815':
    '{value0} Используемые типы: {value1}.',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44':
    'Через запятую. В заметках под одним из них также отображается кнопка. А * означает ',
  'settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a':
    'любая папка, ** для любой глубины: {literal0}.',
  'settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9':
    'В этом хранилище нет папки {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1':
    'В этом хранилище нет папок {value0}.',
  'settings.scripts.HeaderButtonsEditor.is.fa51fd49': 'является',
  'settings.scripts.HeaderButtonsEditor.is_not.e1bf1560': 'не',
  'settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1': 'заполнено',
  'settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d': 'пусто',
  'settings.scripts.HeaderButtonsEditor.all_of_them.29c88933': 'Все они',
  'settings.scripts.HeaderButtonsEditor.any_one.4013adf2': 'Любой',
  'settings.scripts.HeaderButtonsEditor.no_description.06a69482': 'Нет описания.',
  'settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925':
    '{value0} · по умолчанию равно {value1}',
  'settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819':
    'Назовите свойство переднего плана; до тех пор это условие игнорируется.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b':
    'Заметки, для которых указано {value0}.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a':
    'Заметки, у которых {value0} пусто или отсутствует.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0':
    'Заметки, для которых {value0} отличается от "{value1}", отсутствуют.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f':
    'Заметки, для которых {value0} равно "{value1}", или содержат их в списке.',
  'settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908':
    'Введите значение, которое должно иметь {value0}.',
  'settings.scripts.ScriptLibrary.library.dc20b3d5': 'Библиотека',

  'settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644':
    'Скрипты отключены. Включите их в разделе «Общие», чтобы увидеть, что находится в папке.',
  'settings.scripts.ScriptLibrary.filter.638e249f': 'Фильтр',
  'settings.scripts.ScriptLibrary.by_name_or_description.95a3575e': 'По имени или описанию.',
  'settings.scripts.ScriptLibrary.e_g_archive.a525e8b2': 'например {literal0}',
  'settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0':
    'Ни один скрипт не соответствует этому.',
  'settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa': 'В папке пока нет скриптов.',
  'settings.scripts.ScriptLibrary.refused.66b87354': 'Отказался',
  'settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168': 'Ожидание подтверждения',
  'settings.scripts.ScriptLibrary.off.ca7981b4': 'Выкл.',
  'settings.scripts.ScriptLibrary.toolbar.451aa51a': 'Панель инструментов',
  'settings.scripts.ScriptLibrary.startup.65d48235': 'Запускать',
  'settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87':
    'На этом устройстве оно изменилось без записи: посмотрите и подтвердите',
  'settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c':
    'Проверьте доверие выполнения на этом устройстве, не запуская скрипт.',
  'settings.scripts.ScriptLibrary.run_this_script_now.ef501cea': 'Запустите этот скрипт сейчас',
  'settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b':
    'Добавьте кнопку заголовка, которая запускает этот скрипт',
  'settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d':
    'Описания пока нет — добавьте строку {literal0} в начало файла.',
  'settings.scripts.ScriptLibrary.no_parameters.3a7003b7': 'Нет параметров',
  'settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d':
    'На панели инструментов рядом с строкой заголовка {literal0}.',
  'settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed': 'Убрать с панели инструментов',
  'settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91':
    'Разместите его на панели инструментов: слева на ленте и над клавиатурой на телефоне.',
  'settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b':
    'Запускается при запуске по строке заголовка {literal0}.',
  'settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9':
    'Перестаньте запускать его, когда запустится Obsidian.',
  'settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac':
    'Запускайте его каждый раз при запуске Obsidian.',
  'settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6': 'Включить скрипты',
  'settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9':
    'Разрешить регистрацию скриптов JavaScript, хранящихся в папке хранилища, в качестве команд и инструментов искусственного интеллекта.',
  'settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1':
    'Политика синхронизированных скриптов',
  'settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f':
    'Персональная синхронизация: до подтверждения на этом устройстве. Общие и агентские подключения: отказаться. Запустите скрипт вручную, чтобы просмотреть его точные байты. Отсутствующее происхождение требует восстановления; утверждения никогда не синхронизируются.',
  'settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d': 'Папка скриптов',
  'settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89':
    'Папка Vault, содержащая файлы скриптов .js.',
  'settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b': 'например {literal0}',
  'settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea':
    'Подтверждайте скрипты с других устройств',
  'settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac':
    '1 скрипт ожидает подтверждения на этом устройстве.',
  'settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9':
    'Скрипты {value0} ожидают подтверждения на этом устройстве.',
  'settings.scripts.ScriptsGeneral.review.aff0766a': 'Обзор',

  'settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27':
    'AI Agent → Режимы инструментов по умолчанию',

  'settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e':
    'Скрипт, который появляется или изменяется без записи на этом устройстве — через Obsidian Sync, iCloud, Syncthing, git — ждет, пока вы посмотрите на него и не подтвердите его здесь. До тех пор кнопки, автоматизация, автозагрузка и агенты его не запускают. Скрипты, которые вы пишете на этом устройстве, в редакторе или через Abele, считаются подтвержденными. Включение этого параметра принимает каждый скрипт в папке в том виде, в каком он есть сейчас. Подтверждения хранятся только на этом устройстве; выключение здесь забывает их, и только для этого устройства.',
  'settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec':
    'Скрипты по выделенным словам',
  'settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f':
    'Скрипты, прикрепленные к меню выбора книг, в этом порядке. До трех — по кнопке каждая; больше сложить в одно меню. Остальные скрипты остаются в разделе «Другой скрипт…».',
  'settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44':
    'Скрипты выбраны для меню выбора чата независимо от книг. Поддержка запуска чата пока не включена.',
  'settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7':
    'Скриптов пока нет: сначала добавьте один в папку скриптов.',
  'settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11':
    'В меню пока ничего нет.',
  'settings.scripts.SelectionScriptsSettings.script_value.804f5354': 'Скрипт: {value0}',
  'settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0':
    'Скрипт: {value0} — не найден',
  'settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682': 'Имя на панели',
  'settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4':
    'Выберите значок, который есть на панели.',
  'settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41': 'Уже первый',
  'settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10':
    'Переместите это вверх по меню',
  'settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12': 'Уже последний',
  'settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335':
    'Переместите его вниз по меню',
  'settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889': 'Убрать из меню',
  'settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79':
    'В меню по собственному заголовку ({value0}), после приведенных выше. Добавьте его в список, чтобы переименовать или дать ему место.',
  'settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b': 'Добавить в список',
  'settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711':
    'Поместите {value0} в список выше, чтобы переименовать или переместить его.',
  'settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4': 'Добавить скрипт',
  'settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f':
    'Найдите в своих скриптах тот, который можно добавить в меню.',
  'settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec': 'Убрать из меню',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83':
    'Убрать {value0} из меню для слов в {value1}? Сам скрипт остается.{value2}',
  'settings.scripts.StartupScriptsEditor.startup.65d48235': 'Запускать',
  'settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450':
    'Скрипты запускаются каждый раз при запуске Obsidian, один за другим в этом порядке, как только хранилище открыто. Скрипт, принимающий параметры, получает значения по умолчанию; тот, которому требуется значение без значения по умолчанию, пропускается. Поместите сюда скрипт с кнопкой включения на его карточке в библиотеке.',
  'settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa':
    'Не запускайте скрипты запуска',
  'settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c':
    'Пропускает их все, пока не переключится обратно. Если скрипт запуска зависает Obsidian, он также автоматически пропускается при следующем запуске Obsidian.',
  'settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7':
    'Скриптов пока нет: сначала добавьте один в папку скриптов.',
  'settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c':
    'Скриптов запуска пока нет.',
  'settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39':
    'Не найден в папке скриптов',
  'settings.scripts.StartupScriptsEditor.already_the_first.eab62d41': 'Уже первый',
  'settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e': 'Запустите его раньше',
  'settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12': 'Уже последний',
  'settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f': 'Запустить позже',
  'settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3':
    'Перестаньте запускать его при запуске',
  'settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f':
    'Запускается при запуске по собственному заголовку (@startup), после приведенных выше, по {value0}. Добавьте его в список, чтобы дать ему место.',
  'settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b': 'Добавить в список',
  'settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74':
    'Поместите {value0} в список выше, чтобы переместить его или выбрать его устройства.',
  'settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4': 'Добавить скрипт',
  'settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be':
    'Найдите в своих скриптах тот, который будет запускаться при запуске.',
  'settings.scripts.StartupScriptsEditor.every_device.9b626893': 'Каждое устройство',
  'settings.scripts.StartupScriptsEditor.computers.680cb3c6': 'Компьютеры',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2': 'Телефоны и планшеты',
  'settings.scripts.StartupScriptsEditor.every_device.17779e2b': 'каждое устройство',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d': 'телефоны и планшеты',
  'settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7': 'Хранить только на сервере',
  'settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724':
    'Локальное правило устройства. Он запускается только при предварительном просмотре и подтверждении; закрепленные, измененные и открытые файлы остаются здесь.',
  'settings.sync.ExternalFileRules.offload_folder.6566fece': 'Выгрузить папку',
  'settings.sync.ExternalFileRules.empty_means_all_folders.c907d956': 'Пусто означает все папки.',
  'settings.sync.ExternalFileRules.all_folders.226fd0e5': 'Все папки',
  'settings.sync.ExternalFileRules.file_types.696bc9a7': 'Типы файлов',
  'settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a':
    'Расширения, разделенные запятыми. Пусто означает все типы вложений.',
  'settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d': 'pdf, epub, jpg',
  'settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb': 'Минимальный размер (МиБ)',
  'settings.sync.ExternalFileRules.not_opened_for_days.42eb5259': 'Не открывается несколько дней',
  'settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0':
    '0 игнорирует возраст. Файлы без записанного открытия исключаются, если установлен возраст.',
  'settings.sync.ExternalFileRules.review_matching_files.f7400143':
    'Просмотрите соответствующие файлы',
  'settings.sync.ExternalFileRules.see_every_file_and_the.b398409d':
    'Прежде чем вносить изменения, просмотрите каждый файл и предполагаемое пространство.',
  'settings.sync.ExternalFileRules.preview.324b134f': 'Предпросмотр',
  'settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2':
    'Перечислите соответствующие файлы и проверьте место перед выгрузкой.',
  'settings.sync.SelectiveSync.what_this_device_syncs.979d00ce':
    'Что синхронизирует это устройство',
  'settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522':
    'Заметки и холсты всегда путешествуют. Все остальное — выбор этого устройства — телефон может пропускать видео и сохранять все заметки.',
  'settings.sync.SelectiveSync.largest_file.5cd59717': 'Самый большой файл',
  'settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7':
    'Файлы большего размера (в мегабайтах) пропускаются. Оставьте его пустым, чтобы взять все.',
  'settings.sync.SelectiveSync.no_limit.f7fcff0d': 'Без ограничений',
  'settings.sync.SelectiveSync.obsidian_settings.b1370814': 'Обсидиановые настройки',
  'settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56':
    'Папки, которые это устройство пропускает',
  'settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89':
    'Ничего из папки, указанной здесь, не загружается и не загружается на это устройство. Другие устройства все еще держат его.',
  'settings.sync.SelectiveSync.skipped_by_this_device.a7679073': 'Пропущено этим устройством.',
  'settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c':
    'Синхронизируйте эту папку на этом устройстве еще раз',
  'settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be':
    'Это устройство синхронизирует каждую папку.',
  'settings.sync.SelectiveSync.skip_a_folder.1f3e8658': 'Пропустить папку',
  'settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43':
    'Выберите папку, которую это устройство должно оставить в покое.',
  'settings.sync.SelectiveSync.e_g_archive_video.b35fc660': 'например {literal0}',
  'settings.sync.SelectiveSync.skip.28d03596': 'Пропускать',
  'settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063':
    'Прекратить синхронизацию этой папки на этом устройстве',
  'settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698':
    'Назовите папку, которую нужно пропустить в первую очередь',
  'settings.sync.SelectiveSync.images.be7e2f20': 'Изображения',
  'settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e':
    'Скриншоты, фотографии, рисунки и схемы.',
  'settings.sync.SelectiveSync.audio.bc1b8890': 'Аудио',
  'settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181': 'Записи и голосовые заметки.',
  'settings.sync.SelectiveSync.video.d534be82': 'Видео',
  'settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb':
    'Самая тяжелая вещь, которую обычно держит хранилище.',
  'settings.sync.SelectiveSync.pdfs.211eae3f': 'PDF-файлы',
  'settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99': 'Документы, инструкции и сканы.',
  'settings.sync.SelectiveSync.everything_else.cd6c5f59': 'Все остальное',
  'settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625':
    'Вложения неуказанного типа и папка скриптов.',
  'settings.sync.SelectiveSync.app_settings.d43fb8a9': 'Настройки приложения',
  'settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd':
    'Редактор и поведение файлов из app.json.',
  'settings.sync.SelectiveSync.appearance.3907fa7f': 'Появление',
  'settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304':
    'Тема, ее фрагменты и выбор шрифта.',
  'settings.sync.SelectiveSync.hotkeys.c15f1530': 'Горячие клавиши',
  'settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8':
    'Ярлыки, которые вы связали.',
  'settings.sync.SelectiveSync.core_plugins.f2e957b0': 'Основные плагины',
  'settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676':
    'Какие из собственных плагинов Obsidian включены.',
  'settings.sync.SelectiveSync.community_plugins.ab574402': 'Плагины сообщества',
  'settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f':
    'Сами плагины, поэтому на новое устройство устанавливается то, что работает на этом.',
  'settings.sync.SelectiveSync.plugin_settings.95d7fb37': 'Настройки плагина',
  'settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b':
    'Что каждый плагин сообщества содержит в своем data.json.',
  'settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee':
    'Это устройство хранит свои настройки в переименованной папке конфигурации {value0}, и синхронизация пока не выполняется: настройки Obsidian остаются на этом устройстве, а те, что на сервере, остаются в покое.',
  'settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882':
    'Какая часть папки конфигурации перемещается. Рабочая область, график и кеш каждого плагина остаются там, где они есть, на каждом устройстве.',
  'settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2':
    'Ничего не изменилось: {value0}',
  'settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c': 'Что будет отправлено',
  'settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4': 'Носит с собой ключ',
  'settings.transfer.TransferPreviewModal.keys.f0d66a79': 'Ключи',
  'settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018':
    'Здесь показано в маске; они едут в полном объеме, из-за чего передача заблокирована.',
  'settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f': 'Прочитать передачу',
  'settings.transfer.TransferScanModal.use_the_camera.429bb22e': 'Используйте камеру',
  'settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce':
    'Наведите камеру на коды на другом устройстве.',
  'settings.transfer.TransferScanModal.take_a_photo.996e6a73': 'Сфотографироваться',
  'settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87':
    'Сфотографируйте код или выберите его изображение.',
  'settings.transfer.TransferScanModal.open_a_file.3b31f677': 'Открыть файл',
  'settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7':
    'Прочитайте передачу, сохраненную в виде файла на другом устройстве.',
  'settings.transfer.TransferScanModal.paste_the_text.d98782e3': 'Вставьте текст',
  'settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa':
    'Вставьте передача в виде текста вместо чтения кода',
  'settings.transfer.TransferScanModal.abl.c834a09f': 'ABL1:…',
  'settings.transfer.TransferScanModal.codes_read.99b98121': 'коды читаются',

  'settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908':
    'Еще ничего не читал. Другое устройство показывает коды; этот собирает их в любом порядке.',
  'settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91':
    'Эта передача имеет ключ, поэтому она заблокирована. Введите код, показанный на другом устройстве.',
  'settings.transfer.TransferScanModal.characters.2ad81da8': '8 символов',

  'settings.transfer.TransferScanModal.what_to_do_with_what.99215800':
    'Что делать с тем, что уже есть',
  'settings.transfer.TransferScanModal.keep_value.c1cdcb02': 'Сохранить {value0}',
  'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a':
    'Пока нет на этом устройстве',
  'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324':
    'Заменяет тот, который уже есть на этом устройстве.',
  'settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c': 'Уже здесь то же самое',
  'settings.transfer.TransferScanModal.unlock.4ac709aa': 'Разблокировать',
  'settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253':
    'Откройте передача с этим кодом',
  'settings.transfer.TransferScanModal.apply.31e392d1': 'Применить',
  'settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186':
    'Передача получена не целиком. Прочитайте коды заново.',
  'settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4':
    'Этот код не открывает эту передачу.',
  'settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0':
    'Здесь все, что не упомянуто в передаче, оставлено в покое.',
  'settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4':
    'Здесь ничего не будет удалено: перенос охватывает все.',
  'settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876':
    '{value0}: {value1}. Скрипты, навыки и промпты никогда не удаляются.',

  'settings.transfer.TransferScanModal.value_to_store_for_the.22f67128':
    '{value0} для хранения выбранных элементов.',
  'settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7':
    'Нет ключей для хранения выбранных элементов.',
  'settings.transfer.TransferScanModal.just_now.7ddb44d8': 'прямо сейчас',
  'settings.transfer.TransferScanModal.today_at_value.c0d04ee3': 'сегодня в {value0}',
  'settings.transfer.TransferScanModal.already_applied.ca602d60': 'Уже применено',
  'settings.transfer.TransferScanModal.applying.3329a9bb': 'Применение…',
  'settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead':
    'Запишите их в настройки этого хранилища.',
  'settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d':
    'Отметьте что-нибудь, чтобы применить в первую очередь',
  'settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e':
    'Эти настройки невозможно применить.',
  'settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870':
    'Здесь нет камеры. Сфотографируйте код или вставьте передача в виде текста.',
  'settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f':
    'В этом файле нет передачи настроек.',
  'settings.transfer.TransferScanModal.no_code_in_that_picture.34801264': 'На картинке нет кода.',
  'settings.transfer.TransferSendModal.send_to_another_device.71ef2876':
    'Отправить на другое устройство',
  'settings.transfer.TransferSendModal.name_for_the_other_device.33a35391':
    'Имя для другого устройства',
  'settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846':
    'Сервер создает для него собственное устройство, и в списке устройств хранилища оно отображается под этим именем.',
  'settings.transfer.TransferSendModal.other_device.76d065a6': 'Другое устройство',
  'settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48':
    'Запросить у сервера собственное устройство для другой стороны…',
  'settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7':
    'Введите это на другом устройстве',
  'settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606':
    'Код передачи {value0} из {value1}',
  'settings.transfer.TransferSendModal.previous_code.9073b55e': 'Предыдущий код',
  'settings.transfer.TransferSendModal.next_code.2924d04c': 'Следующий код',
  'settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8':
    'Хватит перебирать коды',
  'settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219':
    'Перебирать коды самостоятельно',
  'settings.transfer.TransferSendModal.make_the_codes.05fce439': 'Сделайте коды',
  'settings.transfer.TransferSendModal.have_the_server_make_the.26277032':
    'Попросите сервер создать другое устройство и показать коды.',
  'settings.transfer.TransferSendModal.give_the_other_device_a.62f36130':
    'Сначала дайте имя другому устройству',
  'settings.transfer.TransferSendModal.save_a_file.637ed29a': 'Сохранить файл',
  'settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0':
    'Сохраните передачу как файл за пределами синхронизации, чтобы отправить ее по своему усмотрению.',
  'settings.transfer.TransferSendModal.show_the_codes.1eb16a33': 'Показать коды',

  'settings.transfer.TransferSendModal.copy_the_text.a9c0e598': 'Скопируйте текст',
  'settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d':
    'Скопируйте всю передачу, чтобы вставить на другое устройство.',
  'settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8':
    ' Код выше разблокирует его с другой стороны.',
  'settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601':
    'Прочтите код или скопируйте текст.{value0}',
  'settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2': {
    one: '{count} код, показ по очереди. Можно скопировать текст и обойтись без камеры.{value1}',
    few: '{count} кода, показ по очереди. Можно скопировать текст и обойтись без камеры.{value1}',
    many: '{count} кодов, показ по очереди. Можно скопировать текст и обойтись без камеры.{value1}',
    other: '{count} кода, показ по очереди. Можно скопировать текст и обойтись без камеры.{value1}',
  },
  'settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f': {
    one: 'Для этой передачи нужно кодов: {count} — слишком много, чтобы фотографировать каждый. Скопируйте текст в сообщение или сохраните его в файл и отправьте файл.{value1}',
    few: 'Для этой передачи нужно кодов: {count} — слишком много, чтобы фотографировать каждый. Скопируйте текст в сообщение или сохраните его в файл и отправьте файл.{value1}',
    many: 'Для этой передачи нужно кодов: {count} — слишком много, чтобы фотографировать каждый. Скопируйте текст в сообщение или сохраните его в файл и отправьте файл.{value1}',
    other:
      'Для этой передачи нужно кодов: {count} — слишком много, чтобы фотографировать каждый. Скопируйте текст в сообщение или сохраните его в файл и отправьте файл.{value1}',
  },
  'settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659':
    'Не удалось скопировать текст. Выберите его ниже и скопируйте или сохраните как файл.',
  'settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c':
    'Передача скопирована. Вставьте её на другом устройстве.',
  'settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07':
    'Откройте его в разделе «Читать передача» на другом устройстве.',
  'settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2':
    'Сохранено в {value0}. {value1}.',
  'settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d':
    'Сохранено как {value0} в скрытой папке этого хранилища, которую Abele Sync не хранит. ',
  'settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef':
    '{value0} и удалите его после прочтения.',
  'settings.transfer.TransferSendModal.could_not_save_it_value.14315a58':
    'Не удалось сохранить: {value0}',
  'settings.rich.bc6ba5473fff4aa8':
    'Скрипт, в первых строках которого написано {slot0}, является правилом: он возвращает {slot1}, список ошибок, и может возвращать {slot2}, новый текст заметки. Он указан выше вместе с остальными. На странице «Скрипты» документации показан один из них.',
  'settings.rich.ae545f75ff9437be': 'В этом хранилище нет навыков. Навыки — это заметки с {slot0}.',
  'settings.rich.3cf5061d7d4aaae2':
    'Ключи и токены для запросов API. Агент AI использует {slot0} в вызовах выборки, который заменяется фактическим значением. Надежно хранится в брелке.',
  'settings.rich.59db234df027f515':
    'Скрипты, которые запускаются сами по себе, когда с заметкой что-то происходит: задача выполнена, заметка какого-то типа изменилась. Скрипт читает произошедшее как {slot0}. Параметры принимают {slot1} и любое начальное поле заметки. Они запускаются на устройстве, на котором было внесено изменение; собственные записи скрипта никогда больше не вызывают ту же автоматизацию.',
  'settings.rich.5c124ccc61dc59ea':
    'Кнопки над текстом заметки, которые запускают команду или скрипт для выбранных вами заметок в указанном порядке. Скрипту можно передать значения заметки: {slot0} или любого свойства {slot1}.',
  'settings.rich.225479f70a17e374':
    'Каждый скрипт в папке скриптов. Скрипт описывает себя в блоке комментариев в верхней части файла: {slot0}, {slot1}, {slot2} и по строке {slot3} для каждого принимаемого значения. Пин помещает скрипт на панель инструментов: значок на левой ленте на компьютере и место на панели инструментов над клавиатурой на телефоне — то же самое делает {slot4} в его заголовке. Кнопка питания запускает скрипт каждый раз при запуске Obsidian; {slot5} в шапке делает то же самое, а вкладка Автозагрузка приводит их в порядок.',
  'settings.rich.82dd523dc663e313':
    'Обнаружены скрипты {slot0}. Настройте режимы инструментов в {slot1} или для каждого чата в модальном окне разрешений.',
  'settings.terms.keySaved': 'Ключ сохранён',
  'settings.terms.noKeyYet': 'ключа еще нет',
  'settings.terms.thisKey': 'этот ключ',
  'settings.terms.none': 'никто',
  'settings.terms.theSecret': 'секрет',
  'settings.terms.unnamedAutomation': 'эта безымянная автоматика',
  'settings.terms.unnamedButton': 'эта безымянная кнопка',
  'settings.terms.password': 'пароль',
  'settings.terms.link': 'связь',
  'settings.terms.book': 'книга',
  'settings.terms.chat': 'чат',
  'settings.terms.missingSuffix': ' · отсутствующий',
  'settings.terms.resetsSuffix': ' · сбрасывает ',
  'settings.metadata.c99cb7557b2bd7cb': 'Чтение данных',
  'settings.metadata.ba35eb1f0c41c920': 'Анализ данных',
  'settings.metadata.93b5e95f0841a6c1': 'Выделения из книги',
  'settings.metadata.9b9ab66d2dc6d4e6': 'Выделить в книге',
  'settings.metadata.836cba1ac2f246a0': 'Изменить выделение',
  'settings.metadata.6bbd1e58f841181f': 'Удалить выделение',
  'settings.metadata.1d5729de03eb270a': 'Закладка в книге',
  'settings.metadata.d9e8263863cd7c1a': 'Вкладки книг',
  'settings.metadata.c8e5758cffa93be0': 'Содержание книги',
  'settings.metadata.3e6c3299627e72e5': 'Читать книгу',
  'settings.metadata.efb806b8e248de86': 'Поиск книги',
  'settings.metadata.973b70df8c6835ab': 'Показать в книге',
  'settings.metadata.e1b19c0fcc092bb5': 'Список книг',
  'settings.metadata.3824a9f4dafe92c6': 'Холст',
  'settings.metadata.ca58ee75a82eb866': 'Диаграмма Документы',
  'settings.metadata.1f104d4e483afe57': 'Копировать файл',
  'settings.metadata.f1eb5a8241e4bf26': 'Создать файл',
  'settings.metadata.016fc69b8f33e22e': 'Документация по API скриптов',
  'settings.metadata.e3de1e15d36b9e54': 'Создать скрипт',
  'settings.metadata.cf8c8078d8db9550': 'Текущее местоположение',
  'settings.metadata.1e814554ca1b586f': 'Прочитать презентацию',
  'settings.metadata.cf31f39501ec79cc': 'Презентации',
  'settings.metadata.07bcab5dd6c2b3ac': 'Создать колоду',
  'settings.metadata.a34f02e3fb7f55ab': 'Редактировать слайд',
  'settings.metadata.ee9a26182331bd59': 'Проверьте посадку деки',
  'settings.metadata.4c3cd91f9873a96b': 'Открытая презентация',
  'settings.metadata.3ecb6f7da6cd8b57': 'Делегировать агенту',
  'settings.metadata.e1e5fe2043bd3003': 'Удалить файл',
  'settings.metadata.072bcdf480cf935b': 'Редактировать документ Word',
  'settings.metadata.3a2860ece5a4ee0b': 'Слово',
  'settings.metadata.d62c5e04e2041963': 'Вкладки слов',
  'settings.metadata.fdbd5cb0402f63f0': 'Читать документ Word',
  'settings.metadata.abcfc9b08f141d57': 'Поиск в документе Word',
  'settings.metadata.8fc231e28ab03931': 'Загрузить изображение',
  'settings.metadata.d5501e84dd2baf5a': 'Скачать файл',
  'settings.metadata.c3df84ddf2927d7f': 'Посмотрите на рисунок',
  'settings.metadata.c769c50ec11b66ce': 'Редактировать файл',
  'settings.metadata.5597753f9c2ffeb8': 'Редактировать изображение',
  'settings.metadata.b9aca9af90312aa4': 'Изменить выбор',
  'settings.metadata.529285444d7e58bf': 'Оцените JavaScript',
  'settings.metadata.e663529b7a08617b': 'Перенос чертежей Excalidraw',
  'settings.metadata.014b08ed6d8976df': 'Получить URL-адрес',
  'settings.metadata.d20890b1e4db1fa1': 'Найти файлы',
  'settings.metadata.a6bd489d95504499': 'Забывать',
  'settings.metadata.0f44b5601ade4f85': 'Создать изображение',
  'settings.metadata.1606207c55304e06': 'Геокодирование',
  'settings.metadata.bf4c6dda970987a0': 'Найти места',
  'settings.metadata.06cc7177f48987cc': 'Построить маршрут',
  'settings.metadata.abce462b78197fc5': 'Осмотреть вид',
  'settings.metadata.1f728b52096a2eb0': 'Заметки к ворсу',
  'settings.metadata.f0c84f13ed58b1d6': 'Исправить проблемы с ворсом',
  'settings.metadata.ede087fd8f5ce83a': 'Список рабочей области',
  'settings.metadata.535843b2c2fee0eb': 'Список каталогов',
  'settings.metadata.002cc66337cf3764': 'Переместить/переименовать файл',
  'settings.metadata.7ac362063b9f2046': 'Ноды',
  'settings.metadata.1e8d18f62f2d2a2f': 'Открыть файл',
  'settings.metadata.c0d019c19251efca': 'Запрос документов',
  'settings.metadata.9a72221a27476f3e': 'Вопросы',
  'settings.metadata.fb9b615c6b482637': 'Чтение файла',
  'settings.metadata.6562fb21e7fbb468': 'Читать изображение',
  'settings.metadata.7b4a3b51f8248d49': 'Чтение журналов',
  'settings.metadata.75ce2bbc2da8977a': 'Чтение обратных ссылок',
  'settings.metadata.a50358c35c21caf0': 'Чтение транзакций',
  'settings.metadata.6f987478bf258d46': 'Чтение задач',
  'settings.metadata.8096a7bd9a09e11f': 'Помнить',
  'settings.metadata.95e154398a4bc009': 'Заменять',
  'settings.metadata.ddf641f9a5ee4177': 'Предложить доработку ответа',
  'settings.metadata.029320ad166c1807': 'Скриншот',
  'settings.metadata.40945d7914b5838d': 'Форма ответа',
  'settings.metadata.17434a9251409137': 'Чтение настроек',
  'settings.metadata.7fe866d491ae7890': 'Запись настроек',
  'settings.metadata.6df1bb18a59ab97d': 'Навык',
  'settings.metadata.118469284c824130': 'Шаблоны документов',
  'settings.metadata.f7b314c3f5d5dcea': 'Шаблоны списков',
  'settings.metadata.23febe05ea52c943': 'Применить шаблон',
  'settings.metadata.d04fc7d7e19702f8': 'Веб-поиск',
  'settings.metadata.d78cd87c20261047': 'Записать файл',
  'settings.metadata.ff4e3889f363a511': 'Запись ячеек рабочей книги',
  'settings.metadata.48d53635551c8fd4': 'Эксель',
  'settings.metadata.9a8eb492fd32afbe': 'Листы рабочей тетради',
  'settings.metadata.51feedc6468c9521': 'Чтение диапазона книги',
  'settings.metadata.6b11523da566fd08': 'Поиск в книге',
  'settings.metadata.8463eb4799ceda94': 'Создать ZIP-архив',
  'settings.metadata.ee52497854a67e54': 'Чтение файла GitHub',
  'settings.metadata.7ba6f2c8e75022bd': 'GitHub фиксирует',
  'settings.metadata.c97212ae47ab4694': 'Код Grep в версии',
  'settings.metadata.eff04b0872a1b825': 'Прочитать элемент GitHub',
  'settings.metadata.9632f6701a8ca357': 'Файлы запросов на извлечение',
  'settings.metadata.ff48a92c96b73fa8': 'Поиск на GitHub',
  'settings.metadata.f5db8240ba9c07c2': 'Вкладки GitHub',
  'settings.metadata.0a876c393a858219': 'Показать на вкладке GitHub',
  'settings.metadata.47659c3dccc86dc6': 'Чтение файла',
  'settings.metadata.abc7e9892806b047': 'Файлы',
  'settings.metadata.9608dd142d9b10d7': 'Редактировать файл',
  'settings.metadata.997357233881bfb9': 'Записать файл',
  'settings.metadata.6990d3217b7749c8': 'Создать файл',
  'settings.metadata.28e18dc9db382d81': 'Удалить файл',
  'settings.metadata.f83e6d79cd9c3e10': 'Переместить файл',
  'settings.metadata.b60f1c7ad15c2b04': 'Копировать файл',
  'settings.metadata.930a81591b83ad25': 'Список каталогов',
  'settings.metadata.15d12bc10296dc2d': 'Найти файлы',
  'settings.metadata.87bb59ba2f92f2a5': 'Рабочая область',
  'settings.metadata.d515d2ee195fa943': 'Читать изображение',
  'settings.metadata.4190c0c7ec727064': 'Открыть файл',
  'settings.metadata.693ba7f5f3d9f77d': 'Просмотр приложения',
  'settings.metadata.dc37f2f4529c4136': 'Осмотреть вид',
  'settings.metadata.7711faa74a10416c': 'Веб-поиск',
  'settings.metadata.2975104784a401e3': 'Интернет',
  'settings.metadata.3ac575dcce244f93': 'Скачать изображение',
  'settings.metadata.9de4149fb9716cfc': 'Скачать файл',
  'settings.metadata.f911e414cf6bdfc5': 'GitHub',
  'settings.metadata.f7f0f6218e3ab3ce': 'Прочитать обращение или PR',
  'settings.metadata.046ceaf4f065a500': 'PR-файлы',
  'settings.metadata.d09648c6058a4c84': 'фиксирует',
  'settings.metadata.49c266baaaa70981': 'Поиск',
  'settings.metadata.b2cfbf5af10d5b5d': 'Показать во вкладке',
  'settings.metadata.9da7f76bc81d2f4e': 'Книги',
  'settings.metadata.119e66d117ae8f0c': 'Карты',
  'settings.metadata.1c9c87eec07e453b': 'Создать изображение',
  'settings.metadata.be7e2f20129365c2': 'Изображения',
  'settings.metadata.d9d12b04b3831c32': 'Редактировать изображение',
  'settings.metadata.6bea010c8fb418a4': 'Эвал Дж.С.',
  'settings.metadata.8fdd2ee8475e29bc': 'Основы',
  'settings.metadata.760ed96061ace03e': 'Делегат',
  'settings.metadata.a6d910ba93b7f894': 'Делегация',
  'settings.metadata.c3963aedaac6c83c': 'Память',
  'settings.metadata.2e19427030d9d43c': 'Документы диаграммы',
  'settings.metadata.7af023c43013b9a5': 'Документы',
  'settings.metadata.5afdd3f5b60d4d59': 'Шаблоны документов',
  'settings.metadata.9d45317393ff2163': 'Чтение журналов',
  'settings.metadata.19b88504fa831ce1': 'Данные заметок',
  'settings.metadata.8c87f5ea162d2e65': 'Чтение обратных ссылок',
  'settings.metadata.692a437039f64732': 'Чтение транзакций',
  'settings.metadata.b696d75511dc16f2': 'Финансы',
  'settings.metadata.d340a6c01b6f5fee': 'Чтение задач',
  'settings.metadata.b3a60e61a5233d05': 'Задачи',
  'settings.metadata.a249b2df7cba7a38': 'Шаблоны списков',
  'settings.metadata.56b564b75c7fdb48': 'Шаблоны',
  'settings.metadata.a0859ef85c0a0934': 'Применить шаблон',
  'settings.metadata.6dc2a1098225593e': 'Документация по API скриптов',
  'settings.metadata.74a883a037bc227f': 'Настройки',
  'settings.metadata.ea59135c1811dd4d': 'Создать скрипт',
  'settings.metadata.8d0e6b4ab60543cf': 'Скрипты',
  'settings.metadata.7000d0dc57ecf4be': 'Чтение результата',
  'settings.metadata.d9e66d2ce531344c': 'Файлы нод',
  'settings.metadata.e93372533f323b2f': 'Нода',
  'settings.metadata.6ded9685b4a797e6': 'Чтение файлов и поиск',
  'settings.metadata.562123f8976fe819': 'Редактировать файлы',
  'settings.metadata.aec2f93d67b7c4c5': 'Рабочие деревья',
  'settings.metadata.e90a0f8d49e203ea': 'Передать работу агенту ноды',
  'settings.metadata.b907a91b588b818c': 'Отладчик запускается',
  'settings.metadata.befc6e918047c85b': 'Ваши сообщения',
  'settings.metadata.f39b199601422405': 'Ответы агента',
  'settings.metadata.b6c1d862f9f75ec3': 'Оба',
  'settings.metadata.0ca9f9fe82be9456': 'Только черновик',
  'settings.metadata.65c3ce1551b7fdc4': 'Последние 4 сообщения',
  'settings.metadata.87e460223959d06f': 'Последние 10 сообщений',
  'settings.metadata.27ba0224f1937dcd': 'Весь разговор',
  'settings.metadata.abc9eb2fc4a07abf':
    'Пользовательский агент отправлен на это соединение. Пустой сохраняет значение по умолчанию. Мобильная потоковая передача может игнорировать это.',
  'settings.metadata.fcc01b1454819dec': 'Следит за темой',
  'settings.metadata.17ed08435ee39aec': 'Свобода',
  'settings.metadata.e4378e9c551f7f9c': 'Яркий',
  'settings.metadata.437b56da751ee02a': 'Позитрон, тихо',
  'settings.metadata.60acc53f13a5d1bf': 'Темный',
  'settings.metadata.2620b9ac0d72c634': 'Фиорд, темно-синий',
  'settings.metadata.3d5b0ed33cbfc204': 'Собственный стиль по URL',
  'settings.metadata.a57b3a3a34957437': 'Блок свойств',
  'settings.metadata.fdd539aca215e393': 'Заметка начинается с блока свойств (--- в первой строке).',
  'settings.metadata.a9aeaf057d72407f': 'Свойства можно прочитать',
  'settings.metadata.048c4415ef41ad0a': 'Обязательные свойства',
  'settings.metadata.ae43692b2a310b8e': 'Характеристики',
  'settings.metadata.079647a8b86e4378':
    'Через запятую. «имя: по умолчанию», чтобы внести исправление.',
  'settings.metadata.3c0c64e0fd626bca': 'Имеет тип заметки',
  'settings.metadata.a628c83f6a069d90':
    'В заметке указано, что это такое в свойстве типа — задача, человек, встреча. В списке типов значение должно быть одним из них.',
  'settings.metadata.40040cb181f7f0ee': 'Свойство',
  'settings.metadata.853362b96c0c33a4': 'Где тип написан.',
  'settings.metadata.2b04790e11e9360e': 'Разрешенные типы',
  'settings.metadata.fc2ba0dd4e23cdd0': 'Через запятую. Пустой пропускает любое значение.',
  'settings.metadata.21b111cbfe6e8fca': 'По умолчанию',
  'settings.metadata.0482acc3c6913a87':
    'Записал фикс в заметку без типа. Пусто: ничего не исправлено.',
  'settings.metadata.147e6bba43829675': 'Нет тегов',
  'settings.metadata.c03ca2fe828c431e':
    'Для хранилища, не использующего теги: свойство tags удалено исправлением; показано, что тег # в тексте обрабатывается вручную.',
  'settings.metadata.d4743e63e45dde22': 'Теги в тексте',
  'settings.metadata.587ccd181c91d2a8': 'Также найдите #теги, написанные в тексте.',
  'settings.metadata.fdca3c91c0898bd4': 'Нежелательные свойства',
  'settings.metadata.a4ef39b33278f6ef':
    'Ни одного из перечисленных объектов там нет. Исправление убирает их.',
  'settings.metadata.0a26d2a3c07531d9': 'Через запятую.',
  'settings.metadata.29a015b0a78abcc6': 'Пустая строка после свойств',
  'settings.metadata.56bae77505677e3c':
    'Между свойствами и текстом стоит ровно одна пустая строка.',
  'settings.metadata.6ca1bd19ad8e5df4': 'Нет заголовка первого уровня',
  'settings.metadata.a5b697a0a2aa9674':
    'Имя файла является заголовком, поэтому текст не имеет заголовка #. Исправление удаляет заголовок, повторяющий имя, и превращает любой другой заголовок в ##.',
  'settings.metadata.93df69cc2eaf6ff1': 'Даты написаны как даты',
  'settings.metadata.7ef1f2a6ca083e8a':
    'Перечисленные свойства содержат дату в формате YYYY-MM-DD. Исправление перезаписывает 2026-9-5, 05.09.2026 и [[2026-09-05]].',
  'settings.metadata.9024c197d84940e4': 'Ссылки',
  'settings.metadata.1d80ae7836ce9902': 'Кнопки заголовка',
  'settings.metadata.ad1fb9ec0cb3c7a4': 'Автоматизация',
  'settings.metadata.c20c37564e3f3409': 'Дневники',
  'settings.metadata.e95944e1c3c81e4c': 'Подключения к GitHub',
  'settings.CalendarsSettings.value_h_ago.d5aa4bb8': '{value0} ч. назад',
  'settings.CalendarsSettings.value_d_ago.0f70078c': '{value0} дн назад',
  'settings.CalendarsSettings.value_from_value_kept.419ae64a': '{value0} из {value1}, сохранено',
  'settings.CalendarsSettings.value_read_value.6e58c8af': '{value0}, загружено {value1}',
  'settings.GithubSettings.account_not_checked.d2a6562d': 'Аккаунт не проверен',
  'settings.GithubSettings.token_expires_within_seven_days.1b81c28c':
    'Срок действия токена истекает через семь дней.',
  'settings.LinterSettings.in_value.b63d3a91': 'в {value0}',
  'settings.LinterSettings.where_value_value.e534e0d0': 'где {value0}{value1}',
  'settings.LinterSettings.script_value.c5efe1d1': ' Скрипт: {value0}.',
  'settings.LinterSettings.only_value.e2625151': ' Только {value0}.',

  'settings.SecretsListModal.value_set.f4c8f3b4': 'Набор {value0}',
  'settings.SecretsListModal.value_synced.1785a4d0': '{value0} синхронизировано',
  'settings.TransferSettings.value_of_value.ca6c5e5f': '{value0} из {value1}',
  'settings.TransferSettings.value_selected.975acbfe': '{value0} выбрано',

  'settings.ai.interceptorList.matching_value.b4ca1a61': 'соответствие {value0}',

  'settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986':
    '{value0}…{value1} (символы {value2})',
  'settings.transfer.TransferScanModal.value_at_value.92c9c89a': '{value0} и {value1}',
  'settings.count.item': {
    one: '{count} элемент',
    few: '{count} элемента',
    many: '{count} элементов',
    other: '{count} элемента',
  },
  'settings.count.key': {
    one: '{count} ключ',
    few: '{count} ключа',
    many: '{count} ключей',
    other: '{count} ключа',
  },
  'settings.count.file': {
    one: '{count} файл',
    few: '{count} файла',
    many: '{count} файлов',
    other: '{count} файла',
  },
  'settings.count.code': {
    one: '{count} код',
    few: '{count} кода',
    many: '{count} кодов',
    other: '{count} кода',
  },
  'settings.count.prompt': {
    one: '{count} промпт',
    few: '{count} промпта',
    many: '{count} промптов',
    other: '{count} промпта',
  },
  'settings.count.scopeEntry': {
    one: '{count} запись области',
    few: '{count} записи области',
    many: '{count} записей области',
    other: '{count} записи области',
  },
  'settings.count.event': {
    one: '{count} событие',
    few: '{count} события',
    many: '{count} событий',
    other: '{count} события',
  },
  'settings.count.model': {
    one: '{count} модель',
    few: '{count} модели',
    many: '{count} моделей',
    other: '{count} модели',
  },
  'settings.count.button': {
    one: '{count} кнопка',
    few: '{count} кнопки',
    many: '{count} кнопок',
    other: '{count} кнопки',
  },
  'settings.count.tool': {
    one: '{count} инструмент',
    few: '{count} инструмента',
    many: '{count} инструментов',
    other: '{count} инструмента',
  },

  'settings.parts.fa11c9afc868fc1e': ' · сбрасывает {value0}',

  'settings.parts.520a5d3ab1d92888': ' {value0}',
  'settings.parts.9edb143e79ddd491': '(безымянный)',

  'settings.parts.951aaf14e2b23dff':
    ' Его заголовок {value0} по-прежнему помещает его в это меню; удалите эту строку из скрипта, чтобы скрыть ее.',
  'settings.parts.195dc73d2db93bf8': 'Это будет удалено',
  'settings.parts.778541341fcda9aa': 'Они будут удалены',

  'settings.metadata.86ed522daec49399': 'общий ИИ',
  'settings.metadata.8748f23993a86245': 'Голосовой ввод',
  'settings.metadata.2c4aed90f68a9826': 'Провайдеры ИИ',
  'settings.metadata.d110fe793fa72de1': 'Провайдеры изображений',
  'settings.metadata.279b44d2ab4b40c0': 'Агенты',
  'settings.metadata.22a7559f09bf8f82': 'MCP-серверы',
  'settings.metadata.e5f4cb8707719fbd': 'Сохраненные ключи',
  'settings.metadata.5f2e66e6539797d0': 'Промпты',
  'settings.metadata.f46ee86a068c4c22': 'Настройки скрипта',
  'settings.metadata.66d0f523a379b2de': 'Навыки',
  'settings.metadata.f6a1fdbcca54b2f8': 'Заметки',
  'settings.metadata.71fea45d263e0906': 'Задача выполнена',
  'settings.metadata.968a994a15bd991a': 'Задача открыта повторно',
  'settings.metadata.a3e3e968c40e5951': 'Задача создана',
  'settings.metadata.ba3078bec8c60a69': 'Задача изменена',
  'settings.metadata.98acf0d427bd63b5': 'Дата задания изменена',
  'settings.metadata.d41c129fb8fdf353': 'Заметка создана',
  'settings.metadata.e6a78804e128667f': 'Заметка изменено',
  'settings.metadata.4a33279d562ffb24': 'Заметка переименовано',
  'settings.metadata.81f7d1888d5a03be': 'Заметка удалена',
  'commands.external-file-evict': 'Хранить только на сервере',
  'commands.external-file-pin': 'Хранить на этом устройстве',
  'commands.external-file-hydrate': 'Скачать на это устройство',
  'settings.ordinal.first': 'первым',
  'settings.ordinal.second': 'вторым',
  'settings.ordinal.third': 'третьим',
  'settings.ordinal.number': '{count}-м',
  'settings.terms.script': 'скрипт',
  'settings.CalendarsSettings.new_link.f9e84245': 'Новая ссылка...',
  'settings.CalendarsSettings.save_the_link.7b19a248': 'Сохраните ссылку',
  'settings.CalendarsSettings.the_link.f0fb533a': 'Ссылка',
  'settings.CalendarsSettings.new_password.1abebe85': 'Новый пароль...',
  'settings.CalendarsSettings.save_the_password.acd9c185': 'Сохраните пароль',
  'settings.CalendarsSettings.the_password.3f4e5252': 'Пароль',
  'settings.FinanceSettings.new_token.564f08bc': 'Новый жетон...',
  'settings.FinanceSettings.save_the_token.8326f085': 'Сохраните токен',
  'settings.FinanceSettings.the_token.d22bffce': 'Токен',
  'settings.GithubConnectionEditor.new_token.564f08bc': 'Новый жетон...',
  'settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882':
    'Используйте этот токен при сохранении соединения',
  'settings.GithubConnectionEditor.the_token.d22bffce': 'Токен',
  'settings.GithubSettings.new_token.564f08bc': 'Новый жетон...',
  'settings.GithubSettings.save_the_notifications_token.d4a25b6f': 'Сохраните токен уведомлений',
  'settings.GithubSettings.the_notifications_token.266dfc35': 'Токен уведомлений',
  'settings.ai.InterceptorList.runs_value.fe51da79': 'Выполняется {value0}',
  'settings.ai.McpServerModal.new_token.564f08bc': 'Новый жетон...',
  'settings.ai.McpServerModal.save_the_token.8326f085': 'Сохраните токен',
  'settings.ai.McpServerModal.the_token.d22bffce': 'Токен',
  'settings.transfer.TransferPreviewModal.what_goes.39dde11f': 'что происходит',
  'settings.GithubSettings.delete_this_connection_and_forget.1a526c31':
    'Удалите это соединение и забудьте его локальный токен.',
  'settings.GithubSettings.forget.a6bd489d': 'Забывать',
  'settings.GithubSettings.remove_the_notifications_token_from.d1453607':
    'Удалите токен уведомлений из связки ключей',
  'settings.ImageModelEditModal.delete_value.8782b778': 'Удалить {value0}',
  'settings.ModelEditModal.delete_value.8782b778': 'Удалить {value0}',
  'settings.QuickButtonSettings.take_out.a7fc33e3': 'Выиграть',
  'settings.QuickButtonSettings.take_value_out_of_the.8b01b719': 'Убрать {value0} из меню',
  'settings.SecretsListModal.put_every_key_on_the.8118968c':
    'Поместите каждую клавишу в буфер обмена в виде обычного текста.',
  'settings.ai.AgentsSettings.delete_value.8782b778': 'Удалить {value0}',
  'settings.ai.McpServerModal.delete_value.8782b778': 'Удалить {value0}',
  'settings.ai.McpSettings.delete_value.8782b778': 'Удалить {value0}',
  'settings.scripts.AutomationsEditor.delete_value.8782b778': 'Удалить {value0}',
  'settings.scripts.HeaderButtonsEditor.delete_value.8782b778': 'Удалить {value0}',
  'settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8': 'Снимать',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c':
    'Убрать {value0} из меню.',
  'settings.startup.computers': 'компьютерах',
  'settings.transfer.itemsToApply': {
    one: 'Применить {count} элемент',
    few: 'Применить {count} элемента',
    many: 'Применить {count} элементов',
    other: 'Применить {count} элемента',
  },
  'settings.calendar.found': {
    one: 'Найден {count} календарь.',
    few: 'Найдено {count} календаря.',
    many: 'Найдено {count} календарей.',
    other: 'Найдено {count} календаря.',
  },
  'settings.mcp.fetched': '{tools}, получено {when}',
  'settings.sentence.2de766f4c2331579':
    'Сохранённые значения подставляются в запрос и никогда не показываются здесь. Разрешение запоминает этот адрес для {value0} на этом устройстве: здесь повторного запроса не будет. На других устройствах разрешение всё ещё потребуется.',
  'settings.sentence.c93c0ada01c57a48': 'Доступно моделей: {value0}',
  'settings.sentence.cdb07f66a428a0ed': 'Не сохранено: {value0}',
  'settings.sentence.4f7ec121b15ac5e4': 'Нигде не отображается · {value0}',
  'settings.sentence.7caf85c3282be170': 'ещё осталось найти: {value0}',
  'settings.sentence.2d2a1f1b3800ab01': 'Создано {value0}. Отметьте, что сохранить.',
  'settings.secrets.removeNamed':
    'Удалить {name}? Все вызовы fetch, использующие это имя, перестанут работать, а сохранённое значение будет удалено из связки ключей.',
  'settings.mcp.headersDescription':
    'По одному заголовку на строку в формате Name: value. Для секрета используйте {example}: это ключ из раздела ИИ → Общие → Сохранённые ключи, поэтому он не попадёт в файл настроек.',
  'settings.sync.presentation.e159b06187d369a0': 'Приостановлено',
  'settings.sync.presentation.857a66dd7a6dfe32': ' · {completed} из {total}',
  'settings.sync.presentation.265ec42c10960f4e': ' · Требуется внимание',
  'settings.sync.presentation.a3e3205316b64477': 'Сервер недоступен, повторная попытка',
  'settings.sync.presentation.c70acece009d71d9': '{completed} из файлов {total}',
  'settings.sync.presentation.5c8b9e1ce0a2bc31': 'Синхронизация',
  'settings.sync.presentation.0d60f3335d21fa2b': {
    one: '{count} конфликтная копия',
    few: '{count} конфликтные копии',
    many: '{count} конфликтных копий',
    other: '{count} конфликтной копии',
  },
  'settings.sync.presentation.96f22a9119067884': {
    one: '{count} файл не отправлен',
    few: '{count} файла не отправлены',
    many: '{count} файлов не отправлено',
    other: '{count} файла не отправлено',
  },
  'settings.sync.presentation.9e1b70e3f4abbe8e': 'Синхронизировано {when}',
  'settings.sync.presentation.c10529851ad89bd3': 'Еще не синхронизировано',
  'settings.sync.presentation.2512ef45cc838dc2':
    'Требуется восстановление синхронизации. Файлы и соединение сохранены.',
  'settings.sync.presentation.fbcbda4833c5c0b7':
    'Ответ сервера был прерван до завершения. Попробуйте синхронизировать еще раз.',
  'settings.sync.presentation.fd2175ceceb4c39f':
    'Этот токен поврежден или неполный. Вставьте весь токен еще раз.',
  'settings.sync.presentation.93754bdbbee0e2c4':
    'Сервер недоступен. Проверьте подключение и повторите попытку.',
  'settings.sync.presentation.f58e7749a37e75de': 'Доступ закрыт. Попросите новый жетон.',
  'settings.sync.presentation.c3dbee340e1c8ed3': 'Группа еще готовится. Обмен файлами не начался.',
  'settings.sync.presentation.753e9b392eca8228':
    'Сервер заполнен. Неотправленные файлы остаются на этом устройстве.',
  'settings.sync.presentation.7584f523308d5d6d':
    'Этот файл слишком велик для сервера. Он остается на этом устройстве.',
  'settings.sync.presentation.9036c8e0dc30cc74':
    'Сервер заполнен. Файл остается здесь и может быть отправлен после того, как освободится место.',
  'settings.sync.presentation.bbb4cbf36ea63cbd':
    'Данное соединение не позволяет выполнить это действие.',
  'settings.sync.presentation.110ec9023ae84ee7':
    'Ответу сервера нельзя доверять; синхронизация остановлена. Локальные файлы сохранились.',
  'settings.sync.presentation.9259b3f2e2f72c08': 'Эта папка или группа больше не доступны.',
  'settings.sync.presentation.0303e18246708180': 'Нет подключения',
  'settings.sync.presentation.fe7c4c6f414c4083': 'Группа вне этой связи',
  'settings.sync.presentation.97c769d2eaf4ca1c': 'Папка за пределами этого подключения',
  'settings.sync.presentation.f56643958aeae61b': 'Группа: {name}',
  'settings.sync.presentation.7dd20272337b469c': 'Открыть историю версий · {name}',
  'settings.sync.presentation.cb44fe2561afccff': 'Целое хранилище',
  'settings.sync.presentation.5c802e6401aca4d2': 'Папка: {path}',
  'settings.sync.presentation.5fa7aac5375c5815': 'Готово',
  'settings.sync.presentation.b0f398a57ea3ca38': 'Сервер недоступен',
  'settings.sync.presentation.c1ebc7817870e5be': 'Требуется внимание',
  'settings.sync.presentation.9b7e4ca97f057cbc': 'Нужен токен',
  'settings.sync.presentation.d403c686f6a10480': 'Подключение',
  'settings.sync.presentation.58b1510f8abae1f2': 'Доступ недоступен',
  'settings.sync.presentation.5514efec066cba3e': 'Обновление доступа',
  'settings.sync.presentation.ae9cea791e9bc09c': 'Удален на сервере',
  'settings.sync.presentation.013c681e65af3ea9':
    'Сервер восстановлен из резервной копии — проверка файлов',
  'settings.sync.presentation.43edbd9fcb4f94a4': 'Проверка восстановленных файлов',
  'settings.sync.presentation.ceb8c1fa2307911c':
    'Общая папка переименована на сервере: {from} → {to}; синхронизация остановлена',
  'settings.sync.presentation.d0be29aeb27cd431':
    'Папка перемещена в {path}; синхронизация остановлена',
  'settings.sync.presentation.b1241ef8763e3062': 'Папка исчезла; синхронизация остановлена',
  'settings.sync.presentation.41920972f6474234':
    'Папка или группа сервера недоступна; локальные файлы сохраняются',
  'settings.sync.presentation.54f2a3375e5dd52d': 'Доступ закрыт; локальные файлы сохраняются',
  'settings.sync.presentation.fc135b7008d458b4': '{stage}… {completed}/{total}{attention}',
  'settings.sync.presentation.a90a62a0bc219ded': 'Проверяем хранилище… {completed}/{total}',
  'settings.sync.presentation.ec5aa287907706b6': 'Сравнение файлов {completed}/{total}',
  'settings.sync.presentation.63ec9d9ac51fa025': 'Ответ сервера прерван',
  'settings.sync.presentation.27a38f81837d5e05': {
    one: '{count} папка',
    few: '{count} папки',
    many: '{count} папок',
    other: '{count} папки',
  },
  'settings.sync.presentation.63352fdc2cd6bbbf': {
    one: '{count} файл',
    few: '{count} файла',
    many: '{count} файлов',
    other: '{count} файла',
  },
  'settings.sync.presentation.7c907ab73773e102': {
    one: '{completed} из как минимум {count} папки',
    few: '{completed} из как минимум {count} папок',
    many: '{completed} из как минимум {count} папок',
    other: '{completed} из как минимум {count} папки',
  },
  'settings.sync.presentation.7438a7b7fe1ef4bb': {
    one: '{completed} из как минимум {count} файла',
    few: '{completed} из как минимум {count} файлов',
    many: '{completed} из как минимум {count} файлов',
    other: '{completed} из как минимум {count} файла',
  },
  'settings.sync.presentation.20a1cd5ccd38098a': {
    one: '{completed} из {count} папки',
    few: '{completed} из {count} папок',
    many: '{completed} из {count} папок',
    other: '{completed} из {count} папки',
  },
  'settings.sync.presentation.9a139983ae1196bc': {
    one: '{completed} из {count} файла',
    few: '{completed} из {count} файлов',
    many: '{completed} из {count} файлов',
    other: '{completed} из {count} файла',
  },
  'settings.sync.presentation.608ec17db8dff1ba': ' · {bytes} {unit} перенесен',
  'settings.sync.presentation.4336b4a9e578c6ce': ' · {bytes} из {total} {unit}',
  'settings.sync.presentation.4a9aad432626cdc4': ' · осталось менее 1 минуты',
  'settings.sync.presentation.c42b56810e72964d': ' · осталось около {minutes} минут',
  'settings.sync.presentation.11a6767d5674c7e4': 'Готово',
  'settings.sync.presentation.88fe20810f158d65': 'Сохранено; местная очистка все еще продолжается',
  'settings.sync.presentation.2011abd185905fbc':
    'Хранится на этом устройстве. Сначала разрешите удаление',
  'settings.sync.presentation.cf6ecbdf93a4cbd4':
    'Открыто в редакторе или используется в данный момент. Закройте его и попробуйте еще раз',
  'settings.sync.presentation.ba084f0f0f3f2d81':
    'Неотправленные изменения остаются на этом устройстве. Сначала синхронизируйте',
  'settings.sync.presentation.1450568cbc3989de':
    'Версия изменилась. Предварительный просмотр еще раз',
  'settings.sync.presentation.bfad3113a6082ae4':
    'Файл больше не соответствует этому правилу. Предварительный просмотр еще раз',
  'settings.sync.presentation.c257dbbbf04763fe': 'Недоступно офлайн',
  'settings.sync.presentation.8d4a166ba65e8cac': 'Этот файл недоступен на сервере',
  'settings.sync.presentation.6d48d4d60ba51073':
    'Этой версии еще нет на сервере. Сначала синхронизируйте; файл останется здесь',
  'settings.sync.presentation.3b110b3b8a0affae':
    'Синхронизация отказалась от этого файла. Сначала определите статус синхронизации; оно останется здесь',
  'settings.sync.presentation.3123f064bd232e76': 'Этот сервер не поддерживает разгрузку',
  'settings.sync.presentation.4b9c0b68c8009214':
    'Это хранилище устройства не поддерживает безопасную разгрузку.',
  'settings.sync.presentation.67e22f73b49e31ce': 'Недостаточно места для безопасной загрузки',
  'settings.sync.presentation.8925063fc75cd16d':
    'Место назначения занимает другой файл. Оба файла сохранились',
  'settings.sync.presentation.e2f0da1e1e6f9fdb': 'Этот файл невозможно выгрузить',
  'settings.sync.presentation.a88ffdf4720bfc95': 'Уже хранится только на сервере',
  'settings.sync.presentation.2cfe6717c6efa346': 'Исполняемые файлы остаются на этом устройстве.',
  'settings.sync.presentation.f3912c33c1e7e094':
    'Перед удалением локальной копии нужна проверка доступа к этому подключению',
  'settings.sync.presentation.4d77018e2e63b109':
    'Требуется восстановление синхронизации. Файл останется здесь',
  'settings.sync.presentation.54272d517782b52a': 'Проверка хранилища',
  'settings.sync.presentation.6a534e2d9b68ac18': 'Сравнение файлов',
  'settings.sync.presentation.0b398fdee3be023a': 'Подготовка папок',
  'settings.sync.presentation.f8cc26b4a73ec961': 'Получение файлов',
  'settings.sync.presentation.37b345555d7ea6c1': 'Загрузка',
  'settings.sync.presentation.8b898ca34ce71371': 'Отправка',
  'settings.sync.presentation.d9351cf978606788': 'Чтение токена',
  'settings.sync.presentation.a11acbbb551a6ddc': 'Проверка сервера',
  'settings.sync.presentation.dc4552a7de803f44': 'Открытие папки',
  'settings.sync.presentation.dfe7d0dd9f350fd8': 'Подготовка подключения',
  'settings.sync.presentation.be0e89cc19c4cf38':
    'Удалено на сервере. Все файлы остаются на этом устройстве.',
  'settings.sync.codeSource': 'Код с {host} · {when}',
  'settings.sync.privateQuestion': 'Личный файл · поделиться с {scope}?',
  'settings.components.AiScopeEditor.full_vault_access.e59147d6': 'Полный доступ к хранилищу',
  'settings.components.AiScopeEditor.the_agent_may_read_and.7215c412':
    'Агент может читать и изменять каждый файл в хранилище.',
  'settings.components.AiScopeEditor.the_agent_sees_only_what.dd8d63d0':
    'Агент видит только то, что указано ниже.',
  'settings.components.AiScopeEditor.counting_group_members.6cf29d46': 'Подсчет участников группы',
  'settings.components.AiScopeEditor.what_the_agent_can_reach.9e1cc9cb':
    'К чему у агента есть доступ',
  'settings.components.AiScopeEditor.remove_value_from_scope.5306ceeb':
    'Удалить {value0} из области видимости',
  'settings.components.AiScopeEditor.loading_group_members.64b5fef7': 'Загрузка участников группы',
  'settings.components.AiScopeEditor.show_more.f5c9bd13': 'Показать больше',
  'settings.components.AiScopeEditor.nothing_yet_the_agent_sees.83352aaa':
    'Пока ничего: агент не видит файлов.',
  'settings.components.AiScopeEditor.add_to_what_the_agent.ba420695': 'Расширить доступ агента',
  'settings.components.AiScopeEditor.add_a_note_folder_group.0a52ba05':
    'Добавить заметку, папку, группу или маску…',
  'settings.components.AiScopeEditor.could_not_count_group_members.58d42889':
    'Не удалось посчитать участников группы. Снова откройте доступ и повторите попытку.',
  'settings.components.AiScopeEditor.could_not_load_group_members.9a565298':
    'Не удалось загрузить участников группы. Закройте и снова откройте группу, чтобы повторить попытку.',
  'settings.components.ToolModesEditor.show_core_tools.bea400e8': 'Показать основные инструменты',
  'settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03':
    'Показывать постоянно включенные инструменты, которые нельзя отключить.',
  'settings.components.ToolModesEditor.all_tools.81c151f9': 'Все инструменты',
  'settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce':
    'Устанавливает все инструменты ниже одновременно. После этого каждый из них можно будет изменить самостоятельно.',
  'settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee':
    'Установите для каждого инструмента значение {value0}.',
  'settings.components.ToolModesEditor.always_open.67b6ffc1': 'Всегда открыт',
  'settings.components.ToolModesEditor.when_value_is_open.37a2f90a': 'Когда {value0} открыт',
  'settings.components.ToolModesEditor.change_what_value_is_said.5508c12f':
    'Измените то, для чего предназначен {value0}.',
  'settings.components.ToolModesEditor.reset_to_default.bc5b45ae':
    'Сбросить настройки по умолчанию',
  'settings.components.ToolModesEditor.use_the_section_s_own.e02f836f':
    'Снова используйте собственное описание раздела.',
  'settings.components.ToolModesEditor.done.11a6767d': 'Готово',
  'settings.components.ToolModesEditor.value_tools.a2c9c9bb': 'Инструментов: {value0}',
  'settings.components.ToolModesEditor.hide_its_tools.52db5aef': 'Скрыть инструменты',
  'settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30':
    'Показать инструменты с отдельными настройками',
  'settings.components.ToolModesEditor.all_in_this_section.3d4eba9d': 'Все в этом разделе',
  'settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a':
    'Установите каждый инструмент в {value0} на {value1}.',
  'settings.components.ToolModesEditor.use_this_server.8eb48b42': 'Использовать этот сервер',
  'settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e':
    'Предоставляет все инструменты этого сервера, каждый из которых запрашивается перед запуском.',
  'settings.components.ToolModesEditor.always_on.f017032a': 'всегда включен',
  'settings.components.ToolModesEditor.use_the_tool_s_own.520c244d':
    'Снова используйте собственное описание инструмента.',
  'settings.components.ToolModesEditor.on_request.be820103': 'По запросу',
  'settings.components.ToolModesEditor.off.ca7981b4': 'Выкл.',
  'settings.components.ToolModesEditor.ask.b8c209cd': 'Спрашивать',
  'settings.components.ToolModesEditor.auto.02862497': 'Авто',

  'settings.metadata.354509b1c9ccade8':
    'Файлы, поиск и история Git в папках на ноде, доступ к которым дан этому чату. Доступные папки задаются для каждого чата в разделе доступа к ноде.',
  'settings.metadata.18a90996c684b6b3':
    'Открывать, просматривать и искать файлы; статус, различия и история в git.',
  'settings.metadata.e0b89715205e4ef5':
    'Создавайте, изменяйте, перемещайте, копируйте и удаляйте файлы.',
  'settings.metadata.d442700773269772':
    'Перечислите рабочие деревья папки и переключайтесь между ними.',
  'settings.metadata.29a212809fa10bf3':
    'Дайте задание агенту кодирования на ноде, выполните его, отправьте еще и отмените.',
  'settings.metadata.c7ad7ac4793fb440':
    'Прочитайте прогоны, записанные отладчиком, отметьте их шаги, добавьте точки записи и запишите их; читать, сохранять, импортировать и отправлять сохраненные запросы проекта.',
  'settings.metadata.1fd38d5cbd2a997b': 'маска',
  'settings.metadata.f2892578274d2e49': 'открытая заметка',
  'settings.metadata.034a0062488256f1': 'папка',
  'settings.scope.groupNotes': {
    one: 'группа · {count} заметка',
    few: 'группа · {count} заметки',
    many: 'группа · {count} заметок',
    other: 'группа · {count} заметки',
  },
  'settings.calendar.urlPlaceholder': 'https://… или webcal://…',
  'settings.transfer.singleQr': 'Показать передачу в виде QR-кода',
  'settings.transfer.multipleQr': {
    one: 'Показать передачу в виде QR-кодов: {count}',
    few: 'Показать передачу в виде QR-кодов: {count}',
    many: 'Показать передачу в виде QR-кодов: {count}',
    other: 'Показать передачу в виде QR-кодов: {count}',
  },
  'settings.metadata.bf774e203130976f': 'Добавить точку записи',
  'settings.metadata.ed11479db97b1ec2': 'Отменить задачу на ноде',
  'settings.metadata.ce884b28082de708': 'Передать задачу ноде',
  'settings.metadata.47cbd67f4decc509': 'Найти в запуске',
  'settings.metadata.20c3a692f1425939': 'Проследить значение',
  'settings.metadata.a63e38b5ef9d8acc': 'Продолжить задачу на ноде',
  'settings.metadata.3dcb2cb134c18f1a': 'Импортировать запросы',
  'settings.metadata.a657f2eaf9177c2b': 'Рабочие деревья ноды',
  'settings.metadata.3f577c263389d695': 'Отметить в запуске',
  'settings.metadata.f40ad2a69f110e1a': 'Копирование файлов на ноде',
  'settings.metadata.4c55f1221ca27657': 'Цели задач ноды',
  'settings.metadata.19d5a1e505698a8d': 'Редактирование файлов на ноде',
  'settings.metadata.58bab54373681382': 'Папки ноды',
  'settings.metadata.0887cebecaa90ad8': 'Авторство строк Git на ноде',
  'settings.metadata.7d99864f0651cf16': 'Ветки Git на ноде',
  'settings.metadata.c6d22695c2b49792': 'Различия Git на ноде',
  'settings.metadata.2e62cdbaa5ee98f0': 'История Git на ноде',
  'settings.metadata.74cd294db7d3e719': 'Состояние Git на ноде',
  'settings.metadata.0c7411b73901f6c2': 'Список файлов ноды',
  'settings.metadata.e5b0c93478880755': 'Перемещение файлов на ноде',
  'settings.metadata.c5dfe7e400c6f227': 'Список нод',
  'settings.metadata.fe2b5c47256ac07e': 'Чтение файлов на ноде',
  'settings.metadata.b0dc611264fca372': 'Замена текста на ноде',
  'settings.metadata.d3d7043d61bb21c8': 'Авторство строк в репозитории ноды',
  'settings.metadata.34feb0cfc058ccff': 'Изменения в репозитории ноды',
  'settings.metadata.dd2e41d38b7838e9': 'Создать коммит в репозитории ноды',
  'settings.metadata.074e769d80fde34e': 'Коммиты репозитория ноды',
  'settings.metadata.c4806722ba66e903': 'Сравнить версии в репозитории ноды',
  'settings.metadata.ab004772e1b71ba8': 'Файл репозитория ноды',
  'settings.metadata.6544b43fdfe3320e': 'Поиск в репозитории ноды',
  'settings.metadata.a9c6586ae9f11964': 'Открыть репозиторий ноды',
  'settings.metadata.81ac4cdc952990d9': 'Предложить изменение в репозитории ноды',
  'settings.metadata.44812fcb9883ac9d': 'Дерево файлов репозитория ноды',
  'settings.metadata.b74af9f786625504': 'Вкладки репозитория ноды',
  'settings.metadata.cc00c9b3261b6896': 'Удаление файлов на ноде',
  'settings.metadata.f864b17e206c9949': 'Поиск файлов на ноде',
  'settings.metadata.01bce5e752a4e282': 'Смена рабочего дерева ноды',
  'settings.metadata.82a9c46ffa478994': 'Коммит',
  'settings.metadata.ca8a5f3bee55b125': 'Удалить рабочее дерево…',
  'settings.metadata.6c91d7b86793064a': 'Запись файлов на ноде',
  'settings.metadata.aa2463736b28728a': 'Заметка о запуске',
  'settings.metadata.f659e2e6ad7c78ad': 'Прочитать сохранённый запрос',
  'settings.metadata.bac5871a628ca72b': 'Состояние задачи на ноде',
  'settings.metadata.7616d1f9f0eb2abe': 'Записанные запуски',
  'settings.metadata.62b2137489d32412': 'Результат отправки',
  'settings.metadata.87c059b1fd800819': 'Ход запуска',
  'settings.metadata.93f46c6131a98750': 'Сохранить запрос',
  'settings.metadata.49813efc30da7138': 'Сохранённые запросы',
  'settings.metadata.0d50b621a3f98f5d': 'Отправить сохранённый запрос',
  'settings.metadata.a4b757018683f41d': 'Изменения значения',
  'settings.metadata.ae1b1551ec65814d': 'Структура значения',
  'settings.metadata.7a6f44b8094e0625': 'Фрагмент значения',
  'settings.metadata.da9b697a15683606': 'Создать холст',
  'settings.metadata.841ee7bd4aeb25a6': 'Настроить обзор холста',
  'settings.metadata.aab4922458b14785': 'Изменить холст',
  'settings.metadata.97fd18d398003c79': 'Экспортировать весь холст',
  'settings.metadata.1fe56b7b323305fc': 'Расположить элементы холста',
  'settings.metadata.6f53a1ddd68b0c2b': 'Посмотреть холст',
  'settings.metadata.2b046175f5077346': 'Прочитать холст',
  'settings.tools.openSection': 'Открыть раздел «{section}»',
  'settings.ModelEditModal.default.21b111cb': 'По умолчанию',
  'settings.ModelEditModal.low.f793de20': 'Низкий',
  'settings.ModelEditModal.medium.8e588cd1': 'Середина',
  'settings.ModelEditModal.high.c4ebc6d4': 'Высокий',
  'settings.ai.AgentEditorModal.none.dc937b59': 'Нет',
  'settings.ai.AgentEditorModal.follow_the_setting.ead899ca': 'Как в настройках',
  'settings.ai.AgentEditorModal.by_section.2c8a0eb5': 'По разделам',
  'settings.ai.AgentEditorModal.all_at_once.f9068371': 'Все одновременно',
  'settings.ai.GeneralSettings.same_as_the_chat.3e206eff': 'Как в чате',
  'settings.ai.GeneralSettings.off.ca7981b4': 'Выкл.',
  'settings.ai.GeneralSettings.once.d88f6d83': 'Один раз',
  'settings.ai.GeneralSettings.twice.cc1b4c8d': 'Два раза',
  'settings.ai.GeneralSettings.three_times.13b6376c': 'Три раза',
  'settings.ai.GeneralSettings.five_times.ee32f27e': 'Пять раз',
  'settings.ai.GeneralSettings.not_configured.dd1841d2': 'Не настроено',
  'settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311':
    'Сохранить существующее и добавить новое',
  'settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8':
    'Заменить существующее этим',
  'settings.components.ToolModesEditor.mixed.f340b6d6': 'Разные',
  'settings.metadata.6fd575b1876b0d59':
    'Блок свойств начинается с первой строки, закрыт, содержит корректный YAML и не повторяет имена свойств. Блок, оказавшийся ниже в заметке, переносится в начало; повтор свойства с одинаковым значением удаляется.',
  'settings.metadata.36317c6ed2cd7dbe':
    'Перечисленные свойства присутствуют и заполнены. После двоеточия можно указать значение по умолчанию: «created: {{ctime}}» подставляет дату создания файла, {{today}} — сегодняшнюю дату. Исправляются только эти свойства.',
  'settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e':
    'Страницы этой книги разложены книгой, как в комиксе: для них нечего устанавливать. Масштабируйте с помощью Mod и плюс или минус, щепотку или меню вкладки.',
  'settings.components.reader.ReaderSettingsForm.layout.a5119091': 'Макет',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f':
    'Перелистывайте страницы по одной или пролистывайте каждую главу. В режиме E-ink страницы сохраняются на этом устройстве.',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f':
    'Перелистывайте страницы по одной или пролистывайте каждую главу.',
  'settings.components.reader.ReaderSettingsForm.font.64d0b3ad': 'Шрифт',
  'settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22': 'Папка шрифтов',
  'settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c':
    'Папка в хранилище с файлами шрифтов: .ttf, .otf, .woff или .woff2. Каждое семейство в нем предлагается в виде шрифта выше и передается на другие ваши устройства вместе с хранилищем. Obsidian Sync поддерживает их при включенной синхронизации всех остальных типов. Пусто: шрифты из хранилища отсутствуют.',
  'settings.components.reader.ReaderSettingsForm.text_size.d68761cc': 'Размер текста',
  'settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1': 'Межстрочный интервал',
  'settings.components.reader.ReaderSettingsForm.margins.eea8d245': 'Поля',
  'settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b':
    'Пространство вокруг текста и между столбцами.',
  'settings.components.reader.ReaderSettingsForm.column_width.86f4e582': 'Ширина столбца',
  'settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab':
    'Максимальная ширина колонки текста.',
  'settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135': 'Две колонки',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2':
    'Две страницы рядом, если вкладка достаточно широкая.',
  'settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1': 'Цвета темы',
  'settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee':
    'Показывать книгу в цветах текста и фона вашей темы, включая тёмную тему. Выкл.: собственные цвета книги на светлой странице.',
  'settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d':
    'Собственные стили книги',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8':
    'Оформление книги собственное: таблицы, отступы, выравнивание, буквицы. Ваш размер текста, интервал, шрифт и цвета по-прежнему имеют преимущество. Ничего за пределами книги никогда не загружается.',
  'settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32':
    'Открытие PDF-файлов в программе чтения Abele',
  'settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b':
    'PDF-файлы открываются здесь, а не в собственной программе просмотра Obsidian, со страницами, которые можно перелистывать, содержимым рядом с ними и сохраняемым местом. Выкл.: они открываются в программе просмотра Obsidian, а команда «Открыть в программе чтения Abele» в меню PDF-файла по-прежнему открывает одну из них здесь.',
  'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f':
    'Одна непрерывная прокрутка, страница под страницей или страницы, перелистываемые по одной.',
  'settings.components.reader.ReaderSettingsForm.page_size.bd69e66e': 'Размер страницы',
  'settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb':
    'Автоматически: по ширине страницы при прокрутке, целая страница при перелистывании. Можно также вписать страницу целиком, по ширине или выбрать фиксированный масштаб.',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc':
    'Две страницы рядом',
  'settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6':
    'Когда вкладка достаточно широкая, как печатная книга лежит открытой.',
  'settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd':
    'Темные страницы в темной теме',
  'settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3':
    'Светлая и темная страница поменялись местами, а тема Obsidian темная, поэтому белая страница не бликует. Фотографии выходят в негативе.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f': 'Толщина пера',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925':
    'Толщина рисунка ручки и маркера в PDF-файле. Кнопка рядом с цветами под страницей также меняет их.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856':
    'Толщина пера на рисунках',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a':
    'Какой толщины ручка и маркер рисуют на рисунке или картинке. Кнопка рядом с цветами на панели также меняет его.',
  'settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc':
    'Электронные чернила на этом устройстве',
  'settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337':
    'Для ридера с e-ink экраном, типа Boox. Хранится только на этом устройстве: телефон и компьютер читают как раньше.',
  'settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801': 'Режим электронных чернил',
  'settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d':
    'Страницы перевернуты, никогда не прокручиваются и не сдвигаются, PDF-файлы тоже. Черный текст на белом, ничего серого, более толстые линии, ничего движущегося или тускнеющего. Блики нарисованы в виде линий, форма которых передает цвет. Тап в левой или правой трети переворачивает страницу. Кнопки и клавиши страниц тоже поворачивают его.',
  'settings.components.reader.ReaderSettingsForm.full_refresh.9322071a': 'Полное обновление',
  'settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f':
    'Страница мигает черным, а затем белым через несколько страниц, что очищает слабый призрак предыдущих страниц, которые оставляет экран электронных чернил.',
  'settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e':
    'Показывать нажатия клавиш в читалке',
  'settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a':
    'Над страницей показываются имя и код последней нажатой клавиши или кнопки и результат перелистывания; каждое нажатие также записывается в консоль. Это помогает узнать, что отправляют кнопки читалки, если они не перелистывают страницы.',
  'settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986': 'Чтение вслух',
  'settings.components.reader.ReaderSettingsForm.voice.87bf2bc0': 'Голос',
  'settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e':
    'Голоса, которые есть у этого устройства; на iPhone — те, которые находятся в «Настройки» → «Специальные возможности» → «Разговорный контент». Голос, выбранный на другом устройстве, которого нет на этом, считается голосом по умолчанию.',
  'settings.components.reader.ReaderSettingsForm.speed.c372fee9': 'Скорость',
  'settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8': 'Позиции чтения',
  'settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7':
    'Файл позиций чтения',
  'settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5':
    'Файл .json в хранилище с последней позицией чтения каждой книги: на всех устройствах книга откроется на ней. В списке файлов Obsidian он не виден. Obsidian Sync переносит его, как и чаты, если включена синхронизация всех остальных типов файлов. При смене пути позиции переносятся в новый файл. Пусто: {value0}.',
  'settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4':
    'Каждые {value0} страниц',
  'settings.components.reader.ReaderSettingsForm.never.6300ef80': 'Никогда',
  'settings.components.reader.ReaderSettingsForm.pages.9046da16': 'Страницы',
  'settings.components.reader.ReaderSettingsForm.scrolling.9b976293': 'Прокрутка',
  'settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0': 'Шрифт темы',
  'settings.components.reader.ReaderSettingsForm.serif.1b5e747e': 'с засечками',
  'settings.components.reader.ReaderSettingsForm.sans_serif.07e77255': 'Без засечек',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055': 'Как в книге',
  'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c':
    '{value0} (нет в папке шрифтов)',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807':
    'Шрифт текста. Шрифт темы совпадает со шрифтом заметок; после собственного шрифта книги перечислены шрифты из вашей папки шрифтов.',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358':
    'Шрифт текста. Шрифт темы совпадает со шрифтом заметок. Добавьте файлы шрифтов в папку шрифтов, чтобы читать с выбранным вами шрифтом.',
  'settings.components.reader.ReaderSettingsForm.narrow.ba227109': 'Узкие',
  'settings.components.reader.ReaderSettingsForm.normal.a7248eeb': 'Обычные',
  'settings.components.reader.ReaderSettingsForm.wide.147170e7': 'Широкие',
  'settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6':
    'Непрерывная прокрутка',
  'settings.components.reader.ReaderSettingsForm.automatic.d461a493': 'Автоматически',
  'settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c': 'Вся страница',
  'settings.components.reader.ReaderSettingsForm.page_width.217fbef1': 'По ширине страницы',
  'settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4':
    'Голос устройства на языке книги',
  'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24':
    'Голос с другого устройства',
  'settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037':
    'Выделения из этой книги',
  'settings.components.reader.BookNotesSettings.highlights.6e517828': 'Выделения',
  'settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7': 'Куда сохранять',
  'settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64':
    'Только для этой книги. «Как в настройках» использует выбор из раздела «Настройки → Книги».',
  'settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e':
    'Отдельная заметка рядом с каждой книгой или одна общая заметка для всех книг. Для конкретной книги можно выбрать иначе через кнопку Aa.',
  'settings.components.reader.BookNotesSettings.note.d8da2c49': 'Заметка',
  'settings.components.reader.BookNotesSettings.note_for_all_books.105d496e':
    'Заметка для всех книг',
  'settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6':
    'Заметка, куда сохраняются выделения из этой книги. Пусто: {value0}.',
  'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d':
    'Создаётся при первом выделении; выделения разных книг различаются по ссылкам. Пусто: {value0}.',
  'settings.components.reader.BookNotesSettings.template.0575f29d': 'Шаблон',
  'settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd':
    'Заметка-шаблон для создания заметки с выделениями из этой книги. Пусто: как в настройках.',
  'settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc':
    'Заметка-шаблон для новой заметки с выделениями. Между {literal0} и {literal1} задаётся то, что добавляет каждое выделение; {literal2} — само выделение. Можно использовать {literal3} и {literal4}, чтобы разделить цитату и комментарий; также доступны {literal5}, {literal6}, {literal7}, {literal8}, {literal9}. Пусто: без шаблона.',
  'settings.components.reader.BookNotesSettings.none.dc937b59': 'Нет',
  'settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2':
    'Отдельная заметка для книги',
  'settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78':
    'Одна заметка для всех книг',
  'settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c':
    'Как в настройках ({value0})',
  'settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f': 'Указанная вами заметка',
  'settings.reader.stroke.fine': 'Тонкая',
  'settings.reader.stroke.medium': 'Средняя',
  'settings.reader.stroke.bold': 'Толстая',
  'settings.GithubAccessReport.an_access_token.14f95c33': 'токен доступа',
  'settings.GithubConnectionEditor.add_git_connection.9e359dd8': 'Добавить подключение к Git',
  'settings.GithubConnectionEditor.edit_git_connection.1e73be5f': 'Изменить подключение к Git',
  'settings.GithubConnectionEditor.service.d677190e': 'Сервис',
  'settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8':
    'Выберите сервис перед вводом адреса сервера и токена.',
  'settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1':
    'Полный адрес Forgejo, включая порт и путь установки, если они есть.',
  'settings.GithubConnectionEditor.access_token.9a911b08': 'Токен доступа',
  'settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b':
    'sample-org\nsample-org/project',
  'settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1':
    'владелец/репозиторий или ссылка на Forgejo',
  'settings.GithubConnectionEditor.access_details.abe1adac': 'Подробности доступа',
  'settings.GithubConnectionEditor.forgejo.f4e62146': 'Forgejo',
  'settings.GithubConnectionEditor.signed_in_as_value.682769b2': 'Вошёл как {value0}',
  'settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a':
    'Сервер не принял этот токен (401).',
  'settings.GithubConnectionEditor.the_account_could_not_be.71de8f27':
    'Аккаунт не удалось проверить. {value0}',
  'settings.GithubConnectionEditor.public_access_without_a_token.35b758c0':
    'Публичный доступ без токена',
  'settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc':
    'Выберите репозиторий, чтобы проверить доступ на чтение.',
  'settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8':
    'Токен подключения изменился. Проверьте доступ еще раз.',
  'settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376':
    'Сохраненный токен принадлежит предыдущему серверу. Введите новый токен для этого адреса.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3':
    'Укажите владельца/репозиторий или ссылку на репозиторий на сервере этого подключения.',
  'settings.GithubConnectionEditor.asking_forgejo.f46aa9ff': 'Запрос к Forgejo…',
  'settings.GithubSettings.git_hosting.a3002011': 'Git-хостинг',
  'settings.GithubSettings.default.2ae2ecc2': 'По умолчанию · ',
  'settings.GithubSettings.edit_connection.047f9f95': 'Изменить подключение',
  'settings.GithubSettings.connection_actions.9e1bbb65': 'Действия с подключением',
  'settings.GithubSettings.public_access_without_a_token.35b758c0': 'Публичный доступ без токена',
  'settings.GithubSettings.forgejo.f4e62146': 'Forgejo',
  'settings.GithubSettings.token_unavailable_on_this_device.0bd03b33':
    'Токен недоступен на этом устройстве',
  'settings.GithubSettings.the_token_has_expired.0b52627f': 'Срок действия токена истек',
  'settings.GithubSettings.the_server_did_not_accept.1d7560a4':
    'Сервер не принял токен при последней проверке доступа',
  'settings.GithubSettings.the_last_access_check_failed.72f4e393':
    'Последняя проверка доступа не удалась',
  'settings.GithubSettings.some_repository_access_checks_failed.1b573ceb':
    'Не удалось проверить доступ к некоторым репозиториям',
  'settings.GithubSettings.access_checked.d2518d23': 'Доступ проверен',
  'settings.GithubSettings.not_checked_yet.881d23f6': 'Еще не проверено',
  'settings.GithubSettings.check_access.abb9a172': 'Проверить доступ',
  'settings.GithubSettings.make_default_for_value.ded3e105':
    'Использовать по умолчанию для {value0}',
  'settings.git.serverAddressError':
    'Только адрес: без имени пользователя, параметров запроса и части после #',
  'settings.git.noteLabel': 'заметка',
  'settings.transfer.oneKeyToStore': 'Один ключ для сохранения выбранных элементов.',
  'settings.git.nativeAddress': 'Полный адрес {service}, включая порт и путь установки.',
  'settings.git.useCodeberg': 'Использовать Codeberg',
  'settings.git.useCodebergTooltip': 'Использовать Codeberg как сервер Forgejo',
  'settings.git.nativeRepoLink': 'owner/repo или ссылка {service}',
  'settings.git.gitea': 'Gitea',
  'settings.git.githubId': 'github',
  'settings.git.askingNative': 'Запрос к {service}…',
  'settings.git.accessCheckCancelled': 'Проверка доступа отменена.',
  'settings.git.repositoryConnections': 'Подключения Git',
  'settings.metadata.ca4a628311f7879a': 'Git-репозитории',
  'settings.metadata.b9227122bad532e6': 'Вкладки репозиториев',
  'debuggerAccess.title': 'Доступ агента к отладчику',
  'debuggerAccess.request': 'Разрешить агенту пользоваться отладчиком в {folder}',
  'debuggerAccess.chatFolder': 'папке этого чата',
  'debuggerAccess.scope':
    'Только этот запуск и программа. Для вычисления выражений нужно отдельное разрешение.',
  'debuggerAccess.allowed': 'Доступ к отладчику разрешён. Агент может повторить вызов.',
  'debuggerAccess.denied': 'Доступ к отладчику отклонён.',
  'debuggerAccess.expiredRequest': 'Срок запроса истёк. Попросите агента повторить попытку.',
  'debuggerAccess.allow': 'Разрешить',
  'debuggerAccess.deny': 'Отклонить',
  'debuggerAccess.issued':
    'Разрешения, выданные вами на этом устройстве. Доступ прекращается при завершении запуска.',
  'debuggerAccess.issuerOnly':
    'Разрешения других владельцев скрыты. Отозвать или удалить разрешение может только тот, кто его выдал.',
  'debuggerAccess.refresh': 'Обновить',
  'debuggerAccess.updateNode': 'Обновите ноду, чтобы управлять доступом агента к отладчику.',
  'debuggerAccess.empty': 'Вы ещё не выдавали разрешений на доступ к отладчику.',
  'debuggerAccess.revoke': 'Отозвать доступ к отладчику',
  'debuggerAccess.deleteTip':
    'Удалить разрешение. Можно удалять только выданные вами разрешения. История операций сохранится.',
  'debuggerAccess.grantsUnavailable': 'Разрешения на доступ к отладчику недоступны',
  'debuggerAccess.changeFailed': 'Не удалось изменить разрешение на доступ к отладчику',
  'debuggerAccess.state.revoked': 'Отозвано',
  'debuggerAccess.state.expired': 'Срок истёк',
  'debuggerAccess.state.active': 'Действует',
  'debuggerAccess.grantDescription': '{state} · {actions} · {mode} · {conversation} · До {expires}',
  'debuggerAccess.refreshRequests': 'Обновить запросы к отладчику',
  'debuggerAccess.unavailable': 'Доступ к отладчику недоступен',
  'debuggerAccess.stale':
    'Этот запрос к отладчику больше не ожидает решения. Список ожидающих запросов обновлён.',
  'debuggerAccess.action.read': 'чтение',
  'debuggerAccess.action.step': 'шаг',
  'debuggerAccess.action.continue': 'продолжение',
  'debuggerAccess.action.pause': 'пауза',
  'debuggerAccess.action.breakpoints': 'точки останова',
  'debuggerAccess.action.launch': 'запуск',
  'debuggerAccess.action.attach': 'подключение',
  'debuggerAccess.action.detach': 'отключение',
  'debuggerAccess.action.terminate': 'завершение',
  'debuggerAccess.action.expressions': 'выражения',
  'debuggerAccess.action.evaluate': 'вычисление / изменение переменной',
  'debuggerAccess.mode.ask': 'запрашивать',
  'debuggerAccess.mode.allowAll': 'разрешить всё',
  'settings.git.reloadService': 'Загрузить заново из Git-сервиса',
  'settings.git.openBrowser': 'Открыть в браузере',
  'settings.metadata.gitHosting': 'Git-хостинг',
  'maps.viewName': 'Карта Abele',
  'maps.coordinates': 'Свойство координат',
  'maps.markerIcon': 'Значок точки',
  'maps.markerColor': 'Цвет точки',
  'maps.center': 'Координаты центра',
  'maps.defaultZoom': 'Начальный масштаб',
  'maps.minZoom': 'Минимальный масштаб',
  'maps.maxZoom': 'Максимальный масштаб',
  'maps.mapHeight': 'Высота встроенной карты',
  'maps.groupNearby': 'Группировать близкие места',
  'maps.mapTiles': 'Подложки карты',
  'maps.mapTilesDark': 'Подложки в тёмной теме',
  'maps.copied': 'Координаты скопированы',
  'maps.copyFailed': 'Не удалось скопировать координаты',
  'maps.delete': 'Удалить заметку',
  'maps.createFailed': 'Не удалось создать заметку',
  'maps.saveFailed': 'Не удалось сохранить подложки',
  'maps.locationDenied': 'Нет разрешения на геопозицию',
  'maps.locationTimeout': 'Время определения геопозиции истекло',
  'maps.locationUnavailable': 'Геопозиция недоступна',
  'maps.locating': 'Определяем геопозицию…',
  'commands.copy-current-map-location': 'Скопировать текущие координаты',
  'maps.zoomIn': 'Приблизить',
  'maps.zoomOut': 'Отдалить',
  'maps.north': 'Север сверху',
  'maps.locationOff': 'Геопозиция для Obsidian выключена',
  'maps.following': 'Следим за вами. Нажмите, чтобы остановить',
  'maps.showLocation': 'Моя геопозиция',
  'maps.exitFull': 'Выйти из полного экрана',
  'maps.full': 'Полный экран',
  'maps.fitPlaces': 'Показать все места',
  'maps.defaultBackground': 'По умолчанию',
  'maps.background': 'Подложка',
  'maps.tab': 'Открыть в новой вкладке',
  'maps.split': 'Открыть справа',
  'maps.window': 'Открыть в новом окне',
  'maps.card': 'Карточка места',
  'maps.copy': 'Скопировать координаты',
  'maps.newHere': 'Новая заметка здесь',
  'maps.setCenter': 'Сделать центром вида',
  'maps.manage': 'Настроить подложки…',
  'maps.noCoordinates': 'Нет координат',
  'maps.unreadable': 'Координаты не распознаны',
  'maps.formulaError': 'Ошибка формулы',
  'maps.noProperty': 'Где координаты?',
  'maps.pickProperty': 'Выберите свойство или формулу с координатами места.',
  'maps.configure': 'Настроить вид',
  'maps.noRecords': 'В базе пока нет заметок',
  'maps.hold': 'Удерживайте точку карты, чтобы добавить место.',
  'maps.rightClick': 'Нажмите правой кнопкой на карту, чтобы добавить место.',
  'maps.filtered': 'Нет мест по этим фильтрам',
  'maps.filtersEmpty': 'Фильтры исключили все места.',
  'maps.filters': 'Фильтры',
  'maps.nothing': 'Ничего не найдено',
  'maps.addCoordinates': 'Добавьте координаты или выберите другое свойство в настройках вида.',
  'maps.showNotes': 'Показать заметки',
  'maps.loadFailed': 'Карта не загрузилась',
  'maps.offline': 'Нет связи с сервером карты. Места остаются доступны.',
  'maps.retry': 'Повторить',
  'maps.noWebgl': 'Устройство не может отобразить карту',
  'maps.graphics': 'Графическое ускорение выключено или недоступно.',
  'maps.stopped': 'Карта перестала отображаться',
  'maps.lostContext': 'Графический контекст потерян, например после сна.',
  'maps.drawAgain': 'Перерисовать',
  'maps.backgrounds': 'Подложки',
  'maps.up': 'Выше',
  'maps.down': 'Ниже',
  'maps.edit': 'Изменить',
  'maps.remove': 'Удалить',
  'maps.add': 'Добавить',
  'maps.addBackground': 'Добавить подложку',
  'maps.newBackground': 'Новая подложка',
  'maps.editBackground': 'Изменить подложку',
  'maps.name': 'Название',
  'maps.light': 'Светлая тема',
  'maps.dark': 'Тёмная тема',
  'maps.cancel': 'Отмена',
  'maps.save': 'Сохранить',
  'maps.giveName': 'Укажите название',
  'maps.needAddress': 'Нужен хотя бы один адрес',
  'maps.createNote': 'Создать заметку',
  'maps.formulaWhy':
    'В формулу нельзя записать значение. Выберите свойство заметки для координат перед созданием.',
  'maps.skipped': 'Заметок вне карты: {count}',
  'maps.noneCoordinates': 'Заметок без координат: {count}',
  'maps.copyValue': 'Скопировать {value}',
  'maps.saveZoom': 'Открывать с масштабом {value}',
  'maps.placesHere': 'Мест здесь: {count}',
  'maps.searchEmpty': 'Нет мест по запросу «{query}».',
  'maps.backgroundHint': 'Именованные подложки карт в базах.',
  'maps.noBackgrounds': 'Своих подложек нет',
  'maps.addressHint': 'Адрес стиля или шаблоны тайлов, отображаемые слоями.',
  'maps.darkHint': 'Необязательно. Иначе в тёмной теме используется светлая подложка.',
  'maps.fromMaps': 'Подложки Obsidian Maps',
  'maps.copyBackgrounds': 'Скопировать подложки',
  'maps.importHint': 'Скопировать, не меняя настройки Obsidian Maps.',
  'maps.tileLayers': 'Слоёв тайлов: {count}',
  'maps.style': 'Стиль',
  'maps.lightOnly': 'Только светлая; для обеих тем',
  'maps.bothThemes': 'Светлая и тёмная',
  'maps.deleteFailed': 'Не удалось удалить заметку',
  'maps.fullUnavailable': 'Полный экран недоступен на этом устройстве',
  'maps.showList': 'Показать списком',
  'maps.listBeside': 'Список рядом с картой',
  'maps.placeGone': 'Эта заметка больше недоступна',
  'maps.attribution': 'Показать авторство карты',
  'maps.feedback': 'Сообщить о карте',
  'maps.touchHelp': 'Перемещайте карту двумя пальцами',
  'maps.scrollHelp': 'Используйте {key} и прокрутку для масштаба карты',
  'maps.currentLocation': 'Текущая геопозиция',
  'maps.backList': 'Назад к списку',
  'maps.cardGone': 'Заметка удалена',
  'maps.cardGoneText': 'Она удалена или перемещена после загрузки карты.',
  'maps.cardError': 'Не удалось прочитать заметку',
  'maps.cardErrorText': 'Место осталось на карте. Откройте заметку, чтобы проверить её.',
  'maps.imageMissing': 'Не удалось загрузить {path}',
  'maps.openPicture': 'Открыть фото: {caption}',
  'maps.open': 'Открыть',
  'maps.openNote': 'Открыть заметку',
  'maps.showMap': 'Показать на карте',
  'maps.more': 'Ещё',
  'maps.straightLine': '{distance} по прямой',
  'maps.mapFace': 'Показать карту',
  'maps.hideList': 'Скрыть список',
  'maps.sortLabel': 'Сортировка: {order}',
  'maps.resort': 'Карта перемещена. Пересчитать от нового центра',
  'maps.placeCount': 'Мест: {count}',
  'maps.listSearchEmpty': 'Нет мест по этому запросу',
  'maps.listEmpty': 'Нет мест с координатами',
  'maps.sortBase': 'Порядок базы',
  'maps.sortMe': 'Ближайшие ко мне',
  'maps.sortCentre': 'Ближайшие к центру карты',
  'maps.metres': '{value} м',
  'maps.kilometres': '{value} км',
  'maps.distanceCentre': 'По прямой от центра карты',
  'maps.distanceMe': 'По прямой от вашего местоположения',
  'debug.open': 'Отладчик',
  'debug.run': 'Запустить программу',
  'debug.attach': 'Подключиться к запущенной программе',
  'debug.checking': 'Проверяем поддержку отладчика…',
  'debug.offline': 'Подключитесь к ноде',
  'debug.off': 'Отладчик на этой ноде выключен',
  'debug.update': 'Обновите ноду для отладки без чата',
  'debug.install': 'На ноде не установлен отладчик JavaScript',
  'debug.noFolder': 'Сначала выберите папку на ноде',
  'debug.pathKind': 'Путь в этой папке',
  'debug.programPlaceholder': 'Файл JavaScript для отладки: src/main.js',
  'debug.programEmpty': 'Введите путь к файлу JavaScript в этой папке',
  'debug.thisFolder': 'Эта папка',
  'debug.insideFolder': 'Работает в этой папке',
  'debug.outsideFolder': 'Работает вне этой папки: подключение потребует подтверждения',
  'debug.executionTitle': 'Разрешить выполнение кода в этой папке?',
  'debug.executionMessage':
    'Разрешить выполнение кода в {path}? Проект станет доверенным, а для этой папки или рабочего дерева будет разрешено выполнение программ отладчика и агентов.',
  'debug.empty': 'Откройте отладчик из меню папки на ноде или чата.',
  'debug.outsideTitle': 'Подключиться к программе вне этой папки?',
  'debug.outsideMessage':
    '{command} работает в {path}, а не в выбранной папке. Отладчик может приостанавливать её и читать значения. После отключения она продолжит работать.',
  'debug.sourceUpdate': 'Обновите узел, чтобы ставить точки остановки в этом файле',
  'debug.sourceMap':
    'Узел не нашёл карту, связывающую этот файл с запущенной программой. Соберите проект с картами исходного кода, затем перезапустите программу и подключите отладчик.',
  'debug.sourceChanged':
    'Файл изменился после запуска программы. Верните прежнее содержимое или пересоберите и перезапустите программу.',
  'debug.sourceOutside': 'Файл находится вне папки отладки',
  'debug.sourceUnavailable': 'Не удалось добавить файл в отладчик',
  'debug.entryPlaceholder':
    'Найти входной файл или скрипт пакета; или ввести путь к собранному JavaScript',
  'debug.entryEmpty': 'Ничего не найдено. Можно ввести путь к собранному JavaScript.',
  'debug.sourceConflict': 'Файл конфликтует с уже добавленным исходником',
  'debug.sourceLimit': 'Достигнут предел числа исходников в сессии',
  'debug.sourceUnreadable': 'Файл недоступен или не читается',
  'debug.launchTitle': 'Запустить программу',
  'debug.launchProgram': 'Программа',
  'debug.launchProgramHint':
    'Путь относительно этой папки. Для собранного TypeScript укажите входной файл JavaScript (например, dist/main.js).',
  'debug.launchArgs': 'Аргументы',
  'debug.launchArgsHint':
    'Разделяйте аргументы пробелами; значения с пробелами заключайте в кавычки. Выражения оболочки не выполняются.',
  'debug.launchArgsInvalid': 'Закройте кавычки и завершите экранирование в аргументах.',
  'debug.launchFailed': 'Не удалось запустить программу: {detail}',
  'debug.launchExitedEarly': 'Программа завершилась до подключения отладчика.',
  'debug.launchFailedPlain':
    'Не удалось запустить программу. Дополнительная информация — в подробностях.',
  'debug.sourceDeclaration':
    'В файле деклараций нет исполняемого кода. Откройте реализацию, чтобы поставить точку остановки.',
  'debug.sourceTest':
    'Запущенная программа не загружает этот тестовый файл. Запустите тесты с отладкой, чтобы остановиться здесь.',
  'debug.sourceGenerated':
    'Этот собранный файл здесь недоступен. Для отладки откройте его исходный код.',
  'debug.breakpointDisabled': 'Точка остановки отключена',
  'debug.removeBreakpoints': 'Удалить все точки остановки',
  'debug.breakpointOptions': 'Действия с точкой остановки',
  'debug.caughtExceptions': 'Перехваченные исключения',
  'debug.uncaughtExceptions': 'Неперехваченные исключения',
  'debug.editCondition': 'Изменить условие',
  'debug.editLogMessage': 'Сообщение журнала',
  'debug.editHitCount': 'Число попаданий',
  'debug.hitCountUnavailable': 'Этот узел не поддерживает счётчик попаданий',
  'debug.disableBreakpoint': 'Отключить точку остановки',
  'debug.enableBreakpoint': 'Включить точку остановки',
  'debug.approvalPending': 'Ожидает подтверждения в отладчике',
  'debug.recordPointRefused': 'Не удалось подтвердить сохранение точки записи: {reason}',
  'debug.breakpointUnbound':
    'Программа пока не загрузила код для этой строки. Проверьте карту исходного кода или дождитесь загрузки этого кода.',
  'debug.watchLastValue': 'Последнее значение: {value}',
  'debug.logPoint': 'Точка журнала: {message}',
  'node.delegation.paused': 'Приостановлен; можно продолжить',
  'node.delegation.ownerAnswer':
    'Ожидается ваше разрешение. Ответьте на запрос на этой карточке или откройте дочерний чат. Менеджер не может ответить за вас.',
  'node.delegation.pausedPrompt':
    'Достигнут лимит времени в ожидании вашего ответа. Ответьте на сохранённый запрос и продолжите работу разработчика.',
  'node.delegation.pausedLimit':
    'Достигнут лимит времени. Отправьте сообщение, чтобы продолжить в том же чате и рабочем дереве.',
  'node.manager.session': 'Сессия',
  'node.manager.sourceWorktree': 'Исходное рабочее дерево',
  'node.manager.command': 'Команда',
  'node.manager.invalidCommand':
    'Укажите либо argv, либо command и одну цель: project_id или worktree_id. Проверьте диапазоны timeout_ms и output_bytes.',
  'node.manager.invalidIntegration':
    'Для интеграции нужны исходное и целевое рабочие деревья, имена обеих веток и свежие полные хеши их коммитов.',
  'node.manager.invalidCancel': 'Укажите session_id и run_id команды для отмены.',
  'node.manager.branches': 'Ветки',
  'node.manager.folder': 'Папка',
  'node.manager.sourceHead': 'Исходный коммит',
  'node.manager.targetHead': 'Целевой коммит',
  'node.manager.evidence': 'Точные данные запроса',
  'node.manager.exitCode': 'Код завершения: {code}',
  'node.manager.output': 'Вывод',
  'node.manager.truncated': 'Начало вывода сокращено.',
  'settings.metadata.nodeManagerRun': 'Запустить команду',
  'settings.metadata.nodeManagerStatus': 'Проверить команду',
  'settings.metadata.nodeManagerCancel': 'Отменить команду',
  'settings.metadata.nodeManagerIntegrate': 'Включить ветку',
  'node.manager.pending': 'Ожидает подтверждения',
  'node.manager.exited': 'Завершено',
  'node.manager.timedOut': 'Достигнут лимит времени',
  'node.manager.denied': 'Отклонено',
  'node.error.backpressure':
    'Соединение не успело получить вывод узла. Переподключитесь, чтобы получить оставшиеся события.',
} satisfies TranslationCatalog
