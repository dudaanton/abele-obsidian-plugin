export const streamC = {
  'debug.requestsImporting': 'Importando solicitudes…',
  'debug.httpIncoming': 'Entrante',
  'debug.httpOutgoing': 'Saliente',
  'debug.httpOpenRecorded': 'Abrir solicitud grabada',

  'debug.requestsBrowserOnly':
    'Las solicitudes se graban desde un navegador conectado. Este nodo no captura las solicitudes HTTP que el programa recibe o envía.',
  'debug.referencesTextFallback': 'Buscar referencias a {name} (búsqueda de texto alternativa)',
  'sync.phone.offline': 'Sincronización: servidor no disponible',
  'sync.phone.error': 'La sincronización requiere atención',
  'sync.phone.held': 'Sincronización: eliminaciones retenidas',
  'sync.phone.conflicts': {
    one: 'Sincronización: {count} copia en conflicto',
    many: 'Sincronización: {count} copias en conflicto',
    other: 'Sincronización: {count} copias en conflicto',
  },
  'sync.phone.review': 'Sincronización: {count} en espera de tu decisión',
  'sync.window.progress': '{completed} de {total}',
  'sync.window.notSent': 'No enviado',
  'sync.window.conflicts': 'Copias en conflicto',
  'sync.window.conflictsDesc':
    'Se conservan ambas versiones. Abre la copia, toma lo que necesites y luego elimínala.',
  'sync.window.openCopy': 'Abrir la copia en conflicto',
  'sync.window.waiting': 'En espera de tu decisión',
  'sync.window.trusted': 'De confianza',
  'sync.window.trustedDesc':
    'Instala automáticamente el código recibido y comparte archivos privados vinculados sin preguntar en este dispositivo.',
  'sync.window.recent': 'Reciente',
  'sync.window.recentDesc':
    'Aquí se guarda la actividad reciente de esta sesión. Abre los ajustes de sincronización desde la paleta de comandos para ver el diagnóstico.',
  'sync.window.disconnect': 'Desconectar…',
  'sync.window.disconnectTip': 'Detener esta conexión; los archivos permanecen en este dispositivo',
  'sync.window.close': 'Cerrar',
  'sync.window.closeTip': 'Cerrar esta ventana',
  'sync.window.share': 'Compartir…',
  'sync.window.shareTip':
    'Compartir una carpeta o un grupo con alguien, o conectar otro dispositivo tuyo',
  'sync.window.error': 'La acción no pudo completarse. Se han conservado los cambios pendientes.',
  'sync.status.disconnected': 'Sin conexión',
  'sync.status.joining': 'Conectando',
  'sync.status.idle': 'Todo sincronizado',
  'sync.status.syncing': 'Sincronizando',
  'sync.status.paused': 'En pausa',
  'sync.status.offline': 'Sin red',
  'sync.status.error': 'Error de sincronización',
  'sync.status.held': 'Eliminaciones retenidas',
  'sync.status.review': 'Por revisar',
  'sync.status.waiting': 'En espera',
  'sync.status.conflicts': {
    one: '{count} conflicto',
    many: '{count} conflictos',
    other: '{count} conflictos',
  },
  'sync.status.heldLine': {
    one: 'La eliminación de {count} archivo en este dispositivo no se ha enviado a los demás porque se eliminaron demasiados a la vez. Decide en la pestaña Sincronización si se eliminan en todas partes o se restauran.',
    many: 'La eliminación de {count} archivos en este dispositivo no se ha enviado a los demás porque se eliminaron demasiados a la vez. Decide en la pestaña Sincronización si se eliminan en todas partes o se restauran.',
    other:
      'La eliminación de {count} archivos en este dispositivo no se ha enviado a los demás porque se eliminaron demasiados a la vez. Decide en la pestaña Sincronización si se eliminan en todas partes o se restauran.',
  },
  'sync.status.stagedLine':
    'Ajustes en espera ({count}) — aplícalos y recarga en la pestaña Sincronización.',
  'sync.status.changesAre': {
    one: '{count} cambio está',
    many: '{count} cambios están',
    other: '{count} cambios están',
  },
  'sync.status.title': 'Abele Sync: {status}',
  'sync.status.found': {
    one: '{count} cambio encontrado para enviar',
    many: '{count} cambios encontrados para enviar',
    other: '{count} cambios encontrados para enviar',
  },
  'sync.status.unsent': {
    one: '{count} cambio está esperando para enviarse',
    many: '{count} cambios están esperando para enviarse',
    other: '{count} cambios están esperando para enviarse',
  },
  'sync.status.copies': {
    one: 'Se guardó {count} copia en conflicto junto al original. Ábrelas en la pestaña Sincronización.',
    many: 'Se guardaron {count} copias en conflicto junto al original. Ábrelas en la pestaña Sincronización.',
    other:
      'Se guardaron {count} copias en conflicto junto al original. Ábrelas en la pestaña Sincronización.',
  },
  'sync.status.decision': '{count} en espera de tu decisión en la pestaña Sincronización.',
  'sync.status.connecting': 'Conectando al servidor de sincronización.',
  'sync.status.last': 'Última sincronización: {when}',
  'sync.when.never': 'nunca',
  'sync.held.title': 'Eliminaciones retenidas',
  'sync.held.later': 'Decidir después',
  'sync.held.laterTip':
    'Cerrar; los archivos siguen retenidos y la pregunta permanece en la pestaña Sincronización',
  'sync.arrived.title': 'Ajustes modificados en otro dispositivo',
  'sync.arrived.later': 'Después',
  'sync.arrived.laterTip': 'Cerrar; los ajustes siguen esperando en la pestaña Sincronización',
  'sync.qr.title': 'Leer un código QR',
  'sync.qr.description': 'Haz una foto con el teléfono o elige una imagen del código.',
  'sync.qr.read': 'Leer QR…',
  'sync.qr.readTip': 'Usar la cámara o elegir una imagen QR',
  'sync.qr.missing':
    'No se encontró ningún token de conexión. Acerca la cámara para que el código ocupe casi toda la imagen o pega el token.',
  'sync.qr.error': 'No se pudo leer la imagen. Prueba con otra o pega el token.',
} as const
