import type { TranslationCatalog } from '../../catalogs'
export const es = {
  'node.files.directoryDeleteSummary': '¿Eliminar la carpeta {path} con {files} en {folders}?',
  'node.files.directoryMoveSummary':
    '¿Mover la carpeta {path} con {files} en {folders} a {destination}?',
  'node.files.showFiles': 'Mostrar archivos',
  'node.files.uncommitted': 'Sin confirmar',
  'node.files.untracked': 'Sin seguimiento',
  'node.files.gitStatusUnavailable': 'Estado de Git no disponible',
  'node.files.gitRecoveryWarning':
    'El contenido sin confirmar o sin seguimiento no se puede recuperar de Git.',
  'node.files.fileCount': {
    one: '{count} archivo',
    many: '{count} archivos',
    other: '{count} archivos',
  },
  'node.files.folderCount': {
    one: '{count} carpeta',
    many: '{count} carpetas',
    other: '{count} carpetas',
  },
  'node.files.renameAction': 'Renombrar',
  'node.files.moveAction': 'Mover',
  'node.files.directoryConfirm':
    '¿Eliminar la carpeta {path}? Se eliminarán todos los elementos siguientes:',
  'node.files.directoryMoveConfirm':
    '¿Mover la carpeta {path} a {destination}? Se moverán todos los elementos siguientes:',
  'node.files.gitLock': 'Bloqueo del árbol de trabajo Git',
  'node.localRunning': 'AbeleNode se está ejecutando en este equipo',
  'node.files.nameOnly': 'Introduzca un nombre de archivo sin carpetas.',
  'node.files.attachMessage':
    '¿Mostrar los otros árboles de trabajo del repositorio y permitir editar archivos en el que elija? La ejecución de agentes sigue necesitando una aprobación aparte.',
  'node.files.saveLocked': 'Guardar está bloqueado aquí',
  'node.files.newFile': 'Nuevo archivo…',
  'node.files.newFolder': 'Nueva carpeta…',
  'node.files.rename': 'Renombrar…',
  'node.files.move': 'Mover…',
  'node.files.delete': 'Eliminar…',
  'node.files.deleteConfirm': '¿Eliminar {path}? Se eliminará el archivo de esta carpeta.',
  'node.files.allowEditing':
    '¿Permitir crear, editar, mover y eliminar archivos en este árbol de trabajo? Esto no permite ejecutar agentes.',
  'node.files.worktreeBusyTitle': 'El árbol de trabajo está en uso',
  'node.files.worktreeBusy':
    'Este árbol de trabajo está ocupado por: {holders}. Detenga sus sesiones antes de eliminarlo.',
  'node.files.unknownHolder': 'otra operación en el nodo',
  'node.files.stopSessions': 'Detener estas sesiones',
  'node.files.sessionsStopped':
    'Sesiones detenidas. Cuando terminen de detenerse, seleccione de nuevo Eliminar árbol de trabajo.',
  'node.error.busy':
    'Esta carpeta o árbol de trabajo está en uso. Detenga sus sesiones antes de eliminarlo.',
  'node.codeLineUnavailable': 'Las líneas enlazadas ya no existen en este archivo.',
  'maps.lightAddressExample': 'https://tiles.example.com/{z}/{x}/{y}.png',
  'maps.darkAddressExample': 'https://tiles.example.com/dark/{z}/{x}/{y}.png',
  'node.error.size': 'La solicitud es demasiado grande. Reduce su tamaño y vuelve a intentarlo.',
  'node.error.route':
    'Se rechazó la dirección del nodo. Comprueba la dirección permitida por la invitación de vinculación.',

  'node.error.tls':
    'No se pudo conectar al nodo de forma segura. Comprueba la dirección, el certificado y la conexión.',
  'node.error.access': 'El nodo denegó el acceso. Vuelve a vincularlo o comprueba los permisos.',
  'node.error.unknownOutcome':
    'El resultado es desconocido. Actualiza y comprueba qué ocurrió antes de reintentar.',
  'node.error.outputLimit':
    'El nodo devolvió demasiados datos. Acota la solicitud o usa la paginación.',
  'node.error.limit': 'El nodo alcanzó un límite. Espera antes de reintentar.',
  'node.error.debugger':
    'El depurador no está disponible. Comprueba la configuración de depuración y vuelve a conectar.',
  'node.error.generic':
    'El nodo no pudo completar la solicitud. Comprueba los detalles antes de reintentar.',
  'node.error.connection': 'El nodo está desconectado. Comprueba la conexión y vuelve a conectar.',
  'node.error.pairing':
    'No se pudo completar la vinculación. Comprueba la invitación y vuelve a vincular.',
  'node.error.identity':
    'El nodo o el destino ha cambiado. Comprueba su identidad y vuelve a conectar.',
  'node.error.stale': 'Los datos han cambiado. Actualiza antes de reintentar.',
  'node.error.staleResource':
    'La carpeta o copia de trabajo ha cambiado. Actualiza y vuelve a seleccionarla.',
  'node.error.folderUnavailable':
    'Esta carpeta ya no está disponible en el nodo. Puede haberse eliminado o haber dejado de ser un repositorio.',
  'node.folderRefreshed':
    'La carpeta se ha actualizado. Pulsa Crear de nuevo para crear la carpeta indicada.',
  'node.error.trust':
    'Esta carpeta no es de confianza. Revisa la configuración de confianza antes de continuar.',
  'node.error.unavailable':
    'Esta función no está disponible. Comprueba la configuración y la versión del nodo.',

  'kit.cancel': 'Cancelar',
  'kit.delete': 'Eliminar',
  'kit.deleteTooltip': 'Eliminar este elemento',
  'kit.cancelTooltip': 'Cerrar sin cambiar nada',
  'kit.filename': 'nombre del archivo',
  'kit.create': 'Crear',
  'kit.submitTooltip': 'Continuar con este texto',
  'kit.where': 'Ubicación',
  'kit.allLevels': 'Mostrar todos los niveles',
  'kit.empty': 'Aún no hay elementos',
  'kit.noMatches': 'No hay coincidencias',
  'kit.loading': 'Cargando…',
  'kit.loadError': 'No se pudieron cargar los elementos',
  'kit.details': 'Detalles',
  'kit.noEvents': 'Aún no hay eventos',
  'kit.sourceMissing': 'Fuente no disponible',
  'kit.saveError': 'No se pudo guardar',
  'kit.progress': 'Progreso',
  'kit.clear': 'Quitar selección',
  'kit.selectAll': 'Seleccionar todo',
  'kit.chooseNone': 'Quitar la selección de todos',
  'kit.chooseAll': 'Seleccionar todos los elementos',
  'kit.chooseIcon': 'Elegir un icono',
  'kit.searchIcons': 'Buscar iconos, p. ej., calendar',
  'kit.noIcon': 'No hay iconos con un nombre parecido a «{query}».',
  'kit.refreshing': 'Actualizando…',
  'kit.objectMissing': 'Objeto no disponible',
  'kit.objectError': 'No se pudo cargar el objeto',
  'kit.waiting': 'Esperando tu respuesta',
  'kit.closeSearch': 'Cerrar la búsqueda',
  'kit.folder': 'Carpeta',
  'kit.scope': 'Ámbito',
  'kit.unknown': 'Desconocido',
  'kit.removeNote': 'Quitar esta nota',
  'kit.copyPath': 'Copiar la ruta completa',
  'kit.reveal': 'Mostrar en el explorador de archivos',
  'kit.targetMissing': 'Destino no disponible',
  'kit.vaultRoot': 'Raíz de la bóveda',
  'kit.previousMonth': 'Mes anterior',
  'kit.dateRange': 'Elegir un intervalo de fechas',
  'kit.nextMonth': 'Mes siguiente',
  'kit.noQuote': 'No hay texto citado',
  'kit.collapseQuote': 'Contraer la cita',
  'kit.expandQuote': 'Expandir la cita',
  'kit.exactTime': 'Hora exacta',
  'kit.working': 'En curso',
  'kit.done': 'Hecho',
  'kit.failed': 'Falló',
  'kit.skipped': 'Sin cambios',
  'kit.errors': 'Errores',
  'kit.moreBelow': 'Más abajo',
  'kit.selection': 'Selección',
  'kit.moreActions': 'Más acciones',
  'kit.showRest': 'Mostrar el resto de la lista',
  'kit.showMore': {
    one: 'Mostrar {count} más',
    many: 'Mostrar {count} más',
    other: 'Mostrar {count} más',
  },
  'kit.underlineOn': 'Subrayado activado',
  'kit.underlineOff': 'Subrayado desactivado',
  'kit.underline': 'Subrayar la anotación',
  'kit.savingColour': 'Guardando el color',
  'kit.selectionMissing': 'Selección no disponible',
  'kit.noColour': 'Sin color',
  'kit.savingNamedColour': 'Guardando: {colour}…',
  'kit.colourDisabled': 'Aquí no se puede cambiar el color',
  'kit.waveform': 'Forma de onda',
  'kit.colour.grey': 'Gris',
  'kit.colour.red': 'Rojo',
  'kit.colour.orange': 'Naranja',
  'kit.colour.yellow': 'Amarillo',
  'kit.colour.green': 'Verde',
  'kit.colour.cyan': 'Cian',
  'kit.colour.blue': 'Azul',
  'kit.colour.purple': 'Morado',
  'kit.colour.pink': 'Rosa',
  'settings.tabs.tasks': 'Tareas',
  'settings.tabs.logs': 'Registros',
  'settings.tabs.journals': 'Diarios',
  'settings.tabs.calendars': 'Calendarios',
  'settings.tabs.finance': 'Finanzas',
  'settings.tabs.timeTracking': 'Seguimiento del tiempo',
  'settings.tabs.ai': 'Agente de IA',
  'settings.tabs.scripts': 'Scripts',
  'settings.tabs.links': 'Enlaces',
  'settings.tabs.github': 'Alojamiento de Git',
  'settings.tabs.nodes': 'Nodos',
  'settings.tabs.reader': 'Libros',
  'settings.tabs.quickButton': 'Botón rápido',
  'settings.tabs.headerButtons': 'Botones de cabecera',
  'settings.tabs.linter': 'Comprobador de notas',
  'settings.tabs.transfer': 'Transferencia',
  'settings.tabs.sync': 'Sincronización',
  'settings.tabs.other': 'Otros',
  'settings.groups.notes': 'Notas',
  'settings.groups.moneyTime': 'Dinero y tiempo',
  'settings.groups.agents': 'Agentes',
  'settings.groups.buttons': 'Botones',
  'settings.groups.data': 'Datos',
  'settings.documentation': 'Documentación',
  'settings.documentationTooltip': 'Cerrar los ajustes y leer para qué sirve esta pestaña',
  'settings.englishDocs': 'La documentación está en inglés',
  'kit.imageMissing': 'Imagen no disponible',
  'kit.loadingImage': 'Cargando imagen…',
  'kit.deviceMissing': 'No disponible en este dispositivo',
  'kit.hideDetail': 'Ocultar: {label}',
  'kit.showDetail': 'Mostrar: {label}',
  'kit.description': 'descripción',
  'kit.openSource': 'Abrir la fuente de {title}',
  'kit.retry': 'Reintentar {title}',
  'kit.moreIcons': '{count} iconos más abajo',
  'kit.image': 'imagen',
  'kit.imageMissingNamed': 'Imagen no disponible: {name}',
  'kit.previewImage': 'Vista previa de {name}',
  'kit.inputLoading': 'Cargando',
  'kit.partOf': '{shown} de {total}',
  'kit.workspace': 'Espacio de trabajo: {name}',
  'kit.qrCode': 'Código QR',
  'kit.askSelection': 'Preguntar al agente sobre esto en un chat nuevo',
  'kit.addSelection': 'Añadir al chat abierto',
  'node.trust.title': '¿Confiar en esta carpeta para los agentes?',
  'node.trust.message':
    'Los agentes podrán ejecutar comandos y cambiar archivos en {path}. Confía en esta carpeta solo si conoces su contenido. Puedes seguir al agente en su chat y detenerlo allí.',
  'node.trust.allow': 'Confiar en la carpeta',
  'node.chat.closeTab':
    'Cerrar pestaña: la sesión permanece en el nodo. Ábrela desde el panel del nodo para seguirla o detenerla.',
  'kit.noteSelection': 'Insertar en la última nota abierta',
  'kit.linkSelection': 'Copiar un enlace a estas líneas',
  'kit.saving': 'Guardando…',
  'commands.convert-drawings-to-canvases': 'Convertir dibujos antiguos en lienzos',
  'drawing.conversion-result':
    'Dibujos: {converted} convertidos, {existing} ya convertidos, {failed} fallidos. Originales conservados.',
  'commands.migrate-excalidraw-drawing': 'Migrar este dibujo de Excalidraw a un lienzo',
  'commands.migrate-excalidraw-vault': 'Migrar todos los dibujos de Excalidraw a lienzos',
  'commands.new-canvas': 'Nuevo lienzo',
  'commands.open-canvas-viewer': 'Abrir el lienzo actual en el visor de diagramas',
  'commands.open-changelog': 'Abrir el registro de cambios',
  'commands.cycle-checkbox-state': 'Cambiar el estado de la casilla',
  'commands.insert-columns': 'Insertar columnas',
  'commands.column-options': 'Opciones de columnas',
  'commands.remove-columns': 'Eliminar columnas',
  'commands.add-text-comment': 'Añadir comentario',
  'commands.open-node-repository': 'Abrir el repositorio del nodo',
  'commands.chat-about-github-item': 'Conversar sobre este elemento de GitHub',
  'commands.open-github-repository': 'Abrir repositorio de GitHub…',
  'commands.show-github-notifications': 'Mostrar notificaciones de GitHub',
  'commands.open-github-link': 'Abrir enlace o elemento de GitHub',
  'commands.copy-link-to-lines': 'Copiar enlace a las líneas seleccionadas',
  'commands.linter-open': 'Abrir el analizador',
  'commands.linter-lint-note': 'Analizar la nota actual',
  'commands.linter-lint-folder': 'Analizar carpeta…',
  'commands.linter-lint-vault': 'Analizar la bóveda',
  'commands.sync-now': 'Sincronizar ahora',
  'commands.sync-pause-resume': 'Pausar o reanudar la sincronización',
  'commands.sync-log': 'Abrir ajustes de sincronización',
  'commands.sync-deleted-files': 'Abrir archivos eliminados',
  'commands.reader-toggle-eink':
    'Alternar el modo de tinta electrónica para libros en este dispositivo',
  'commands.reader-toggle-zen': 'Alternar el modo zen para libros en este dispositivo',
  'commands.open-requests': 'Abrir solicitudes',
  'commands.import-requests': 'Importar solicitudes del portapapeles',
  'commands.new-presentation': 'Nueva presentación',
  'commands.open-presentation': 'Abrir presentación',
  'commands.preview-presentation': 'Previsualizar presentación junto al editor',
  'commands.play-presentation': 'Reproducir presentación',
  'commands.present-presentation': 'Presentar con vista del orador',
  'commands.agents': 'Agentes',
  'ribbon.agents': 'Agentes',
  'commands.comment-here': 'Comentar aquí',
  'commands.show-ai-sidebar': 'Mostrar panel lateral del chat de IA',
  'commands.find-in-chat': 'Buscar en el chat actual',
  'commands.search-all-chats': 'Buscar en todos los chats',
  'commands.chat-close-tab': 'Cerrar la pestaña de chat actual',
  'commands.chat-reopen-tab': 'Reabrir la última pestaña de chat cerrada',
  'commands.chat-next-tab': 'Ir a la siguiente pestaña de chat',
  'commands.chat-previous-tab': 'Ir a la pestaña de chat anterior',
  'ribbon.show-ai-chat': 'Mostrar chat de IA',
  'commands.voice-input': 'Dictar en la nota',
  'commands.show-script-runs': 'Mostrar ejecuciones de scripts',
  'commands.open-documentation': 'Abrir documentación',
  'commands.open-quick-menu': 'Abrir menú rápido',
  'commands.show-script-api': 'Mostrar referencia de la API de scripts',
  'commands.review-key-destinations': 'Revisar destinos de claves',
  'commands.create-task': 'Crear nueva tarea',
  'commands.create-task-and-insert-link': 'Crear nueva tarea e insertarla en la nota actual',
  'commands.find-and-replace':
    'Buscar y reemplazar en los metadatos y el contenido de todas las notas que cumplan los criterios',
  'commands.import-files': 'Importar archivos a la bóveda',
  'commands.save-media': 'Guardar archivos multimedia remotos en la bóveda',
  'commands.unused-media': 'Buscar y eliminar archivos multimedia sin usar',
  'commands.deduplicate-media': 'Eliminar duplicados de adjuntos multimedia',
  'commands.migrate-from-dataview': 'Migrar tareas de Dataview',
  'commands.migrate-from-firefly': 'Migrar datos de Firefly III',
  'commands.create-transaction': 'Crear nueva transacción',
  'commands.create-transaction-and-insert-link':
    'Crear nueva transacción e insertarla en la nota actual',
  'commands.show-timeline-sidebar': 'Mostrar panel lateral de cronología',
  'commands.migrate-dataview-fields': 'Migrar campos de Dataview',
  'commands.show-todo-sidebar': 'Mostrar panel lateral de tareas',
  'commands.show-finance-sidebar': 'Mostrar panel lateral de finanzas',
  'commands.show-accounts-sidebar': 'Mostrar panel lateral de cuentas',
  'commands.migrate-from-toggl': 'Migrar registros de tiempo de Toggl',
  'commands.show-time-tracking-sidebar': 'Mostrar panel lateral de control de tiempo',
  'commands.start-timer': 'Iniciar temporizador para la nota actual',
  'commands.stop-timer': 'Detener el temporizador activo',
  'commands.paste-from-clipboard': 'Pegar del portapapeles en el cursor',
  'commands.create-note-from-template': 'Crear nota a partir de plantilla',
  'commands.create-note-in-group': 'Crear nota en grupo',
  'commands.replace-note-with-template': 'Reemplazar la nota actual por una plantilla',
  'commands.insert-template-at-cursor': 'Insertar plantilla en el cursor',
  'commands.insert-gallery': 'Insertar galería de imágenes',
  'commands.convert-images-to-galleries': 'Convertir las imágenes de la página en galerías',
  'commands.reindex-footnotes': 'Renumerar notas al pie',
  'commands.insert-highlight': 'Insertar resaltado de color',
  'commands.remove-highlight': 'Eliminar resaltado de color',
  'commands.set-cover-from-first-media':
    'Establecer portada con la primera imagen o vídeo de la nota',
  'commands.open-today-daily-note': 'Abrir la nota diaria de hoy',
  'commands.create-css-snippet': 'Crear fragmento CSS',
  'commands.reload-css-snippets': 'Recargar fragmentos CSS',
  'commands.create-script': 'Crear script',
  'ribbon.show-timeline-sidebar': 'Mostrar panel lateral de cronología',
  'ribbon.show-todo-sidebar': 'Mostrar panel lateral de tareas',
  'ribbon.show-finance-sidebar': 'Mostrar panel lateral de finanzas',
  'ribbon.show-time-tracking': 'Mostrar control de tiempo',
  'ribbon.show-script-runs': 'Mostrar ejecuciones de scripts',
  'commands.open-node': 'Abrir nodo',
  'ribbon.node': 'Nodo',
  'commands.toggle-zen-mode': 'Alternar modo zen',
  'commands.add-to-agent-context': 'Añadir al contexto del agente',
  'commands.chat-about-current-note': 'Conversar sobre esto',
  'commands.attach-note-to-chat': 'Adjuntar a un chat',
  'commands.attach-chat-to-current-note': 'Adjuntar un chat a la nota',
  'commands.copy-note-wikilink': 'Copiar wikienlace',
  'commands.review-scripts': 'Revisar scripts pendientes de confirmación',
  'commands.script': 'Script: {name}',
  'settings.nodes.title': 'Nodos',
  'settings.nodes.description':
    'Equipos en los que el agente puede trabajar: abra uno, elija un proyecto y observe y responda aquí. Sus claves e historial permanecen en este dispositivo.',
  'settings.nodes.check': 'Comprobar la conexión de este dispositivo con el nodo',
  'settings.nodes.open': 'Abrir sesión',
  'settings.nodes.openTip': 'Elegir una sesión o gestionar proyectos y espacios de trabajo',
  'settings.nodes.more': 'Emparejamiento, delegación, eliminación',
  'settings.nodes.pairTitle': 'Emparejar un nodo en otro equipo',
  'settings.nodes.pairDesc':
    'Un equipo remoto o servidor, mediante su invitación. Un dispositivo cuyo acceso se revocó se empareja de nuevo de la misma forma.',
  'settings.nodes.pair': 'Emparejar',
  'settings.nodes.pairTip':
    'Escanear o pegar una invitación; volver a emparejar o verificar una clave de nodo modificada',
  'settings.nodes.addTitle': 'Añadir el nodo de este equipo',
  'settings.nodes.addDesc': 'Uno que se ejecuta aquí, mediante su token.',
  'settings.nodes.add': 'Añadir',
  'settings.nodes.addTip': 'Nombrar el nodo aquí y pegar su token',
  'settings.nodes.traceTitle': 'Notas sobre ejecuciones grabadas',
  'settings.nodes.traceDesc':
    'Carpeta para una nota sobre una ejecución grabada por el depurador, suya o del agente: una carpeta de la bóveda o cualquier carpeta del equipo con su ruta completa. La ejecución permanece en el nodo.',
  'settings.nodes.traceExample': 'p. ej., Trace',
  'settings.nodes.traceFolder': 'Carpeta de notas sobre ejecuciones grabadas',
  'settings.nodes.chooseFolderTip':
    'Elegir una carpeta de este equipo, dentro o fuera de la bóveda',
  'settings.nodes.chooseFolder': 'Elegir una carpeta de notas sobre ejecuciones grabadas',
  'settings.nodes.name': 'Nombre',
  'settings.nodes.nameDesc': 'Cómo se llama este nodo en este dispositivo.',
  'settings.nodes.localPlaceholder': 'Nodo local',
  'settings.nodes.label': 'Nombre del nodo',
  'settings.nodes.address': 'Dirección',
  'settings.nodes.addressDesc':
    'Solo la dirección de este equipo; otro equipo se conecta mediante emparejamiento.',
  'settings.nodes.url': 'URL del nodo',
  'settings.nodes.token': 'Token',
  'settings.nodes.tokenDesc':
    'El que muestra abele-node token create. Se guarda solo en el llavero de este dispositivo.',
  'settings.nodes.pasteToken': 'Pegar token',
  'settings.nodes.installationToken': 'Token de instalación del nodo',
  'settings.nodes.cancel': 'Cancelar',
  'settings.nodes.cancelTip': 'Cerrar sin añadir nada',
  'settings.nodes.authenticateTip':
    'Autenticar y fijar la identidad del nodo local en este dispositivo',
  'settings.nodes.untitledChat': 'Chat sin título',
  'settings.nodes.unavailable': 'Nodo no disponible',
  'settings.nodes.added': 'Conectado. Abra una sesión aquí o desde el menú de nuevo chat.',
  'settings.nodes.connected': 'Conectado',
  'settings.nodes.connecting': 'Conectando…',
  'settings.nodes.disconnected': 'Sin conexión',
  'settings.nodes.repair': 'Emparejar / volver a emparejar',
  'settings.nodes.delegation': 'Permisos de delegación',
  'settings.nodes.remove': 'Eliminar',
  'settings.nodes.removed':
    'Conexión eliminada de este dispositivo. El historial del nodo y la credencial del demonio no han cambiado.',
  'commands.insert-columns-two': 'Insertar dos columnas iguales',
  'commands.insert-columns-three': 'Insertar tres columnas iguales',
  'commands.insert-columns-aside': 'Insertar texto con una columna lateral',
  'ribbon.agentsStatus': 'Agentes · Requieren atención: {attention}. Trabajando: {running}',
  'ribbon.agentsStatusIncomplete':
    'Agentes · Requieren atención: {attention}. Trabajando: {running} · No se pudieron comprobar algunas conversaciones',
  'settings.AiSettings.general.c910d474': 'General',
  'settings.AiSettings.models.d17d2d78': 'Modelos',
  'settings.AiSettings.agents.279b44d2': 'Agentes',
  'settings.AiSettings.prompts.5f2e66e6': 'Indicaciones',
  'settings.AttachmentRulesSettings.attachment_folders.4ec7937c': 'Carpetas adjuntas',
  'settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d':
    'Los archivos pegados o colocados en una nota en una de estas carpetas van a la carpeta con los nombres de sus reglas. Gana la carpeta más profunda.',
  'settings.AttachmentRulesSettings.add_a_rule.bed79361': 'Agregar una regla',
  'settings.AttachmentRulesSettings.notes_in.af0c6387': 'Notas en',
  'settings.AttachmentRulesSettings.notes_folder.b8c1e974': 'Carpeta de notas',
  'settings.AttachmentRulesSettings.folder.74ccd433': 'Carpeta',
  'settings.AttachmentRulesSettings.remove_this_rule.00612239': 'Eliminar esta regla',
  'settings.AttachmentRulesSettings.attachments_go_to.7b114ade': 'Los archivos adjuntos van a',
  'settings.AttachmentRulesSettings.attachment_folder.fce49098': 'Carpeta de archivos adjuntos',
  'settings.AttachmentRulesSettings.subfolder_name.f381c5ab': 'Nombre de la subcarpeta',
  'settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7':
    'Sin reglas: los archivos adjuntos siguen la configuración de Obsidian.',
  'settings.AttachmentRulesSettings.add_a_folder_rule.879a8360': 'Agregar una regla de carpeta',
  'settings.AttachmentRulesSettings.same_folder_as_the_note.32781177': 'Misma carpeta que la nota.',
  'settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55':
    'En la carpeta especificada a continuación',
  'settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483':
    'En la subcarpeta debajo de la carpeta de la nota.',
  'settings.AttachmentRulesSettings.whole_vault.cb44fe25': 'Bóveda entera',
  'settings.CalendarsSettings.calendars.e0b2b00c': 'Calendarios',
  'settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b':
    'Eventos de Google, iCloud, Outlook o cualquier servidor CalDAV, mostrados al lado de las tareas: en el calendario de la barra lateral, la línea de tiempo y una nota diaria. Solo lectura: nunca se escribe nada en un calendario y no se toman notas a menos que usted solicite una en un evento.',
  'settings.CalendarsSettings.read_every_minutes.f4ca625e': 'Leer cada (minutos)',
  'settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf':
    'Cuando se inicia Obsidian, esto ocurre a menudo mientras está abierto. {value0} al menos; El propio Google actualiza un enlace sólo cada pocas horas.',
  'settings.CalendarsSettings.read_now.20d8b246': 'Leer ahora',
  'settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9':
    'Lee cada calendario que se muestra nuevamente, ahora',
  'settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f':
    'Aún no se muestra ningún calendario',
  'settings.CalendarsSettings.your_calendars.80ca6c5e': 'Tus calendarios',
  'settings.CalendarsSettings.not_read.e4f441c4': 'No leído: ',
  'settings.CalendarsSettings.change_this_calendar.a6ced910': 'Cambiar este calendario',
  'settings.CalendarsSettings.add_another_calendar.744b9f9c': 'Añadir otro calendario',
  'settings.CalendarsSettings.no_calendars_yet.0097b3fe': 'Aún no hay calendarios',
  'settings.CalendarsSettings.a_secret_link_from_google.21e49135':
    'Un enlace secreto de Google, iCloud o Outlook, o una cuenta CalDAV.',
  'settings.CalendarsSettings.add_calendar.9067e0e8': 'Agregar calendario',
  'settings.CalendarsSettings.add_a_calendar_to_show.6973ff63':
    'Agregar un calendario para mostrar al lado de las tareas',
  'settings.CalendarsSettings.name.dcd1d522': 'Nombre',
  'settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee':
    'Se muestra al lado de cada uno de sus eventos.',
  'settings.CalendarsSettings.e_g_work.7f2ce0de': 'p.ej. {literal0}',
  'settings.CalendarsSettings.colour.3a9dfa58': 'Color',
  'settings.CalendarsSettings.its_events_are_marked_with.16eafb54':
    'Sus acontecimientos están marcados con él.',
  'settings.CalendarsSettings.connected_by.9952ce52': 'Conectado por',
  'settings.CalendarsSettings.a_secret_link_to_the.9b051a7d':
    'Un enlace secreto al calendario o una cuenta CalDAV con su nombre de usuario y contraseña.',
  'settings.CalendarsSettings.link.a6a32dbc': 'Enlace',
  'settings.CalendarsSettings.forget_the_link.45aee758': 'olvida el enlace',
  'settings.CalendarsSettings.server.aef7de28': 'Servidor',
  'settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72':
    'La dirección CalDAV: {literal0} para iCloud, {literal1} para Fastmail, la dirección de su Nextcloud para Nextcloud.',
  'settings.CalendarsSettings.username.e3b89e9d': 'Nombre de usuario',
  'settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f':
    'Para iCloud, el correo electrónico de la cuenta Apple.',
  'settings.CalendarsSettings.password.e7cf3ef4': 'Contraseña',
  'settings.CalendarsSettings.app_specific_password.ffcc8f77':
    'Contraseña específica de la aplicación',
  'settings.CalendarsSettings.forget_the_password.9d745dd0': 'Olvida la contraseña',
  'settings.CalendarsSettings.calendar.d5d0a30b': 'Calendario',
  'settings.CalendarsSettings.one_calendar_of_the_account.562ef915':
    'Un calendario de la cuenta, o todos. Buscar calendarios pregunta al servidor cuáles hay.',
  'settings.CalendarsSettings.find_calendars.d59c2286': 'encontrar calendarios',
  'settings.CalendarsSettings.set_the_server_the_username.111eaa0a':
    'Configure primero el servidor, el nombre de usuario y la contraseña.',
  'settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb':
    'Preguntar al servidor qué calendarios tiene esta cuenta',
  'settings.CalendarsSettings.delete.e2d0a549': 'Eliminar',
  'settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787':
    'Elimina este calendario de la configuración y su clave del llavero',
  'settings.CalendarsSettings.done.11a6767d': 'Listo',
  'settings.CalendarsSettings.close_this_window_changes_are.91342d87':
    'Cierra esta ventana; Los cambios se mantienen a medida que los realiza.',
  'settings.CalendarsSettings.delete_the_calendar.e601c301': 'Eliminar el calendario',
  'settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0':
    '¿Eliminar {value0}? Sus eventos salen de las listas y su {value1} se elimina del llavero. El calendario en sí no se toca.',
  'settings.CalendarsSettings.google_the_calendar_s_settings.065b586e':
    'Google: configuración del calendario, “Dirección secreta en formato iCal”. iCloud: comparte el calendario como calendario público y copia su enlace. Outlook: publique el calendario y copie el enlace de ICS. Guardado en el llavero: cualquiera que tenga el enlace puede leer el calendario.',
  'settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48':
    'Para iCloud, una contraseña específica de la aplicación creada en account.apple.com, no la de la cuenta. Guardado en el llavero, nunca en el archivo de configuración.',
  'settings.CalendarsSettings.secret_link_ics.a3f8db65': 'Enlace secreto (ICS)',
  'settings.CalendarsSettings.caldav_account.bb860701': 'cuenta CalDAV',
  'settings.CalendarsSettings.the_value_could_not_be.3daaa765':
    'El {value0} no se pudo guardar en el llavero: {value1}',
  'settings.CalendarsSettings.asking_the_server.fb689559': 'Preguntando al servidor...',

  'settings.CalendarsSettings.the_account_has_no_calendar.a059bc95':
    'La cuenta no tiene calendario con eventos.',
  'settings.CalendarsSettings.all_calendars_of_the_account.3b138d44':
    'Todos los calendarios de la cuenta.',
  'settings.CalendarsSettings.just_now.7ddb44d8': 'En este momento',
  'settings.CalendarsSettings.value_min_ago.c85acd7d': '{value0} hace minutos',
  'settings.CalendarsSettings.not_shown.a08f0f94': 'No mostrado',
  'settings.CalendarsSettings.reading.874bfa5b': 'Lectura…',
  'settings.CalendarsSettings.no_password_yet.11f1e05e': 'Aún no hay contraseña',
  'settings.CalendarsSettings.no_link_yet.60e5be61': 'Aún no hay enlace',
  'settings.CalendarsSettings.could_not_be_read.51a02791': 'No se pudo leer',
  'settings.CalendarsSettings.not_read_yet.fbe841ea': 'Aún no leído',
  'settings.CalendarsSettings.reading_the_calendars.b8ec37a1': 'Leyendo los calendarios...',
  'settings.CalendarsSettings.value_of_the_calendars_could.c86147d0':
    'No se pudo leer {value0} de los calendarios; cada uno dice por qué a continuación.',
  'settings.CalendarsSettings.read_every_calendar_again_now.d8b13597':
    'Lea cada calendario nuevamente ahora en lugar de hacerlo en el siguiente intervalo.',
  'settings.FinanceSettings.transactions.3e5136fd': 'Actas',
  'settings.FinanceSettings.transaction_path_template.39b564b9': 'Plantilla de ruta de transacción',
  'settings.FinanceSettings.template_for_new_transaction_file.0e3740ec':
    'Plantilla para nuevas rutas de archivos de transacciones. Déjelo vacío para mantener los caminos existentes; Las nuevas transacciones utilizan sus títulos en la raíz de la bóveda. Variables: {literal0}, {literalDate}, {literal1}, {literal2}, {literal3}, {literal4}.',
  'settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45': 'p.ej. {literal1}',
  'settings.FinanceSettings.transaction_template_note.010eab6c': 'Nota de plantilla de transacción',
  'settings.FinanceSettings.path_to_a_template_note.397b813a':
    'Ruta a una nota de plantilla utilizada al crear nuevas transacciones.',
  'settings.FinanceSettings.path_to_template_note.18b70a08': 'Ruta a la nota de plantilla',
  'settings.FinanceSettings.default_currency.67e65877': 'Moneda predeterminada',
  'settings.FinanceSettings.default_currency_code_for_new.7d536f52':
    'Código de moneda predeterminado para nuevas transacciones.',
  'settings.FinanceSettings.e_g_eur.00afdaf5': 'p.ej. {literal0}',
  'settings.FinanceSettings.pinned_currencies.b882d6bc': 'Monedas fijadas',
  'settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698':
    'Monedas separadas por comas para mostrar resúmenes de saldos en la barra lateral. Se conserva el orden.',
  'settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64': 'p.ej. {literal0}',
  'settings.FinanceSettings.exchange_rates.a1875e41': 'Tipos de cambio',
  'settings.FinanceSettings.fetch_today_s_rates.c175748e': 'Obtenga las tarifas de hoy',
  'settings.FinanceSettings.once_a_day_from_a.73d47942':
    'Una vez al día, desde una mesa pública que no necesita clave; no se envía nada sobre la bóveda. Se utilizan sumas de varias monedas y el orden de las cuentas por importe.',
  'settings.FinanceSettings.show_sums_in.86b3b3d2': 'Mostrar sumas en',
  'settings.FinanceSettings.the_currency_a_sum_of.42c9988d':
    'La moneda en la que se muestra la suma de varias monedas.',
  'settings.FinanceSettings.rates.54dd2169': 'Tarifas',
  'settings.FinanceSettings.fetch_today_s_rates_now.68e35189': 'Obtenga las tarifas de hoy ahora',
  'settings.FinanceSettings.firefly_iii_migration.59031cf7': 'Migración de Firefly III',
  'settings.FinanceSettings.firefly_iii_url.3050cc31': 'URL de luciérnaga III',
  'settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a':
    'URL base de su instancia de Firefly III.',
  'settings.FinanceSettings.e_g_https_firefly_example.6999e343': 'p.ej. {literal1}',
  'settings.FinanceSettings.firefly_iii_token.45c3acb2': 'Ficha de luciérnaga III',
  'settings.FinanceSettings.personal_access_token_for_firefly.7deff96a':
    'Token de acceso personal para la API Firefly III. Almacenado en el llavero, nunca en el archivo de configuración.',
  'settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788': 'Ingrese su token Firefly III',
  'settings.FinanceSettings.forget_the_token.961a44b9': 'Olvídate de la ficha',
  'settings.FinanceSettings.accounts_folder.8f9b5bf3': 'Carpeta de cuentas',
  'settings.FinanceSettings.folder_for_account_notes_created.dab1fa98':
    'Carpeta para notas de cuenta creada durante la migración.',
  'settings.FinanceSettings.enter_accounts_folder_path.93935780':
    'Ingrese la ruta de la carpeta de cuentas',
  'settings.FinanceSettings.categories_folder.60253c7c': 'Carpeta de categorías',
  'settings.FinanceSettings.folder_for_category_notes_created.9f0764fe':
    'Carpeta para notas de categoría creadas durante la migración.',
  'settings.FinanceSettings.enter_categories_folder_path.306fac3f':
    'Ingrese la ruta de la carpeta de categorías',
  'settings.FinanceSettings.fetching_today_s_rates.1182bcb9': 'Obteniendo las tarifas de hoy...',
  'settings.FinanceSettings.could_not_fetch_value.ae250f78': 'No se pudo recuperar: {value0}',
  'settings.FinanceSettings.not_fetched_yet.21ca804f': 'Aún no recuperado.',
  'settings.FinanceSettings.could_not_update_since_value.9af0a0fc':
    'No se pudo actualizar desde {value0}{value1}',
  'settings.FinanceSettings.from_value_value.11c05045': 'Desde {value0}, {value1}',
  'settings.FinanceSettings.no_rate_for_value_left.b8718978':
    'Sin tarifa para {value0}: excluido de las sumas',
  'settings.GithubAccessReport.token.d2089be6': 'Token',
  'settings.GithubAccessReport.sent.c16bc82b': 'Enviado',
  'settings.GithubAccessReport.not_sent.cd5f943d': 'No enviado',
  'settings.GithubAccessReport.refused.66b87354': 'Rechazado',
  'settings.GithubAccessReport.skipped.12698ce1': 'Saltado',
  'settings.GithubAccessReport.a_fine_grained_personal_access.04646cce':
    'un token de acceso personal detallado',
  'settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc':
    'un token de acceso personal clásico',
  'settings.GithubAccessReport.an_oauth_token.4e87c03e': 'un token de OAuth',
  'settings.GithubAccessReport.a_github_app_s_token.911c13a3': 'token de una aplicación GitHub',
  'settings.GithubAccessReport.a_token_of_a_kind.7af25278':
    'un token de un tipo que GitHub no marca',
  'settings.GithubAccessReport.sent_with_every_request_value.a8affe59':
    'Enviado con cada solicitud: caracteres {value0}, {value1}.',
  'settings.GithubAccessReport.no_token_was_sent_with.8d5461bf':
    'No se envió ningún token con estas solicitudes.',
  'settings.GithubAccessReport.token_is_set_for_value.2c01fdf9':
    'El token está configurado para: {value0}',
  'settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e':
    'Repositorio: {value0}/{value1} en {value2}',
  'settings.GithubAccessReport.belongs_to_value.d316930d': 'Pertenece a {value0}.',
  'settings.GithubAccessReport.expires_value.f820bc15': 'Vence {value0}.',
  'settings.GithubAccessReport.scopes_value.1d42883b': 'Alcances: {value0}.',
  'settings.GithubAccessReport.api_value.011cfaea': 'API: {value0}',
  'settings.GithubAccessReport.needs_value.9e07998c': 'Necesidades: {value0}',
  'settings.GithubAccessReport.github_said_value.cc7a0df5': 'GitHub dijo: "{value0}"',
  'settings.GithubConnectionEditor.add_github_connection.a8b1ed9f': 'Agregar conexión GitHub',
  'settings.GithubConnectionEditor.edit_github_connection.ca1cc639': 'Editar conexión de GitHub',
  'settings.GithubConnectionEditor.account.7e1b0d56': 'Cuenta',
  'settings.GithubConnectionEditor.name.dcd1d522': 'Nombre',
  'settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0':
    'Un nombre para esta conexión, independiente de la cuenta descubierta a partir de su token.',
  'settings.GithubConnectionEditor.connection_name.686d4d5d': 'Nombre de conexión',
  'settings.GithubConnectionEditor.server.aef7de28': 'Servidor',
  'settings.GithubConnectionEditor.empty_is_github_com_for.0f201123':
    'Vacío es github.com. Para Enterprise, utilice su dirección completa, incluido cualquier puerto.',
  'settings.GithubConnectionEditor.github_com.3aeb0024': 'github.com',
  'settings.GithubConnectionEditor.token.d2089be6': 'Token',
  'settings.GithubConnectionEditor.github_pat.94238580': 'github_pat_...',
  'settings.GithubConnectionEditor.forget_the_token.961a44b9': 'Olvídate de la ficha',
  'settings.GithubConnectionEditor.default_for_this_server.c7a4b365':
    'Predeterminado para este servidor',
  'settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859':
    'Se utiliza cuando ninguna preferencia del propietario del repositorio selecciona otra conexión.',
  'settings.GithubConnectionEditor.repository_owners.89c91e93': 'Propietarios del repositorio',
  'settings.GithubConnectionEditor.one_per_line_sample_org.335517a9':
    'Uno por línea: sample-org, sample-org/*, sample-* o sample-org/project. Las reglas más específicas ganan.',
  'settings.GithubConnectionEditor.sample_org_nsample_org_project.9045ecd8':
    'organización-muestra\\norg-muestra/proyecto',
  'settings.GithubConnectionEditor.check_access.abb9a172': 'Consultar acceso',
  'settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0':
    'Comprueba sólo esta conexión. Deje el repositorio vacío para descubrir la cuenta.',
  'settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009':
    'propietario/repositorio o un enlace de GitHub',
  'settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799':
    'Enviar solicitudes de lectura con el token de este borrador sin almacenarlo',
  'settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327':
    'Otra conexión utiliza la misma cuenta en este servidor. Aún puedes guardarlo.',
  'settings.GithubConnectionEditor.cancel.19766ed6': 'Cancelar',
  'settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff':
    'Descartar este borrador sin cambiar la configuración ni el llavero.',
  'settings.GithubConnectionEditor.save.1509f561': 'Guardar',
  'settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364':
    'Almacene esta conexión y su token, luego cierre el editor',
  'settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6':
    'El token se olvidará cuando guardes.',
  'settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e':
    'Se almacena un token en este dispositivo. Introduzca un reemplazo o déjelo vacío para conservarlo. Los cambios se guardan sólo con Guardar.',
  'settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60':
    'Las claves sincronizadas están bloqueadas; desbloquéelos para usar el token o ingrese uno nuevo.',
  'settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf':
    'No hay token en este dispositivo. Se almacena en el llavero solo cuando guardas.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209':
    'Proporcione propietario/repositorio o un enlace al repositorio.',
  'settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d':
    'Este repositorio está en otro servidor. Elija su conexión en su lugar.',
  'settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4':
    'Este repositorio se encuentra en una dirección, esquema o puerto de servidor diferente. Utilice el servidor de esta conexión.',
  'settings.GithubConnectionEditor.asking_github.5becc057': 'Preguntando a GitHub…',
  'settings.GithubConnectionEditor.the_access_check_failed.90fa9dca':
    'La verificación de acceso falló.',
  'settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c':
    'Abre repositorios, incidencias, solicitudes de cambios, commits y archivos de GitHub, Forgejo y Gitea en pestañas, y notificaciones en una barra lateral. Las acciones disponibles dependen del servicio.',
  'settings.GithubSettings.open_github_links_in_obsidian.815b1959': 'Abrir enlaces Git en Obsidian',
  'settings.GithubSettings.a_click_on_a_supported.f005fa1f':
    'Los enlaces de repositorios compatibles se abren en una pestaña. Los demás enlaces y los pulsados con Alt se abren en el navegador.',
  'settings.GithubSettings.default_repository.525a8366': 'Repositorio predeterminado',
  'settings.GithubSettings.where_the_command_open_github.750aa580':
    'Dónde busca Open GitHub link or item cuando ninguna pestaña de repositorio aporta contexto. Usa owner/repo o un enlace; elige una conexión si el nombre es ambiguo.',
  'settings.GithubSettings.owner_repo.65e817ee': 'propietario/repositorio',
  'settings.GithubSettings.pinned_repositories.03dccfeb': 'Repositorios anclados',
  'settings.GithubSettings.first_in_open_github_repository.067f8a9c':
    'Primero en Open GitHub repository…; se transfieren con los ajustes. Fija un repositorio desde ese selector (Alt+Enter) o el menú de una pestaña de repositorio.',
  'settings.GithubSettings.nothing_pinned_yet.0b27e4d1': 'Nada fijado todavía.',
  'settings.GithubSettings.unpin_this_repository.91038877': 'Desanclar este repositorio',
  'settings.GithubSettings.connections.dc273117': 'Conexiones',
  'settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9':
    'Cada conexión tiene su propio servicio, servidor y cuenta; elige una predeterminada por servidor. Para explorar, usa un token con acceso de lectura al repositorio. Las notificaciones de GitHub requieren un token clásico con el permiso notifications.',
  'settings.GithubSettings.no_connections_public_github_com.534d40f4':
    'Sin conexiones. Los repositorios públicos de github.com se leen de forma anónima.',
  'settings.GithubSettings.default.2a7e0b7b': ' · Por defecto',
  'settings.GithubSettings.check.9d60841e': 'Controlar',
  'settings.GithubSettings.check_this_connection_s_account.64de4945':
    'Verifique la cuenta de esta conexión y el acceso al repositorio',
  'settings.GithubSettings.edit.464c4ffd': 'Editar',
  'settings.GithubSettings.edit_this_connection_s_name.de8cb86e':
    'Edite el nombre, el servidor, el token y las preferencias del propietario de esta conexión',
  'settings.GithubSettings.delete.e2d0a549': 'Eliminar',
  'settings.GithubSettings.remove_this_connection_after_confirmation.f3a7dd7f':
    'Eliminar esta conexión después de la confirmación',
  'settings.GithubSettings.public_github_com_anonymous.c18bb859': 'Público github.com (anónimo)',
  'settings.GithubSettings.value_of_value_requests_remaining.037c7ebe':
    '{value0} de {value1} solicitudes restantes{value2}',
  'settings.GithubSettings.quota_not_observed_yet_normally.b802706a':
    'Cuota aún no observada; Normalmente 60 solicitudes por hora compartidas por este dispositivo.',
  'settings.GithubSettings.add_connection.685f88ae': 'Agregar conexión',
  'settings.GithubSettings.create_a_connection_with_its.a4245461':
    'Crea una conexión con su propio token de llavero',
  'settings.GithubSettings.notifications.78801183': 'Notificaciones',
  'settings.GithubSettings.a_fine_grained_personal_access.259d3619':
    'Un token de acceso personal detallado puede leer el contenido del repositorio, pero GitHub envía notificaciones solo a un token clásico con alcance de notificaciones. Configure el token de notificaciones a continuación para la bandeja de entrada única retenida. Permanece vinculado al servidor donde se configuró.',
  'settings.GithubSettings.notifications_token.e314ce9b': 'Ficha de notificaciones',
  'settings.GithubSettings.optional_a_classic_personal_access.0e7b2561':
    'Opcional. Un token de acceso personal clásico con alcance de notificaciones, utilizado solo por el panel de notificaciones: GitHub no permite que un token detallado lea notificaciones. Vacío: el panel utiliza la conexión predeterminada. Guardado en el llavero.',
  'settings.GithubSettings.ghp.ff475c83': 'ghp_...',
  'settings.GithubSettings.forget_the_notifications_token.5f48625d':
    'Olvídate del token de notificaciones',
  'settings.GithubSettings.pages.9046da16': 'paginas',
  'settings.GithubSettings.how_a_github_tab_lays.f030133b':
    'Cómo una pestaña de GitHub presenta lo que muestra.',
  'settings.GithubSettings.page_width.217fbef1': 'Ancho de página',
  'settings.GithubSettings.how_wide_the_text_of.8d0e20a7':
    'Qué ancho tiene el texto de una pestaña: conversaciones, mensajes de confirmación, rebajas renderizadas y páginas de carpetas. Las diferencias y el código siempre ocupan toda la pestaña.',
  'settings.GithubSettings.width_in_pixels.b3f8f713': 'Ancho en píxeles',
  'settings.GithubSettings.from_value_to_value_a.87f8c5fb':
    'Desde {value0} hasta {value1}. Una pestaña más estrecha que esta usa lo que tiene.',
  'settings.GithubSettings.markdown_files_open_as.5541a0b8': 'Los archivos Markdown se abren como',
  'settings.GithubSettings.preview_rendered_and_a_link.7f27338b':
    'Vista previa: renderizada y un enlace a las líneas del archivo marca los párrafos, listas o bloques de código que las contienen. Código: el archivo tal como está escrito, línea por línea. El interruptor sobre un archivo lo cambia para esa pestaña.',
  'settings.GithubSettings.people.7db20897': 'Gente',
  'settings.GithubSettings.who_wrote_an_issue_a.deb19dbb':
    'Quién escribió un problema, un comentario, una reseña o un compromiso, con su foto. Los nombres y las imágenes se solicitan a GitHub una vez y se guardan en este dispositivo durante una semana.',
  'settings.GithubSettings.show_people_by.989a820c': 'Mostrar personas por',
  'settings.GithubSettings.their_name_as_their_profile.2452b5a6':
    'Su nombre tal como lo indica su perfil, o su inicio de sesión. El otro está en la información sobre herramientas, y un clic o un toque en una persona intercambia los dos allí mismo. Alguien cuyo perfil no tiene nombre se muestra al iniciar sesión de cualquier manera.',
  'settings.GithubSettings.kept_names_and_pictures.586c5b5f': 'Nombres e imágenes guardados.',
  'settings.GithubSettings.clear.83b12c22': 'Quitar selección',
  'settings.GithubSettings.forget_every_kept_name_and.ddf1b164':
    'Olvídese de todos los nombres y fotografías guardados; se vuelven a pedir a medida que se muestra a la gente',
  'settings.GithubSettings.nothing_is_kept_yet.7287d9c8': 'Aún no se guarda nada',
  'settings.GithubSettings.code_search.ca5e7167': 'Búsqueda de código',
  'settings.GithubSettings.search_the_code_of_the.1ce06300':
    'Busque el código de la versión que muestra una pestaña y vaya a la definición desde el interior de la pestaña. El repositorio en esa versión se descarga una vez por sesión y se busca aquí.',
  'settings.GithubSettings.largest_repository_to_download_mb.c4edc368':
    'Repositorio más grande para descargar (MB)',
  'settings.GithubSettings.its_files_at_that_version.5d039cfc':
    'Tamaño total de los archivos en esa revisión. Los repositorios GitHub mayores usan la búsqueda del servidor en la rama predeterminada con un token. Forgejo y Gitea indican el límite del archivo.',
  'settings.GithubSettings.delete_github_connection.e4dfa050': 'Eliminar conexión Git',
  'settings.GithubSettings.delete_connection.e960651b': 'Eliminar conexión',
  'settings.GithubSettings.delete_value_its_local_token.b78722f1':
    '¿Eliminar {value0}? Su token local será olvidado; se mantienen otras conexiones.',
  'settings.GithubSettings.remove_the_notifications_token_from.5b3f8312':
    '¿Quitar el token de notificaciones del llavero? El panel de notificaciones vuelve al token principal.',
  'settings.GithubSettings.token_available_on_this_device.8141399a':
    'Token disponible en este dispositivo',
  'settings.GithubSettings.synced_keys_locked.1673153c': 'Teclas sincronizadas bloqueadas',
  'settings.GithubSettings.no_token_on_this_device.a87b4f4f': 'No hay token en este dispositivo',
  'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4':
    'Esta conexión cambió en otros lugares. Cierra este borrador y edita su configuración actual.',
  'settings.GithubSettings.could_not_save_the_token.8edbb7d6':
    'No se pudo guardar el token en el llavero. No se cambió nada; intentar otra vez.',
  'settings.GithubSettings.readable_line_width_like_notes.526184e3':
    'Ancho de línea legible, como notas',
  'settings.GithubSettings.full_width.d34008d2': 'Ancho completo',
  'settings.GithubSettings.preview.324b134f': 'Vista previa',
  'settings.GithubSettings.code.340f4630': 'Código',
  'settings.GithubSettings.name.dcd1d522': 'Nombre',
  'settings.GithubSettings.login.9d6322c1': 'Acceso',
  'settings.GithubSettings.value_value_kept_on_this.ceefdd92': {
    one: '{count} persona guardada en este dispositivo. Bórralas para volver a consultar cada nombre y foto, por ejemplo, si alguien los ha cambiado.',
    many: '{count} personas guardadas en este dispositivo. Bórralas para volver a consultar cada nombre y foto, por ejemplo, si alguien los ha cambiado.',
    other:
      '{count} personas guardadas en este dispositivo. Bórralas para volver a consultar cada nombre y foto, por ejemplo, si alguien los ha cambiado.',
  },
  'settings.GithubSettings.none_kept_on_this_device.bfb58c42':
    'Aún no hay ninguno en este dispositivo.',
  'settings.ImageModelEditModal.add_image_model.6b3a2d66': 'Agregar modelo de imagen',
  'settings.ImageModelEditModal.edit_image_model.ca72d086': 'Editar modelo de imagen',
  'settings.ImageModelEditModal.model_id.089ef2b6': 'ID del modelo',
  'settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d':
    'Identificador de modelo API (por ejemplo, gpt-image-1, flux-pro).',
  'settings.ImageModelEditModal.e_g_gpt_image.c781dc87': 'p.ej. {literal0}',
  'settings.ImageModelEditModal.display_name.2b7f6a84': 'Nombre para mostrar',
  'settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Etiqueta opcional que se muestra en el selector de modelo.',
  'settings.ImageModelEditModal.e_g_gpt_image.5ae53afd': 'p.ej. {literal0}',
  'settings.ImageModelEditModal.size.1af85190': 'Tamaño',
  'settings.ImageModelEditModal.image_dimensions.1a4bb2f3': 'Dimensiones de la imagen.',
  'settings.ImageModelEditModal.quality.1b2c08a8': 'Calidad',
  'settings.ImageModelEditModal.output_format.93c53d37': 'Formato de salida',
  'settings.ImageModelEditModal.delete_image_model.f28aaecc': 'Eliminar modelo de imagen',
  'settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0':
    '¿Eliminar {value0}? Los agentes que lo utilicen no tendrán modelo hasta que uno esté\n        elegido de nuevo.',
  'settings.ImageModelEditModal.save.1509f561': 'Guardar',
  'settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Mantenga estas configuraciones y cierre',
  'settings.ImageModelEditModal.delete.e2d0a549': 'Eliminar',
  'settings.ImageModelEditModal.remove_this_image_model_from.c139edec':
    'Eliminar este modelo de imagen del proveedor',
  'settings.ImageModelEditModal.landscape.caa8642b': '1536×1024 (paisaje)',
  'settings.ImageModelEditModal.portrait.29d9d2d0': '1024×1536 (retrato)',
  'settings.ImageModelEditModal.auto.02862497': 'Auto',
  'settings.ImageModelEditModal.low.f793de20': 'Bajo',
  'settings.ImageModelEditModal.medium.8e588cd1': 'Medio',
  'settings.ImageModelEditModal.high.c4ebc6d4': 'Alto',
  'settings.JournalsSettings.value_journal.cc8a4dd5': 'Diario {value0}',
  'settings.JournalsSettings.journal_value.06b87038': 'Diario #{value0}',
  'settings.JournalsSettings.remove_this_journal.c3a84c0a': 'Eliminar este diario',
  'settings.JournalsSettings.default_journal.b54bf1fd': 'Diario predeterminado',
  'settings.JournalsSettings.journal_name.4a021433': 'Nombre de la revista',
  'settings.JournalsSettings.journal_type_property_value_or.04441eaf':
    'Valor de propiedad de tipo de diario o nombre de archivo RegExp',
  'settings.JournalsSettings.type_or_regexp.241a5ad0': 'Tipo o RegExp',
  'settings.JournalsSettings.date_property_name.8e90965d': 'Nombre de la propiedad de fecha',
  'settings.JournalsSettings.optional.59be7133': 'Opcional',
  'settings.JournalsSettings.new_journal_note_path_template.862462e1':
    'Nueva plantilla de ruta de notas de diario',
  'settings.JournalsSettings.path_template.ec234daf': 'Plantilla de ruta',
  'settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9':
    'Día del período de recurrencia, cuando se crea la nota',
  'settings.JournalsSettings.optional_default_to_first.e58c831d':
    'Opcional. Por defecto es "primero".',
  'settings.JournalsSettings.template_note_path.de4db36f': 'Ruta de nota de plantilla',
  'settings.JournalsSettings.journal_reccurence.8957b0f1': 'Recurrencia de la revista',
  'settings.JournalsSettings.add_journal.f49ae75e': 'Agregar diario',
  'settings.JournalsSettings.add_another_journal.0d345224': 'Agregar otra revista',
  'settings.JournalsSettings.daily.b36c2611': 'A diario',
  'settings.JournalsSettings.weekly.29751324': 'Semanalmente',
  'settings.JournalsSettings.monthly.9b11f6b7': 'Mensual',
  'settings.JournalsSettings.yearly.6e69b59e': 'Anual',
  'settings.KeyDestinationsModal.review_key_destinations.2058c462': 'Revisar destinos de claves',
  'settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597':
    'Elija una clave y un destinatario. La confirmación y la asignación HTTP son locales para este dispositivo.',
  'settings.KeyDestinationsModal.saved_key.85ec79d9': 'Clave guardada',
  'settings.KeyDestinationsModal.recipient_address.454d0391': 'Dirección del destinatario',
  'settings.KeyDestinationsModal.recipient_url.59ef2635': 'URL del destinatario',
  'settings.KeyDestinationsModal.new_key_name.0e18145f': 'Nuevo nombre de clave',
  'settings.KeyDestinationsModal.new_key_value.7a7e9552': 'Nuevo valor clave',
  'settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477':
    'Almacenamiento protegido; guardado sólo cuando usted confirma.',
  'settings.KeyDestinationsModal.key_permissions.1f24b6b7': 'Permisos clave',
  'settings.KeyDestinationsModal.let_value_be_sent_to.3057160b':
    'Permitir que {value0} se envíe a {value1} desde este dispositivo',
  'settings.KeyDestinationsModal.remove_key_permission.60713985': 'Quitar permiso clave',
  'settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd':
    'Deje de enviar {value0} a {value1}; la clave permanece guardada',
  'settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5':
    'Destinos del servicio a confirmar',
  'settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2':
    'Permitir que {value0} reciba su clave en {value1} desde este dispositivo',
  'settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3':
    'Transporte HTTP en este dispositivo',
  'settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f':
    'Sólo transporte no cifrado; Cada clave aún necesita su propio permiso de destinatario.',
  'settings.KeyDestinationsModal.remove_http_exception.ae72ff92': 'Eliminar excepción HTTP',
  'settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28':
    'Dejar de permitir el transporte de claves no cifradas a {value0}',
  'settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc': 'Permitir clave y dirección',
  'settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82':
    'Guarde este permiso clave en este dispositivo; no se envía nada ahora',
  'settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d':
    ' — Sin cifrar: cualquier persona en la ruta de la red puede leer la clave.',
  'settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1':
    ' — El HTTP público no puede recibir claves. Cambie esta dirección a HTTPS.',
  'settings.KeyDestinationsModal.choose_a_key.68bb8fb8': 'Elige una clave',
  'settings.KeyDestinationsModal.save_a_new_named_key.7982a2de':
    'Guarde una nueva clave con nombre...',
  'settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb':
    ' Guarde esta nueva clave en un almacenamiento protegido.',
  'settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0':
    'Elija una clave guardada e ingrese la dirección del destinatario.',
  'settings.KeyDestinationsModal.allowed_on_this_device.bac894b7': 'Permitido en este dispositivo',
  'settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda':
    'Necesita confirmación en este dispositivo',
  'settings.KeyDestinationsModal.allow_unencrypted_http.e905502b': 'Permitir HTTP sin cifrar',
  'settings.KeyDestinationsModal.allow_on_this_device.a92ce243': 'Permitir en este dispositivo',
  'settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8':
    'La clave de el almacén no se puede enviar a un destinatario.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46':
    'Permitido {value0} → {value1}. Vuelva a intentar el guión original; No se envió nada automáticamente.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642':
    'Permitido {value0} → {value1}. Vuelva a intentar el guión original.',
  'settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad':
    'Se eliminó {value0} → {value1}. La clave guardada y otros permisos permanecen.',
  'settings.KeyDestinationsModal.confirmed_value_value.b96426a6': 'Confirmado {value0} → {value1}.',
  'settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86':
    'Se eliminó la excepción HTTP. Las claves no pueden utilizar esta dirección no cifrada.',
  'settings.LinksSettings.links_that_run_things.6849bb37': 'Enlaces que ejecutan cosas',
  'settings.LinksSettings.each_one_is_an_obsidian.bcfd9260':
    'Cada una es una dirección obsidiana:// que ejecuta un script o un comando cuando se abre, desde un marcador, otra aplicación o un acceso directo.',
  'settings.LinksSettings.untitled_link.be1c93df': 'Enlace sin título',
  'settings.LinksSettings.copy_the_link_s_address.331a3bd9': 'Copia la dirección del enlace.',
  'settings.LinksSettings.change_this_link.f6aa89bf': 'Cambiar este enlace',
  'settings.LinksSettings.add_another_link.a8b73866': 'Añadir otro enlace',
  'settings.LinksSettings.no_links_yet.30d3e862': 'Aún no hay enlaces',
  'settings.LinksSettings.a_name_for_the_address.f36bdc5a':
    'Un nombre para la dirección y el script o comando que ejecuta.',
  'settings.LinksSettings.add_link.dfe9ca4d': 'Agregar enlace',
  'settings.LinksSettings.add_a_link_and_set.5eb68448': 'Añade un enlace y configúralo',
  'settings.LinksSettings.new_link.98ee0dfb': 'Nuevo enlace',
  'settings.LinksSettings.name.dcd1d522': 'Nombre',
  'settings.LinksSettings.the_part_of_the_address.2929fc21':
    'La parte de la dirección después del nombre=, en letras simples y guiones.',
  'settings.LinksSettings.add_movie.2f79eca6': 'agregar película',
  'settings.LinksSettings.runs.848f54e8': 'Corre',
  'settings.LinksSettings.script.102acc10': 'Guion',
  'settings.LinksSettings.choose_a_script.d8ff6dd0': 'Elige un guión...',
  'settings.LinksSettings.search_the_scripts_for_the.e5119ad8':
    'Busque los scripts que ejecuta este enlace',
  'settings.LinksSettings.command.71316697': 'Dominio',
  'settings.LinksSettings.search_the_commands_for_the.ebe2fa5b':
    'Busque los comandos que ejecuta este enlace',
  'settings.LinksSettings.wait_for_sync.8d3efbd1': 'Esperar sincronización',
  'settings.LinksSettings.run_only_once_obsidian_sync.91ba259b':
    'Ejecútelo solo una vez que Obsidian Sync haya actualizado la bóveda.',
  'settings.LinksSettings.address.56ef8f20': 'Dirección',
  'settings.LinksSettings.add_param_value_to_hand.2c89675e':
    'Agregue &param=value para entregarle al script sus valores.',
  'settings.LinksSettings.delete.e2d0a549': 'Eliminar',
  'settings.LinksSettings.remove_this_link.d7173cb1': 'Eliminar este enlace',
  'settings.LinksSettings.done.11a6767d': 'Listo',
  'settings.LinksSettings.close_this_window_changes_are.91342d87':
    'Cierra esta ventana; Los cambios se mantienen a medida que los realiza.',
  'settings.LinksSettings.choose_a_command.58e501e1': 'Elija un comando...',
  'settings.LinksSettings.runs_the_script_value.c5e5c031': 'Ejecuta el script {value0}.',
  'settings.LinksSettings.runs_a_script_none_chosen.1b6f1723':
    'Ejecuta un script; ninguno elegido todavía',
  'settings.LinksSettings.runs_the_command_value.c397fa11': 'Ejecuta el comando {value0}',
  'settings.LinksSettings.runs_a_command_none_chosen.67edb64d':
    'Ejecuta un comando; ninguno elegido todavía',
  'settings.LinksSettings.link_copied.d12860c2': 'Enlace copiado',
  'settings.LintRuleModal.on.13001175': 'En',
  'settings.LintRuleModal.switched_off_the_rule_checks.db75c03b':
    'Apagada, la regla no controla nada.',
  'settings.LintRuleModal.how_bad.016a19df': 'que malo',
  'settings.LintRuleModal.an_error_or_a_warning.ea93bb11':
    'Un error o una advertencia, como lo muestra la lista.',
  'settings.LintRuleModal.where_it_applies.39e44cbf': 'donde se aplica',
  'settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53':
    'Dejado vacío, en todas partes. Las listas están separadas por comas.',
  'settings.LintRuleModal.only_in.aed9f516': 'Sólo en',
  'settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac':
    'Carpetas o globos como Proyectos/*/Tareas.',
  'settings.LintRuleModal.everywhere.dcc10bfd': 'En todos lados',
  'settings.LintRuleModal.not_in.1bc8651b': 'no en',
  'settings.LintRuleModal.folders_or_globs_left_alone.a5983464':
    'Carpetas o pegotes dejados solos dentro de ellos.',
  'settings.LintRuleModal.nowhere.7e32434d': 'En ningún lugar',
  'settings.LintRuleModal.note_types.52d728fb': 'Tipos de notas',
  'settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66':
    'Sólo notas cuyo tipo sea uno de estos.',
  'settings.LintRuleModal.any_type.b05fc1fe': 'cualquier tipo',
  'settings.LintRuleModal.having_a_property.07dd0569': 'tener una propiedad',
  'settings.LintRuleModal.only_notes_with_this_property.adbc72b9':
    'Sólo notas con esta propiedad: igual al valor, cuando se proporciona una.',
  'settings.LintRuleModal.property.40040cb1': 'Propiedad',
  'settings.LintRuleModal.any_value.004f62d2': 'cualquier valor',
  'settings.LintRuleModal.settings_of_the_rule.99e57b0c': 'Configuraciones de la regla',
  'settings.LintRuleModal.as_it_ships.be4ca4de': 'Como se envía',
  'settings.LintRuleModal.put_this_rule_back_the.6e2ebc57':
    'Vuelva a colocar esta regla tal como la envía el complemento.',
  'settings.LintRuleModal.done.11a6767d': 'Listo',
  'settings.LintRuleModal.close_this_the_changes_are.459403b0':
    'Cierra esto; los cambios se guardan',
  'settings.LintRuleModal.error.54a0e8c1': 'Error',
  'settings.LintRuleModal.warning.e981ddae': 'Advertencia',
  'settings.LinterSettings.the_linter_checks_notes_against.67baa82b':
    'El linter compara las notas con las reglas siguientes (una nota a la vez, una carpeta o toda la bóveda) y enumera lo que no las sigue en una pestaña propia. Gran parte de esto se puede solucionar allí de una sola vez; el resto se abre en la línea para fijar a mano.',
  'settings.LinterSettings.linter.99bede8d': 'Comprobador de notas',
  'settings.LinterSettings.the_tab_with_what_the.e019607d':
    'La pestaña con lo que encontró la última ejecución.',
  'settings.LinterSettings.open_linter.72c54acd': 'Abrir el analizador',
  'settings.LinterSettings.close_the_settings_and_open.125786ff':
    'Cierra la configuración y abre la pestaña del linter.',
  'settings.LinterSettings.folders_to_skip.ad324780': 'Carpetas para saltar',
  'settings.LinterSettings.no_rule_looks_in_these.2a478951':
    'Ninguna regla se ve en estos, a menos que una nota en uno esté marcada por su nombre. Separados por comas; una carpeta o un pegote como Archive/**.',
  'settings.LinterSettings.templates_attachments.2440bdba': 'Plantillas, archivos adjuntos',
  'settings.LinterSettings.rules.4228aeb0': 'Normas',
  'settings.LinterSettings.each_can_be_switched_off.240786af':
    'Cada uno se puede desactivar, indicar qué tan malo es un hallazgo, guardarlo en algunas carpetas o tipos de notas y darle su propia configuración.',
  'settings.LinterSettings.set_up_value.45578254': 'Configurar {value0}',
  'settings.LinterSettings.rules_of_your_own.f29b0461': 'Reglas propias',

  'settings.LinterSettings.no_script_rules_yet.37cf496e': 'Aún no hay reglas de guión.',
  'settings.LinterSettings.not_in_value.d95a4831': 'no en {value0}',
  'settings.LinterSettings.for_value_notes.670a9ee4': 'para {value0} notas',
  'settings.LinterSettings.is_set.c7d5e11f': ' esta establecido',
  'settings.LinterSettings.error.54a0e8c1': 'Error',
  'settings.LinterSettings.warning.e981ddae': 'Advertencia',
  'settings.LogsSettings.logs_note_types.0793e6f2': 'Tipos de notas de registros',
  'settings.LogsSettings.optional_comma_separated_list_of.8730c2d2':
    'Lista opcional de tipos de notas separados por comas para considerar como notas de registro.',
  'settings.LogsSettings.e_g_journal_log_daily.a54faefe': 'p.ej. {literal0}',
  'settings.ModelEditModal.add_model.7060e824': 'Agregar modelo',
  'settings.ModelEditModal.edit_model.e76cc0ba': 'Editar modelo',
  'settings.ModelEditModal.model_id.089ef2b6': 'ID del modelo',
  'settings.ModelEditModal.api_model_identifier_e_g.5c0e2892':
    'Identificador de modelo API (por ejemplo, gpt-4o, claude-sonnet-4-20250514).',
  'settings.ModelEditModal.e_g_gpt_o.c6a41eb7': 'p.ej. {literal0}',
  'settings.ModelEditModal.display_name.2b7f6a84': 'Nombre para mostrar',
  'settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Etiqueta opcional que se muestra en el selector de modelo.',
  'settings.ModelEditModal.e_g_gpt_o.c9f23b2e': 'p.ej. {literal0}',
  'settings.ModelEditModal.context_window.7696d085': 'ventana contextual',
  'settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14':
    'Tokens de entrada máximos que admite el modelo.',
  'settings.ModelEditModal.max_output_tokens.397dda07': 'Fichas de salida máxima',
  'settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9':
    'Tokens máximos en una sola respuesta.',
  'settings.ModelEditModal.request_timeout_seconds.1b1b1d08':
    'Solicitar tiempo de espera (segundos)',
  'settings.ModelEditModal.wait_for_the_first_response.08adebcb':
    'Espere la primera respuesta o el siguiente fragmento, no la respuesta completa. 1–3600 segundos; vacío utiliza el tiempo de espera global. Se aplica al chat y al trabajo en segundo plano con este modelo.',
  'settings.ModelEditModal.global_timeout.542c2bf3': 'Tiempo de espera global',
  'settings.ModelEditModal.reasoning.d8211e24': 'Razonamiento',
  'settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996':
    'Habilite el razonamiento/pensamiento para los modelos compatibles.',
  'settings.ModelEditModal.thinking_effort.264c28cb': 'esfuerzo de pensamiento',
  'settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5':
    'Controla cuánto razonamiento hace el modelo. Déjelo como predeterminado para el comportamiento propio del modelo.',
  'settings.ModelEditModal.delete_model.b7828ba0': 'Eliminar modelo',
  'settings.ModelEditModal.delete_value_agents_using_it.c65217d0':
    '¿Eliminar {value0}? Los agentes que lo utilicen no tendrán modelo hasta que uno esté\n        elegido de nuevo.',
  'settings.ModelEditModal.save.1509f561': 'Guardar',
  'settings.ModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Mantenga estas configuraciones y cierre',
  'settings.ModelEditModal.delete.e2d0a549': 'Eliminar',
  'settings.ModelEditModal.remove_this_model_from_the.2838dd4b':
    'Eliminar este modelo del proveedor',
  'settings.ModelEditModal.enter_seconds_correct_this_value.508147a7':
    'Introduzca 1–3600 segundos. Corrija este valor antes de guardar.',
  'settings.OtherSettings.look.a0de5719': 'Mirar',
  'settings.OtherSettings.full_width_sidebars.bc7a2b4e': 'Barras laterales de ancho completo',
  'settings.OtherSettings.make_sidebars_take_the_full.15d01abc':
    'Haga que las barras laterales ocupen todo el ancho de la pantalla en un teléfono.',
  'settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63':
    'Barras laterales de medio ancho en tableta',
  'settings.OtherSettings.make_sidebars_take_half_the.f915aa8e':
    'Haga que las barras laterales ocupen la mitad del ancho de la pantalla en una tableta.',
  'settings.OtherSettings.css_snippets_folder.0f718ada': 'Carpeta de fragmentos CSS',
  'settings.OtherSettings.vault_folder_with_css_files.063bfc1c':
    'Carpeta Vault con archivos .css para aplicar automáticamente como fragmentos de estilo. Déjelo vacío para desactivarlo.',
  'settings.OtherSettings.e_g_snippets.d1877812': 'p.ej. {literal0}',
  'settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19': 'Dibujado por Abele en una nota.',
  'settings.OtherSettings.each_one_in_place_of.7bc5aa3f':
    'Cada uno en lugar del dibujo propio de Obsidian.',
  'settings.OtherSettings.own_drawing_of_properties.909062a8': 'Dibujo propio de propiedades.',
  'settings.OtherSettings.in_a_note_s_properties.769ed541':
    'En las propiedades de una nota: el saldo de una billetera al lado de un enlace a ella, sumas calculadas en campos numéricos y tarjetas para Archivo y propiedades de Archivos y para la portada. Apagado está el propio dibujo de Obsidian.',
  'settings.OtherSettings.counter_properties.8ebc8e5b': 'Propiedades del contador',
  'settings.OtherSettings.comma_separated_property_names_drawn.054f1654':
    'Nombres de propiedades separados por comas dibujados como un número con los botones − y +. Un valor vacío cuenta como 0. Necesita su propio dibujo de propiedades.',
  'settings.OtherSettings.e_g_reps_glasses.bcb26756': 'p.ej. {literal0}',
  'settings.OtherSettings.mermaid_viewer.0fee57c7': 'Visor de sirenas',
  'settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa':
    'Dibuja diagramas de sirenas al ancho de la nota, con zoom, arrastre y vista a pantalla completa, en lugar del propio dibujo de Obsidian.',
  'settings.OtherSettings.open_canvases_in_abele.0104f91b': 'Lienzos abiertos en Abele',
  'settings.OtherSettings.open_diagrams_in_the_read.b48fc66f':
    'Abra diagramas en el visor de solo lectura con pasos paso a paso. Utilice Abrir en Obsidian Canvas en su encabezado para editar un diagrama en el lienzo nativo.',
  'settings.OtherSettings.editor_syntax_highlighting.9bbd35c2': 'Resaltado de sintaxis del editor',
  'settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd':
    'Resalte más lenguajes de código delimitado en Fuente y Vista previa en vivo, utilizando el tema propio de Obsidian. El resaltado nativo y los bloques renderizados permanecen sin cambios. El resaltado adicional está limitado a bloques de 32.768 caracteres y 1.000 líneas.',
  'settings.OtherSettings.opening_notes.d2eceee4': 'Notas de apertura',
  'settings.OtherSettings.remember_where_notes_were_left.1010d0b2':
    'Recuerda dónde se dejaron las notas',
  'settings.OtherSettings.open_each_note_at_the.c4f04706':
    'Abra cada nota en el desplazamiento y cursor en el que se dejó, guardados en este dispositivo. Un enlace a un título o bloque, un resultado de búsqueda o un elemento destacado de un libro todavía va a su propio lugar.',
  'settings.OtherSettings.maps.119e66d1': 'Mapas',
  'settings.OtherSettings.coordinates_property.afe852a5': 'Propiedad de coordenadas',
  'settings.OtherSettings.note_property_holding_a_place.d3b2dd8b':
    "Tenga en cuenta la propiedad que ocupa un lugar como 'lat, lon'. Se le dice al agente que escriba en este.",
  'settings.OtherSettings.coordinates.29abdbc9': 'coordenadas',
  'settings.OtherSettings.map_style.62a4d250': 'Estilo de mapa',
  'settings.OtherSettings.how_maps_in_notes_and.dc2e0608':
    'Cómo se ven los mapas en notas y chats. Los estilos gratuitos no necesitan clave ni cuenta.',
  'settings.OtherSettings.style_url.221b2c65': 'URL de estilo',
  'settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee':
    'Un estilo MapLibre.json de su propio proveedor.',
  'settings.OtherSettings.the_plugin.cb8c07f4': 'El complemento',
  'settings.OtherSettings.changelog.ead07c84': 'Registro de cambios',
  'settings.OtherSettings.see_what_changed_in_every.b28c48a6':
    'Vea lo que cambió en cada versión del complemento, la más nueva primero.',
  'settings.OtherSettings.open_changelog.f8738613': 'Abrir el registro de cambios',
  'settings.OtherSettings.open_the_plugin_changelog.f99c92b8':
    'Abra el registro de cambios del complemento',
  'settings.OtherSettings.keyboard_diagnostics.b559c4cd': 'Diagnóstico del teclado',
  'settings.OtherSettings.show_at_the_top_of.2cad0798':
    'Muestra, en la parte superior de la pantalla, lo que informa la aplicación sobre el teclado en pantalla, para obtener una captura de pantalla cuando un cuadro de diálogo termina debajo de él. Permanece en este dispositivo.',
  'settings.OtherSettings.date_properties.9201e6b8': 'Propiedades de fecha',
  'settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640':
    'Nombres de propiedades separados por comas dibujados como una fecha con botones de un día atrás y adelante, qué tan lejos está y un botón para su nota diaria. Necesita dibujo propio de propiedades.',
  'settings.OtherSettings.priority_properties.21f4bae9': 'Propiedades prioritarias',
  'settings.OtherSettings.comma_separated_property_names_drawn.b31eb248':
    'Nombres de propiedades separados por comas dibujados como prioridad de tarea, baja, media o alta, con botones para subirla y bajarla. Necesita dibujo propio de propiedades.',
  'settings.OtherSettings.label_properties.7ad8c49d': 'Propiedades de etiqueta',
  'settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7':
    'Nombres de propiedades separados por comas dibujados como etiquetas, agregados a partir de los que ya se usan en la bóveda o escritos. Necesita dibujo propio de propiedades.',
  'settings.OtherSettings.group_properties.23d1a496': 'Propiedades del grupo',
  'settings.OtherSettings.comma_separated_property_names_that.cb39dad8':
    'Nombres de propiedades separados por comas que obtienen un botón al lado de su lista, agregando una de las notas ya utilizadas como grupos. La lista todavía se escribe como de costumbre. Necesita dibujo propio de propiedades.',
  'settings.QuickButtonSettings.a_round_button_at_the.aa095d26':
    'Un botón redondo en el borde de la pantalla de un teléfono. Abre un menú de acciones rápidas para lo que sea que esté al frente: sus propias acciones a continuación, los botones de encabezado de una nota y lo que ofrece el complemento allí: la búsqueda y los aspectos destacados de un libro, el cronómetro y el chat de una nota. Se aparta mientras lees o escribes. Arrástralo para moverlo; mantiene el lado y la altura en que lo dejó.',
  'settings.QuickButtonSettings.show_the_quick_button.65b455f7': 'Mostrar el botón rápido',
  'settings.QuickButtonSettings.on_a_phone_it_is.0737337d':
    'En un teléfono. Es un concepto, por lo que comienza apagado.',
  'settings.QuickButtonSettings.also_on_a_tablet.5f696152': 'También en una tableta',
  'settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d':
    'Muéstralo tanto en una tableta como en un teléfono.',
  'settings.QuickButtonSettings.side.630ef00b': 'Lado',
  'settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46':
    'El borde de la pantalla en el que se encuentra. Arrastrarlo lo cambia.',
  'settings.QuickButtonSettings.height.bfe2eca4': 'Altura',
  'settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1':
    'Arrastrado más arriba de donde descansa, encima de la barra inferior de cada pantalla.',
  'settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94':
    'Dónde descansa: justo encima de la barra inferior de cada pantalla.',
  'settings.QuickButtonSettings.put_it_back.55057d7e': 'Ponlo de nuevo',
  'settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b':
    'Muévelo hacia abajo hasta donde descansa.',
  'settings.QuickButtonSettings.it_is_already_where_it.36b74557':
    'Ya está donde reposa; arrástralo para levantarlo',
  'settings.QuickButtonSettings.your_actions.6c06c355': 'Tus acciones',
  'settings.QuickButtonSettings.at_the_top_of_the.b6848b73':
    'En la parte superior del menú, en este orden. Un comando aparece sólo donde se puede ejecutar, por lo que uno destinado a notas no se ofrece en un libro.',
  'settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002': 'Nada propio todavía.',
  'settings.QuickButtonSettings.name_in_the_menu.feca41eb': 'Nombre en el menú',
  'settings.QuickButtonSettings.choose_the_icon_it_has.e8357476':
    'Elige el icono que tiene en el menú.',
  'settings.QuickButtonSettings.already_the_first.eab62d41': 'Ya el primero',
  'settings.QuickButtonSettings.move_it_up_the_menu.20938d10': 'Muévelo hacia arriba en el menú.',
  'settings.QuickButtonSettings.already_the_last.a6ec4b12': 'ya el ultimo',
  'settings.QuickButtonSettings.move_it_down_the_menu.dc508335': 'Muévelo hacia abajo en el menú.',
  'settings.QuickButtonSettings.take_it_out_of_the.4a64934c': 'Sácalo del menú.',
  'settings.QuickButtonSettings.add_a_command.b907f252': 'Agregar un comando',
  'settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7':
    'Busque en los comandos de Obsidian (cualquier complemento) uno para colocar en el menú',
  'settings.QuickButtonSettings.add_a_script.c4526bc4': 'Agregar un guión',
  'settings.QuickButtonSettings.search_your_scripts_for_one.df40b370':
    'Busque en sus scripts uno para poner en el menú.',
  'settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a': 'Sacar del menú',
  'settings.QuickButtonSettings.take_value_out_of_the.f628c5a3':
    '¿Sacar {value0} del menú rápido? El comando o script en sí permanece.',
  'settings.QuickButtonSettings.right.883361d5': 'Bien',
  'settings.QuickButtonSettings.left.58eb9032': 'Izquierda',
  'settings.QuickButtonSettings.unnamed.e504e615': 'Sin nombre',
  'settings.QuickButtonSettings.command_value.b7bcffe4': 'Comando: {value0}',
  'settings.QuickButtonSettings.script_value.804f5354': 'Guión: {value0}',
  'settings.ReaderSettings.epub_books_in_the_vault.7574b8de':
    'Los libros EPUB en la bóveda se abren en una pestaña de lectura propia, y los PDF también. Estas opciones se aplican a todos los libros y también se pueden cambiar desde la pestaña de un libro con el botón Aa.',
  'settings.SavedKeyRequestModal.send_saved_keys.618ddec9': '¿Enviar claves guardadas?',
  'settings.SavedKeyRequestModal.key.99a52df3': 'Clave',
  'settings.SavedKeyRequestModal.keys.f0d66a79': 'Claves',
  'settings.SavedKeyRequestModal.sent_to.4e7201c7': 'Enviado a',

  'settings.SavedKeyRequestModal.cancel.19766ed6': 'Cancelar',
  'settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8':
    'No enviar nada y dejar los permisos como están.',
  'settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17': 'Permitir dirección y enviar',
  'settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3':
    'Recuerde {value0} para estas claves en este dispositivo, luego envíe la solicitud',
  'settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82':
    'No se pudo guardar este permiso clave, por lo que no se envió nada. Verifique los destinos clave e inténtelo nuevamente.',
  'settings.ScriptsSettings.library.dc20b3d5': 'Biblioteca',
  'settings.ScriptsSettings.every_script_in_the_folder.8e2a3585':
    'Cada script en la carpeta y lo que hace.',
  'settings.ScriptsSettings.selection_menus.22601a32': 'Menús de selección',
  'settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4':
    'Elija guiones para libros y chats de forma independiente',
  'settings.ScriptsSettings.header_buttons.1d80ae78': 'Botones de cabecera',
  'settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e':
    'Botones en encabezados de notas que ejecutan un script',
  'settings.ScriptsSettings.automations.ad1fb9ec': 'Automatizaciones',
  'settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66':
    'Scripts que se ejecutan solos cuando cambia una tarea o una nota',
  'settings.ScriptsSettings.startup.65d48235': 'Puesta en marcha',
  'settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc':
    'Scripts que se ejecutan cada vez que se inicia Obsidian',
  'settings.ScriptsSettings.general.c910d474': 'General',
  'settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d':
    'Active los scripts y elija su carpeta.',
  'settings.ScriptsSettings.books.9da7f76b': 'Libros',
  'settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97':
    'Guiones sobre palabras seleccionadas en un libro.',
  'settings.ScriptsSettings.chats.ef5b4049': 'Charlas',
  'settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b':
    'Guiones elegidos para palabras seleccionadas en un chat.',
  'settings.SecretField.hide_the_key.46a22923': 'Ocultar la clave',
  'settings.SecretField.show_the_key.90d90eb7': 'mostrar la clave',
  'settings.SecretField.copy_the_key.30d7860a': 'Copia la clave',
  'settings.SecretField.new_key.31ffdeb5': 'Nueva clave...',
  'settings.SecretField.save_key.b6e0aef2': 'Guardar clave',
  'settings.SecretField.the_key.144976d8': 'la clave',
  'settings.SecretStoreSettings.synced_keys.a764d83d': 'Claves sincronizadas',
  'settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab':
    'Cada clave y token de API se guarda en un almacén cifrado que se sincroniza con la configuración del complemento. Cada dispositivo sólo necesita la frase de contraseña, escrita una vez. Sin él, el almacén es ilegible, en cualquier dispositivo y en cualquier copia del archivo de configuración.',
  'settings.SecretStoreSettings.status.920e413c': 'Estado',
  'settings.SecretStoreSettings.all_keys.9e5c5da4': 'Todas las claves',
  'settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da':
    'Cada clave que utiliza el complemento en este dispositivo: para qué sirve, si está sincronizada y una forma de mostrarla o copiarla.',
  'settings.SecretStoreSettings.show.0df6f1ca': 'Mostrar',
  'settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1':
    'Enumere todas las claves de este dispositivo',
  'settings.SecretStoreSettings.passphrase.e7611f05': 'frase de contraseña',
  'settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e':
    'Al menos 12 caracteres. Escrito en cada dispositivo que debería tener las claves; nada puede recuperarlo.',
  'settings.SecretStoreSettings.repeat_the_passphrase.4b93336c': 'Repita la frase de contraseña',
  'settings.SecretStoreSettings.passphrase_again.47b97578': 'Frase de contraseña otra vez',
  'settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573':
    'Claves que ingresan a el almacén: {value0}',
  'settings.SecretStoreSettings.cancel.19766ed6': 'Cancelar',
  'settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492': 'Cerrar sin cambiar nada',
  'settings.SecretStoreSettings.turn_on.5a1f096a': 'Activar',
  'settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24':
    'Cifra las claves de este dispositivo en el almacén y sincronízalas',
  'settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910':
    'Mueve las claves que tiene este dispositivo a el almacén, bajo una frase de contraseña que usted elija.',
  'settings.SecretStoreSettings.set_up.4da10f1f': 'Configurar',
  'settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b':
    'Elija una frase de contraseña para las claves sincronizadas',
  'settings.SecretStoreSettings.unlock_on_this_device.ec7699b7': 'Desbloquear en este dispositivo',
  'settings.SecretStoreSettings.unlock.4ac709aa': 'Descubrir',
  'settings.SecretStoreSettings.open_the_store_here_and.879288fd':
    'Abre el almacén aquí y coloca sus claves en el llavero de este dispositivo.',
  'settings.SecretStoreSettings.new_passphrase.5cc14549': 'Nueva contraseña',
  'settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e':
    'Todos los demás dispositivos lo solicitan una vez y la próxima vez que la configuración lo alcanza.',
  'settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be': 'Repita la nueva contraseña',
  'settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb': 'Nueva contraseña nuevamente',
  'settings.SecretStoreSettings.change_the_passphrase.a9a3e51b': 'Cambiar la frase de contraseña',
  'settings.SecretStoreSettings.change.c0bf75bd': 'Cambiar',
  'settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af':
    'Cifre el almacén nuevamente con la nueva contraseña',
  'settings.SecretStoreSettings.change_passphrase.a0ffb851': 'Cambiar frase de contraseña',
  'settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29':
    'Las claves se vuelven a cifrar. Otros dispositivos siguen funcionando con sus claves y solicitan la nueva contraseña.',
  'settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286': 'Elige una nueva contraseña',
  'settings.SecretStoreSettings.remove_from_this_device.43b9a522': 'Quitar de este dispositivo',
  'settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0':
    'La frase de contraseña y todas las claves de el almacén salen de este dispositivo. El almacén y otros dispositivos los guardan; desbloquear nuevamente para recuperarlos.',
  'settings.SecretStoreSettings.remove.c3812fc4': 'Eliminar',
  'settings.SecretStoreSettings.take_the_synced_keys_off.537f867f':
    'Quita las claves sincronizadas de este dispositivo',
  'settings.SecretStoreSettings.turn_off.06f0e210': 'Apagar',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0':
    'El almacén sale de la configuración. Cada dispositivo desbloqueado guarda sus claves en su propio llavero; cualquier otro dispositivo necesitará ingresarlos a mano.',
  'settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d':
    'Deje de sincronizar claves y manténgalas en cada dispositivo',
  'settings.SecretStoreSettings.start_over.5eed7e9f': 'Empezar de nuevo',
  'settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f':
    'Elimina el almacén de la configuración de cada dispositivo, para uno nuevo con una nueva frase de contraseña. Las claves que tiene este dispositivo se quedan aquí.',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2':
    'Eliminar las claves sincronizadas de la configuración',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195':
    'Eliminar las claves sincronizadas de este dispositivo',
  'settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae':
    'La frase de contraseña y el {value0} en el almacén salen del llavero de este dispositivo. Las funciones que los utilizan dejan de funcionar aquí hasta que se desbloquean nuevamente.',
  'settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c': 'Desactivar claves sincronizadas',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814':
    'El almacén deja la configuración en cada dispositivo. Los dispositivos que fueron desbloqueados conservan sus claves; un dispositivo nuevo no los recibirá.',
  'settings.SecretStoreSettings.the_store_is_removed_from.7d71216a':
    'El almacén se elimina de la configuración de cada dispositivo, con todas las claves que ningún dispositivo contiene. Las claves propias de este dispositivo permanecen.',
  'settings.SecretStoreSettings.off.ca7981b4': 'Apagado',
  'settings.SecretStoreSettings.each_device_keeps_its_own.02c01692':
    'Cada dispositivo guarda sus propias claves, ingresadas en ese dispositivo.',
  'settings.SecretStoreSettings.locked_on_this_device.e1223c06': 'Bloqueado en este dispositivo',
  'settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954':
    'Otro dispositivo guarda las claves en el almacén. Ingrese su frase de contraseña para tenerlos aquí también.',
  'settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4':
    'Desbloqueado en este dispositivo',
  'settings.SecretStoreSettings.out_of_date.c8f1506a': 'Fuera de fecha',
  'settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603':
    'La frase de contraseña se cambió en otro dispositivo. Las claves que ya están aquí siguen funcionando; ingrese la nueva contraseña para obtener los cambios nuevamente.',
  'settings.SecretStoreSettings.damaged.3604e21d': 'Dañado',
  'settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8':
    'El almacén en el archivo de configuración no se puede descifrar, aunque este dispositivo tiene la frase de contraseña correcta: el archivo fue cambiado por algo distinto al complemento. Las claves que ya están en este dispositivo siguen funcionando.',
  'settings.SecretStoreSettings.value_in_the_store_a.02db016b':
    '{value0} en el almacén. Una clave agregada o modificada en cualquier parte del complemento ingresa y llega a sus otros dispositivos con la configuración.',
  'settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8':
    'Esa frase de contraseña no abre el almacén.',
  'settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983':
    'La nueva frase de contraseña, tal como está configurada en el otro dispositivo.',
  'settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36':
    'La frase de contraseña elegida cuando se activaron las claves sincronizadas.',
  'settings.SecretStoreSettings.the_two_do_not_match.184006b7': 'Los dos no coinciden.',
  'settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6':
    'Al menos {value0} caracteres.',
  'settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86':
    'Las claves sincronizadas están activadas: {value0} claves en el almacén.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c':
    'No se pudieron activar las claves sincronizadas',
  'settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b':
    'Desbloqueado: {value0} claves en este dispositivo.',
  'settings.SecretStoreSettings.the_store_could_not_be.be373a49':
    'El almacén no se pudo desbloquear.',
  'settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec':
    'Se cambia la frase de contraseña. Otros dispositivos lo solicitarán.',
  'settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1':
    'No se pudo cambiar la frase de contraseña',
  'settings.SecretStoreSettings.the_keys_could_not_be.a70d217b':
    'No se pudieron quitar las claves de este dispositivo',
  'settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f':
    'Las claves sincronizadas no se pudieron desactivar',
  'settings.SecretStoreSettings.the_store_could_not_be.76043571': 'El almacén no se pudo eliminar.',
  'settings.SecretsListModal.all_keys.9e5c5da4': 'Todas las claves',
  'settings.SecretsListModal.passphrase.e7611f05': 'frase de contraseña',
  'settings.SecretsListModal.unlock.4ac709aa': 'Descubrir',
  'settings.SecretsListModal.open_the_store_here_and.6be7e00a':
    'Abra el almacén aquí y enumere sus claves.',
  'settings.SecretsListModal.type_the_passphrase_first.397584ff': 'Escribe la contraseña primero',
  'settings.SecretsListModal.the_synced_store_cannot_be.df30eba8':
    'El almacén sincronizado no se puede descifrar, por lo que no se pueden enumerar las claves que contiene. Las claves a continuación son las que tiene este dispositivo.',
  'settings.SecretsListModal.hide_the_key.46a22923': 'Ocultar la clave',
  'settings.SecretsListModal.show_the_key.90d90eb7': 'mostrar la clave',
  'settings.SecretsListModal.copy_the_key.30d7860a': 'Copia la clave',
  'settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6':
    'Aún no hay claves. Aquí se enumera una clave ingresada en cualquier lugar de la configuración del complemento.',
  'settings.SecretsListModal.copy_all.96e3f09a': 'Copiar todo',
  'settings.SecretsListModal.put_every_key_on_the.a26cf3c7':
    'Pon cada clave en el portapapeles, después de una advertencia.',
  'settings.SecretsListModal.no_key_is_set.f4f5b239': 'No hay ninguna clave establecida',
  'settings.SecretsListModal.copy_every_key.2f918de3': 'Copia cada clave',
  'settings.SecretsListModal.on_this_device.38b9d88c': 'En este dispositivo',
  'settings.SecretsListModal.synced.5da22fe4': 'Sincronizado',
  'settings.SecretsListModal.differs_from_keychain.922767e7': 'Se diferencia del llavero',
  'settings.SecretsListModal.only_in_the_store.9bb2ce40': 'Solo en el almacén',
  'settings.SecretsListModal.not_in_the_store.507fd6ce': 'no en el almacén',
  'settings.SecretsListModal.store_locked.d47ee0fe': 'Tienda bloqueada',
  'settings.SecretsListModal.not_set.4895f731': 'No establecido',
  'settings.SecretsListModal.this_device_s_keychain_holds.1b27e956':
    'El llavero de este dispositivo tiene otro valor, cambiado fuera del complemento. El valor de el almacén es el utilizado.',
  'settings.SecretsListModal.in_the_store_but_not.5e27c94a':
    'En el almacén pero no en el llavero de este dispositivo. El complemento todavía lo usa.',
  'settings.SecretsListModal.set_on_this_device_and.db43f1dd':
    'Configurado en este dispositivo y no en el almacén. Configúrelo nuevamente para colocarlo allí.',
  'settings.SecretsListModal.not_used_by_any_setting.85faf2ac':
    'No utilizado por ninguna configuración en este dispositivo',
  'settings.SecretsListModal.updated_value.51194723': 'Actualizado {value0}',
  'settings.SecretsListModal.every_key_that_is_set.19a2b157':
    'Cada clave que se establece, como líneas de nombre = valor, para un administrador de contraseñas o para pegar en otra aplicación.',
  'settings.SecretsListModal.every_key_listed_here_value.a6aac65e':
    'Cada clave enumerada aquí ({value0} de ellas) va al portapapeles como texto sin formato, donde cualquier aplicación de este dispositivo puede leerla. ',
  'settings.SecretsListModal.it_is_cleared_from_the.06480e6f':
    'Se borra del portapapeles en un minuto si todavía está allí.',
  'settings.SecretsListModal.on_this_device_it_stays.57af8178':
    'En este dispositivo permanece allí hasta que se copia algo más.',
  'settings.SecretsListModal.synced_keys_are_out_of.408b671b':
    'Las claves sincronizadas están desactualizadas aquí',
  'settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24':
    'Las claves sincronizadas están bloqueadas en este dispositivo',
  'settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8':
    'Esa frase de contraseña no abre el almacén.',
  'settings.SecretsListModal.the_store_may_hold_keys.5b2f6105':
    'El almacén puede tener claves que este dispositivo no tiene. Sus nombres también están encriptados, por lo que aparecen en la lista una vez que se desbloquea.',
  'settings.SecretsListModal.the_store_could_not_be.bafdcd54': 'No se pudo desbloquear el almacén.',
  'settings.SyncSettings.waiting_for_you.9f760ab2': 'Esperando por ti',
  'settings.SyncSettings.code_that_came_from_another.89b6b46f':
    'Código que proviene de otro dispositivo y archivos privados a los que se vincula una nota compartida.',

  'settings.SyncSettings.view_the_exact_incoming_version.6497a546':
    'Ver la versión entrante exacta',

  'settings.SyncSettings.allow_or_deny_this_file.5d819259':
    'Permitir o denegar este archivo para esta conexión',
  'settings.SyncSettings.connections.dc273117': 'Conexiones',
  'settings.SyncSettings.each_connection_works_on_its.4a88585e':
    'Cada conexión funciona por sí sola. La desconexión mantiene todos los archivos en este dispositivo.',
  'settings.SyncSettings.no_connections_yet.8697571e': 'Aún no hay conexiones',
  'settings.SyncSettings.paste_a_token_or_scan.257b9a79':
    'Pegue un token o escanee un código QR para conectarse.',
  'settings.SyncSettings.sync_this_connection_now.52cd5ea4': 'Sincroniza esta conexión ahora',
  'settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85':
    'Pausar, compartir, archivos eliminados, desconectar',
  'settings.SyncSettings.connect_to_a_server.232ac7de': 'Conectarse a un servidor',
  'settings.SyncSettings.by_a_token_you_were.d2dab8e7':
    'Mediante una ficha que te entregaron, la pegaste o la escaneaste.',
  'settings.SyncSettings.connect.c0e20f6d': 'Conectar…',
  'settings.SyncSettings.paste_a_token_for_a.256b8463':
    'Pegue un token para un servidor, carpeta o grupo',
  'settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6':
    'Se está abriendo el intercambio de archivos. Las conexiones que necesitan atención guardan sus archivos aquí.',
  'settings.SyncSettings.sync_is_opening_if_it.1225ed54':
    'La sincronización se está abriendo. Si no puede abrirse, reinicie Obsidian y vuelva a intentarlo.',
  'settings.SyncSettings.the_whole_vault.0a409543': 'toda la bóveda',
  'settings.SyncSettings.deleted_value_from_the_server.70376e92':
    'Se eliminó {value0} del servidor. Sus archivos permanecen en este dispositivo.',
  'settings.SyncSettings.keep_syncing_into_the_same.12873e9a':
    'Sigue sincronizando en la misma carpeta local',
  'settings.SyncSettings.follow_moved_folder.bba3cc92': 'Seguir carpeta movida',
  'settings.SyncSettings.restore_from_the_server.6186b8b7': 'Restaurar desde el servidor',
  'settings.SyncSettings.resume.d640c742': 'Reanudar',
  'settings.SyncSettings.pause.858e4ba7': 'Pausa',
  'settings.SyncSettings.share.51fc2d24': 'Compartir…',
  'settings.SyncSettings.deleted_files.5352e2e9': 'Archivos eliminados',
  'settings.SyncSettings.what_this_device_syncs.979d00ce': 'Qué sincroniza este dispositivo',
  'settings.SyncSettings.disconnect.f1142965': 'Desconectar…',
  'settings.SyncSettings.delete_from_the_server.b3acd04d': 'Eliminar del servidor…',
  'settings.SyncSettings.delete_from_the_server_read.5f7e4370':
    'Eliminar del servidor: solo lectura',
  'settings.SyncSettings.delete_from_the_server_unavailable.516a170e':
    'Eliminar del servidor: no disponible; comprobar la conexión y la versión del servidor',
  'settings.SyncSettings.the_file_could_not_be.accad798':
    'No se pudo abrir el archivo. Su contenido se ha conservado. Vuelva a intentarlo cuando haya un servidor disponible.',
  'settings.SyncSettings.incoming_changes_could_not_be.24745c6e':
    'No se pudieron abrir los cambios entrantes. Vuelva a abrir la configuración de sincronización para intentarlo nuevamente.',
  'settings.TaskLabelsSettings.labels.934b8899': 'Etiquetas',
  'settings.TaskLabelsSettings.labels_are_read_from_a.310aa3b6':
    'Las etiquetas se leen a partir de la propiedad de una tarea, un valor o una lista de ellos. Cada etiqueta puede tener un color; el resto son grises.',
  'settings.TaskLabelsSettings.label_property.2b08cac9': 'Propiedad de etiqueta',
  'settings.TaskLabelsSettings.the_task_property_labels_are.5b8a2eb7':
    'Se leen las etiquetas de propiedades de la tarea (predeterminado: "etiquetas").',
  'settings.TaskLabelsSettings.priority_property.1588ceb0': 'Propiedad prioritaria',
  'settings.TaskLabelsSettings.the_task_property_priority_is.19d87f4b':
    'La prioridad de la propiedad de la tarea se lee y se escribe (predeterminado: "prioridad"). No cambia qué propiedades tienen widgets.',
  'settings.TaskLabelsSettings.priority.3092a5f0': 'prioridad',
  'settings.TaskLabelsSettings.add_a_label.43db67d6': 'Agregar una etiqueta',
  'settings.TaskLabelsSettings.to_colour_a_label_before.7f8888f5':
    'Colorear una etiqueta antes de que cualquier tarea la lleve.',
  'settings.TaskLabelsSettings.label.0e66373f': 'Etiqueta',
  'settings.TaskLabelsSettings.add.9fd728c6': 'Añadir',
  'settings.TaskLabelsSettings.add_this_label_to_the.b2c3c5b9': 'Añadir esta etiqueta a la lista',
  'settings.TasksSettings.tasks_folder.9c703cd1': 'Carpeta de tareas',
  'settings.TasksSettings.optional_folder_path_to_store.68deedd3':
    'Ruta opcional de la carpeta para los archivos de tareas (predeterminada: "Tasks").',
  'settings.TasksSettings.enter_tasks_folder_path.685fec4a':
    'Ingrese la ruta de la carpeta de tareas',
  'settings.TasksSettings.tasks_time_choices.97d2bb52': 'Opciones de tiempo para las tareas',
  'settings.TasksSettings.optional_comma_separated_list_of.352a5929':
    'Lista opcional de opciones de hora para las tareas, separadas por comas (p. ej., "09:00,12:00,18:00").',
  'settings.TasksSettings.e_g.4c04e29e': 'p.ej. {literal0}',
  'settings.TasksSettings.tasks_date_choices.56987dbf': 'Opciones de fecha de tareas',
  'settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e':
    'Lista opcional de opciones de fecha para las tareas, separadas por comas (p. ej., "Today,Tomorrow,Next Week").',
  'settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0': 'p.ej. {literal0}',
  'settings.TasksSettings.tasks_recurrence_choices.5933e491': 'Opciones de recurrencia de tareas',
  'settings.TasksSettings.optional_comma_separated_list_of.f364b641':
    'Lista opcional de opciones de recurrencia para las tareas, separadas por comas (p. ej., "Daily,Weekly,Monthly").',
  'settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3': 'p.ej. {literal0}',
  'settings.TasksSettings.busy_day_threshold.ebd745bf': 'Umbral de día ocupado',
  'settings.TasksSettings.number_of_tasks_in_a.def227ff':
    'Número de tareas en un día para considerarlo como "día ocupado".',
  'settings.TasksSettings.e_g.8c2fb766': 'p.ej. {literal0}',
  'settings.TasksSettings.week_starts_on_monday.1e6c3ee3': 'La semana comienza el lunes.',
  'settings.TasksSettings.set_the_first_day_of.0426b53c':
    'Establezca el primer día de la semana para los cálculos de fechas.',
  'settings.TasksSettings.birth_date.5164b245': 'Fecha de nacimiento',
  'settings.TasksSettings.where_the_life_layout_of.291ea708':
    'Donde el diseño Life de una base de calendario comienza a contar tus semanas. Utilizado por todas las bases.',
  'settings.TasksSettings.life_expectancy.da8e9e4d': 'Esperanza de vida',
  'settings.TasksSettings.the_years_the_life_layout.4cd598a4':
    'Los años que dibuja el diseño de Life. Una base de calendario puede solicitar la suya propia en las opciones de la vista.',
  'settings.TimeTrackingSettings.time_entry_path_template.b06163ff':
    'Plantilla de ruta de entrada de tiempo',
  'settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8':
    'Plantilla para nuevas rutas de archivos de entrada de tiempo. Variables: {literal0}, {literal1}, {literal2}, {literalDate}.',
  'settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce': 'p.ej. {literal2}',
  'settings.TimeTrackingSettings.trackable_note_types.4b331926': 'Tipos de notas rastreables',
  'settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd':
    'Tipos de notas separadas por comas que muestran el botón del temporizador en el encabezado (por ejemplo, tarea, proyecto).',
  'settings.TimeTrackingSettings.e_g_task.1c985447': 'p.ej. {literal0}',
  'settings.TimeTrackingSettings.track_all_notes.41a2243c': 'Seguimiento de todas las notas',
  'settings.TimeTrackingSettings.show_the_timer_button_in.983d0303':
    'Muestra el botón del cronómetro en el encabezado de todas las notas, independientemente del tipo.',
  'settings.TransferSettings.send_to_another_device.71ef2876': 'Enviar a otro dispositivo',
  'settings.TransferSettings.tick_what_should_travel_what.be4e856b':
    'Marque lo que debe viajar. Lo que elijas puede ir como un código QR, como texto para pegar o como un archivo para enviar.',
  'settings.TransferSettings.include_keys.f7508fd4': 'incluir claves',
  'settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9':
    'Las claves API viajan con cualquier cosa que las necesite. Una transferencia que lleva una clave se bloquea detrás de un código de un solo uso, que se muestra aquí y se escribe en el otro dispositivo.',
  'settings.TransferSettings.what_to_send.bceb988a': 'que enviar',
  'settings.TransferSettings.clear.83b12c22': 'Quitar selección',
  'settings.TransferSettings.select_all.1fc9a387': 'Seleccionar todo',
  'settings.TransferSettings.send_nothing.1bc92d8a': 'no enviar nada',
  'settings.TransferSettings.send_everything_listed_here.f1ac2a00':
    'Envía todo lo que aparece aquí',
  'settings.TransferSettings.send_everything_under_value.1db19fa3': 'Enviar todo bajo {value0}',
  'settings.TransferSettings.send_value.c229d699': 'Enviar {value0}',
  'settings.TransferSettings.carries_a_key.0d090cb4': 'lleva una clave',
  'settings.TransferSettings.send_all_of_the_value.f01a8818': 'Enviar todos los {value0}',
  'settings.TransferSettings.nothing_here_can_be_transferred.49a46df4':
    'Aquí no se puede transferir nada todavía.',
  'settings.TransferSettings.preview.324b134f': 'Vista previa',
  'settings.TransferSettings.see_exactly_what_would_be.5a694fa9':
    'Ver exactamente lo que se enviaría',
  'settings.TransferSettings.choose_something_to_send_first.5fde4c03':
    'Elige algo para enviar primero',
  'settings.TransferSettings.send.f6f4688f': 'Enviar',
  'settings.TransferSettings.hand_what_you_chose_to.f4aa3506':
    'Pasa lo que elegiste al otro dispositivo',
  'settings.TransferSettings.receive_from_another_device.955f97bb':
    'Recibir desde otro dispositivo',
  'settings.TransferSettings.read_the_codes_the_other.7d52f77b':
    'Lea los códigos que muestra el otro dispositivo. No se escribe nada hasta que no hayas visto lo que llegó.',
  'settings.TransferSettings.read_a_transfer.da2dcc0f': 'Leer una transferencia',
  'settings.TransferSettings.camera_a_photo_of_the.d9996865':
    'Cámara, una foto del código, un archivo o el texto mismo.',
  'settings.TransferSettings.scan.ea1c510d': 'Escanear',
  'settings.TransferSettings.read_a_transfer_from_another.60d1c2f6':
    'Leer una transferencia de otro dispositivo',
  'settings.TransferSettings.notes.8a7525b1': 'Notas',
  'settings.TransferSettings.money_and_time.ebb5a49d': 'Dinero y tiempo',
  'settings.TransferSettings.agents.279b44d2': 'Agentes',
  'settings.TransferSettings.buttons.d452583a': 'Botones',
  'settings.TransferSettings.data.cec3a9b8': 'Datos',
  'settings.TransferSettings.nothing_selected_yet.d6f9822a': 'Aún no hay nada seleccionado.',
  'settings.TransferSettings.fits_in_one_code.324a2a38': 'Cabe en un código.',
  'settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4':
    'Toma códigos {value0}, que se muestran uno tras otro.',
  'settings.TransferSettings.takes_value_codes_too_many.304d8234':
    'Toma códigos {value0}; demasiados para fotografiarlos, por lo que iría como texto o como archivo.',
  'settings.TransferSettings.applied_value.d4ffb612': 'Aplicado {value0}.',
  'settings.TransferSettings.value_could_not_be_stored.cf4fe457':
    '{value0} no se pudo almacenar: el nombre que usa esta bóveda es uno que Obsidian no aceptará.',
  'settings.TransferSettings.value_could_not_be_written.93eaa96e': 'No se pudo escribir {value0}.',
  'settings.ai.AgentEditorModal.agent_value.c67844d1': 'Agente: {value0}',
  'settings.ai.AgentEditorModal.agent.11b39c93': 'Agente',
  'settings.ai.AgentEditorModal.name.dcd1d522': 'Nombre',
  'settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51':
    'Se muestra en el selector de agentes.',
  'settings.ai.AgentEditorModal.description.526e0087': 'Descripción',
  'settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342':
    'Le dice a otros agentes para qué sirve este.',
  'settings.ai.AgentEditorModal.utility_agent.e8384fe8': 'Agente de servicios públicos',
  'settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc':
    'Oculto del selector de chat. Aún disponible para guiones, delegación y borrador.\n              revisión.',
  'settings.ai.AgentEditorModal.model.5e2c614c': 'Modelo',
  'settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab':
    'El modelo en el que se ejecuta este agente.',
  'settings.ai.AgentEditorModal.fallback_model.ed293bb6': 'Modelo alternativo',
  'settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0':
    'Se ofrece como reintento cuando falla una solicitud. Utilizado automáticamente en ejecuciones delegadas,\n              donde nadie puede presionar un botón.',
  'settings.ai.AgentEditorModal.background_model.905a0833': 'modelo de fondo',
  'settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428':
    'Por nombrar y compactar los chats de este agente. Desarmado, el fondo de todo el complemento\n              La configuración del modelo decide, y al desarmarla también lo decide el propio modelo del chat.',
  'settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a':
    'Leen los chats de este agente en este orden, cada uno teniendo en cuenta lo que el anterior\n              devuelto: sus mensajes antes de que lo haga el agente, sus respuestas antes de que se queden, o\n              ambos. Un agente dice lo que piensa; un guión decide. Un chat puede mantener su propia lista.',
  'settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9':
    'Los bloques se unen en orden con una línea en blanco entre ellos. Utilice {value0} para la fecha de hoy.',
  'settings.ai.AgentEditorModal.block_value.dd05ec6a': 'Bloque {value0}',
  'settings.ai.AgentEditorModal.move_up.c66feb5e': 'Subir',
  'settings.ai.AgentEditorModal.move_down.40bb50da': 'Bajar',
  'settings.ai.AgentEditorModal.remove.c3812fc4': 'Eliminar',
  'settings.ai.AgentEditorModal.path_to_note.ef6763e6': 'Camino a la nota...',
  'settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2':
    'Instrucciones para este agente...',
  'settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4':
    'Sin bloqueos rápidos. Este agente se ejecuta sin instrucciones propias.',
  'settings.ai.AgentEditorModal.add_text_block.4b0903f4': 'Agregar bloque de texto',
  'settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8':
    'Adjunte un bloque de instrucciones escritas aquí.',
  'settings.ai.AgentEditorModal.add_note_block.34512584': 'Agregar bloque de notas',
  'settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7':
    'Agregar un bloque leído de una nota en la bóveda',
  'settings.ai.AgentEditorModal.permission_mode.c7a8e6db': 'Modo de permiso',
  'settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c':
    'Lo que este agente puede hacer sin preguntar.',
  'settings.ai.AgentEditorModal.github_connections.e95944e1': 'Conexiones de GitHub',
  'settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61':
    'Apagado: sin acceso. Pregunta: aprueba cada operación en un chat interactivo. Encendido: usar sin preguntar. Nuevas conexiones comienzan en cada servidor. Estas opciones no habilitan una herramienta de desactivación.',
  'settings.ai.AgentEditorModal.github_com.3aeb0024': 'github.com',
  'settings.ai.AgentEditorModal.unavailable_connection_value.795252e1':
    'Conexión no disponible: {value0}',
  'settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef':
    'Este agente hace referencia a una conexión que no está presente en este dispositivo. Transfiera la conexión o déjela desactivada.',
  'settings.ai.AgentEditorModal.scope.b073f6c6': 'Ámbito',
  'settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74':
    'Donde este agente trabaja por defecto. Una ejecución delegada también recibe cualquier chat.\n              que el delegado en él tenía abierto.',
  'settings.ai.AgentEditorModal.tools.ea93d6a2': 'Herramientas',
  'settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983':
    'Apagado = no disponible. Preguntar = necesita aprobación. Auto = se ejecuta solo. Las herramientas de archivos son\n              siempre disponible y regido por el modo de permiso anterior.',
  'settings.ai.AgentEditorModal.offer_tools.677c3882': 'Ofrecer herramientas',
  'settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7':
    'Por sección: el agente ve una entrada por sección con para qué sirve y abre una sección cuando lo necesita. Todo a la vez: todas las herramientas habilitadas se ofrecen desde el principio.',
  'settings.ai.AgentEditorModal.skills.66d0f523': 'Habilidades',
  'settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3':
    'Qué habilidades este agente puede cargar según demanda.',

  'settings.ai.AgentEditorModal.delegation_depth.29ea0156': 'Profundidad de delegación',
  'settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e':
    'Hasta qué punto este agente puede delegar. 0 elimina la herramienta de delegado por completo.',
  'settings.ai.AgentEditorModal.basic.0e35f6e9': 'Básico',
  'settings.ai.AgentEditorModal.prompts.5f2e66e6': 'Indicaciones',
  'settings.ai.AgentEditorModal.memory.c3963aed': 'Memoria',
  'settings.ai.AgentEditorModal.access.ec5ba0ab': 'Acceso',
  'settings.ai.AgentEditorModal.delegation.a6d910ba': 'Delegación',
  'settings.ai.AgentEditorModal.text.71988c4d': 'Texto',
  'settings.ai.AgentEditorModal.note.d8da2c49': 'Nota',
  'settings.ai.AgentEditorModal.all_skills.78abcbbf': 'todas las habilidades',
  'settings.ai.AgentEditorModal.no_skills.5083cd4b': 'Sin habilidades',
  'settings.ai.AgentEditorModal.only_selected.c1792bfe': 'Sólo seleccionado',
  'settings.ai.AgentEditorModal.cannot_delegate.6a16ca61': 'No puedo delegar',
  'settings.ai.AgentEditorModal.level.3292ae98': '1 nivel',
  'settings.ai.AgentEditorModal.levels.8b7cdd29': '2 niveles',
  'settings.ai.AgentEditorModal.levels.93b1554a': '3 niveles',
  'settings.ai.AgentEditorModal.off.ca7981b4': 'Apagado',
  'settings.ai.AgentEditorModal.ask.b8c209cd': 'Preguntar',
  'settings.ai.AgentEditorModal.on.13001175': 'En',
  'settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c':
    'Lo que se le pidió a este agente que recordara. Sólo este agente lo ve: se suma a su\n      indicador del sistema, presentado por la plantilla de memoria en la configuración general de AI. El agente añade\n      y cambia elementos con la herramienta recordar y los elimina con olvidar; ambos se pueden cambiar\n      desactivado en la pestaña Acceso.',
  'settings.ai.AgentMemoryEditor.added_value.29f396e2': 'Añadido {value0}',
  'settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d': 'Olvídate de este artículo',
  'settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6':
    'Aún no se recuerda nada. Pídale al agente en un chat que recuerde algo o agréguelo aquí.',
  'settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77':
    'Algo que este agente debería recordar...',
  'settings.ai.AgentMemoryEditor.add.9fd728c6': 'Añadir',
  'settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8':
    'Añade esta línea a la memoria del agente.',
  'settings.ai.AgentsSettings.an_agent_is_a_model.148349b4':
    'Un agente es un modelo, un conjunto de instrucciones y lo que se le permite hacer. Los chats continúan\n      uno; Los scripts y otros agentes pueden delegar en uno.',
  'settings.ai.AgentsSettings.default.37a8eec1': 'por defecto',
  'settings.ai.AgentsSettings.utility.57ffcc28': 'utilidad',
  'settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501': 'Duplicar este agente',
  'settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82':
    'El último agente no se puede eliminar: un chat debe ejecutarse sobre algo',
  'settings.ai.AgentsSettings.delete_this_agent.0ba11bd2': 'Eliminar este agente',
  'settings.ai.AgentsSettings.add_agent.d3e039d4': 'Agregar agente',
  'settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1':
    'Cree un agente y ábralo para editarlo',
  'settings.ai.AgentsSettings.delete_agent.602cc4da': 'Eliminar agente',
  'settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4':
    '¿Eliminar {value0}? Los chats que aún se estén ejecutando volverán al\n        agente predeterminado. Esto no se puede deshacer.',
  'settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d':
    'Un agente de utilidad no puede ser el predeterminado: está oculto en los chats',
  'settings.ai.AgentsSettings.already_the_default_agent.28842ed7':
    'Ya es el agente predeterminado.',
  'settings.ai.AgentsSettings.make_this_the_default_agent.4e646862':
    'Haga de este el agente predeterminado para nuevos chats.',
  'settings.ai.AgentsSettings.no_model.f62c7d17': 'ningún modelo',
  'settings.ai.AgentsSettings.whole_vault.18d9a3b5': 'bóveda entera',
  'settings.ai.AgentsSettings.no_scope.cc0ca29a': 'sin alcance',

  'settings.ai.GeneralSettings.ai_agent.b48c8be3': 'Agente de IA',
  'settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425':
    'Habilite las funciones del agente de IA, incluida la barra lateral de chat.',
  'settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23':
    'El agente de IA está apagado. Actívelo en General.',
  'settings.ai.GeneralSettings.keep_running_in_background_while.32440789':
    'Sigue ejecutándose en segundo plano mientras los agentes trabajan',
  'settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2':
    'Reproduzca audio silencioso mientras se ejecuta un turno. Puede usar más batería; La ejecución en segundo plano depende del sistema.',
  'settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee':
    'Seguir ejecutándose en segundo plano siempre',
  'settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f':
    'Reproduzca audio silencioso incluso cuando los agentes estén inactivos. Desactivado de forma predeterminada; puede usar más batería.',
  'settings.ai.GeneralSettings.key_destinations.fe672569': 'Destinos clave',
  'settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee':
    'Revise las direcciones cambiadas fuera de este dispositivo antes de enviar claves allí.',
  'settings.ai.GeneralSettings.review.aff0766a': 'Revisar',
  'settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591':
    'Revisa y confirma dónde envía las claves este dispositivo',
  'settings.ai.GeneralSettings.chat_storage.b1ad73cf': 'Almacenamiento de chat',
  'settings.ai.GeneralSettings.chat_path_template.306fa23b': 'Plantilla de ruta de chat',
  'settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e':
    'Plantilla de ruta para archivos de chat. Variables: {value0}, {value1}.',
  'settings.ai.GeneralSettings.ai_chats.f579b34b': 'IA/Chats',
  'settings.ai.GeneralSettings.rewind_space_mb.a3eaae55': 'Espacio de rebobinado (MB)',
  'settings.ai.GeneralSettings.how_much_room_on_this.f5c80989':
    '¿Cuánto espacio, en este dispositivo, pueden ocupar las copias que permiten que un chat recupere el\n            archivos que su agente cambió. Los chats escritos menos recientemente pierden el suyo primero. 0 mantiene\n            nada y los chats no pueden retroceder.',
  'settings.ai.GeneralSettings.migrate_chats.cd7a094d': 'Migrar chats',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b':
    'Mueva los archivos de chat existentes para que coincidan con la plantilla de ruta actual.',
  'settings.ai.GeneralSettings.migrating.e3c84baf': 'Migrando...',
  'settings.ai.GeneralSettings.migrate.f988ed29': 'Emigrar',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22':
    'Mueva los archivos de chat existentes para que coincidan con la plantilla anterior',
  'settings.ai.GeneralSettings.comment_agent.42067bbf': 'Agente de comentarios',
  'settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0':
    'Qué agente responde a los chats de comentarios. También se ofrecen agentes de servicios públicos: el que\n            sembrado para comentarios es uno.',
  'settings.ai.GeneralSettings.comment_folder.0f39b86a': 'Carpeta de comentarios',
  'settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501':
    'Dónde se almacenan los chats de comentarios',
  'settings.ai.GeneralSettings.ai_comments.e01654c6': 'IA/Comentarios',
  'settings.ai.GeneralSettings.skills.66d0f523': 'Habilidades',
  'settings.ai.GeneralSettings.skills_folder.bc563bf9': 'Carpeta de habilidades',
  'settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b':
    'Aquí se ofrecen habilidades a cada agente. En otros lugares, sólo se ofrecen habilidades en el ámbito del chat; cargar otra habilidad pregunta primero. La selección de habilidades del agente aún se aplica.',
  'settings.ai.GeneralSettings.ai_skills.cebb9b9a': 'IA/Habilidades',
  'settings.ai.GeneralSettings.integrations.090512d9': 'Integraciones',
  'settings.ai.GeneralSettings.brave_search_api_key.309e5bff': 'Clave API de búsqueda valiente',
  'settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5':
    'Guardado de forma segura en llavero.',
  'settings.ai.GeneralSettings.secrets.d8707d41': 'Misterios',

  'settings.ai.GeneralSettings.unnamed.9edb143e': '(sin nombre)',
  'settings.ai.GeneralSettings.secret_name.5cdf573b': 'nombre secreto',
  'settings.ai.GeneralSettings.value.fb2e2c72': 'Valor...',
  'settings.ai.GeneralSettings.allowed_addresses.0479f7eb': 'Direcciones permitidas',
  'settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c':
    'Agregue una dirección de la confirmación de una solicitud. Cada solicitud de clave guardada todavía pregunta.',
  'settings.ai.GeneralSettings.remove.c3812fc4': 'Eliminar',
  'settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72':
    'Eliminar esta dirección de la lista permitida de la clave',
  'settings.ai.GeneralSettings.none_yet.adb85cf2': 'Ninguno todavía',
  'settings.ai.GeneralSettings.remove_this_secret.42b31675': 'Quitar este secreto',
  'settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa':
    'Cancelar: dejar el valor almacenado como está',
  'settings.ai.GeneralSettings.add_secret.f57a23c6': 'Agregar secreto',
  'settings.ai.GeneralSettings.add_another_named_secret.16c8806f':
    'Agregar otro secreto con nombre',
  'settings.ai.GeneralSettings.providers.996c32b3': 'Proveedores',
  'settings.ai.GeneralSettings.base_url.70589413': 'URL base',
  'settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e':
    'Punto final API compatible con OpenAI.',
  'settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef': 'Obtener modelos de API',
  'settings.ai.GeneralSettings.add_model_manually.c42ee506': 'Agregar modelo manualmente',

  'settings.ai.GeneralSettings.filter_models.e91fd9af': 'Filtrar modelos...',
  'settings.ai.GeneralSettings.reasoning.0c4d01e8': 'razonamiento',
  'settings.ai.GeneralSettings.no_models_yet.36604ff4': 'Aún no hay modelos.',
  'settings.ai.GeneralSettings.add_another_provider.91f9cd40': 'Agregar otro proveedor',
  'settings.ai.GeneralSettings.no_providers_yet.55327313': 'Aún no hay proveedores',
  'settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8':
    'Cualquier servicio que hable la API OpenAI: su dirección, una clave y sus modelos.',
  'settings.ai.GeneralSettings.add_provider.8cd1856b': 'Agregar proveedor',
  'settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7':
    'Agregue otro proveedor compatible con OpenAI',
  'settings.ai.GeneralSettings.background_model.eefa747e': 'Modelo de fondo',
  'settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa':
    'Los modelos de chat se eligen por agente, en la pestaña Agentes. Éste se utiliza para el\n          propio trabajo en segundo plano del complemento: nombrar chats y compactar conversaciones largas.',
  'settings.ai.GeneralSettings.auxiliary_model.6c245762': 'Modelo auxiliar',
  'settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143':
    'Se utiliza para títulos de chat y compactación. Si no se configura, cada chat usa el modelo que es.\n            ya hablando con; un agente puede nombrar uno propio, lo que le gana.',
  'settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7': 'Auxiliar secuencial',
  'settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159':
    'Ejecute tareas auxiliares una vez finalizado el modelo principal. Habilitar para modelos locales con rendimiento limitado.',
  'settings.ai.GeneralSettings.when_a_request_fails.8adc1690': 'Cuando una solicitud falla',
  'settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33':
    'Sólo se repiten los fallos que pasan por sí solos: un límite de velocidad, un proveedor sobrecargado, una conexión caída. Una clave rechazada o una solicitud incorrecta no se vuelve a intentar.',
  'settings.ai.GeneralSettings.try_again_automatically.84c6a3e7':
    'Inténtalo de nuevo automáticamente',
  'settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd':
    '¿Cuántos intentos más después del primero?',
  'settings.ai.GeneralSettings.first_wait.548b0480': 'primera espera',
  'settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb':
    'Segundos antes del primer reintento. Cada uno después lo duplica, hasta un minuto.',
  'settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08':
    'Solicitar tiempo de espera (segundos)',
  'settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5':
    'Espere a que el modelo se conecte o envíe el siguiente fragmento de respuesta, no la respuesta completa. 1–3600 segundos; restauraciones vacías 60. Se utiliza para chat y modelos en segundo plano sin su propio tiempo de espera.',
  'settings.ai.GeneralSettings.voice_input.8748f239': 'Entrada de voz',
  'settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a':
    'Dítelo en el chat o en una nota con el comando "Dictar en la nota". OpenRouter no tiene un punto final de transcripción, por lo que el audio va a un modelo que escucha; estos dos fueron elegidos por su precio, por funcionar en Europa y por no entrenarse con lo que se envía.',
  'settings.ai.GeneralSettings.model.5e2c614c': 'Modelo',
  'settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f':
    'Lo que convierte el habla en texto.',
  'settings.ai.GeneralSettings.model_id.7789530b': 'Identificación del modelo',
  'settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177':
    'Cualquier modelo que acepte audio, como lo denomina su proveedor.',
  'settings.ai.GeneralSettings.vendor_model.ba723767': 'proveedor/modelo',
  'settings.ai.GeneralSettings.endpoint.3df9726c': 'Punto final',
  'settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7':
    'Dejado vacío, finalización del chat de OpenRouter.',
  'settings.ai.GeneralSettings.language.a4fe6526': 'Idioma',
  'settings.ai.GeneralSettings.told_to_the_model_as.35170cef':
    'Se lo dijo a la modelo a modo de pista. Si se deja vacío, lo resuelve a partir del audio.',
  'settings.ai.GeneralSettings.russian.5bcc40ad': 'ruso',
  'settings.ai.GeneralSettings.client_name.b6626cd7': 'Nombre del cliente',
  'settings.ai.GeneralSettings.default.21b111cb': 'Predeterminado',
  'settings.ai.GeneralSettings.openrouter_api_key.89616b71': 'Clave API de OpenRouter',
  'settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21':
    'Almacenado en el llavero, compartido con generación de imágenes.',
  'settings.ai.GeneralSettings.image_generation.8f4716e6': 'Generación de imágenes',
  'settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226':
    'Identificador corto utilizado en claves de modelo (por ejemplo, openai, openrouter).',
  'settings.ai.GeneralSettings.e_g_openai.e3ce2f3c': 'p.ej. {literal0}',
  'settings.ai.GeneralSettings.api_type.72e7cc4c': 'Tipo de API',
  'settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d':
    'OpenAI usa /v1/images/generaciones, OpenRouter usa finalización de chat.',
  'settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3': 'Dejar vacío por defecto: ',
  'settings.ai.GeneralSettings.add_model.b2609f7d': 'Agregar modelo',
  'settings.ai.GeneralSettings.add_another_image_provider.fac89d72':
    'Agregar otro proveedor de imágenes',
  'settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca':
    'Aún no hay proveedores de imágenes',
  'settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb':
    'Un servicio que crea imágenes a partir de palabras para que el agente pueda dibujar.',
  'settings.ai.GeneralSettings.add_image_provider.858726bf': 'Agregar proveedor de imágenes',
  'settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9':
    'Agregar otro proveedor de generación de imágenes',
  'settings.ai.GeneralSettings.default_image_model.164d9980': 'Modelo de imagen predeterminado',
  'settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88':
    'Se utiliza cuando el agente no especifica un modelo.',
  'settings.ai.GeneralSettings.prompts.5f2e66e6': 'Indicaciones',
  'settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4':
    'Lo que el complemento dice a los modelos para su propio trabajo. Cada uno comienza como propio del complemento; cambie uno solo para cambiar cómo sale ese trabajo.',
  'settings.ai.GeneralSettings.tool_descriptions.eb258712': 'Descripciones de herramientas',
  'settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136':
    'Lo que cada herramienta le dice al modelo sobre sí mismo, compartido por cada agente. Las herramientas que puede utilizar un agente se establecen por agente.',
  'settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106':
    '{value0} cambió del propio del complemento',
  'settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39':
    'Cambiar lo que las herramientas le dicen al modelo.',
  'settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab':
    'Cambiado de las propias palabras del complemento.',
  'settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921': 'Cambiar el mensaje {value0}',
  'settings.ai.GeneralSettings.use_the_default.76f7faf5': 'Utilice el valor predeterminado',
  'settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb':
    'Volver a las propias palabras del complemento.',
  'settings.ai.GeneralSettings.cancel.19766ed6': 'Cancelar',
  'settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492': 'Cerrar sin cambiar nada',
  'settings.ai.GeneralSettings.save.1509f561': 'Guardar',
  'settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d':
    'Usa estas palabras de ahora en adelante',
  'settings.ai.GeneralSettings.done.11a6767d': 'Listo',
  'settings.ai.GeneralSettings.close_this_window.3f02fc8e': 'Cerrar esta ventana',
  'settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9': '{value0} chats migrados',
  'settings.ai.GeneralSettings.migration_failed_value.109b5f7f': 'Error de migración: {value0}',
  'settings.ai.GeneralSettings.default_agent.94da52ec': 'Agente predeterminado',
  'settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9':
    'Introduzca 1–3600 segundos. Este valor no ha sido guardado.',
  'settings.ai.GeneralSettings.something_else.b4768d66': 'Otra cosa…',
  'settings.ai.GeneralSettings.remove_secret.1422ca6e': 'Quitar secreto',

  'settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101':
    'Guardado {value0} en el llavero',
  'settings.ai.GeneralSettings.agent_memory.f3cd4df6': 'Memoria del agente',
  'settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab':
    'Cómo se agrega al indicador del sistema lo que se le pidió que recordara a un agente; {value0} es donde van los artículos.',
  'settings.ai.GeneralSettings.chat_titles.950a9874': 'Títulos de chat',
  'settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a':
    'Nombra un chat desde sus primeros mensajes; {value0} es a donde van.',
  'settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9': 'Títulos de chat, sistema.',
  'settings.ai.GeneralSettings.what_the_model_that_names.4a08978e':
    'Lo que se dice que es el modelo que da nombre a los chats.',
  'settings.ai.GeneralSettings.chat_recap.adaaf80a': 'Resumen del chat',
  'settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c':
    'La frase en la tarjeta de un chat debajo de una nota cambió; {value0} es donde van los mensajes.',
  'settings.ai.GeneralSettings.chat_summary.b82dab10': 'Resumen del chat',
  'settings.ai.GeneralSettings.the_short_line_under_a.c81696a8':
    'La línea corta debajo del título de un chat en el historial; {value0} es donde van los mensajes.',
  'settings.ai.GeneralSettings.compacting.df77799c': 'Compactación',
  'settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886':
    'Cómo se resume una larga conversación para que pueda continuar; {value0} es a donde va.',
  'settings.ai.InterceptorList.interceptors.803987ac': 'Interceptores',
  'settings.ai.InterceptorList.off.ca7981b4': 'Apagado',
  'settings.ai.InterceptorList.close_its_settings.de0fd0fb': 'Cierra su configuración',
  'settings.ai.InterceptorList.edit_what_it_reads_and.86412c66': 'Edite lo que lee y cómo',
  'settings.ai.InterceptorList.on_runs_in_its_turn.baf521d9': 'Encendido: se ejecuta a su vez',
  'settings.ai.InterceptorList.off_skipped_keeps_its_place.28162216':
    'Apagado: omitido, mantiene su lugar',
  'settings.ai.InterceptorList.move_or_remove.ca447e47': 'Mover o quitar',
  'settings.ai.InterceptorList.who_reads_an_agent_says.0ff03e5e':
    'Quién lee: un agente dice lo que piensa, un guión decide.',
  'settings.ai.InterceptorList.add_interceptor.36b0eb2d': 'Agregar interceptor',
  'settings.ai.InterceptorList.add_one_at_the_end.98a5c813': 'Agrega uno al final; corre último',
  'settings.ai.InterceptorList.an_agent_or_a_script.92a06c1a':
    'Un agente o un script que se lee primero',
  'settings.ai.InterceptorList.everything.75304cf7': 'Todo',
  'settings.ai.InterceptorList.they_run_in_this_order.7b624feb':
    'Se ejecutan en este orden, cada uno teniendo en cuenta lo que devolvió el anterior. El agente lee el texto del último.',
  'settings.ai.InterceptorList.script_value_missing.31a4f5d0': 'Guión: {value0} · faltante',
  'settings.ai.InterceptorList.missing_agent.4eeff6c3': 'Agente desaparecido',
  'settings.ai.InterceptorList.nobody.3fad99b5': 'Nadie',
  'settings.ai.InterceptorList.move_up.c66feb5e': 'Subir',
  'settings.ai.InterceptorList.move_down.40bb50da': 'Bajar',
  'settings.ai.InterceptorList.remove.c3812fc4': 'Eliminar',
  'settings.ai.InterceptorSettings.interceptor.e7123168': 'Interceptador',
  'settings.ai.InterceptorSettings.checks.de07d072': 'cheques',
  'settings.ai.InterceptorSettings.only_messages_matching.a6b95968': 'Solo coinciden mensajes',
  'settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb':
    'Una expresión regular, simple o como /pattern/flags, probada en cualquier cosa que esté marcada. El resto pasa sin control. Vacío lo es todo.',

  'settings.ai.InterceptorSettings.reply_only.df23f4c5': 'Sólo responder',
  'settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839':
    'Envíe sus mensajes sin cambios directamente al agente principal. El interceptor puede responder al lado de cada mensaje, sin retenerlo, reescribirlo ni decidir la aprobación de la herramienta.',
  'settings.ai.InterceptorSettings.interceptor_context.4b7f6f53': 'Contexto interceptor',
  'settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856':
    'Cuánto de la conversación ve el interceptor.',
  'settings.ai.InterceptorSettings.everything.75304cf7': 'Todo',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec':
    'Tus mensajes, antes de que el agente los lea.',
  'settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d':
    'Las respuestas del agente, una vez finalizado. Un nuevo texto del interceptor ocupa el lugar de la respuesta; el original permanece a una pulsación de distancia.',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706':
    'Tus mensajes antes de que el agente los lea, y sus respuestas una vez finalizado. Un nuevo texto del interceptor ocupa el lugar de la respuesta.',
  'settings.ai.McpServerModal.add_mcp_server.0e3e58f9': 'Agregar servidor MCP',
  'settings.ai.McpServerModal.edit_mcp_server.35d90caa': 'Editar servidor MCP',
  'settings.ai.McpServerModal.name.dcd1d522': 'Nombre',
  'settings.ai.McpServerModal.e_g_context.e900fc3c': 'p.ej. {literal0}',
  'settings.ai.McpServerModal.another_server_already_has_this.8e96ea34':
    'Otro servidor ya tiene este nombre. Los nombres de las herramientas provienen de él, por lo que tiene que ser diferente.',
  'settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59':
    'El punto final MCP del servidor, alcanzado a través de HTTP.',
  'settings.ai.McpServerModal.on.13001175': 'En',
  'settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37':
    'Off lo mantiene aquí y no le da sus herramientas a ningún agente.',
  'settings.ai.McpServerModal.token.d2089be6': 'Token',
  'settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3':
    'Se envía como Authorization: Bearer. Se guarda en el llavero, nunca en el archivo de ajustes.',
  'settings.ai.McpServerModal.optional.59be7133': 'Opcional',
  'settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436':
    'Olvidar el token almacenado al guardar',
  'settings.ai.McpServerModal.headers.194e9fe6': 'Encabezados',
  'settings.ai.McpServerModal.tools.ea93d6a2': 'Herramientas',
  'settings.ai.McpServerModal.what_agents_are_told_is.7591a661':
    'Lo que se les dice a los agentes es esta lista tal como fue obtenida. Cambia solo cuando lo buscas\n          nuevamente aquí y guardar.',
  'settings.ai.McpServerModal.fetch_tools.4788d40d': 'buscar herramientas',
  'settings.ai.McpServerModal.connect_to_the_server_and.db04f00f':
    'Conéctese al servidor y lea las herramientas que ofrece',
  'settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f':
    'Necesita primero la URL del servidor',
  'settings.ai.McpServerModal.save.1509f561': 'Guardar',
  'settings.ai.McpServerModal.keep_this_server_and_close.f4798cef':
    'Mantenga este servidor y cierre',
  'settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc': 'Necesita un nombre propio y una URL',
  'settings.ai.McpServerModal.delete.e2d0a549': 'Eliminar',
  'settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c':
    'Eliminar este servidor; Los agentes pierden sus herramientas.',
  'settings.ai.McpServerModal.delete_mcp_server.1a969bef': 'Eliminar servidor MCP',
  'settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d':
    '¿Eliminar {value0}? Cada agente pierde sus herramientas.',

  'settings.ai.McpServerModal.also_the_start_of_its.6f23c597':
    'También el inicio de los nombres de sus herramientas: mcp_{value0}_<tool>.',
  'settings.ai.McpServerModal.fetching.8d0738c8': 'Atractivo…',
  'settings.ai.McpServerModal.not_fetched_yet.d17fdec2': 'Aún no recuperado',
  'settings.ai.McpSettings.servers_that_give_agents_more.67631550':
    'Servidores que brindan a los agentes más herramientas, accesibles a través de HTTP, también desde un teléfono. Nada es\n      iniciado en este dispositivo. Las herramientas de un servidor llegan a un agente sólo una vez que están encendidas.\n      la pestaña Acceso de ese agente y preguntan antes de cada llamada, a menos que se establezca lo contrario.',
  'settings.ai.McpSettings.delete_this_server.e42cb344': 'Eliminar este servidor',
  'settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef': 'Aún no hay servidores MCP.',
  'settings.ai.McpSettings.add_server.1099b2a9': 'Agregar servidor',
  'settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42':
    'Conecte un servidor MCP por su dirección',
  'settings.ai.McpSettings.delete_mcp_server.1a969bef': 'Eliminar servidor MCP',
  'settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d':
    '¿Eliminar {value0}? Cada agente pierde sus herramientas.',
  'settings.ai.McpSettings.off.ca7981b4': 'Apagado',
  'settings.ai.McpSettings.on.13001175': 'En',
  'settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f':
    'Encendido, herramientas aún no recuperadas',
  'settings.ai.ProviderSettings.unnamed_provider.1b003656': 'Proveedor sin nombre',
  'settings.ai.ProviderSettings.change_this_provider_and_its.6b743289':
    'Cambiar este proveedor y sus modelos',
  'settings.ai.ProviderSettings.new_provider.38a96a6a': 'Nuevo proveedor',
  'settings.ai.ProviderSettings.name.dcd1d522': 'Nombre',
  'settings.ai.ProviderSettings.client_name.b6626cd7': 'Nombre del cliente',
  'settings.ai.ProviderSettings.default.21b111cb': 'Predeterminado',
  'settings.ai.ProviderSettings.api_key.16f0ee47': 'clave API',
  'settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578':
    'Guardado en el llavero de este dispositivo.',
  'settings.ai.ProviderSettings.models.d17d2d78': 'Modelos',
  'settings.ai.ProviderSettings.delete.e2d0a549': 'Eliminar',
  'settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b':
    'Eliminar este proveedor y sus modelos.',
  'settings.ai.ProviderSettings.done.11a6767d': 'Listo',
  'settings.ai.ProviderSettings.close_this_window_changes_are.91342d87':
    'Cierra esta ventana; Los cambios se mantienen a medida que los realiza.',
  'settings.ai.ToolDescriptions.value_of_value.ca6c5e5f': '{value0} de {value1}',
  'settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab':
    'Cambiado de las propias palabras del complemento.',
  'settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d':
    'Cambiar lo que {value0} le dice al modelo',
  'settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7':
    'Lo que esta herramienta le dice al modelo sobre sí mismo.',
  'settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7':
    'Lo que {value0} le dice al modelo',
  'settings.ai.ToolDescriptions.use_the_default.76f7faf5': 'Utilice el valor predeterminado',
  'settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb':
    'Volver a las propias palabras del complemento.',
  'settings.ai.ToolDescriptions.cancel.19766ed6': 'Cancelar',
  'settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492': 'Cerrar sin cambiar nada',
  'settings.ai.ToolDescriptions.save.1509f561': 'Guardar',
  'settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d':
    'Usa estas palabras de ahora en adelante',
  'settings.ai.interceptorList.reply_only.37786db8': 'solo responder',
  'settings.ai.options.ask_before_every_change.f5fb08f2': 'Preguntar antes de cada cambio',
  'settings.ai.options.edit_files_without_asking.08674c9f': 'Editar archivos sin preguntar',
  'settings.ai.options.everything_without_asking.d14adf38': 'todo sin preguntar',
  'settings.ai.options.value_utility.6fb6bae8': '{value0} · utilidad',
  'settings.ai.options.script_value_value.97c5d924': 'Guión: {value0}{value1}',
  'settings.scripts.AutomationsEditor.automations.ad1fb9ec': 'Automatizaciones',

  'settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15': 'Aún no hay automatizaciones.',
  'settings.scripts.AutomationsEditor.off.ca7981b4': 'Apagado',
  'settings.scripts.AutomationsEditor.delete_this_automation.76539f9f':
    'Eliminar esta automatización',
  'settings.scripts.AutomationsEditor.run_this_automation.25a70adc': 'Ejecute esta automatización',
  'settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f':
    'Off lo mantiene configurado aquí sin ejecutarlo.',
  'settings.scripts.AutomationsEditor.name.dcd1d522': 'Nombre',
  'settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc':
    'Cómo se llama aquí y en la lista de ejecuciones de scripts.',
  'settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8': 'p.ej. {literal0}',
  'settings.scripts.AutomationsEditor.when.cf9c7aa2': 'Cuando',
  'settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf':
    '¿Qué tiene que suceder para que se ejecute el script?',
  'settings.scripts.AutomationsEditor.note_types.52d728fb': 'Tipos de notas',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4':
    'Separados por comas. Sólo notas cuyo tipo de portada sea uno de estos. Vacía está cualquier nota.',
  'settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4': 'p.ej. {literal0}',
  'settings.scripts.AutomationsEditor.folders.c4d6bb20': 'Carpetas',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774':
    'Separados por comas. Sólo notas debajo de uno de estos. El vacío está en cualquier lugar.',
  'settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d': 'p.ej. {literal0}',
  'settings.scripts.AutomationsEditor.property.40040cb1': 'Propiedad',
  'settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04':
    'Sólo notas con esta propiedad frontal. Opcional.',
  'settings.scripts.AutomationsEditor.e_g_area.95b1c988': 'p.ej. {literal0}',
  'settings.scripts.AutomationsEditor.equals.f939ae3d': 'igual',
  'settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f':
    '…manteniendo este valor, o uno de sus valores. Vacío es cualquier valor.',
  'settings.scripts.AutomationsEditor.e_g_home.a9f31279': 'p.ej. {literal0}',
  'settings.scripts.AutomationsEditor.script.102acc10': 'Guion',
  'settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704':
    'Script para que se ejecute la automatización.',
  'settings.scripts.AutomationsEditor.choose_script.e582e7b2': 'Elige guión...',
  'settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d':
    'Busque los scripts que ejecuta esta automatización',
  'settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9':
    'Este script no toma parámetros.',
  'settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590':
    'Como máximo cada (segundos)',
  'settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf':
    'Por una nota. Los cambios intermedios se agrupan en una sola ejecución al final. 0 se ejecuta en cada cambio.',
  'settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225':
    'También para cambios desde otros dispositivos',
  'settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2':
    'Desactivado, un cambio que llega por sincronización no ejecuta nada aquí: ya se ejecutó en el dispositivo donde se realizó.',
  'settings.scripts.AutomationsEditor.add_automation.537c3ee4': 'Agregar automatización',
  'settings.scripts.AutomationsEditor.add_another_automation.78aa262d':
    'Agregar otra automatización',
  'settings.scripts.AutomationsEditor.delete_automation.f71084e7': 'Eliminar automatización',
  'settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0':
    '¿Eliminar {value0}? Su guión se detiene\n        funcionando por sí solo. Esto no se puede deshacer.',
  'settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a':
    'Aún no se ha elegido ningún guión',
  'settings.scripts.AutomationsEditor.no_description.06a69482': 'Sin descripción.',
  'settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925':
    '{value0} · por defecto es {value1}',
  'settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78': 'Botones de cabecera',

  'settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4': 'Botón sin nombre',

  'settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275':
    'Muévete antes: ya es el primero',
  'settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10':
    'Mover antes en el encabezado',
  'settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45':
    'Mover más tarde: ya es el último',
  'settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d':
    'Mover más tarde en el encabezado',
  'settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e': 'Cambiar este botón',
  'settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516': 'Agregar otro botón',
  'settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3':
    'Aún no hay botones de encabezado',
  'settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f':
    'Un comando o un guión, sobre las notas que elijas.',
  'settings.scripts.HeaderButtonsEditor.add_button.c0f290f3': 'botón agregar',
  'settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8':
    'Agregue un botón de encabezado y configúrelo',
  'settings.scripts.HeaderButtonsEditor.new_button.c499cbe3': 'Nuevo botón',
  'settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80': 'que corre',
  'settings.scripts.HeaderButtonsEditor.runs.848f54e8': 'Corre',
  'settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412':
    'Un comando desde cualquier lugar de Obsidian, o uno de tus scripts.',
  'settings.scripts.HeaderButtonsEditor.name.dcd1d522': 'Nombre',
  'settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef':
    'Se muestra como información sobre herramientas del botón y en el menú donde no encaja.',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b':
    'Se muestra en el botón o como información sobre herramientas cuando es solo un icono.',
  'settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.icon.a35abcd6': 'Icono',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8':
    'Se muestra en el botón del encabezado.',
  'settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06':
    'Elija el icono de todo el conjunto, por imagen o por nombre',
  'settings.scripts.HeaderButtonsEditor.command.71316697': 'Dominio',
  'settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f':
    'Comando el botón se ejecuta.',
  'settings.scripts.HeaderButtonsEditor.choose_command.ea49d680': 'Elija comando...',
  'settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77':
    'Busque en cada comando que tenga Obsidian el que ejecuta este botón',
  'settings.scripts.HeaderButtonsEditor.icon_only.7a047008': 'Solo icono',
  'settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5':
    'Deje el nombre fuera del encabezado, si el encabezado ya está lleno.',
  'settings.scripts.HeaderButtonsEditor.script.102acc10': 'Guion',
  'settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c':
    'Script para que se ejecute el botón.',
  'settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2': 'Elige guión...',
  'settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4':
    'Busque los scripts que ejecuta este botón',
  'settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9':
    'Este script no toma parámetros.',
  'settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1': 'donde se muestra',
  'settings.scripts.HeaderButtonsEditor.on_every_note.d761c688': 'En cada nota',
  'settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572':
    'Sea cual sea su tipo, etiquetas o carpeta.',
  'settings.scripts.HeaderButtonsEditor.note_types.52d728fb': 'Tipos de notas',
  'settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.folders.c4d6bb20': 'Carpetas',
  'settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.tags.1331275b': 'Etiquetas',
  'settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4':
    'Separados por comas, con o sin #. Las notas con uno de estos, o una etiqueta anidada debajo, también muestran el botón.',
  'settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318': 'También en otros archivos',
  'settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c':
    'PDF, lienzos, libros y otros archivos abiertos en una pestaña, hasta donde lleguen sus carpetas y etiquetas. No tienen tipo ni propiedades.',
  'settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87':
    'Sólo cuando sus propiedades',
  'settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754':
    'La nota también debe tenerlos en su portada.',
  'settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb':
    'Muéstrelo sólo en notas cuyo texto inicial se ajuste, por ejemplo, un estado o una fecha completada.',
  'settings.scripts.HeaderButtonsEditor.add_condition.60a0d835': 'Agregar condición',
  'settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa':
    'Pregunta por una propiedad más de la nota',
  'settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b': 'Condiciones necesarias',
  'settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1':
    'Si el billete debe cumplir con todas las condiciones siguientes o con cualquiera de ellas.',
  'settings.scripts.HeaderButtonsEditor.property.40040cb1': 'Propiedad',
  'settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56': 'p.ej. {literal0}',
  'settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189': 'Eliminar esta condición',
  'settings.scripts.HeaderButtonsEditor.delete.e2d0a549': 'Eliminar',
  'settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9': 'Eliminar este botón',
  'settings.scripts.HeaderButtonsEditor.done.11a6767d': 'Listo',
  'settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87':
    'Cierra esta ventana; Los cambios se mantienen a medida que los realiza.',
  'settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880': 'Botón eliminar encabezado',
  'settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26':
    '¿Eliminar {value0}? Desaparece de cada\n        encabezado de nota en el que estaba. Esto no se puede deshacer.',
  'settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee': 'un comando',
  'settings.scripts.HeaderButtonsEditor.a_script.1ccd820b': 'un guion',
  'settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7':
    'Aún no se ha elegido ningún comando',
  'settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a':
    'Aún no se ha elegido ningún guión',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848':
    'Separados por comas. Las notas cuyo tipo de portada es una de estas muestran el botón.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3':
    'Ninguna nota en esta bóveda tiene el tipo {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78':
    'Ninguna nota en esta bóveda tiene los tipos {value0}.',
  'settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815':
    '{value0} Tipos en uso: {value1}.',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44':
    'Separados por comas. Las notas en cualquier lugar debajo de uno de estos también muestran el botón. A * significa ',
  'settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a':
    'cualquier carpeta, ** para cualquier profundidad: {literal0}.',
  'settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9':
    'No hay carpeta {value0} en esta bóveda.',
  'settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1':
    'No hay carpetas {value0} en esta bóveda.',
  'settings.scripts.HeaderButtonsEditor.is.fa51fd49': 'es',
  'settings.scripts.HeaderButtonsEditor.is_not.e1bf1560': 'no es',
  'settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1': 'esta lleno',
  'settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d': 'esta vacio',
  'settings.scripts.HeaderButtonsEditor.all_of_them.29c88933': 'Todos',
  'settings.scripts.HeaderButtonsEditor.any_one.4013adf2': 'Alguien',
  'settings.scripts.HeaderButtonsEditor.no_description.06a69482': 'Sin descripción.',
  'settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925':
    '{value0} · por defecto es {value1}',
  'settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819':
    'Nombra una propiedad inicial; hasta entonces esta condición se ignora.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b':
    'Notas cuyo {value0} está cumplimentado.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a':
    'Notas cuyo {value0} está vacío o falta.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0':
    'Notas cuyo {value0} es cualquier cosa menos "{value1}", faltan incluidas.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f':
    'Notas cuyo {value0} es "{value1}", o lo mantiene en una lista.',
  'settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908':
    'Escriba el valor que debe tener {value0}.',
  'settings.scripts.ScriptLibrary.library.dc20b3d5': 'Biblioteca',

  'settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644':
    'Los scripts están desactivados. Actívelos en General para ver qué contiene la carpeta.',
  'settings.scripts.ScriptLibrary.filter.638e249f': 'Filtrar',
  'settings.scripts.ScriptLibrary.by_name_or_description.95a3575e': 'Por nombre o descripción.',
  'settings.scripts.ScriptLibrary.e_g_archive.a525e8b2': 'p.ej. {literal0}',
  'settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0':
    'Ningún guión coincide con eso.',
  'settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa':
    'Aún no hay scripts en la carpeta.',
  'settings.scripts.ScriptLibrary.refused.66b87354': 'Rechazado',
  'settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168': 'Esperando ser confirmado',
  'settings.scripts.ScriptLibrary.off.ca7981b4': 'Apagado',
  'settings.scripts.ScriptLibrary.toolbar.451aa51a': 'Barra de herramientas',
  'settings.scripts.ScriptLibrary.startup.65d48235': 'Puesta en marcha',
  'settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87':
    'Cambió sin estar escrito en este dispositivo: míralo y confírmalo',
  'settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c':
    'Revisar la confianza de ejecución en este dispositivo sin ejecutar el script',
  'settings.scripts.ScriptLibrary.run_this_script_now.ef501cea': 'Ejecute este script ahora',
  'settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b':
    'Agregue un botón de encabezado que ejecute este script',
  'settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d':
    'Aún no hay descripción: agregue una línea {literal0} en la parte superior del archivo.',
  'settings.scripts.ScriptLibrary.no_parameters.3a7003b7': 'Sin parámetros',
  'settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d':
    'En la barra de herramientas junto a su línea de encabezado {literal0}',
  'settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed':
    'Sácalo de la barra de herramientas',
  'settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91':
    'Colóquelo en la barra de herramientas: la cinta izquierda y encima del teclado en un teléfono.',
  'settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b':
    'Se ejecuta al inicio por su línea de encabezado {literal0}',
  'settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9':
    'Deja de ejecutarlo cuando se inicie Obsidian.',
  'settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac':
    'Ejecútelo cada vez que se inicie Obsidian.',
  'settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6': 'Habilitar secuencias de comandos',
  'settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9':
    'Permitir que los scripts de JavaScript almacenados en una carpeta de bóveda se registren como comandos y herramientas de inteligencia artificial.',
  'settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1':
    'Política de script sincronizado',
  'settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f':
    'Sincronización personal: hasta que se confirme en este dispositivo. Conexiones compartidas y de agentes: rechazar. Ejecute un script manualmente para revisar sus bytes exactos. La procedencia faltante requiere recuperación; las aprobaciones nunca se sincronizan.',
  'settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d': 'Carpeta de secuencias de comandos',
  'settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89':
    'Carpeta de Vault que contiene archivos de script .js.',
  'settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b': 'p.ej. {literal0}',
  'settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea':
    'Confirmar scripts de otros dispositivos',
  'settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac':
    '1 secuencia de comandos espera ser confirmada en este dispositivo.',
  'settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9':
    '{value0} scripts esperan ser confirmados en este dispositivo.',
  'settings.scripts.ScriptsGeneral.review.aff0766a': 'Revisar',

  'settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27':
    'Agente AI → Modos de herramienta predeterminados',

  'settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e':
    'Un script que aparece o cambia sin estar escrito en este dispositivo (a través de Obsidian Sync, iCloud, Syncthing, git) espera hasta que lo mires y lo confirmes aquí. Hasta entonces los botones, automatizaciones, inicio y agentes no lo ejecutan. Los scripts que escribas en este dispositivo, en el editor o a través de Abele, cuentan como confirmados. Al activar esto, se aceptan todos los scripts de la carpeta tal como están ahora. Las confirmaciones se guardan únicamente en este dispositivo; al apagarlo aquí se olvidan, y sólo para este dispositivo.',
  'settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec':
    'Guiones sobre palabras seleccionadas',
  'settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f':
    'Guiones fijados al menú de selección de libros, en este orden. Hasta tres son un botón cada uno; más veces en un solo menú. Otros guiones permanecen en "Otro guión...".',
  'settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44':
    'Guiones elegidos para el menú de selección del chat, independientemente de los libros. La compatibilidad con el inicio del chat aún no está habilitada.',
  'settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7':
    'Aún no hay scripts: primero agregue uno a la carpeta de scripts.',
  'settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11':
    'Aún no hay nada en el menú.',
  'settings.scripts.SelectionScriptsSettings.script_value.804f5354': 'Guión: {value0}',
  'settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0':
    'Guión: {value0} — no encontrado',
  'settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682': 'Nombre en la barra',
  'settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4':
    'Elige el icono que tiene en la barra.',
  'settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41': 'Ya el primero',
  'settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10':
    'Muévelo hacia arriba en el menú.',
  'settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12': 'ya el ultimo',
  'settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335':
    'Muévelo hacia abajo en el menú.',
  'settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889': 'Sácalo del menú',
  'settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79':
    'En el menú por su propio encabezado ({value0}), después de los anteriores. Agréguelo a la lista para cambiarle el nombre o darle un lugar.',
  'settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b': 'Añadir a la lista',
  'settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711':
    'Coloque {value0} en la lista anterior para cambiarle el nombre o moverlo.',
  'settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4': 'Agregar un guión',
  'settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f':
    'Busque en sus scripts uno para poner en el menú.',
  'settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec': 'Quitar el menú',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83':
    '¿Quitar {value0} del menú para palabras en un {value1}? El guión en sí permanece.{value2}',
  'settings.scripts.StartupScriptsEditor.startup.65d48235': 'Puesta en marcha',
  'settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450':
    'Los scripts se ejecutan cada vez que se inicia Obsidian, uno tras otro en este orden, una vez que la bóveda está abierta. Un script que toma parámetros obtiene sus valores predeterminados; se omite el que necesita un valor sin valor predeterminado. Coloque un script aquí con el botón de encendido en su tarjeta en la biblioteca.',
  'settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa':
    'No ejecute scripts de inicio',
  'settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c':
    'Los omite todos hasta que se vuelve a cambiar. Si un script de inicio congela Obsidian, también se omitirá la próxima vez que se inicie Obsidian.',
  'settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7':
    'Aún no hay scripts: primero agregue uno a la carpeta de scripts.',
  'settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c':
    'Aún no hay scripts de inicio.',
  'settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39':
    'No encontrado en la carpeta de scripts',
  'settings.scripts.StartupScriptsEditor.already_the_first.eab62d41': 'Ya el primero',
  'settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e': 'Ejecútelo antes',
  'settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12': 'ya el ultimo',
  'settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f': 'Ejecutarlo más tarde',
  'settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3':
    'Deja de ejecutarlo al inicio',
  'settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f':
    'Se ejecuta al inicio mediante su propio encabezado (@startup), después de los anteriores, en {value0}. Agréguelo a la lista para darle un lugar.',
  'settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b': 'Añadir a la lista',
  'settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74':
    'Pon {value0} en la lista de arriba, para moverlo o elegir sus dispositivos',
  'settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4': 'Agregar un guión',
  'settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be':
    'Busque en sus scripts uno para ejecutar al inicio',
  'settings.scripts.StartupScriptsEditor.every_device.9b626893': 'Cada dispositivo',
  'settings.scripts.StartupScriptsEditor.computers.680cb3c6': 'Computadoras',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2': 'Teléfonos y tabletas',
  'settings.scripts.StartupScriptsEditor.every_device.17779e2b': 'cada dispositivo',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d': 'teléfonos y tabletas',
  'settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7':
    'Mantener solo en el servidor',
  'settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724':
    'Regla local del dispositivo. Se ejecuta sólo cuando obtienes una vista previa y confirmas; Los archivos anclados, modificados y abiertos permanecen aquí.',
  'settings.sync.ExternalFileRules.offload_folder.6566fece': 'Descargar carpeta',
  'settings.sync.ExternalFileRules.empty_means_all_folders.c907d956':
    'Vacío significa todas las carpetas.',
  'settings.sync.ExternalFileRules.all_folders.226fd0e5': 'Todas las carpetas',
  'settings.sync.ExternalFileRules.file_types.696bc9a7': 'Tipos de archivos',
  'settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a':
    'Extensiones separadas por comas. Vacío significa todos los tipos de archivos adjuntos.',
  'settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d': 'pdf, epub, jpg',
  'settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb': 'Tamaño mínimo (MiB)',
  'settings.sync.ExternalFileRules.not_opened_for_days.42eb5259': 'Hace días que no abre',
  'settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0':
    '0 ignora la edad. Los archivos sin una apertura registrada se excluyen cuando se establece la edad.',
  'settings.sync.ExternalFileRules.review_matching_files.f7400143': 'Revisar archivos coincidentes',
  'settings.sync.ExternalFileRules.see_every_file_and_the.b398409d':
    'Vea cada archivo y el espacio estimado antes de realizar cambios.',
  'settings.sync.ExternalFileRules.preview.324b134f': 'Vista previa',
  'settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2':
    'Enumere los archivos coincidentes y revise el espacio antes de descargar',
  'settings.sync.SelectiveSync.what_this_device_syncs.979d00ce': 'Qué sincroniza este dispositivo',
  'settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522':
    'Las notas y los lienzos siempre viajan. Todo lo demás es elección de este dispositivo: un teléfono puede saltarse el vídeo y seguir manteniendo todas las notas.',
  'settings.sync.SelectiveSync.largest_file.5cd59717': 'archivo más grande',
  'settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7':
    'Los archivos de mayor tamaño se omiten, en megabytes. Déjalo vacío para llevarte todo.',
  'settings.sync.SelectiveSync.no_limit.f7fcff0d': 'Sin límite',
  'settings.sync.SelectiveSync.obsidian_settings.b1370814': 'Configuración de obsidiana',
  'settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56':
    'Carpetas que este dispositivo omite',
  'settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89':
    'Este dispositivo no carga ni descarga nada de lo que se encuentra en una de las carpetas enumeradas aquí. Los demás dispositivos todavía lo conservan.',
  'settings.sync.SelectiveSync.skipped_by_this_device.a7679073': 'Omitido por este dispositivo.',
  'settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c':
    'Sincroniza esta carpeta en este dispositivo nuevamente',
  'settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be':
    'Este dispositivo sincroniza cada carpeta.',
  'settings.sync.SelectiveSync.skip_a_folder.1f3e8658': 'Saltar una carpeta',
  'settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43':
    'Elija una carpeta que este dispositivo deba dejar en paz.',
  'settings.sync.SelectiveSync.e_g_archive_video.b35fc660': 'p.ej. {literal0}',
  'settings.sync.SelectiveSync.skip.28d03596': 'Saltar',
  'settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063':
    'Dejar de sincronizar esta carpeta en este dispositivo',
  'settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698':
    'Nombra una carpeta para omitirla primero',
  'settings.sync.SelectiveSync.images.be7e2f20': 'Imágenes',
  'settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e':
    'Capturas de pantalla, fotografías, dibujos y diagramas.',
  'settings.sync.SelectiveSync.audio.bc1b8890': 'Audio',
  'settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181': 'Grabaciones y notas de voz.',
  'settings.sync.SelectiveSync.video.d534be82': 'Video',
  'settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb':
    'Lo más pesado que suele contener una bóveda.',
  'settings.sync.SelectiveSync.pdfs.211eae3f': 'PDF',
  'settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99': 'Papeles, manuales y escaneos.',
  'settings.sync.SelectiveSync.everything_else.cd6c5f59': 'Todo lo demás',
  'settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625':
    'Archivos adjuntos que no figuran en la lista y la carpeta de scripts.',
  'settings.sync.SelectiveSync.app_settings.d43fb8a9': 'Configuración de la aplicación',
  'settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd':
    'Comportamiento del editor y del archivo, desde app.json.',
  'settings.sync.SelectiveSync.appearance.3907fa7f': 'Apariencia',
  'settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304':
    'El tema, sus fragmentos y las opciones de fuente.',
  'settings.sync.SelectiveSync.hotkeys.c15f1530': 'Teclas de acceso rápido',
  'settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8':
    'Los atajos que has enlazado.',
  'settings.sync.SelectiveSync.core_plugins.f2e957b0': 'Complementos principales',
  'settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676':
    '¿Cuáles de los complementos propios de Obsidian están activados?',
  'settings.sync.SelectiveSync.community_plugins.ab574402': 'Complementos comunitarios',
  'settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f':
    'Los complementos en sí, por lo que un nuevo dispositivo instala lo que ejecuta este.',
  'settings.sync.SelectiveSync.plugin_settings.95d7fb37': 'Configuración del complemento',
  'settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b':
    'Lo que contiene cada complemento de la comunidad en su propio data.json.',
  'settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee':
    'Este dispositivo mantiene su configuración en una carpeta de configuración renombrada, {value0}, y la sincronización aún no incluye ninguna: la configuración de Obsidian permanece en este dispositivo y las del servidor se dejan solas.',
  'settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882':
    'Cuánto viaja la carpeta de configuración. El espacio de trabajo, el gráfico y cada caché de complementos permanecen donde están, en cada dispositivo.',
  'settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2': 'No se cambió nada: {value0}',
  'settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c': '¿Qué será enviado?',
  'settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4': 'lleva una clave',
  'settings.transfer.TransferPreviewModal.keys.f0d66a79': 'Claves',
  'settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018':
    'Se muestra enmascarado aquí; viajan completos, por lo que el traslado está bloqueado.',
  'settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f': 'Leer una transferencia',
  'settings.transfer.TransferScanModal.use_the_camera.429bb22e': 'usa la camara',
  'settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce':
    'Apunta la cámara a los códigos del otro dispositivo.',
  'settings.transfer.TransferScanModal.take_a_photo.996e6a73': 'tomar una foto',
  'settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87':
    'Fotografíe el código o elija una imagen de uno.',
  'settings.transfer.TransferScanModal.open_a_file.3b31f677': 'abrir un archivo',
  'settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7':
    'Leer una transferencia guardada como un archivo en el otro dispositivo',
  'settings.transfer.TransferScanModal.paste_the_text.d98782e3': 'Pega el texto',
  'settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa':
    'Pegue la transferencia como texto en lugar de leer un código',
  'settings.transfer.TransferScanModal.abl.c834a09f': 'ABL1:…',
  'settings.transfer.TransferScanModal.codes_read.99b98121': 'códigos leídos',

  'settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908':
    'Nada leído todavía. El otro dispositivo muestra los códigos; éste los recoge en cualquier orden.',
  'settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91':
    'Esta transferencia lleva una clave, por lo que queda bloqueada. Escriba el código que se muestra en el otro dispositivo.',
  'settings.transfer.TransferScanModal.characters.2ad81da8': '8 personajes',

  'settings.transfer.TransferScanModal.what_to_do_with_what.99215800':
    '¿Qué hacer con lo que ya está aquí?',
  'settings.transfer.TransferScanModal.keep_value.c1cdcb02': 'Mantener {value0}',
  'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a':
    'Aún no en este dispositivo',
  'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324':
    'Reemplaza el que ya está en este dispositivo',
  'settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c': 'Ya aqui lo mismo',
  'settings.transfer.TransferScanModal.unlock.4ac709aa': 'Descubrir',
  'settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253':
    'Abre la transferencia con este código',
  'settings.transfer.TransferScanModal.apply.31e392d1': 'Aplicar',
  'settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186':
    'Ese traslado no llegó entero. Lea los códigos nuevamente.',
  'settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4':
    'Ese código no abre esta transferencia.',
  'settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0':
    'Cualquier cosa aquí que la transferencia no mencione se deja en paz.',
  'settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4':
    'Aquí no se eliminaría nada: la transferencia lo cubre todo.',
  'settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876':
    '{value0}: {value1}. Los guiones, habilidades e indicaciones nunca se eliminan.',

  'settings.transfer.TransferScanModal.value_to_store_for_the.22f67128':
    '{value0} para almacenar los elementos seleccionados.',
  'settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7':
    'No hay claves para almacenar para los artículos seleccionados.',
  'settings.transfer.TransferScanModal.just_now.7ddb44d8': 'En este momento',
  'settings.transfer.TransferScanModal.today_at_value.c0d04ee3': 'hoy en {value0}',
  'settings.transfer.TransferScanModal.already_applied.ca602d60': 'Ya aplicado',
  'settings.transfer.TransferScanModal.applying.3329a9bb': 'Aplicando…',
  'settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead':
    'Escríbalos en la configuración de esta bóveda',
  'settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d':
    'Marque algo para aplicar primero',
  'settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e':
    'Esta configuración no se pudo aplicar.',
  'settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870':
    'Aquí no hay cámara. Tome una foto del código o pegue la transferencia como texto.',
  'settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f':
    'No hay transferencia en ese archivo.',
  'settings.transfer.TransferScanModal.no_code_in_that_picture.34801264':
    'No hay código en esa imagen.',
  'settings.transfer.TransferSendModal.send_to_another_device.71ef2876':
    'Enviar a otro dispositivo',
  'settings.transfer.TransferSendModal.name_for_the_other_device.33a35391':
    'Nombre para el otro dispositivo',
  'settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846':
    'El servidor crea su propio dispositivo y la lista de dispositivos de la bóveda lo muestra con este nombre.',
  'settings.transfer.TransferSendModal.other_device.76d065a6': 'Otro dispositivo',
  'settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48':
    'Pidiendo al servidor un dispositivo propio para el otro lado…',
  'settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7':
    'Escribe esto en el otro dispositivo',
  'settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606':
    'Código de transferencia {value0} de {value1}',
  'settings.transfer.TransferSendModal.previous_code.9073b55e': 'código anterior',
  'settings.transfer.TransferSendModal.next_code.2924d04c': 'siguiente codigo',
  'settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8':
    'Deja de moverte por los códigos',
  'settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219':
    'Muévete por los códigos por tu cuenta',
  'settings.transfer.TransferSendModal.make_the_codes.05fce439': 'hacer los codigos',
  'settings.transfer.TransferSendModal.have_the_server_make_the.26277032':
    'Haga que el servidor cree el otro dispositivo y muestre los códigos.',
  'settings.transfer.TransferSendModal.give_the_other_device_a.62f36130':
    'Primero dale un nombre al otro dispositivo',
  'settings.transfer.TransferSendModal.save_a_file.637ed29a': 'guardar un archivo',
  'settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0':
    'Guarde la transferencia como un archivo fuera de lo que se sincroniza, para enviarla como desee',
  'settings.transfer.TransferSendModal.show_the_codes.1eb16a33': 'Mostrar los códigos',

  'settings.transfer.TransferSendModal.copy_the_text.a9c0e598': 'Copia el texto',
  'settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d':
    'Copie toda la transferencia para pegarla en el otro dispositivo',
  'settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8':
    ' El código de arriba lo desbloquea en el otro lado.',
  'settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601':
    'Lea el código o copie el texto.{value0}',
  'settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2': {
    one: '{count} códigos, que se muestran uno tras otro, o copie el texto y salte la cámara.{value1}',
    many: '{count} códigos, que se muestran uno tras otro, o copie el texto y salte la cámara.{value1}',
    other:
      '{count} códigos, que se muestran uno tras otro, o copie el texto y salte la cámara.{value1}',
  },
  'settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f': {
    one: 'Este toma códigos {count}, que es más de lo que nadie quiere fotografiar. Copie el texto en un mensaje o guárdelo como un archivo y envíelo.{value1}',
    many: 'Este toma códigos {count}, que es más de lo que nadie quiere fotografiar. Copie el texto en un mensaje o guárdelo como un archivo y envíelo.{value1}',
    other:
      'Este toma códigos {count}, que es más de lo que nadie quiere fotografiar. Copie el texto en un mensaje o guárdelo como un archivo y envíelo.{value1}',
  },
  'settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659':
    'No se pudo copiar el texto. Selecciónelo a continuación y cópielo o guárdelo como un archivo.',
  'settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c':
    'Transferencia copiada. Pégalo en el otro dispositivo.',
  'settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07':
    'Ábrelo en "Leer una transferencia" en el otro dispositivo',
  'settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2':
    'Guardado en {value0}. {value1}.',
  'settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d':
    'Guardado como {value0}, en una carpeta oculta de esta bóveda que Abele Sync no lleva. ',
  'settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef':
    '{value0} y elimínelo una vez leído.',
  'settings.transfer.TransferSendModal.could_not_save_it_value.14315a58':
    'No se pudo guardar: {value0}',
  'settings.rich.bc6ba5473fff4aa8':
    'Un script cuyas primeras líneas digan {slot0} es una regla: devuelve {slot1}, una lista de lo que está mal, y puede devolver {slot2}, el nuevo texto de la nota. Está listado arriba con los demás. La página Scripts de la documentación muestra uno.',
  'settings.rich.ae545f75ff9437be':
    'No hay habilidades en esta bóveda. Las habilidades son notas con {slot0}.',
  'settings.rich.3cf5061d7d4aaae2':
    'Claves y tokens para solicitudes de API. El agente de IA utiliza {slot0} en llamadas de recuperación, que se reemplaza con el valor real. Guardado de forma segura en llavero.',
  'settings.rich.59db234df027f515':
    'Scripts que se ejecutan solos cuando algo le sucede a una nota: una tarea completada, una nota de algún tipo modificada. El guión lee lo que sucedió como {slot0}. Los parámetros aceptan {slot1} y cualquier campo inicial de la nota. Se ejecutan en el dispositivo donde se realizó el cambio; las propias escrituras de un guión nunca vuelven a activar la misma automatización.',
  'settings.rich.5c124ccc61dc59ea':
    'Botones encima del texto de una nota que ejecutan un comando o un script, en las notas que elijas, en este orden. A un script se le pueden entregar los valores de la nota: {slot0} o cualquier propiedad, {slot1}.',
  'settings.rich.225479f70a17e374':
    'Cada script en la carpeta de scripts. Un script se describe a sí mismo en el bloque de comentarios en la parte superior de su archivo: {slot0}, {slot1}, {slot2} y una línea {slot3} por valor que toma. El pin coloca un script en la barra de herramientas: un ícono en la cinta izquierda en una computadora y un lugar en la barra de herramientas encima del teclado en un teléfono: {slot4} en su encabezado hace lo mismo. El botón de encendido ejecuta un script cada vez que se inicia Obsidian; {slot5} en su encabezado hace lo mismo y la pestaña Inicio los pone en orden.',
  'settings.rich.82dd523dc663e313':
    'Scripts {slot0} descubiertos. Configurar modos de herramienta en {slot1} o por chat en el modal de permisos.',
  'settings.terms.keySaved': 'Clave guardada',
  'settings.terms.noKeyYet': 'Aún no hay clave',
  'settings.terms.thisKey': 'esta clave',
  'settings.terms.none': 'ninguno',
  'settings.terms.theSecret': 'el secreto',
  'settings.terms.unnamedAutomation': 'esta automatización sin nombre',
  'settings.terms.unnamedButton': 'este botón sin nombre',
  'settings.terms.password': 'contraseña',
  'settings.terms.link': 'enlace',
  'settings.terms.book': 'libro',
  'settings.terms.chat': 'charlar',
  'settings.terms.missingSuffix': ' · desaparecido',
  'settings.terms.resetsSuffix': ' · se reinicia ',
  'settings.metadata.c99cb7557b2bd7cb': 'leer datos',
  'settings.metadata.ba35eb1f0c41c920': 'Analizar datos',
  'settings.metadata.93b5e95f0841a6c1': 'Lo más destacado del libro',
  'settings.metadata.9b9ab66d2dc6d4e6': 'Destacar en un libro',
  'settings.metadata.836cba1ac2f246a0': 'Cambiar un resaltado',
  'settings.metadata.6bbd1e58f841181f': 'Quitar un resaltado',
  'settings.metadata.1d5729de03eb270a': 'Marcador en un libro',
  'settings.metadata.d9e8263863cd7c1a': 'Pestañas de libros',
  'settings.metadata.c8e5758cffa93be0': 'Contenido del libro',
  'settings.metadata.3e6c3299627e72e5': 'leer libro',
  'settings.metadata.efb806b8e248de86': 'buscar libro',
  'settings.metadata.973b70df8c6835ab': 'Mostrar en un libro',
  'settings.metadata.e1b19c0fcc092bb5': 'Listar libros',
  'settings.metadata.3824a9f4dafe92c6': 'Lienzo',
  'settings.metadata.ca58ee75a82eb866': 'Documentos de gráficos',
  'settings.metadata.1f104d4e483afe57': 'Copiar archivo',
  'settings.metadata.f1eb5a8241e4bf26': 'Crear archivo',
  'settings.metadata.016fc69b8f33e22e': 'Documentos de la API de secuencias de comandos',
  'settings.metadata.e3de1e15d36b9e54': 'Crear guión',
  'settings.metadata.cf8c8078d8db9550': 'Ubicación actual',
  'settings.metadata.1e814554ca1b586f': 'Leer mazo',
  'settings.metadata.cf31f39501ec79cc': 'Presentaciones',
  'settings.metadata.07bcab5dd6c2b3ac': 'Crear mazo',
  'settings.metadata.a34f02e3fb7f55ab': 'Editar diapositiva',
  'settings.metadata.ee9a26182331bd59': 'Comprobar el ajuste de la plataforma',
  'settings.metadata.4c3cd91f9873a96b': 'Presentación abierta',
  'settings.metadata.3ecb6f7da6cd8b57': 'Delegar al agente',
  'settings.metadata.e1e5fe2043bd3003': 'Eliminar archivo',
  'settings.metadata.072bcdf480cf935b': 'Editar documento de Word',
  'settings.metadata.3a2860ece5a4ee0b': 'Palabra',
  'settings.metadata.d62c5e04e2041963': 'Pestañas de palabras',
  'settings.metadata.fdbd5cb0402f63f0': 'Leer documento de Word',
  'settings.metadata.abcfc9b08f141d57': 'Buscar documento de Word',
  'settings.metadata.8fc231e28ab03931': 'Descargar imagen',
  'settings.metadata.d5501e84dd2baf5a': 'Descargar archivo',
  'settings.metadata.c3df84ddf2927d7f': 'mira el dibujo',
  'settings.metadata.c769c50ec11b66ce': 'Editar archivo',
  'settings.metadata.5597753f9c2ffeb8': 'Editar imagen',
  'settings.metadata.b9aca9af90312aa4': 'Editar selección',
  'settings.metadata.529285444d7e58bf': 'Evaluar JavaScript',
  'settings.metadata.e663529b7a08617b': 'Migrar dibujos de Excalidraw',
  'settings.metadata.014b08ed6d8976df': 'Obtener URL',
  'settings.metadata.d20890b1e4db1fa1': 'Buscar archivos',
  'settings.metadata.a6bd489d95504499': 'Olvidar',
  'settings.metadata.0f44b5601ade4f85': 'Generar imagen',
  'settings.metadata.1606207c55304e06': 'Geocodificar',
  'settings.metadata.bf4c6dda970987a0': 'encontrar lugares',
  'settings.metadata.06cc7177f48987cc': 'Construir ruta',
  'settings.metadata.abce462b78197fc5': 'Inspeccionar vista',
  'settings.metadata.1f728b52096a2eb0': 'notas de pelusa',
  'settings.metadata.f0c84f13ed58b1d6': 'Solucionar problemas de pelusa',
  'settings.metadata.ede087fd8f5ce83a': 'Listar espacio de trabajo',
  'settings.metadata.535843b2c2fee0eb': 'Directorio de lista',
  'settings.metadata.002cc66337cf3764': 'Mover/Cambiar nombre de archivo',
  'settings.metadata.7ac362063b9f2046': 'Nodos',
  'settings.metadata.1e8d18f62f2d2a2f': 'Abrir archivo',
  'settings.metadata.c0d019c19251efca': 'Consultar documentos',
  'settings.metadata.9a72221a27476f3e': 'Preguntas',
  'settings.metadata.fb9b615c6b482637': 'Leer archivo',
  'settings.metadata.6562fb21e7fbb468': 'Leer imagen',
  'settings.metadata.7b4a3b51f8248d49': 'Leer registros',
  'settings.metadata.75ce2bbc2da8977a': 'Leer vínculos de retroceso',
  'settings.metadata.a50358c35c21caf0': 'Leer transacciones',
  'settings.metadata.6f987478bf258d46': 'Leer tareas',
  'settings.metadata.8096a7bd9a09e11f': 'Recordar',
  'settings.metadata.95e154398a4bc009': 'Reemplazar',
  'settings.metadata.ddf641f9a5ee4177': 'Proponer revisión de respuesta',
  'settings.metadata.029320ad166c1807': 'Captura de pantalla',
  'settings.metadata.40945d7914b5838d': 'formulario de respuesta',
  'settings.metadata.17434a9251409137': 'Leer configuración',
  'settings.metadata.7fe866d491ae7890': 'Escribir configuración',
  'settings.metadata.6df1bb18a59ab97d': 'Habilidad',
  'settings.metadata.118469284c824130': 'Documentos de plantilla',
  'settings.metadata.f7b314c3f5d5dcea': 'Plantillas de lista',
  'settings.metadata.23febe05ea52c943': 'Aplicar plantilla',
  'settings.metadata.d04fc7d7e19702f8': 'Búsqueda web',
  'settings.metadata.d78cd87c20261047': 'Escribir archivo',
  'settings.metadata.ff4e3889f363a511': 'Escribir celdas del libro de trabajo',
  'settings.metadata.48d53635551c8fd4': 'Sobresalir',
  'settings.metadata.9a8eb492fd32afbe': 'Hojas del libro de trabajo',
  'settings.metadata.51feedc6468c9521': 'Leer rango de libros',
  'settings.metadata.6b11523da566fd08': 'Buscar libro de trabajo',
  'settings.metadata.8463eb4799ceda94': 'Crear código postal',
  'settings.metadata.ee52497854a67e54': 'Leer el archivo GitHub',
  'settings.metadata.7ba6f2c8e75022bd': 'GitHub confirma',
  'settings.metadata.c97212ae47ab4694': 'Código grep en una versión',
  'settings.metadata.eff04b0872a1b825': 'Leer elemento de GitHub',
  'settings.metadata.9632f6701a8ca357': 'Archivos de solicitud de extracción',
  'settings.metadata.ff48a92c96b73fa8': 'Buscar en GitHub',
  'settings.metadata.f5db8240ba9c07c2': 'Pestañas de GitHub',
  'settings.metadata.0a876c393a858219': 'Mostrar en la pestaña GitHub',
  'settings.metadata.47659c3dccc86dc6': 'leer archivo',
  'settings.metadata.abc7e9892806b047': 'Archivos',
  'settings.metadata.9608dd142d9b10d7': 'Editar archivo',
  'settings.metadata.997357233881bfb9': 'Escribir archivo',
  'settings.metadata.6990d3217b7749c8': 'crear archivo',
  'settings.metadata.28e18dc9db382d81': 'Eliminar archivo',
  'settings.metadata.f83e6d79cd9c3e10': 'Mover archivo',
  'settings.metadata.b60f1c7ad15c2b04': 'Copiar archivo',
  'settings.metadata.930a81591b83ad25': 'Directorio de lista',
  'settings.metadata.15d12bc10296dc2d': 'encontrar archivos',
  'settings.metadata.87bb59ba2f92f2a5': 'Espacio de trabajo',
  'settings.metadata.d515d2ee195fa943': 'Leer imagen',
  'settings.metadata.4190c0c7ec727064': 'Abrir archivo',
  'settings.metadata.693ba7f5f3d9f77d': 'Vista de aplicación',
  'settings.metadata.dc37f2f4529c4136': 'Inspeccionar vista',
  'settings.metadata.7711faa74a10416c': 'búsqueda web',
  'settings.metadata.2975104784a401e3': 'Web',
  'settings.metadata.3ac575dcce244f93': 'Descargar imagen',
  'settings.metadata.9de4149fb9716cfc': 'Descargar archivo',
  'settings.metadata.f911e414cf6bdfc5': 'GitHub',
  'settings.metadata.f7f0f6218e3ab3ce': 'Leer número o PR',
  'settings.metadata.046ceaf4f065a500': 'Archivos PR',
  'settings.metadata.d09648c6058a4c84': 'Se compromete',
  'settings.metadata.49c266baaaa70981': 'Buscar',
  'settings.metadata.b2cfbf5af10d5b5d': 'Mostrar en una pestaña',
  'settings.metadata.9da7f76bc81d2f4e': 'Libros',
  'settings.metadata.119e66d117ae8f0c': 'Mapas',
  'settings.metadata.1c9c87eec07e453b': 'Generar imagen',
  'settings.metadata.be7e2f20129365c2': 'Imágenes',
  'settings.metadata.d9d12b04b3831c32': 'Editar imagen',
  'settings.metadata.6bea010c8fb418a4': 'evaluación js',
  'settings.metadata.8fdd2ee8475e29bc': 'Lo esencial',
  'settings.metadata.760ed96061ace03e': 'Delegar',
  'settings.metadata.a6d910ba93b7f894': 'Delegación',
  'settings.metadata.c3963aedaac6c83c': 'Memoria',
  'settings.metadata.2e19427030d9d43c': 'Documentos de gráficos',
  'settings.metadata.7af023c43013b9a5': 'Documentos',
  'settings.metadata.5afdd3f5b60d4d59': 'Documentos de plantilla',
  'settings.metadata.9d45317393ff2163': 'Leer registros',
  'settings.metadata.19b88504fa831ce1': 'Datos de notas',
  'settings.metadata.8c87f5ea162d2e65': 'Leer vínculos de retroceso',
  'settings.metadata.692a437039f64732': 'Leer transacciones',
  'settings.metadata.b696d75511dc16f2': 'Finanzas',
  'settings.metadata.d340a6c01b6f5fee': 'Leer tareas',
  'settings.metadata.b3a60e61a5233d05': 'Tareas',
  'settings.metadata.a249b2df7cba7a38': 'Plantillas de lista',
  'settings.metadata.56b564b75c7fdb48': 'Plantillas',
  'settings.metadata.a0859ef85c0a0934': 'Aplicar plantilla',
  'settings.metadata.6dc2a1098225593e': 'Documentos de la API de secuencias de comandos',
  'settings.metadata.74a883a037bc227f': 'Preferencias',
  'settings.metadata.ea59135c1811dd4d': 'Crear guión',
  'settings.metadata.8d0e6b4ab60543cf': 'Scripts',
  'settings.metadata.7000d0dc57ecf4be': 'Leer resultado',
  'settings.metadata.d9e66d2ce531344c': 'Archivos de nodo',
  'settings.metadata.e93372533f323b2f': 'Nodo',
  'settings.metadata.6ded9685b4a797e6': 'Leer archivos y buscar',
  'settings.metadata.562123f8976fe819': 'Editar archivos',
  'settings.metadata.aec2f93d67b7c4c5': 'árboles de trabajo',
  'settings.metadata.e90a0f8d49e203ea': 'Delegar trabajo a un agente del nodo',
  'settings.metadata.b907a91b588b818c': 'Ejecuciones del depurador',
  'settings.metadata.befc6e918047c85b': 'Tus mensajes',
  'settings.metadata.f39b199601422405': 'Las respuestas del agente.',
  'settings.metadata.b6c1d862f9f75ec3': 'Ambos',
  'settings.metadata.0ca9f9fe82be9456': 'Solo borrador',
  'settings.metadata.65c3ce1551b7fdc4': 'Últimos 4 mensajes',
  'settings.metadata.87e460223959d06f': 'Últimos 10 mensajes',
  'settings.metadata.27ba0224f1937dcd': 'Toda la conversación',
  'settings.metadata.abc9eb2fc4a07abf':
    'User-Agent enviado a esta conexión. Vacío mantiene el valor predeterminado. La transmisión móvil puede ignorarlo.',
  'settings.metadata.fcc01b1454819dec': 'sigue el tema',
  'settings.metadata.17ed08435ee39aec': 'Libertad',
  'settings.metadata.e4378e9c551f7f9c': 'Brillante',
  'settings.metadata.437b56da751ee02a': 'positrones, silencioso',
  'settings.metadata.60acc53f13a5d1bf': 'Oscuro',
  'settings.metadata.2620b9ac0d72c634': 'Fiordo, azul oscuro',
  'settings.metadata.3d5b0ed33cbfc204': 'Estilo propio por URL',
  'settings.metadata.a57b3a3a34957437': 'Tiene propiedades',
  'settings.metadata.fdd539aca215e393':
    'La nota comienza con un bloque de propiedades (--- en su primera línea).',
  'settings.metadata.a9aeaf057d72407f': 'Las propiedades se pueden leer.',
  'settings.metadata.048c4415ef41ad0a': 'Propiedades requeridas',
  'settings.metadata.ae43692b2a310b8e': 'Propiedades',
  'settings.metadata.079647a8b86e4378':
    'Separados por comas. "nombre: predeterminado" para que la solución lo complete.',
  'settings.metadata.3c0c64e0fd626bca': 'Tiene un tipo de nota',
  'settings.metadata.a628c83f6a069d90':
    'La nota dice lo que es en su propiedad de tipo: tarea, persona, reunión. Con una lista de tipos, el valor debe ser uno de ellos.',
  'settings.metadata.40040cb181f7f0ee': 'Propiedad',
  'settings.metadata.853362b96c0c33a4': 'Donde está escrito el tipo.',
  'settings.metadata.2b04790e11e9360e': 'Tipos permitidos',
  'settings.metadata.fc2ba0dd4e23cdd0': 'Separados por comas. Vacío deja pasar cualquier valor.',
  'settings.metadata.21b111cbfe6e8fca': 'Predeterminado',
  'settings.metadata.0482acc3c6913a87':
    'Escrito por la corrección en una nota sin tipo. Vacío: nada está arreglado.',
  'settings.metadata.147e6bba43829675': 'Sin etiquetas',
  'settings.metadata.c03ca2fe828c431e':
    'Para una bóveda que no utiliza etiquetas: la propiedad de etiquetas se elimina mediante la corrección; Se muestra que una etiqueta # en el texto se trata a mano.',
  'settings.metadata.d4743e63e45dde22': 'Etiquetas en el texto',
  'settings.metadata.587ccd181c91d2a8': 'También encuentre #etiquetas escritas en el texto.',
  'settings.metadata.fdca3c91c0898bd4': 'Propiedades no deseadas',
  'settings.metadata.a4ef39b33278f6ef':
    'Ninguna de las propiedades enumeradas está allí. La solución los elimina.',
  'settings.metadata.0a26d2a3c07531d9': 'Separados por comas.',
  'settings.metadata.29a015b0a78abcc6': 'Línea en blanco después de las propiedades.',
  'settings.metadata.56bae77505677e3c':
    'Entre las propiedades y el texto hay exactamente una línea en blanco.',
  'settings.metadata.6ca1bd19ad8e5df4': 'Sin título de primer nivel',
  'settings.metadata.a5b697a0a2aa9674':
    'El nombre del archivo es el título, por lo que el texto no tiene encabezado #. La solución elimina uno que repite el nombre y convierte cualquier otro en un encabezado ##.',
  'settings.metadata.93df69cc2eaf6ff1': 'Fechas escritas como fechas.',
  'settings.metadata.7ef1f2a6ca083e8a':
    'Las propiedades enumeradas tienen una fecha como YYYY-MM-DD. La solución reescribe 2026-9-5, 05.09.2026 y [[2026-09-05]].',
  'settings.metadata.9024c197d84940e4': 'Enlaces',
  'settings.metadata.1d80ae7836ce9902': 'Botones de cabecera',
  'settings.metadata.ad1fb9ec0cb3c7a4': 'Automatizaciones',
  'settings.metadata.c20c37564e3f3409': 'Diarios',
  'settings.metadata.e95944e1c3c81e4c': 'Conexiones de GitHub',
  'settings.CalendarsSettings.value_h_ago.d5aa4bb8': '{value0} hace una hora',
  'settings.CalendarsSettings.value_d_ago.0f70078c': '{value0} hace d',
  'settings.CalendarsSettings.value_from_value_kept.419ae64a': '{value0} de {value1}, conservado',
  'settings.CalendarsSettings.value_read_value.6e58c8af': '{value0}, leído {value1}',
  'settings.GithubSettings.account_not_checked.d2a6562d': 'Cuenta no revisada',
  'settings.GithubSettings.token_expires_within_seven_days.1b81c28c':
    'El token caduca en siete días',
  'settings.LinterSettings.in_value.b63d3a91': 'en {value0}',
  'settings.LinterSettings.where_value_value.e534e0d0': 'donde {value0}{value1}',
  'settings.LinterSettings.script_value.c5efe1d1': ' Guión: {value0}.',
  'settings.LinterSettings.only_value.e2625151': ' Sólo {value0}.',

  'settings.SecretsListModal.value_set.f4c8f3b4': 'Conjunto {value0}',
  'settings.SecretsListModal.value_synced.1785a4d0': '{value0} sincronizado',
  'settings.TransferSettings.value_of_value.ca6c5e5f': '{value0} de {value1}',
  'settings.TransferSettings.value_selected.975acbfe': '{value0} seleccionado',

  'settings.ai.interceptorList.matching_value.b4ca1a61': 'a juego {value0}',

  'settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986':
    '{value0}…{value1} (caracteres {value2})',
  'settings.transfer.TransferScanModal.value_at_value.92c9c89a': '{value0} y {value1}',
  'settings.count.item': {
    one: '{count} elemento',
    other: '{count} elementos',
    many: '{count} elementos',
  },
  'settings.count.key': { one: '{count} clave', other: '{count} claves', many: '{count} claves' },
  'settings.count.file': {
    one: '{count} archivo',
    other: '{count} archivos',
    many: '{count} archivos',
  },
  'settings.count.code': {
    one: '{count} código',
    other: '{count} códigos',
    many: '{count} códigos',
  },
  'settings.count.prompt': {
    one: '{count} prompt',
    other: '{count} prompts',
    many: '{count} prompts',
  },
  'settings.count.scopeEntry': {
    one: '{count} entrada de ámbito',
    other: '{count} entradas de ámbito',
    many: '{count} entradas de ámbito',
  },
  'settings.count.event': {
    one: '{count} evento',
    other: '{count} eventos',
    many: '{count} eventos',
  },
  'settings.count.model': {
    one: '{count} modelo',
    other: '{count} modelos',
    many: '{count} modelos',
  },
  'settings.count.button': {
    one: '{count} botón',
    other: '{count} botones',
    many: '{count} botones',
  },
  'settings.count.tool': {
    one: '{count} herramienta',
    other: '{count} herramientas',
    many: '{count} herramientas',
  },

  'settings.parts.fa11c9afc868fc1e': ' · restablece {value0}',

  'settings.parts.520a5d3ab1d92888': ' es {value0}',
  'settings.parts.9edb143e79ddd491': '(sin nombre)',

  'settings.parts.951aaf14e2b23dff':
    ' Su encabezado {value0} todavía lo coloca en este menú; elimine esa línea del script para ocultarla.',
  'settings.parts.195dc73d2db93bf8': 'Esto será eliminado',
  'settings.parts.778541341fcda9aa': 'Estos serán eliminados',

  'settings.metadata.86ed522daec49399': 'IA general',
  'settings.metadata.8748f23993a86245': 'Entrada de voz',
  'settings.metadata.2c4aed90f68a9826': 'Proveedores de IA',
  'settings.metadata.d110fe793fa72de1': 'Proveedores de imágenes',
  'settings.metadata.279b44d2ab4b40c0': 'Agentes',
  'settings.metadata.22a7559f09bf8f82': 'Servidores MCP',
  'settings.metadata.e5f4cb8707719fbd': 'Claves almacenadas',
  'settings.metadata.5f2e66e6539797d0': 'Indicaciones',
  'settings.metadata.f46ee86a068c4c22': 'Configuración de secuencia de comandos',
  'settings.metadata.66d0f523a379b2de': 'Habilidades',
  'settings.metadata.f6a1fdbcca54b2f8': 'notas rápidas',
  'settings.metadata.71fea45d263e0906': 'Tarea completada',
  'settings.metadata.968a994a15bd991a': 'Tarea reabierta',
  'settings.metadata.a3e3e968c40e5951': 'Tarea creada',
  'settings.metadata.ba3078bec8c60a69': 'Tarea cambiada',
  'settings.metadata.98acf0d427bd63b5': 'La fecha de la tarea cambió',
  'settings.metadata.d41c129fb8fdf353': 'Nota creada',
  'settings.metadata.e6a78804e128667f': 'Nota cambiada',
  'settings.metadata.4a33279d562ffb24': 'Nota renombrada',
  'settings.metadata.81f7d1888d5a03be': 'Nota eliminada',
  'commands.external-file-evict': 'Conservar solo en el servidor',
  'commands.external-file-pin': 'Conservar en este dispositivo',
  'commands.external-file-hydrate': 'Descargar en este dispositivo',
  'settings.ordinal.first': 'primero',
  'settings.ordinal.second': 'segundo',
  'settings.ordinal.third': 'tercero',
  'settings.ordinal.number': '{count}.º',
  'settings.terms.script': 'script',
  'settings.CalendarsSettings.new_link.f9e84245': 'Nuevo enlace...',
  'settings.CalendarsSettings.save_the_link.7b19a248': 'Guarde el enlace',
  'settings.CalendarsSettings.the_link.f0fb533a': 'El enlace',
  'settings.CalendarsSettings.new_password.1abebe85': 'Nueva contraseña...',
  'settings.CalendarsSettings.save_the_password.acd9c185': 'guardar la contraseña',
  'settings.CalendarsSettings.the_password.3f4e5252': 'la contraseña',
  'settings.FinanceSettings.new_token.564f08bc': 'Nueva ficha...',
  'settings.FinanceSettings.save_the_token.8326f085': 'guardar la ficha',
  'settings.FinanceSettings.the_token.d22bffce': 'la ficha',
  'settings.GithubConnectionEditor.new_token.564f08bc': 'Nueva ficha...',
  'settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882':
    'Utilice este token al guardar la conexión',
  'settings.GithubConnectionEditor.the_token.d22bffce': 'la ficha',
  'settings.GithubSettings.new_token.564f08bc': 'Nueva ficha...',
  'settings.GithubSettings.save_the_notifications_token.d4a25b6f':
    'Guarde el token de notificaciones',
  'settings.GithubSettings.the_notifications_token.266dfc35': 'El token de notificaciones',
  'settings.ai.InterceptorList.runs_value.fe51da79': 'Ejecuta {value0}',
  'settings.ai.McpServerModal.new_token.564f08bc': 'Nueva ficha...',
  'settings.ai.McpServerModal.save_the_token.8326f085': 'guardar la ficha',
  'settings.ai.McpServerModal.the_token.d22bffce': 'la ficha',
  'settings.transfer.TransferPreviewModal.what_goes.39dde11f': 'que pasa',
  'settings.GithubSettings.delete_this_connection_and_forget.1a526c31':
    'Elimina esta conexión y olvida su token local.',
  'settings.GithubSettings.forget.a6bd489d': 'Olvidar',
  'settings.GithubSettings.remove_the_notifications_token_from.d1453607':
    'Quitar el token de notificaciones del llavero',
  'settings.ImageModelEditModal.delete_value.8782b778': 'Eliminar {value0}',
  'settings.ModelEditModal.delete_value.8782b778': 'Eliminar {value0}',
  'settings.QuickButtonSettings.take_out.a7fc33e3': 'Sacar',
  'settings.QuickButtonSettings.take_value_out_of_the.8b01b719': 'Saque {value0} del menú',
  'settings.SecretsListModal.put_every_key_on_the.8118968c':
    'Coloque cada tecla en el portapapeles como texto sin formato',
  'settings.ai.AgentsSettings.delete_value.8782b778': 'Eliminar {value0}',
  'settings.ai.McpServerModal.delete_value.8782b778': 'Eliminar {value0}',
  'settings.ai.McpSettings.delete_value.8782b778': 'Eliminar {value0}',
  'settings.scripts.AutomationsEditor.delete_value.8782b778': 'Eliminar {value0}',
  'settings.scripts.HeaderButtonsEditor.delete_value.8782b778': 'Eliminar {value0}',
  'settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8': 'Despegar',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c':
    'Quita {value0} del menú',
  'settings.startup.computers': 'ordenadores',
  'settings.transfer.itemsToApply': {
    one: '{count} elemento para aplicar',
    many: '{count} elementos para aplicar',
    other: '{count} elementos para aplicar',
  },
  'settings.calendar.found': {
    one: 'Se ha encontrado {count} calendario.',
    many: 'Se han encontrado {count} calendarios.',
    other: 'Se han encontrado {count} calendarios.',
  },
  'settings.mcp.fetched': '{tools}, obtenidas el {when}',
  'settings.sentence.2de766f4c2331579':
    'Los valores guardados se incluyen en la solicitud; nunca se muestran aquí. Al permitirlo, esta dirección se recuerda para {value0} en este dispositivo y no se volverá a preguntar aquí. Los demás dispositivos seguirán preguntando.',
  'settings.sentence.c93c0ada01c57a48': 'Modelos disponibles: {value0}',
  'settings.sentence.cdb07f66a428a0ed': 'Sin guardar: {value0}',
  'settings.sentence.4f7ec121b15ac5e4': 'No se muestra en ningún lugar · {value0}',
  'settings.sentence.7caf85c3282be170': 'aún por encontrar: {value0}',
  'settings.sentence.2d2a1f1b3800ab01': 'Creada {value0}. Marca lo que quieras conservar.',
  'settings.secrets.removeNamed':
    '¿Eliminar {name}? Las llamadas fetch que lo usen por su nombre dejarán de funcionar y el valor guardado se eliminará del llavero.',
  'settings.mcp.headersDescription':
    'Uno por línea, con el formato Name: value. Escribe un secreto como {example}, una clave de IA → General → Claves guardadas, para que no aparezca en el archivo de ajustes.',
  'settings.sync.presentation.e159b06187d369a0': 'En pausa',
  'settings.sync.presentation.857a66dd7a6dfe32': ' · {completed} de {total}',
  'settings.sync.presentation.265ec42c10960f4e': ' · Necesita atención',
  'settings.sync.presentation.a3e3205316b64477': 'Servidor no disponible, reintentando',
  'settings.sync.presentation.c70acece009d71d9': 'Archivos {completed} de {total}',
  'settings.sync.presentation.5c8b9e1ce0a2bc31': 'Sincronización',
  'settings.sync.presentation.0d60f3335d21fa2b': {
    one: '{count} copia en conflicto',
    many: '{count} copias en conflicto',
    other: '{count} copias en conflicto',
  },
  'settings.sync.presentation.96f22a9119067884': {
    one: '{count} archivo sin enviar',
    many: '{count} archivos sin enviar',
    other: '{count} archivos sin enviar',
  },
  'settings.sync.presentation.9e1b70e3f4abbe8e': 'Sincronizado {when}',
  'settings.sync.presentation.c10529851ad89bd3': 'Aún no sincronizado',
  'settings.sync.presentation.2512ef45cc838dc2':
    'Se requiere recuperación de sincronización. Se han conservado los archivos y la conexión.',
  'settings.sync.presentation.fbcbda4833c5c0b7':
    'La respuesta del servidor se cortó antes de que terminara. Intente sincronizar nuevamente.',
  'settings.sync.presentation.fd2175ceceb4c39f':
    'Este token está dañado o incompleto. Pega toda la ficha nuevamente.',
  'settings.sync.presentation.93754bdbbee0e2c4':
    'El servidor no es accesible. Comprueba tu conexión y vuelve a intentarlo.',
  'settings.sync.presentation.f58e7749a37e75de':
    'El acceso está cerrado. Solicite una nueva ficha.',
  'settings.sync.presentation.c3dbee340e1c8ed3':
    'El grupo todavía se está preparando. El intercambio de archivos no ha comenzado.',
  'settings.sync.presentation.753e9b392eca8228':
    'El servidor está lleno. Tus archivos no enviados permanecen en este dispositivo.',
  'settings.sync.presentation.7584f523308d5d6d':
    'Este archivo es demasiado grande para el servidor. Permanece en este dispositivo.',
  'settings.sync.presentation.9036c8e0dc30cc74':
    'El servidor está lleno. El archivo permanece aquí y puede enviarse cuando haya espacio disponible.',
  'settings.sync.presentation.bbb4cbf36ea63cbd': 'Esta conexión no permite esa acción.',
  'settings.sync.presentation.110ec9023ae84ee7':
    'No se puede confiar en la respuesta del servidor; sincronización detenida. Se mantuvieron los archivos locales.',
  'settings.sync.presentation.9259b3f2e2f72c08': 'Esta carpeta o grupo ya no está disponible.',
  'settings.sync.presentation.0303e18246708180': 'No conectado',
  'settings.sync.presentation.fe7c4c6f414c4083': 'Grupo fuera de esta conexión',
  'settings.sync.presentation.97c769d2eaf4ca1c': 'Carpeta fuera de esta conexión',
  'settings.sync.presentation.f56643958aeae61b': 'Grupo: {name}',
  'settings.sync.presentation.7dd20272337b469c': 'Abrir historial de versiones · {name}',
  'settings.sync.presentation.cb44fe2561afccff': 'Bóveda entera',
  'settings.sync.presentation.5c802e6401aca4d2': 'Carpeta: {path}',
  'settings.sync.presentation.5fa7aac5375c5815': 'Listo',
  'settings.sync.presentation.b0f398a57ea3ca38': 'Servidor no disponible',
  'settings.sync.presentation.c1ebc7817870e5be': 'necesita atencion',
  'settings.sync.presentation.9b7e4ca97f057cbc': 'Necesita una ficha',
  'settings.sync.presentation.d403c686f6a10480': 'Conectando',
  'settings.sync.presentation.58b1510f8abae1f2': 'Acceso no disponible',
  'settings.sync.presentation.5514efec066cba3e': 'Acceso de actualización',
  'settings.sync.presentation.ae9cea791e9bc09c': 'Eliminado en el servidor.',
  'settings.sync.presentation.013c681e65af3ea9':
    'El servidor fue restaurado a partir de una copia de seguridad: verificando archivos',
  'settings.sync.presentation.43edbd9fcb4f94a4': 'Comprobando archivos restaurados',
  'settings.sync.presentation.ceb8c1fa2307911c':
    'Carpeta compartida renombrada en el servidor: {from} → {to}; sincronización detenida',
  'settings.sync.presentation.d0be29aeb27cd431': 'Carpeta movida a {path}; sincronización detenida',
  'settings.sync.presentation.b1241ef8763e3062': 'La carpeta desapareció; sincronización detenida',
  'settings.sync.presentation.41920972f6474234':
    'Carpeta o grupo del servidor no disponible; archivos locales mantenidos',
  'settings.sync.presentation.54f2a3375e5dd52d': 'Acceso cerrado; archivos locales guardados',
  'settings.sync.presentation.fc135b7008d458b4': '{stage}… {completed}/{total}{attention}',
  'settings.sync.presentation.a90a62a0bc219ded': 'Comprobando la bóveda… {completed}/{total}',
  'settings.sync.presentation.ec5aa287907706b6': 'Comparando archivos {completed}/{total}',
  'settings.sync.presentation.63ec9d9ac51fa025': 'Respuesta del servidor interrumpida',
  'settings.sync.presentation.27a38f81837d5e05': {
    one: '{count} carpeta',
    many: '{count} carpetas',
    other: '{count} carpetas',
  },
  'settings.sync.presentation.63352fdc2cd6bbbf': {
    one: '{count} archivo',
    many: '{count} archivos',
    other: '{count} archivos',
  },
  'settings.sync.presentation.7c907ab73773e102': {
    one: '{completed} de al menos {count} carpeta',
    many: '{completed} de al menos {count} carpetas',
    other: '{completed} de al menos {count} carpetas',
  },
  'settings.sync.presentation.7438a7b7fe1ef4bb': {
    one: '{completed} de al menos {count} archivo',
    many: '{completed} de al menos {count} archivos',
    other: '{completed} de al menos {count} archivos',
  },
  'settings.sync.presentation.20a1cd5ccd38098a': {
    one: '{completed} de {count} carpeta',
    many: '{completed} de {count} carpetas',
    other: '{completed} de {count} carpetas',
  },
  'settings.sync.presentation.9a139983ae1196bc': {
    one: '{completed} de {count} archivo',
    many: '{completed} de {count} archivos',
    other: '{completed} de {count} archivos',
  },
  'settings.sync.presentation.608ec17db8dff1ba': ' · {bytes} {unit} transferido',
  'settings.sync.presentation.4336b4a9e578c6ce': ' · {bytes} de {total} {unit}',
  'settings.sync.presentation.4a9aad432626cdc4': ' · queda menos de 1 minuto',
  'settings.sync.presentation.c42b56810e72964d': ' · quedan unos minutos {minutes}',
  'settings.sync.presentation.11a6767d5674c7e4': 'Listo',
  'settings.sync.presentation.88fe20810f158d65': 'Salvado; la limpieza local aún está pendiente',
  'settings.sync.presentation.2011abd185905fbc':
    'Mantenido en este dispositivo. Permitir la eliminación primero',
  'settings.sync.presentation.cf6ecbdf93a4cbd4':
    'Abrir en un editor o actualmente en uso. Ciérralo y vuelve a intentarlo.',
  'settings.sync.presentation.ba084f0f0f3f2d81':
    'Los cambios no enviados permanecen en este dispositivo. Sincronizar primero',
  'settings.sync.presentation.1450568cbc3989de': 'La versión cambió. Vista previa de nuevo',
  'settings.sync.presentation.bfad3113a6082ae4':
    'El archivo ya no coincide con esta regla. Vista previa de nuevo',
  'settings.sync.presentation.c257dbbbf04763fe': 'No disponible sin conexión',
  'settings.sync.presentation.8d4a166ba65e8cac': 'Este archivo no está disponible en el servidor.',
  'settings.sync.presentation.6d48d4d60ba51073':
    'Esta versión aún no está en el servidor. Sincronizar primero; el archivo se queda aquí',
  'settings.sync.presentation.3b110b3b8a0affae':
    'Sync rechazó este archivo. Primero resuelva su estado de sincronización; se queda aquí',
  'settings.sync.presentation.3123f064bd232e76': 'Este servidor no admite la descarga.',
  'settings.sync.presentation.4b9c0b68c8009214':
    'El almacenamiento de este dispositivo no admite la descarga segura',
  'settings.sync.presentation.67e22f73b49e31ce':
    'No hay suficiente espacio para descargar de forma segura',
  'settings.sync.presentation.8925063fc75cd16d':
    'Otro archivo ocupa el destino. Ambos archivos fueron conservados',
  'settings.sync.presentation.e2f0da1e1e6f9fdb': 'Este archivo no se puede descargar',
  'settings.sync.presentation.a88ffdf4720bfc95': 'Ya guardado solo en el servidor.',
  'settings.sync.presentation.2cfe6717c6efa346':
    'Los archivos ejecutables permanecen en este dispositivo',
  'settings.sync.presentation.f3912c33c1e7e094':
    'Esta conexión necesita una revisión de acceso antes de descargarse.',
  'settings.sync.presentation.4d77018e2e63b109':
    'Se requiere recuperación de sincronización. El archivo se queda aquí.',
  'settings.sync.presentation.54272d517782b52a': 'Comprobando la bóveda',
  'settings.sync.presentation.6a534e2d9b68ac18': 'Comparando archivos',
  'settings.sync.presentation.0b398fdee3be023a': 'Preparando carpetas',
  'settings.sync.presentation.f8cc26b4a73ec961': 'Recibir archivos',
  'settings.sync.presentation.37b345555d7ea6c1': 'Descargando',
  'settings.sync.presentation.8b898ca34ce71371': 'Subiendo',
  'settings.sync.presentation.d9351cf978606788': 'leyendo la ficha',
  'settings.sync.presentation.a11acbbb551a6ddc': 'Comprobando el servidor',
  'settings.sync.presentation.dc4552a7de803f44': 'Abriendo la carpeta',
  'settings.sync.presentation.dfe7d0dd9f350fd8': 'Preparando la conexión',
  'settings.sync.presentation.be0e89cc19c4cf38':
    'Eliminado del servidor. Todos los archivos permanecen en este dispositivo.',
  'settings.sync.codeSource': 'Código de {host} · {when}',
  'settings.sync.privateQuestion': 'Archivo privado · ¿compartir con {scope}?',
  'settings.components.AiScopeEditor.full_vault_access.e59147d6': 'Acceso completo a la bóveda',
  'settings.components.AiScopeEditor.the_agent_may_read_and.7215c412':
    'El agente puede leer y cambiar todos los archivos de la bóveda.',
  'settings.components.AiScopeEditor.the_agent_sees_only_what.dd8d63d0':
    'El agente ve sólo lo que se enumera a continuación.',
  'settings.components.AiScopeEditor.counting_group_members.6cf29d46':
    'Contando miembros del grupo',
  'settings.components.AiScopeEditor.what_the_agent_can_reach.9e1cc9cb':
    'A qué puede llegar el agente',
  'settings.components.AiScopeEditor.remove_value_from_scope.5306ceeb':
    'Eliminar {value0} del alcance',
  'settings.components.AiScopeEditor.loading_group_members.64b5fef7': 'Cargando miembros del grupo',
  'settings.components.AiScopeEditor.show_more.f5c9bd13': 'Mostrar más',
  'settings.components.AiScopeEditor.nothing_yet_the_agent_sees.83352aaa':
    'Nada todavía: el agente no ve ningún archivo.',
  'settings.components.AiScopeEditor.add_to_what_the_agent.ba420695':
    'Añadir a lo que el agente puede alcanzar',
  'settings.components.AiScopeEditor.add_a_note_folder_group.0a52ba05':
    'Añade una nota, carpeta, grupo o patrón…',
  'settings.components.AiScopeEditor.could_not_count_group_members.58d42889':
    'No se pudieron contar los miembros del grupo. Vuelva a abrir Access para intentarlo de nuevo.',
  'settings.components.AiScopeEditor.could_not_load_group_members.9a565298':
    'No se pudieron cargar los miembros del grupo. Cierra y vuelve a abrir el grupo para volver a intentarlo.',
  'settings.components.ToolModesEditor.show_core_tools.bea400e8':
    'Mostrar herramientas principales',
  'settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03':
    'Mostrar herramientas siempre activas que no se pueden desactivar.',
  'settings.components.ToolModesEditor.all_tools.81c151f9': 'Todas las herramientas',
  'settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce':
    'Establece todas las herramientas siguientes a la vez. Cada uno todavía se puede cambiar por sí solo después.',
  'settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee':
    'Configure cada herramienta en {value0}',
  'settings.components.ToolModesEditor.always_open.67b6ffc1': 'Siempre abierto',
  'settings.components.ToolModesEditor.when_value_is_open.37a2f90a': 'Cuando {value0} está abierto',
  'settings.components.ToolModesEditor.change_what_value_is_said.5508c12f':
    'Cambiar para qué se dice que es {value0}',
  'settings.components.ToolModesEditor.reset_to_default.bc5b45ae':
    'Restablecer los valores predeterminados',
  'settings.components.ToolModesEditor.use_the_section_s_own.e02f836f':
    'Utilizar de nuevo la propia descripción de la sección.',
  'settings.components.ToolModesEditor.done.11a6767d': 'Listo',
  'settings.components.ToolModesEditor.value_tools.a2c9c9bb': 'Herramientas: {value0}',
  'settings.components.ToolModesEditor.hide_its_tools.52db5aef': 'Ocultar sus herramientas',
  'settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30':
    'Muestra sus herramientas, cada una con su propia elección.',
  'settings.components.ToolModesEditor.all_in_this_section.3d4eba9d': 'Todo en esta sección',
  'settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a':
    'Configure cada herramienta en {value0} en {value1}',
  'settings.components.ToolModesEditor.use_this_server.8eb48b42': 'Utilice este servidor',
  'settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e':
    'Proporciona todas las herramientas de este servidor, cada una de las cuales pregunta antes de ejecutarse.',
  'settings.components.ToolModesEditor.always_on.f017032a': 'siempre encendido',
  'settings.components.ToolModesEditor.use_the_tool_s_own.520c244d':
    'Utilizar de nuevo la propia descripción de la herramienta.',
  'settings.components.ToolModesEditor.on_request.be820103': 'A solicitud',
  'settings.components.ToolModesEditor.off.ca7981b4': 'Apagado',
  'settings.components.ToolModesEditor.ask.b8c209cd': 'Preguntar',
  'settings.components.ToolModesEditor.auto.02862497': 'Auto',

  'settings.metadata.354509b1c9ccade8':
    'Archivos, búsqueda e historial de git en las carpetas que este chat se proporcionó en un nodo. Lo que puede alcanzar se establece por chat en Acceso al nodo.',
  'settings.metadata.18a90996c684b6b3':
    'Abrir, listar y buscar archivos; estado, diferencias e historial en git.',
  'settings.metadata.e0b89715205e4ef5': 'Cree, cambie, mueva, copie y elimine archivos.',
  'settings.metadata.d442700773269772':
    'Enumere los árboles de trabajo de una carpeta y cambie entre ellos.',
  'settings.metadata.29a212809fa10bf3':
    'Asigne una tarea a un agente de codificación en un nodo, sígala, envíela más y cancélela.',
  'settings.metadata.c7ad7ac4793fb440':
    'Lea las ejecuciones que registró el depurador, marque sus pasos, agregue puntos de registro y escríbalos; leer, guardar, importar y enviar las solicitudes guardadas del proyecto.',
  'settings.metadata.1fd38d5cbd2a997b': 'patrón',
  'settings.metadata.f2892578274d2e49': 'nota abierta',
  'settings.metadata.034a0062488256f1': 'carpeta',
  'settings.scope.groupNotes': {
    one: 'grupo · {count} nota',
    many: 'grupo · {count} notas',
    other: 'grupo · {count} notas',
  },
  'settings.calendar.urlPlaceholder': 'https://… o webcal://…',
  'settings.transfer.singleQr': 'Mostrar la transferencia como un código QR',
  'settings.transfer.multipleQr': {
    one: 'Mostrar la transferencia como {count} códigos QR',
    many: 'Mostrar la transferencia como {count} códigos QR',
    other: 'Mostrar la transferencia como {count} códigos QR',
  },
  'settings.metadata.bf774e203130976f': 'Añadir punto de grabación',
  'settings.metadata.ed11479db97b1ec2': 'Cancelar tarea del nodo',
  'settings.metadata.ce884b28082de708': 'Delegar al nodo',
  'settings.metadata.47cbd67f4decc509': 'Buscar en la ejecución',
  'settings.metadata.20c3a692f1425939': 'Seguir un valor',
  'settings.metadata.a63e38b5ef9d8acc': 'Continuar tarea del nodo',
  'settings.metadata.3dcb2cb134c18f1a': 'Importar solicitudes',
  'settings.metadata.a657f2eaf9177c2b': 'Árboles de trabajo del nodo',
  'settings.metadata.3f577c263389d695': 'Marcar en la ejecución',
  'settings.metadata.f40ad2a69f110e1a': 'Copiar archivos en el nodo',
  'settings.metadata.4c55f1221ca27657': 'Destinos de delegación del nodo',
  'settings.metadata.19d5a1e505698a8d': 'Editar archivos en el nodo',
  'settings.metadata.58bab54373681382': 'Carpetas del nodo',
  'settings.metadata.0887cebecaa90ad8': 'Autoría de líneas Git en el nodo',
  'settings.metadata.7d99864f0651cf16': 'Ramas Git del nodo',
  'settings.metadata.c6d22695c2b49792': 'Diferencias Git del nodo',
  'settings.metadata.2e62cdbaa5ee98f0': 'Historial Git del nodo',
  'settings.metadata.74cd294db7d3e719': 'Estado Git del nodo',
  'settings.metadata.0c7411b73901f6c2': 'Listar archivos del nodo',
  'settings.metadata.e5b0c93478880755': 'Mover archivos en el nodo',
  'settings.metadata.c5dfe7e400c6f227': 'Lista de nodos',
  'settings.metadata.fe2b5c47256ac07e': 'Leer archivos del nodo',
  'settings.metadata.b0dc611264fca372': 'Reemplazar texto en el nodo',
  'settings.metadata.d3d7043d61bb21c8': 'Autoría de líneas en el repositorio del nodo',
  'settings.metadata.34feb0cfc058ccff': 'Cambios en el repositorio del nodo',
  'settings.metadata.dd2e41d38b7838e9': 'Crear commit en el repositorio del nodo',
  'settings.metadata.074e769d80fde34e': 'Commits del repositorio del nodo',
  'settings.metadata.c4806722ba66e903': 'Comparar versiones del repositorio del nodo',
  'settings.metadata.ab004772e1b71ba8': 'Archivo del repositorio del nodo',
  'settings.metadata.6544b43fdfe3320e': 'Buscar en el repositorio del nodo',
  'settings.metadata.a9c6586ae9f11964': 'Abrir repositorio del nodo',
  'settings.metadata.81ac4cdc952990d9': 'Proponer cambios en el repositorio del nodo',
  'settings.metadata.44812fcb9883ac9d': 'Árbol de archivos del repositorio del nodo',
  'settings.metadata.b74af9f786625504': 'Pestañas del repositorio del nodo',
  'settings.metadata.cc00c9b3261b6896': 'Eliminar archivos del nodo',
  'settings.metadata.f864b17e206c9949': 'Buscar archivos en el nodo',
  'settings.metadata.01bce5e752a4e282': 'Cambiar árbol de trabajo del nodo',
  'settings.metadata.6c91d7b86793064a': 'Escribir archivos en el nodo',
  'settings.metadata.aa2463736b28728a': 'Nota sobre una ejecución',
  'settings.metadata.f659e2e6ad7c78ad': 'Leer solicitud guardada',
  'settings.metadata.bac5871a628ca72b': 'Consultar estado de tarea del nodo',
  'settings.metadata.7616d1f9f0eb2abe': 'Ejecuciones grabadas',
  'settings.metadata.62b2137489d32412': 'Resultado del envío',
  'settings.metadata.87c059b1fd800819': 'Cronología de ejecución',
  'settings.metadata.93f46c6131a98750': 'Guardar solicitud',
  'settings.metadata.49813efc30da7138': 'Solicitudes guardadas',
  'settings.metadata.0d50b621a3f98f5d': 'Enviar solicitud guardada',
  'settings.metadata.a4b757018683f41d': 'Cambios de valor',
  'settings.metadata.ae1b1551ec65814d': 'Estructura del valor',
  'settings.metadata.7a6f44b8094e0625': 'Fragmento del valor',
  'settings.metadata.da9b697a15683606': 'Crear lienzo',
  'settings.metadata.841ee7bd4aeb25a6': 'Definir recorrido del lienzo',
  'settings.metadata.aab4922458b14785': 'Editar lienzo',
  'settings.metadata.97fd18d398003c79': 'Exportar todo el lienzo',
  'settings.metadata.1fe56b7b323305fc': 'Distribuir elementos del lienzo',
  'settings.metadata.6f53a1ddd68b0c2b': 'Ver lienzo',
  'settings.metadata.2b046175f5077346': 'Leer lienzo',
  'settings.tools.openSection': 'Abrir «{section}»',
  'settings.ModelEditModal.default.21b111cb': 'Predeterminado',
  'settings.ModelEditModal.low.f793de20': 'Bajo',
  'settings.ModelEditModal.medium.8e588cd1': 'Medio',
  'settings.ModelEditModal.high.c4ebc6d4': 'Alto',
  'settings.ai.AgentEditorModal.none.dc937b59': 'Ninguno',
  'settings.ai.AgentEditorModal.follow_the_setting.ead899ca': 'Seguir el ajuste',
  'settings.ai.AgentEditorModal.by_section.2c8a0eb5': 'Por secciones',
  'settings.ai.AgentEditorModal.all_at_once.f9068371': 'Todos a la vez',
  'settings.ai.GeneralSettings.same_as_the_chat.3e206eff': 'Como en el chat',
  'settings.ai.GeneralSettings.off.ca7981b4': 'Apagado',
  'settings.ai.GeneralSettings.once.d88f6d83': 'Una vez',
  'settings.ai.GeneralSettings.twice.cc1b4c8d': 'Dos veces',
  'settings.ai.GeneralSettings.three_times.13b6376c': 'Tres veces',
  'settings.ai.GeneralSettings.five_times.ee32f27e': 'Cinco veces',
  'settings.ai.GeneralSettings.not_configured.dd1841d2': 'Sin configurar',
  'settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311':
    'Conservar lo actual y añadir esto',
  'settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8':
    'Sustituir lo actual por esto',
  'settings.components.ToolModesEditor.mixed.f340b6d6': 'Mixto',
  'settings.metadata.6fd575b1876b0d59':
    'El bloque de propiedades empieza en la primera línea, está cerrado, contiene YAML válido y no repite nombres de propiedades. Si el bloque está más abajo en la nota, se mueve al principio; se elimina una propiedad repetida con el mismo valor.',
  'settings.metadata.36317c6ed2cd7dbe':
    'Las propiedades indicadas están presentes y rellenas. Cada entrada puede incluir un valor predeterminado después de dos puntos: "created: {{ctime}}" inserta la fecha de creación del archivo y {{today}} la fecha de hoy. Solo se corrigen estas propiedades.',
  'settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e':
    'Las páginas de este libro están dispuestas según el libro, como las de un cómic: no hay nada que preparar para ellas. Haga zoom con Mod y más o menos, un pellizco o el menú de pestañas.',
  'settings.components.reader.ReaderSettingsForm.layout.a5119091': 'Disposición',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f':
    'Pase las páginas una por una o desplácese por cada capítulo. El modo de tinta electrónica mantiene las páginas en este dispositivo.',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f':
    'Pase las páginas una por una o desplácese por cada capítulo.',
  'settings.components.reader.ReaderSettingsForm.font.64d0b3ad': 'Fuente',
  'settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22': 'Carpeta de fuentes',
  'settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c':
    'Una carpeta en la bóveda con archivos de fuentes: .ttf, .otf, .woff o .woff2. Cada familia que contiene se ofrece como una fuente arriba y viaja a sus otros dispositivos con la bóveda. Obsidian Sync los lleva con Sync todos los demás tipos activados. Vacío: no hay fuentes del almacén.',
  'settings.components.reader.ReaderSettingsForm.text_size.d68761cc': 'Tamaño del texto',
  'settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1': 'Interlineado',
  'settings.components.reader.ReaderSettingsForm.margins.eea8d245': 'Márgenes',
  'settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b':
    'El espacio alrededor del texto y entre columnas.',
  'settings.components.reader.ReaderSettingsForm.column_width.86f4e582': 'Ancho de columna',
  'settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab':
    'Lo más ancho que puede crecer una columna de texto.',
  'settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135': 'Dos columnas',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2':
    'Dos páginas una al lado de la otra cuando la pestaña sea lo suficientemente ancha.',
  'settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1': 'Colores del tema',
  'settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee':
    'Dibuja el libro con el texto y los colores de fondo de tu tema, incluido el modo oscuro. Apagado: colores propios del libro, en una página clara.',
  'settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d':
    'Estilos propios del libro.',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8':
    'Diseño propio del libro: tablas, sangrías, alineación, capitulares. El tamaño, el espaciado, la fuente y los colores del texto siguen ganando. Nunca se carga nada fuera del libro.',
  'settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32':
    'Abrir archivos PDF en el lector Abele',
  'settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b':
    'Los archivos PDF se abren aquí en lugar de en el propio visor de Obsidian, con páginas para pasar, el contenido al lado de ellas y el lugar guardado. Desactivado: se abren en el visor de Obsidian y Abrir en el lector Abele en el menú de un PDF aún abre uno aquí.',
  'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f':
    'Un desplazamiento continuo, página tras página o páginas pasadas de una en una.',
  'settings.components.reader.ReaderSettingsForm.page_size.bd69e66e': 'Tamaño de página',
  'settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb':
    'Automático es el ancho de la página al desplazarse y toda la página con páginas. O ajustar toda la página, ajustar su ancho o un zoom fijo.',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc':
    'Dos páginas una al lado de la otra',
  'settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6':
    'Cuando la pestaña es lo suficientemente ancha, se encuentra abierta como si fuera un libro impreso.',
  'settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd':
    'Páginas oscuras en un tema oscuro.',
  'settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3':
    'La luz y la oscuridad de la página se intercambian mientras que el tema de Obsidian es oscuro, por lo que una página blanca no brilla. Las imágenes salen en negativo.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f': 'Grosor de la pluma',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925':
    'De qué grosor dibujan el bolígrafo y el rotulador en un PDF. El botón al lado de los colores debajo de la página también lo cambia.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856':
    'Grosor de la pluma en los dibujos.',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a':
    'De qué grosor dibujan el bolígrafo y el rotulador en un dibujo o en una imagen dibujada. El botón al lado de los colores en su barra también lo cambia.',
  'settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc':
    'Tinta electrónica, en este dispositivo',
  'settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337':
    'Para un lector con pantalla de tinta electrónica, como un Boox. Mantenido solo en este dispositivo: su teléfono y computadora leen como antes.',
  'settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801': 'Modo de tinta electrónica',
  'settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d':
    'Páginas pasadas, nunca desplazadas ni deslizadas, también un PDF. Texto negro sobre blanco, nada gris, líneas más gruesas, nada que se mueva o se desvanezca. Destacados dibujados como líneas cuya forma indica el color. Un toque en el tercio izquierdo o derecho pasa la página. Los botones y teclas de página también lo giran.',
  'settings.components.reader.ReaderSettingsForm.full_refresh.9322071a': 'Actualización completa',
  'settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f':
    'La página parpadea en negro y luego en blanco cada tantas páginas, lo que elimina el leve fantasma de las páginas anteriores que deja una pantalla de tinta electrónica.',
  'settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e':
    'Mostrar las claves que el lector escucha.',
  'settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a':
    'Sobre la página, el nombre y código de la última tecla o botón presionado y si pasó de página; la consola registra cada uno. Para saber qué envían los botones de página de un lector cuando no pasa las páginas.',
  'settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986': 'Leer en voz alta',
  'settings.components.reader.ReaderSettingsForm.voice.87bf2bc0': 'Voz',
  'settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e':
    'Las voces que tiene este dispositivo; en un iPhone, los de Configuración → Accesibilidad → Contenido hablado. Una voz elegida en otro dispositivo del que éste carece se lee como predeterminada.',
  'settings.components.reader.ReaderSettingsForm.speed.c372fee9': 'Velocidad',
  'settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8':
    'donde quedaron los libros',
  'settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7':
    'Archivo de lugares de lectura',
  'settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5':
    'Un archivo .json en la bóveda que guarda dónde se dejó cada libro, para que cada dispositivo lo abra allí. La lista de archivos de Obsidian no lo muestra. Obsidian Sync lo lleva con Sync todos los demás tipos activados, al igual que los chats. Cambiar la ruta mueve los lugares al nuevo archivo. Vacío: {value0}.',
  'settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4':
    'Cada {value0} páginas',
  'settings.components.reader.ReaderSettingsForm.never.6300ef80': 'Nunca',
  'settings.components.reader.ReaderSettingsForm.pages.9046da16': 'paginas',
  'settings.components.reader.ReaderSettingsForm.scrolling.9b976293': 'Desplazamiento',
  'settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0': 'Fuente del tema',
  'settings.components.reader.ReaderSettingsForm.serif.1b5e747e': 'Serifa',
  'settings.components.reader.ReaderSettingsForm.sans_serif.07e77255': 'Sans-serif',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055': 'Del libro',
  'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c':
    '{value0} (no en la carpeta de fuentes)',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807':
    'La fuente del texto. El tema es el que usan tus notas; debajo de las del libro están las fuentes de su carpeta de fuentes.',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358':
    'La fuente del texto. El tema es el que usan tus notas. Coloque los archivos de fuentes en la carpeta de fuentes para leerlos usted mismo.',
  'settings.components.reader.ReaderSettingsForm.narrow.ba227109': 'Estrechos',
  'settings.components.reader.ReaderSettingsForm.normal.a7248eeb': 'Normales',
  'settings.components.reader.ReaderSettingsForm.wide.147170e7': 'Anchos',
  'settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6':
    'Desplazamiento continuo',
  'settings.components.reader.ReaderSettingsForm.automatic.d461a493': 'Automático',
  'settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c': 'Página completa',
  'settings.components.reader.ReaderSettingsForm.page_width.217fbef1': 'Ancho de página',
  'settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4':
    'La voz del dispositivo para el idioma del libro.',
  'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24':
    'Una voz de otro dispositivo',
  'settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037':
    'Aspectos destacados de este libro',
  'settings.components.reader.BookNotesSettings.highlights.6e517828': 'Reflejos',
  'settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7': 'donde van',
  'settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64':
    'Sólo para este libro. “Como en configuración” sigue Configuración → Libros.',
  'settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e':
    'Una nota propia de cada libro, al lado, o una nota por cada libro. Un libro puede elegir por sí mismo desde su botón Aa.',
  'settings.components.reader.BookNotesSettings.note.d8da2c49': 'Nota',
  'settings.components.reader.BookNotesSettings.note_for_all_books.105d496e':
    'Nota para todos los libros.',
  'settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6':
    'La nota a la que van los aspectos más destacados de este libro. Vacío: {value0}.',
  'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d':
    'Realizado con el primer punto culminante; Los de cada libro se diferencian por sus enlaces. Vacío: {value0}.',
  'settings.components.reader.BookNotesSettings.template.0575f29d': 'Plantilla',
  'settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd':
    'Una nota para tomar nota de los aspectos más destacados de este libro. Vacío: como en configuración.',
  'settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc':
    'Una nota a partir de la cual se crea una nueva nota destacada. Entre {literal0} y {literal1} es lo que suma cada destacado, siendo el destacado {literal2}; o {literal3} y {literal4} para separar la cotización y tu comentario; también {literal5}, {literal6}, {literal7}, {literal8}, {literal9}. Vacío: ninguno.',
  'settings.components.reader.BookNotesSettings.none.dc937b59': 'Ninguno',
  'settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2':
    'Una nota propia del libro',
  'settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78':
    'Una nota para todos los libros',
  'settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c':
    'Como en configuración ({value0})',
  'settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f': 'Una nota que nombre',
  'settings.reader.stroke.fine': 'Fino',
  'settings.reader.stroke.medium': 'Medio',
  'settings.reader.stroke.bold': 'Grueso',
  'settings.GithubAccessReport.an_access_token.14f95c33': 'un token de acceso',
  'settings.GithubConnectionEditor.add_git_connection.9e359dd8': 'Añadir conexión de Git',
  'settings.GithubConnectionEditor.edit_git_connection.1e73be5f': 'Editar conexión de Git',
  'settings.GithubConnectionEditor.service.d677190e': 'Servicio',
  'settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8':
    'Elija el servicio antes de introducir la dirección del servidor y el token.',
  'settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1':
    'Dirección completa de Forgejo, incluidos el puerto y la ruta de instalación, si los hay.',
  'settings.GithubConnectionEditor.access_token.9a911b08': 'token de acceso',
  'settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b':
    'sample-org\nsample-org/project',
  'settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1':
    'propietario/repositorio o un enlace de Forgejo',
  'settings.GithubConnectionEditor.access_details.abe1adac': 'Detalles de acceso',
  'settings.GithubConnectionEditor.forgejo.f4e62146': 'Forgejo',
  'settings.GithubConnectionEditor.signed_in_as_value.682769b2': 'Iniciado sesión como {value0}',
  'settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a':
    'El servidor no aceptó este token (401).',
  'settings.GithubConnectionEditor.the_account_could_not_be.71de8f27':
    'No se pudo verificar la cuenta. {value0}',
  'settings.GithubConnectionEditor.public_access_without_a_token.35b758c0':
    'Acceso público sin token',
  'settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc':
    'Elija un repositorio para verificar el acceso de lectura.',
  'settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8':
    'El token de conexión cambió. Verifique el acceso nuevamente.',
  'settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376':
    'El token almacenado pertenece al servidor anterior. Ingrese un nuevo token para esta dirección.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3':
    'Proporcione propietario/repositorio o un enlace de repositorio en el servidor de esta conexión.',
  'settings.GithubConnectionEditor.asking_forgejo.f46aa9ff': 'Consultando Forgejo…',
  'settings.GithubSettings.git_hosting.a3002011': 'Alojamiento de Git',
  'settings.GithubSettings.default.2ae2ecc2': 'Por defecto · ',
  'settings.GithubSettings.edit_connection.047f9f95': 'Editar conexión',
  'settings.GithubSettings.connection_actions.9e1bbb65': 'Acciones de conexión',
  'settings.GithubSettings.public_access_without_a_token.35b758c0': 'Acceso público sin token',
  'settings.GithubSettings.forgejo.f4e62146': 'Forgejo',
  'settings.GithubSettings.token_unavailable_on_this_device.0bd03b33':
    'Token no disponible en este dispositivo',
  'settings.GithubSettings.the_token_has_expired.0b52627f': 'El token ha caducado',
  'settings.GithubSettings.the_server_did_not_accept.1d7560a4':
    'El servidor no aceptó el token en la última verificación de acceso.',
  'settings.GithubSettings.the_last_access_check_failed.72f4e393':
    'La última verificación de acceso falló',
  'settings.GithubSettings.some_repository_access_checks_failed.1b573ceb':
    'Algunas comprobaciones de acceso a repositorios fallaron',
  'settings.GithubSettings.access_checked.d2518d23': 'Acceso comprobado',
  'settings.GithubSettings.not_checked_yet.881d23f6': 'Aún no comprobado',
  'settings.GithubSettings.check_access.abb9a172': 'Consultar acceso',
  'settings.GithubSettings.make_default_for_value.ded3e105':
    'Establecer como predeterminada para {value0}',
  'settings.git.serverAddressError':
    'Solo la dirección: sin usuario, consulta ni fragmento después de #',
  'settings.git.noteLabel': 'nota',
  'settings.transfer.oneKeyToStore': 'Una clave para guardar los elementos seleccionados.',
  'settings.git.nativeAddress':
    'Dirección completa de {service}, incluidos el puerto y la ruta de instalación.',
  'settings.git.useCodeberg': 'Usar Codeberg',
  'settings.git.useCodebergTooltip': 'Usar Codeberg como servidor Forgejo',
  'settings.git.nativeRepoLink': 'owner/repo o un enlace de {service}',
  'settings.git.gitea': 'Gitea',
  'settings.git.githubId': 'github',
  'settings.git.askingNative': 'Consultando {service}…',
  'settings.git.accessCheckCancelled': 'Se canceló esta comprobación de acceso.',
  'settings.git.repositoryConnections': 'Conexiones Git',
  'settings.metadata.ca4a628311f7879a': 'Repositorios Git',
  'settings.metadata.b9227122bad532e6': 'Pestañas de repositorios',
  'debuggerAccess.title': 'Acceso del agente al depurador',
  'debuggerAccess.request': 'Permitir que el agente use el depurador en {folder}',
  'debuggerAccess.chatFolder': 'la carpeta de este chat',
  'debuggerAccess.scope':
    'Solo esta ejecución y este programa. Las expresiones requieren una aprobación aparte.',
  'debuggerAccess.allowed': 'Acceso al depurador permitido. El agente puede repetir la llamada.',
  'debuggerAccess.denied': 'Acceso al depurador denegado.',
  'debuggerAccess.expiredRequest':
    'Esta solicitud ha caducado. Pide al agente que lo intente de nuevo.',
  'debuggerAccess.allow': 'Permitir',
  'debuggerAccess.deny': 'Denegar',
  'debuggerAccess.issued':
    'Permisos que has concedido en este dispositivo. El acceso termina al finalizar la ejecución.',
  'debuggerAccess.issuerOnly':
    'Los permisos de otros propietarios están ocultos. Solo quien concedió un permiso puede revocarlo o eliminarlo.',
  'debuggerAccess.refresh': 'Actualizar',
  'debuggerAccess.updateNode':
    'Actualiza este nodo para gestionar el acceso del agente al depurador.',
  'debuggerAccess.empty': 'No has concedido permisos para el depurador.',
  'debuggerAccess.revoke': 'Revocar el acceso al depurador',
  'debuggerAccess.deleteTip':
    'Eliminar este permiso. Solo puedes eliminar los permisos que concediste. Se conserva el historial de operaciones.',
  'debuggerAccess.grantsUnavailable': 'Los permisos del depurador no están disponibles',
  'debuggerAccess.changeFailed': 'No se pudo modificar el permiso del depurador',
  'debuggerAccess.state.revoked': 'Revocado',
  'debuggerAccess.state.expired': 'Caducado',
  'debuggerAccess.state.active': 'Activo',
  'debuggerAccess.grantDescription':
    '{state} · {actions} · {mode} · {conversation} · Caduca {expires}',
  'debuggerAccess.refreshRequests': 'Actualizar solicitudes del depurador',
  'debuggerAccess.unavailable': 'El acceso al depurador no está disponible',
  'debuggerAccess.stale':
    'Esta solicitud del depurador ya no está pendiente. Se han actualizado las solicitudes pendientes.',
  'debuggerAccess.action.read': 'lectura',
  'debuggerAccess.action.step': 'paso',
  'debuggerAccess.action.continue': 'continuar',
  'debuggerAccess.action.pause': 'pausa',
  'debuggerAccess.action.breakpoints': 'puntos de interrupción',
  'debuggerAccess.action.launch': 'iniciar',
  'debuggerAccess.action.attach': 'conectar',
  'debuggerAccess.action.detach': 'desconectar',
  'debuggerAccess.action.terminate': 'terminar',
  'debuggerAccess.action.expressions': 'expresiones',
  'debuggerAccess.action.evaluate': 'evaluar / modificar variable',
  'debuggerAccess.mode.ask': 'preguntar',
  'debuggerAccess.mode.allowAll': 'permitir todo',
  'settings.git.reloadService': 'Volver a cargar desde el servicio Git',
  'settings.git.openBrowser': 'Abrir en el navegador',
  'settings.metadata.gitHosting': 'Alojamiento de Git',
  'maps.viewName': 'Mapa de Abele',
  'maps.coordinates': 'Propiedad de coordenadas',
  'maps.markerIcon': 'Icono del marcador',
  'maps.markerColor': 'Color del marcador',
  'maps.center': 'Coordenadas del centro',
  'maps.defaultZoom': 'Zoom inicial',
  'maps.minZoom': 'Zoom mínimo',
  'maps.maxZoom': 'Zoom máximo',
  'maps.mapHeight': 'Altura incrustada',
  'maps.groupNearby': 'Agrupar lugares cercanos',
  'maps.mapTiles': 'Capas del mapa',
  'maps.mapTilesDark': 'Capas en modo oscuro',
  'maps.copied': 'Coordenadas copiadas',
  'maps.copyFailed': 'No se pudieron copiar las coordenadas',
  'maps.delete': 'Eliminar nota',
  'maps.createFailed': 'No se pudo crear la nota',
  'maps.saveFailed': 'No se pudieron guardar los fondos',
  'maps.locationDenied': 'Permiso de ubicación denegado',
  'maps.locationTimeout': 'Se agotó el tiempo de ubicación',
  'maps.locationUnavailable': 'Ubicación no disponible',
  'maps.locating': 'Buscando tu ubicación…',
  'commands.copy-current-map-location': 'Copiar coordenadas actuales',
  'maps.zoomIn': 'Acercar',
  'maps.zoomOut': 'Alejar',
  'maps.north': 'Orientar al norte',
  'maps.locationOff': 'Ubicación desactivada para Obsidian',
  'maps.following': 'Siguiéndote. Pulsa para parar',
  'maps.showLocation': 'Mostrar mi ubicación',
  'maps.exitFull': 'Salir de pantalla completa',
  'maps.full': 'Pantalla completa',
  'maps.fitPlaces': 'Mostrar todos los lugares',
  'maps.defaultBackground': 'Predeterminado',
  'maps.background': 'Fondo',
  'maps.tab': 'Abrir en nueva pestaña',
  'maps.split': 'Abrir a la derecha',
  'maps.window': 'Abrir en nueva ventana',
  'maps.card': 'Ficha del lugar',
  'maps.copy': 'Copiar coordenadas',
  'maps.newHere': 'Nueva nota aquí',
  'maps.setCenter': 'Usar como centro de la vista',
  'maps.manage': 'Gestionar fondos…',
  'maps.noCoordinates': 'Sin coordenadas',
  'maps.unreadable': 'Coordenadas ilegibles',
  'maps.formulaError': 'Error en la fórmula',
  'maps.noProperty': '¿Dónde están las coordenadas?',
  'maps.pickProperty': 'Elige la propiedad o fórmula con las coordenadas del lugar.',
  'maps.configure': 'Configurar vista',
  'maps.noRecords': 'Aún no hay notas en esta base',
  'maps.hold': 'Mantén pulsado el mapa para añadir un lugar.',
  'maps.rightClick': 'Haz clic derecho para añadir un lugar.',
  'maps.filtered': 'Ningún lugar coincide con los filtros',
  'maps.filtersEmpty': 'Los filtros no dejan resultados.',
  'maps.filters': 'Filtros',
  'maps.nothing': 'No se encontró nada',
  'maps.addCoordinates': 'Añade coordenadas o elige otra propiedad en la configuración.',
  'maps.showNotes': 'Mostrar notas',
  'maps.loadFailed': 'No se pudo cargar el mapa',
  'maps.offline': 'Sin conexión al servidor del mapa. Los lugares siguen aquí.',
  'maps.retry': 'Reintentar',
  'maps.noWebgl': 'Este dispositivo no puede mostrar mapas',
  'maps.graphics': 'La aceleración gráfica no está disponible.',
  'maps.stopped': 'El mapa dejó de mostrarse',
  'maps.lostContext': 'Se perdió el contexto gráfico, por ejemplo tras suspender.',
  'maps.drawAgain': 'Volver a dibujar',
  'maps.backgrounds': 'Fondos',
  'maps.up': 'Subir',
  'maps.down': 'Bajar',
  'maps.edit': 'Editar',
  'maps.remove': 'Eliminar',
  'maps.add': 'Añadir',
  'maps.addBackground': 'Añadir fondo',
  'maps.newBackground': 'Nuevo fondo',
  'maps.editBackground': 'Editar fondo',
  'maps.name': 'Nombre',
  'maps.light': 'Claro',
  'maps.dark': 'Oscuro',
  'maps.cancel': 'Cancelar',
  'maps.save': 'Guardar',
  'maps.giveName': 'Ponle un nombre',
  'maps.needAddress': 'Se necesita al menos una dirección',
  'maps.createNote': 'Crear nota',
  'maps.formulaWhy':
    'No se puede escribir en una fórmula. Elige una propiedad para las coordenadas antes de crear la nota.',
  'maps.skipped': 'Notas fuera del mapa: {count}',
  'maps.noneCoordinates': 'Notas sin coordenadas: {count}',
  'maps.copyValue': 'Copiar {value}',
  'maps.saveZoom': 'Abrir con zoom {value}',
  'maps.placesHere': 'Lugares aquí: {count}',
  'maps.searchEmpty': 'Ningún lugar coincide con «{query}».',
  'maps.backgroundHint': 'Fondos con nombre para mapas de Bases.',
  'maps.noBackgrounds': 'No hay fondos propios',
  'maps.addressHint': 'Una dirección de estilo o plantillas de teselas dibujadas como capas.',
  'maps.darkHint': 'Opcional. Sin él se usa el fondo claro también en modo oscuro.',
  'maps.fromMaps': 'Fondos de Obsidian Maps',
  'maps.copyBackgrounds': 'Copiar fondos',
  'maps.importHint': 'Copiar sin cambiar la configuración de Obsidian Maps.',
  'maps.tileLayers': 'Capas de teselas: {count}',
  'maps.style': 'Estilo',
  'maps.lightOnly': 'Solo claro; para ambos temas',
  'maps.bothThemes': 'Claro y oscuro',
  'maps.deleteFailed': 'No se pudo eliminar la nota',
  'maps.fullUnavailable': 'Pantalla completa no disponible en este dispositivo',
  'maps.showList': 'Mostrar como lista',
  'maps.listBeside': 'Lista junto al mapa',
  'maps.placeGone': 'Esta nota ya no está disponible',
  'maps.attribution': 'Mostrar atribución del mapa',
  'maps.feedback': 'Comentarios del mapa',
  'maps.touchHelp': 'Usa dos dedos para mover el mapa',
  'maps.scrollHelp': 'Usa {key} y desplázate para ampliar el mapa',
  'maps.currentLocation': 'Ubicación actual',
  'maps.backList': 'Volver a la lista',
  'maps.cardGone': 'La nota ya no existe',
  'maps.cardGoneText': 'Se eliminó o movió después de cargar el mapa.',
  'maps.cardError': 'No se pudo leer la nota',
  'maps.cardErrorText': 'El lugar sigue en el mapa. Abre la nota para comprobarla.',
  'maps.imageMissing': 'No se pudo cargar {path}',
  'maps.openPicture': 'Abrir imagen: {caption}',
  'maps.open': 'Abrir',
  'maps.openNote': 'Abrir la nota',
  'maps.showMap': 'Mostrar en el mapa',
  'maps.more': 'Más',
  'maps.straightLine': '{distance} en línea recta',
  'maps.mapFace': 'Mostrar el mapa',
  'maps.hideList': 'Ocultar la lista',
  'maps.sortLabel': 'Orden: {order}',
  'maps.resort': 'El mapa se movió. Ordenar desde el nuevo centro',
  'maps.placeCount': 'Lugares: {count}',
  'maps.listSearchEmpty': 'Ningún lugar coincide con la búsqueda',
  'maps.listEmpty': 'No hay lugares con coordenadas',
  'maps.sortBase': 'Orden de la base',
  'maps.sortMe': 'Más cerca de mí',
  'maps.sortCentre': 'Más cerca del centro del mapa',
  'maps.metres': '{value} m',
  'maps.kilometres': '{value} km',
  'maps.distanceCentre': 'En línea recta desde el centro del mapa',
  'maps.distanceMe': 'En línea recta desde tu ubicación',
  'debug.open': 'Depurar',
  'debug.run': 'Ejecutar un programa',
  'debug.attach': 'Conectar a un programa en ejecución',
  'debug.checking': 'Comprobando el depurador…',
  'debug.offline': 'Vuelve a conectar al nodo',
  'debug.off': 'El depurador está desactivado en este nodo',
  'debug.update': 'Actualiza el nodo para depurar desde carpetas',
  'debug.install': 'El depurador de JavaScript no está instalado en el nodo',
  'debug.noFolder': 'Primero elige una carpeta del nodo',
  'debug.pathKind': 'Una ruta en esta carpeta',
  'debug.programPlaceholder': 'Archivo JavaScript para depurar: src/main.js',
  'debug.programEmpty': 'Escribe la ruta de un archivo JavaScript en esta carpeta',
  'debug.thisFolder': 'Esta carpeta',
  'debug.insideFolder': 'Se ejecuta desde esta carpeta',
  'debug.outsideFolder': 'Se ejecuta fuera de esta carpeta: se pedirá confirmación',
  'debug.executionTitle': '¿Permitir ejecutar código en esta carpeta?',
  'debug.executionMessage':
    '¿Permitir ejecutar código en {path}? El proyecto registrado será de confianza y los programas del depurador y los agentes podrán ejecutarse en esta carpeta o árbol de trabajo.',
  'debug.empty': 'Abre el depurador desde el menú de una carpeta del nodo o de un chat.',
  'debug.outsideTitle': '¿Conectar con un programa fuera de esta carpeta?',
  'debug.outsideMessage':
    '{command} se ejecuta en {path}, fuera de la carpeta seleccionada. El depurador puede pausarlo y leer sus valores. Al desconectarlo, el programa sigue ejecutándose.',
  'debug.sourceUpdate': 'Actualiza el nodo para poner puntos de interrupción en este archivo',
  'debug.sourceMap':
    'El nodo no encontró un mapa de fuentes que vincule este archivo con el programa en ejecución. Compile con mapas de fuentes, reinicie el programa y vuelva a conectar el depurador.',
  'debug.sourceChanged':
    'Este archivo cambió desde que se inició el programa. Restaure ese contenido o vuelva a compilar y reiniciar el programa.',
  'debug.sourceOutside': 'El archivo está fuera de la carpeta de depuración',
  'debug.sourceUnavailable': 'No se pudo añadir el archivo al depurador',
  'debug.entryPlaceholder':
    'Buscar archivos de entrada o scripts del paquete; o escribir una ruta JavaScript compilada',
  'debug.entryEmpty': 'Sin coincidencias. Puede escribir la ruta del JavaScript compilado.',
  'debug.sourceConflict': 'El archivo entra en conflicto con una fuente ya añadida',
  'debug.sourceLimit': 'Se alcanzó el límite de archivos fuente de la sesión',
  'debug.sourceUnreadable': 'El archivo no está disponible o no se puede leer',
  'debug.launchTitle': 'Ejecutar un programa',
  'debug.launchProgram': 'Programa',
  'debug.launchProgramHint':
    'Ruta relativa a esta carpeta. Para TypeScript compilado, indique el archivo JavaScript de entrada (por ejemplo, dist/main.js).',
  'debug.launchArgs': 'Argumentos',
  'debug.launchArgsHint':
    'Separe los argumentos con espacios; use comillas para valores con espacios. No se evalúan expresiones del intérprete de comandos.',
  'debug.launchArgsInvalid':
    'Cierre las comillas y complete las secuencias de escape en los argumentos.',
  'debug.launchFailed': 'No se pudo iniciar el programa: {detail}',
  'debug.launchExitedEarly': 'El programa terminó antes de que el depurador pudiera conectarse.',
  'debug.launchFailedPlain':
    'No se pudo iniciar el programa. Abra Detalles para obtener más información.',
  'debug.sourceDeclaration':
    'Este archivo de declaraciones no contiene código ejecutable. Abra la implementación para añadir un punto de interrupción.',
  'debug.sourceTest':
    'El programa en ejecución no carga este archivo de pruebas. Inicie las pruebas con depuración para detenerse aquí.',
  'debug.sourceGenerated':
    'Este archivo compilado no está disponible aquí. Abra su código fuente original para depurarlo.',
  'debug.breakpointDisabled': 'Punto de interrupción desactivado',
  'debug.removeBreakpoints': 'Eliminar todos los puntos de interrupción',
  'debug.breakpointOptions': 'Opciones del punto de interrupción',
  'debug.caughtExceptions': 'Excepciones capturadas',
  'debug.uncaughtExceptions': 'Excepciones no capturadas',
  'debug.editCondition': 'Editar condición',
  'debug.editLogMessage': 'Mensaje de registro',
  'debug.editHitCount': 'Número de aciertos',
  'debug.hitCountUnavailable': 'Este nodo no admite el contador de aciertos',
  'debug.disableBreakpoint': 'Desactivar punto de interrupción',
  'debug.enableBreakpoint': 'Activar punto de interrupción',
  'debug.approvalPending': 'Esperando aprobación en Depuración',
  'debug.recordPointRefused': 'No se pudo confirmar el guardado del punto de registro: {reason}',
  'debug.breakpointUnbound':
    'El programa aún no ha cargado código para esta línea. Compruebe el mapa de fuentes o espere a que se cargue este código.',
  'debug.watchLastValue': 'Último valor: {value}',
  'debug.logPoint': 'Punto de registro: {message}',
} satisfies TranslationCatalog
