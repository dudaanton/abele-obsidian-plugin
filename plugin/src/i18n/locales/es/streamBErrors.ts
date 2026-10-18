export const streamBErrors = {
  'streamBError.diffLineBudget':
    'Esta comparación supera el límite de líneas. Abre cada lado por separado.',
  'streamBError.diffDistinctLines':
    'Hay demasiadas líneas distintas para compararlas con seguridad. Abre cada lado por separado.',
  'streamBError.2858c527cf': 'No se envió ningún token: {v0}',
  'streamBError.6e74ee0eb3': 'GitHub no aceptó el token al solicitar {v0}.',
  'streamBError.69e3e92a4b': 'GitHub requiere un token para mostrar {v0}.',
  'streamBError.d10c3511be':
    'Puede estar mal escrito, caducado o revocado. Configura uno nuevo en los ajustes de Abele → GitHub.',
  'streamBError.1de332c345': 'Añade uno en los ajustes de Abele → GitHub.',
  'streamBError.bc5d838c06': 'Se agotó el límite de solicitudes de GitHub para este token.',
  'streamBError.27106edf75':
    'Se agotó el límite de GitHub para solicitudes sin token (60 por hora).',
  'streamBError.3d90b66898': 'Se restablece a las {v0}.',
  'streamBError.0af4d24f00': '{v0}Un token lo aumenta a 5000.',
  'streamBError.9bbd87f900':
    'Esta organización usa inicio de sesión único y el token no está autorizado para ello.',
  'streamBError.85596cf701': 'Autorízalo aquí: {v0}',
  'streamBError.98f3a2fad0':
    'Autorízalo en GitHub: Settings → Personal access tokens → el token → Configure SSO.',
  'streamBError.525a59abdd':
    '{v0} solo acepta solicitudes de sus direcciones IP permitidas, y la de este dispositivo no está en la lista. El token es válido.',
  'streamBError.cc22835989':
    'Conéctate mediante la red de oficina o VPN permitida por la organización, o pide a un propietario que añada esta dirección. El mismo token sigue funcionando desde un equipo incluido en la lista, por eso puede funcionar en otro lugar y aquí no.',
  'streamBError.8a4e28441e':
    '{v0} rechaza los tokens de permisos específicos con una duración superior a la permitida{v1}.',
  'streamBError.deabf54f35':
    'Acorta la caducidad del token en GitHub — el mensaje de GitHub de abajo incluye el enlace — o crea otro con menor duración.',
  'streamBError.23ae822430': '{v0} no acepta tokens de acceso personal con permisos específicos.',
  'streamBError.867dbd63be':
    'Solo un propietario de la organización puede cambiarlo (ajustes de la organización → Personal access tokens). Hasta entonces no se pueden leer sus repositorios con este tipo de token.',
  'streamBError.cb67a9c5e8': '{v0} no acepta tokens de acceso personal clásicos.',
  'streamBError.4d980c1a74':
    'Crea un token de permisos específicos con la organización como Resource owner.',
  'streamBError.6c498d7d3c':
    '{v0} restringe qué aplicaciones pueden leer sus datos, y este token está sujeto a ello.',
  'streamBError.c81e0c8baa':
    'Usa un token de permisos específicos con la organización como Resource owner, o pide a un propietario que permita el acceso.',
  'streamBError.9909829c59': 'GitHub denegó a este token el acceso a {v0}.',
  'streamBError.e6f3c80ade':
    'Un token de permisos específicos se rechaza así si carece del permiso, si el repositorio no está entre los autorizados o si su Resource owner es tu cuenta en vez de la organización: solo accede a los repositorios del único propietario elegido al crearlo. Si aún espera la aprobación de un propietario de la organización, solo lee datos públicos.',
  'streamBError.e048ee47d3': 'GitHub denegó el acceso a {v0}.',
  'streamBError.33dca72ade': 'El repositorio está vacío: aún no tiene archivos.',
  'streamBError.67711ed6a1': 'GitHub no encontró nada para {v0}.',
  'streamBError.690d176ada':
    'Puede que no exista o que el token no lo vea: para un repositorio privado sin acceso GitHub responde “no encontrado” en vez de “prohibido”. Comprueba que el repositorio esté seleccionado en el token, que su Resource owner sea la organización propietaria (un token de tu cuenta no ve los repositorios privados de una organización) y que, si se requiere, un propietario haya aprobado el token.',
  'streamBError.8dc365ec07':
    'Si el repositorio es privado, añade un token en los ajustes de Abele → GitHub.',
  'streamBError.6c1e1f640d': 'GitHub respondió {v0} al solicitar {v1}.',
  'streamBError.f6a1bafa2b': 'La organización',
  'streamBError.679b703e6c': 'La organización {v0}',
  'streamBError.d860f8f34f': ' ({v0} días)',
  'streamBError.65aab2aa1d': 'Requiere: {v0}',
  'streamBError.5247198e11': 'GitHub dijo: «{v0}»',
  'streamBError.e3ee915a8e': ' y ',
  'streamBError.e1a3e78cb5': ' o ',
  'streamBError.22b988efd0': 'No hay un proveedor con modelos configurado',
  'streamBError.a07cc0a057': 'No hay un agente configurado',
  'streamBError.f731db85bb': 'Introduce un commit, una rama o una etiqueta.',
  'streamBError.7b457d7047': 'GitHub no resolvió esa referencia a un SHA de commit.',
  'streamBError.dfd5e00f0d': 'El origen no resolvió esa referencia a un SHA de commit.',
  'streamBError.fe0a3cb7dd': 'Comparación cancelada',
  'streamBError.9171ce437b': 'GitHub no resolvió el destino a un SHA de commit.',
  'streamBError.0929738b5b': 'El archivo no existe en ninguno de los extremos de la comparación.',
  'streamBError.46fc41c9da': 'No existe ese archivo o referencia.',
  'streamBError.082cf53674': 'GitHub no envió la identidad del contenido.',
  'streamBError.dfd0b68e6f':
    'GitHub no proporcionó contenido compatible. La API puede limitar este archivo; abre cualquiera de los lados en GitHub.',
  'streamBError.b2ceed2130':
    'Este archivo supera el límite de memoria para comparar. Abre cada lado por separado.',
  'streamBError.4f737e4ab7': 'No se encontró el archivo en el árbol de comparación.',
  'streamBError.4e7bc5e16d':
    'Cambió el commit del submódulo. No se sigue ningún repositorio automáticamente.',
  'streamBError.4d89c4f1ef':
    'El tamaño del archivo es desconocido o supera el límite de memoria para comparar. Abre cada lado por separado.',
  'streamBError.61af9130fa':
    'Archivo grande: carga su texto explícitamente o abre cada lado por separado.',
  'streamBError.02c437689c':
    'Archivo binario o codificación no compatible. Los recuentos de texto no están disponibles (—).',
  'streamBError.71722fe4dc':
    'Muchas líneas: carga las diferencias explícitamente o abre cada lado por separado.',
  'streamBError.cb3497631d':
    'Los finales de línea difieren entre la base y el destino (CRLF / LF).',
  'streamBError.f1497cb1f1': 'Solo texto del puntero Git LFS. No se descarga el contenido.',
  'streamBError.ed3d83967c': 'Solo texto del enlace simbólico. No se sigue el enlace.',
  'streamBError.a97a5c3772': 'Esta parte no está guardada para usar sin conexión. {v0}',
  'streamBError.0e5771af81': 'Selecciona una ubicación concreta del repositorio.',
  'streamBError.74656128ba':
    'No se pudieron listar todos los commits de la solicitud de incorporación. Abre el servicio para leer el resto.',
  'streamBError.d4470c2927': 'No se encontró la discusión.',
  'streamBError.bcb47435bb':
    'GitHub no proporcionó el listado completo del repositorio: es demasiado grande para descargarlo para una búsqueda.',
  'streamBError.52ab21f79c':
    'El repositorio ocupa {v0} en este commit, más que el límite de {v1} definido en los ajustes de Abele → GitHub.',
  'streamBError.908ff82a4d': 'Se restableció la búsqueda de código de GitHub',
  'streamBError.d353a99eb4': 'Cancelado',
  'streamBError.6151f41d37':
    'La búsqueda de código de GitHub necesita un token. Añádelo en Ajustes de Abele → GitHub.',
  'streamBError.fc0bde16c0': 'GitHub no indicó ningún árbol para {v0}.',
  'streamBError.cae3891ed5':
    'GitHub no envió un árbol completo para {v0}. Reintenta cuando esté disponible.',
  'streamBError.6ab83b4090': 'GitHub no envió el árbol del repositorio.',
  'streamBError.61746dfc8f': 'GitHub no envió un árbol completo del nivel superior.',
  'streamBError.9ae33c33a2':
    'Los archivos actuales cambiaron durante la comparación. Reintenta para compararlos de nuevo.',
  'streamBError.a890b77334':
    'Este repositorio del nodo ya no está disponible. Vuelve a conectar o elige un espacio de trabajo.',
  'streamBError.1d3298ac1d':
    'La autorización del repositorio cambió durante la lectura. Actualiza explícitamente.',
  'streamBError.b46591df0d':
    'Los datos del árbol de trabajo caducaron. Actualiza para ver los archivos actuales.',
  'streamBError.1a2309dd33': 'Esta revisión del repositorio caducó. Actualiza explícitamente.',
  'streamBError.b930e16c73':
    'Esta lista del repositorio supera el límite de la vista. Acota la ruta o la búsqueda.',
  'streamBError.df8a5b2002': 'El nodo no pudo devolver una lista completa.',
  'streamBError.7de42eef4a': 'No se conoce la rama predeterminada. Elige una rama para comparar.',
  'streamBError.696ab2ea7b': 'Este espacio de trabajo no existe o no está disponible. Elige otro.',
  'streamBError.888e010715':
    'Este archivo conservado es demasiado grande para mostrarlo automáticamente.',
  'streamBError.6018e8db9e': 'Archivo binario · sin vista previa de texto.',
  'streamBError.96018da9a1': 'Este archivo es demasiado grande para mostrarlo automáticamente.',
  'streamBError.88e5c20cd0':
    'Este commit raíz supera el límite de archivos modificados. Explora su árbol.',
  'streamBError.b0f4afdb21': 'Este archivo supera el límite de líneas de diferencias.',
  'streamBError.d2999e7b21': 'No hay diferencias de texto disponibles para este archivo.',
  'streamBError.b2d5677c39': 'Los archivos pueden cambiar mientras los ves. Actualiza los datos.',
  'streamBError.f3d48d14b9': 'Cambios desde el ancestro común.',
  'streamBError.9da9b97d87': 'Archivo binario o grande · abre cada lado por separado.',
  'streamBError.cace6bbbbf':
    'el token está configurado para {v0} (ajuste Servidor), y esto está en {v1}.',
  'streamBError.ad2081e8e0':
    'hay un token configurado, pero no está en el llavero de este dispositivo. Pégalo de nuevo en Ajustes de Abele → GitHub o, si las claves se sincronizan, desbloquéalas en Ajustes de Abele → Transferencia → Claves sincronizadas.',
  'streamBError.bb2a67e714':
    '«{v0}» no es un repositorio. Indica propietario/nombre o un enlace al repositorio.',
  'streamBError.9cfa0264aa':
    '{v0} no es github.com ni el servidor indicado arriba, por lo que no se puede leer aquí.',
  'streamBError.a51346d01d': 'También se solicitó mediante GraphQL, y se rechazó: «{v0}»',
  'streamBError.2eac8a11cd': 'También se solicitó mediante GraphQL: {v0}',
  'streamBError.6b52eb9983':
    'El mismo token leyó el elemento. No falta un permiso en el token: el servidor rechaza esta solicitud concreta. El resto se muestra; abre esta parte en GitHub.',
  'streamBError.2528c26585':
    'El mismo token leyó el elemento, que requiere {v0} (lectura), uno de los permisos que acepta esta solicitud. No falta un permiso en el token: el servidor rechaza esta solicitud concreta. El resto se muestra; abre esta parte en GitHub.',
  'streamBError.1209bb12ff': 'No disponible para este servicio en esta versión.',
  'streamBError.d4d581aba2': 'El servicio no devolvió un commit inmutable.',
  'streamBError.f1fe763173': 'Esta ruta es un archivo.',
  'streamBError.b305654ab9': 'Esta ruta es una carpeta.',
  'streamBError.2f27e1a646': 'El servicio no devolvió un árbol raíz completo.',
  'streamBError.dae9ef12db': 'El servicio no devolvió la identidad del árbol de la carpeta.',
  'streamBError.f308135e99': 'El servicio no devolvió un árbol de carpeta completo.',
  'streamBError.cd278c1617': 'Este destino pertenece a otro repositorio o servidor.',
  'streamBError.43d93bea97': 'No se encontró esta referencia en el servicio.',
  'streamBError.0495ef01d3': 'Servidor Forgejo no válido.',
  'streamBError.b51a173612': 'Ruta de API de Forgejo no válida.',
  'streamBError.0f69117eda': 'Las credenciales no pueden aparecer en una URL de API.',
  'streamBError.de772eddd4': 'No se pudo conectar con el servicio Forgejo.',
  'streamBError.9759c8d4b7':
    'Forgejo redirigió la solicitud; comprueba la dirección del servidor configurada.',
  'streamBError.8988c7148a': 'Forgejo devolvió una respuesta ilegible.',
  'streamBError.5f32006dc8': 'Límite de paginación de Forgejo no válido.',
  'streamBError.31f4a37ff9': 'Respuesta de página de Forgejo no válida.',
  'streamBError.1ea731dddc': 'Dirección base del servicio git no válida.',
  'streamBError.5e61d71bfc': 'Ruta del servicio git no válida.',
  'streamBError.8e9468f2f5': 'El repositorio pertenece a otro servidor.',
  'streamBError.ee5b3b4622': 'Ruta de repositorio de GitHub no válida.',
  'streamBError.3aef34f6c5':
    'No hay un contrato de esquema verificado para esta versión del proveedor.',
  'streamBError.48c142c51b': 'La conexión de Forgejo se eliminó o cambió.',
  'streamBError.7351aeb8ca': 'La conexión de Forgejo se eliminó o cambió; recarga esta pestaña.',
  'streamBError.233dcaa94f':
    'El token de conexión no está disponible en este dispositivo; desbloquea las claves sincronizadas o añade el token.',
  'streamBError.b83e5c8317': 'Segmento de ruta de Forgejo no válido.',
  'streamBError.8016408637': 'Repositorio de Forgejo no válido.',
  'streamBError.43ad51d8f0': 'Forgejo rechazó la solicitud ({v0}).',
  'streamBError.399ef88060': 'Hay más resultados en este servicio.',
  'streamBError.01fa8fb2a8': 'Esta entrada es un enlace, no un archivo normal.',
  'streamBError.af130c9cfc': 'Este archivo es demasiado grande para mostrarlo.',
  'streamBError.fe05b9bbe4': 'El servicio no devolvió el contenido del archivo.',
  'streamBError.9ff28c9fad': 'Archivo binario.',
  'streamBError.329a3b9f4a': 'Archivo binario o con codificación distinta de UTF-8.',
  'streamBError.1e226ce2d8': 'No se pudo comprobar la cuenta.',
  'streamBError.90fa9dca4e': 'La comprobación de acceso falló.',
  'streamBError.ec18ec18e8':
    'Usa un token con acceso de lectura para esta operación y repositorio.',
  'streamBError.596c52f1eb': 'Error de conexión',
  'streamBError.78b93810bf': 'No se pudo leer la carpeta',
  'streamBError.6097572d7b': 'No se pudo cargar el nodo',
  'streamBError.2bf254e296': 'No se pudo leer el archivo',
  'streamBError.c4dfa2b119': 'No se pudo cargar el historial',
  'streamBError.a11a2d3c13': 'No se pudo cargar el commit',
  'streamBError.dd4481bfbe': 'La expresión regular no es válida: {v0}',
  'streamBError.921180cd63':
    'Este servicio devuelve un resumen del archivo sin diferencias de texto.',
  'streamBError.3dd6c9269c': 'El servicio no proporcionó diferencias de texto para este archivo.',
  'streamBError.edafd9ed12':
    'GitHub rechazó las diferencias para este token. La lista de archivos se obtuvo mediante la API GraphQL, que no incluye diferencias; abre la solicitud de incorporación en GitHub para leerlas.',
  'streamBError.591f69a90b':
    'GitHub rechazó la comparación para este token. Los commits se obtuvieron mediante la API GraphQL, que no incluye los archivos modificados; abre la comparación en GitHub para leerlos.',
  'streamBError.c169cf0a0c':
    'La API de GitHub compara desde donde se separaron las ramas, así que se muestran los cambios desde entonces, no las dos versiones en paralelo que piden los dos puntos del enlace. Ábrelo en GitHub para verlas.',
  'streamBError.fa96a837ce': 'Se cerró la nueva pestaña del chat.',
  'streamBError.93215f7df9': 'Se canceló la copia del chat.',
  'streamBError.2f113794db':
    'La transcripción delegada no está disponible. Vuelve a abrir el chat de origen e inténtalo de nuevo.',
  'streamBError.8f777786c2': 'No se pudo guardar la transcripción delegada.',
  'streamBError.f327a9464f': 'No se pudo guardar el nuevo chat.',
  'streamBError.2e42fe1f95': 'La presentación contextual requiere una intención admitida.',
  'streamBError.d132590f46': 'No se pudo guardar la confirmación. Inténtalo de nuevo.',
  'streamBError.e4184853d0': 'Cambió el propietario de la operación ZIP',
  'streamBError.960fe81dfd': 'Las operaciones de escritura ZIP requieren aprobación',
  'streamBError.cf2e4ddaac': 'El límite de la rama cambió antes de continuar',
  'streamBError.55409a75b4': 'No se pudo guardar el permiso. La operación no se inició.',
  'streamBError.854a5410e5': 'Este chat está trabajando. Espera a que termine su turno.',
  'streamBError.3865c0186d': 'La respuesta ya no está disponible.',
  'streamBError.c85c1160fb':
    'Este chat cambió en otro lugar. Vuelve a abrirlo antes de hacer cambios.',
  'streamBError.c5908dd3f8': 'Esta respuesta se está modificando. Inténtalo cuando termine.',
  'streamBError.8d825ed127': 'Solo se pueden resaltar respuestas guardadas del modelo.',
  'streamBError.e6d5371478': 'Cambió la revisión de la selección. Selecciona el pasaje de nuevo.',
  'streamBError.9ed6e7f6a7': 'La identidad del anclaje debe ser única en el chat.',
  'streamBError.392bcbe1e7': 'La conversación capturada cambió.',
  'streamBError.a2091f71aa': 'Este mensaje se está modificando. Inténtalo cuando termine.',
  'streamBError.0d2f0c2bed':
    'Solo los mensajes guardados del chat pueden tener anclajes de selección.',
  'streamBError.36e8bead5c':
    'Solo los mensajes guardados del usuario o del modelo pueden tener anclajes de selección.',
  'streamBError.eda0e6622d': 'La conversación capturada cambió. Vuelve a abrirla antes de enlazar.',
  'streamBError.c93dfca065': 'Guarda el chat principal antes de aprobar la delegación al nodo',
  'streamBError.132388cd4d': 'La conversación principal cambió',
  'streamBError.7d35f0db1e':
    'El resultado de publicar un enlace es incierto. Vuelve a abrir el chat para revisar el origen guardado antes de escribir.',
  'streamBError.e0774494e5': 'Primero selecciona palabras en una respuesta del modelo.',
  'streamBError.5d1f47524d': 'Elige un color de resaltado.',
  'streamBError.218b14f26c': 'El resaltado ya no está disponible.',
  'streamBError.9b77d73c1b': 'Espera a que este chat termine su turno.',
  'streamBError.9390b6928f':
    'Esta propuesta se aceptó. Termina de aplicarla y luego usa Deshacer en la respuesta principal.',
  'streamBError.879f176aec': 'Esta propuesta ya no está pendiente.',
  'streamBError.dee0fd6565':
    'Este chat aún tiene cambios sin guardar. Intenta guardarlos de nuevo antes de cerrarlo.',
  'streamBError.80d27f4757': 'No se puede confirmar la ampliación mientras cambia la conversación.',
  'streamBError.97188092c4': 'La discusión guardada no está disponible o cambió de identidad.',
  'streamBError.ab47750c92': 'La discusión cambió al confirmar la ampliación.',
  'streamBError.cfe8f23fc1':
    'El trabajo local cambió. Confirma la conversación guardada antes de reintentar la ampliación.',
  'streamBError.92f4905c24': 'El origen de la selección ya no está abierto.',
  'streamBError.0bda7be5eb': 'Este chat cambió al volver. Abre el enlace de nuevo.',
  'streamBError.4d4b0467c4':
    'Este chat cambió en otro lugar. Termina o guarda el trabajo local antes de volver a la selección.',
  'streamBError.963ca9ee5b': 'No se pudo cargar la nueva discusión.',
  'streamBError.73cf5550f9': 'No se pudo resolver la identidad de la discusión para este archivo.',
  'streamBError.1fa876b018': 'Se abrió el comentario. Vuelve a intentar cambiar el nombre.',
  'streamBError.774edb1289': 'El chat principal no está disponible.',
  'streamBError.d7e135b1f7': 'La respuesta principal no está disponible.',
  'streamBError.7190d9a20e':
    'El pasaje seleccionado no está disponible. Inicia un comentario nuevo.',
  'streamBError.e5ad2cbf8c': 'Se abrió el chat principal. Revisa la propuesta de nuevo.',
  'streamBError.8d7c0dc93d': 'Este plan de deshacer ya no pertenece al chat; vuelve a abrirlo',
  'streamBError.81d9f5765b': 'No se completó la conexión autenticada con el nodo.',
  'streamBError.ce4159a6ef':
    'No hay diferencias de texto para este archivo (binario, vacío, renombrado o truncado).',
  'streamBError.cdc8d9cfa0':
    'La conexión de GitHub cambió; reintenta con las credenciales actuales.',
  'streamBError.2ea0bf550b':
    'Las solicitudes de GitHub están pausadas hasta {v0}. Reintenta entonces.',
  'streamBError.0eb5b3ed5a': 'El destino de la solicitud de GitHub no está permitido.',
  'streamBError.1c867e3040': 'No se pudo conectar con {v0}.',
  'streamBError.6a1efa8857': 'GitHub redirigió esta solicitud; no se repitió.',
  'streamBError.c2ad5cd823': 'GitHub devolvió una redirección no válida.',
  'streamBError.6523b94909': 'GitHub redirigió a un destino inseguro.',
  'streamBError.dae8766b06': 'GitHub envió {v0} sin su contenido.',
  'streamBError.a0ebbf6573': 'URL de imagen no válida.',
  'streamBError.04b71aa0cc': 'GitHub envió {v0} donde se esperaba una imagen.',
  'streamBError.147dd984fc':
    'GitHub requiere una solicitud autenticada para leer {v0} mediante GraphQL. Añade un token en Ajustes de Abele → GitHub.{v1}',
  'streamBError.c7437fbf46': 'GitHub devolvió una respuesta vacía.',
  'streamBError.c2583399b1': 'La conexión de GitHub se eliminó o es desconocida.',
  'streamBError.8e264bfe49': 'Este proveedor no está disponible en el adaptador de GitHub.',
  'streamBError.74e2c88c85': 'No se pudo leer esta imagen',
  'streamBError.fbba4c81db': 'La decodificación de imágenes no está disponible en este dispositivo',
  'streamBError.35732e49c9': 'No se encontró una invitación de nodo en esta imagen',
  'streamBError.f5b8b2ba78': 'No se pudo leer la conversación de este servicio.',
  'streamBError.9acce75256':
    'No se pudieron leer las revisiones de la solicitud de incorporación de este servicio.',
  'streamBError.545311af41': 'Error de transmisión desconocido',
  'streamBError.0f56130f3d': 'Se produjo un error desconocido',
  'streamBError.338214ff83': 'El agente «{v0}» no tiene un modelo utilizable configurado',
  'streamBError.cbbb077a00': 'Este destino ya no está disponible. Actualice su carpeta.',
  'streamBError.d15771e911': 'Las acciones de Git requieren actualizar el nodo.',
  'streamBError.54a4d809c8': 'Actualice primero la carpeta.',
  'streamBError.607e975b14': 'Otra acción de Git sigue en curso.',
  'streamBError.97797a06f1': 'Aquí no hay ningún commit desde el que crear una rama.',
  'streamBError.890a0701f9': 'Las solicitudes de incorporación requieren actualizar el nodo.',
  'streamBError.8a0e599716': 'Este destino pertenece a otro registro de nodo.',
  'streamBError.e1b43e1573':
    'Los archivos de este destino no se conservaron. Vuelva a conectarse para cargarlos.',
  'streamBError.b4836687ce':
    'Vuelva a conectarse para cargar las entradas no conservadas de esta carpeta.',
  'streamBError.29f751894a': 'Actualice la carpeta antes de continuar su listado caducado.',
  'streamBError.fd3e95b2aa': 'La paginación del nodo no avanzó',
  'streamBError.d6473017d0':
    'Este archivo no se conserva en este dispositivo. Vuelva a conectarse para abrirlo.',
  'streamBError.cf3ad06448':
    'Sin conexión · versión conservada. Vuelva a conectarse para obtener el contenido actual.',
  'streamBError.4566a5a6f4': 'La respuesta del archivo pertenece a otro destino.',
  'streamBError.91f21e6d95': 'El nodo no indica a qué remoto se envía esta rama.',
  'streamBError.474dc449ab':
    'Una solicitud de incorporación necesita una rama, no un commit separado.',
  'streamBError.9ca0d465a5':
    'Los tiempos de cambio y la divergencia de ramas requieren actualizar el nodo.',
  'streamBError.d4a2fc884b': 'El estado de la rama requiere actualizar el nodo.',
  'streamBError.6714d255c9':
    'Esta carpeta supera el límite de 10 000 entradas del árbol. Use el explorador del repositorio con paginación.',
  'streamBError.b98a7f8f5f': 'La vista previa de imágenes está limitada a 4 MiB.',
  'streamBError.9bc23eb575': 'La comparación de archivos actuales requiere una observación.',
  'streamBError.aecd43ae62':
    'La comparación de árboles de trabajo sin commits requiere actualizar el nodo.',
  'streamBError.8647963b04': 'No hay comparación de texto disponible para este archivo.',
  'streamBError.23d06ee9cc':
    'Este archivo no se puede previsualizar en la vista de texto limitada.',
  'streamBError.6e57d7786b':
    'Resuelva el conflicto en el editor de código o el explorador del repositorio; una sola comparación omitiría un lado.',
  'streamBError.a3b91e1549':
    'La vista previa de una imagen preparada requiere leer el objeto del índice Git, algo que esta conexión no admite.',
  'streamBError.d822bad866': 'Una carpeta normal no tiene historial de Git.',
  'streamBError.aa6abd6309': 'Este parche no contiene bloques de texto dentro del límite.',
  'streamBError.0e5dd7f8f9':
    'El parche conservado no coincide con este archivo. Actualice para obtener una nueva comparación.',
  'streamBError.ac7deb53ca': 'El contenido del nodo no es válido o es demasiado grande',
  'streamBError.3e93167395': 'Contenido del nodo incompleto',
  'streamBError.61353475a2': 'Este archivo no se puede editar en el editor de texto limitado',
  'streamBError.99ca5e24c2':
    'El editor admite archivos UTF-8 existentes de hasta 32768 caracteres, fuera de los metadatos de Git',
  'streamBError.83795aa299':
    'El borrador local supera el límite de contenido conservado; cópielo antes de cerrar',
  'streamBError.164ef4c4d9':
    'Este guardado está sin resolver; compruebe su resultado original antes de editar',
  'streamBError.bcc3e13a88': 'Vuelva a conectarse antes de guardar; se conserva su borrador local.',
  'streamBError.26e0c3b094':
    'Revise la versión actual y selecciónela explícitamente como base antes de volver a guardar',
  'streamBError.a5f9367699':
    'El borrador supera el límite de guardado UTF-8 de 32768 caracteres o contiene texto no admitido. Se conserva su borrador local.',
  'streamBError.6077692b27': 'La identidad del recibo de guardado del archivo no es válida',
  'streamBError.67ccffde77':
    'Este guardado está sin resolver; no se puede cambiar su condición previa',
  'streamBError.3d90fa2b83':
    'Este guardado está sin resolver; conserve su borrador y sus evidencias',
  'streamBError.dfd2326f20': 'Este archivo no se puede editar',
  'streamBError.04e25ee78d': 'Este guardado está sin resolver',
  'streamBError.94302699b3':
    'No se pudo almacenar el borrador local. Mantenga esta ventana abierta y copie su texto antes de cerrarla.',
  'streamBError.e61aa4bddc': 'La vista del archivo cambió antes de admitir el guardado',
  'streamBError.3d0331c807': 'La vista del archivo cambió antes de conciliar el borrador',
  'streamBError.896b98b01e': 'No hay ningún borrador local que conservar',
  'streamBError.17dd70d322': 'invalid_anchor: seleccione un máximo de 200 líneas por comentario',
  'streamBError.ad8aa99210': 'Esperando la revisión enviada',
  'streamBError.2d8481c0c6':
    'La revisión supera los límites del nodo: como máximo 32 comentarios, 200 líneas y 2000 caracteres por comentario',
  'streamBError.7a17a125e6': 'Introduzca un comentario',
  'streamBError.3bf18401ad': 'Abra una sesión del espacio de trabajo antes de enviar una revisión',
  'streamBError.535c73617c':
    'El destino del chat no está listo. No se envió nada. Vuelva a abrir la revisión antes de enviarla.',
  'streamBError.d7e2b0292d':
    'La operación de carpeta conservada ha cambiado. Revísela antes de reintentar.',
  'streamBError.a0a1c7d80c':
    'El resultado de la eliminación es desconocido. Vuelva a conectarse y compruebe la eliminación original.',
  'streamBError.fcff0cdbbc': 'Se rechazó la eliminación original: {v0}. Se conserva su recibo.',
  'streamBError.96b7c749ee': 'Este cliente no admite eliminar árboles de trabajo administrados.',
  'streamBError.35eb88371d':
    'El resultado de la eliminación es desconocido. Conserve el destino y compruebe la misma operación antes de reintentar.',
  'streamBError.8d6b5aefb7':
    'El árbol de trabajo ha cambiado. Actualícelo y revíselo antes de eliminarlo.',
  'streamBError.29f8c77828':
    'Falta el registro del nodo. Vuelva a conectarlo desde el panel del nodo.',
  'streamBError.eed78d87c1':
    'El canal local protegido debe usar una dirección de bucle local exacta.',
  'streamBError.5f035cba63': 'El puerto del nodo local no es válido',
  'streamBError.8f82f94ebf': 'El contenido de la imagen no está disponible para la vista previa.',
  'streamBError.576e97984e':
    'El nodo perdió el estado de esta acción de Git. Actualice para comprobar qué ocurrió antes de reintentar.',
  'streamBError.23563064bf': 'Actualice la carpeta antes de descartar los cambios.',
  'streamBError.1248b93aec': 'Aún no hay nada que enviar: la rama no tiene commits.',
  'streamBError.b2c46ecdf3': 'Actualice el nodo para obtener datos del remoto.',
  'streamBError.5e20368923': 'Actualice el nodo para crear una rama aquí.',
  'streamBError.b43838f570': 'No hay ninguna pestaña disponible en la barra lateral izquierda.',
  'streamBError.4ec802bae5': 'Vuelva a conectar este nodo antes de abrir su repositorio.',
  'streamBError.0702fbb835': 'Se esperaba un repositorio del nodo',
  'streamBError.69096135bb':
    'El nodo está sin conexión; vuelva a conectarlo antes de que el agente lea el repositorio.',
  'streamBError.0e3c3b3571': 'La navegación del repositorio no coincide con el origen aprobado.',
  'streamBError.4d299e3ab0':
    'El borrador local cambió en otra vista. Copie el texto visible antes de recargar el borrador compartido.',
  'streamBError.3cdea71657': 'Archivo binario: sin vista previa de texto.',
  'streamBError.9ba095fdb1':
    'Este archivo requiere solicitar una carga mayor en el explorador del repositorio.',
  'streamBError.e12006025a': 'El nodo devolvió un listado incompleto',
  'streamBError.7d3850fd71': 'Historial incompleto',
  'streamBError.f87df21e8e':
    'El chat se ha movido. No se envió nada. Revise el destino actual antes de volver a enviar.',
  'streamBError.573c6d85e4': 'El chat está abierto. Resúmalo desde su sesión.',
  'streamBError.79654b25ba': 'Una ejecución delegada no se puede guardar ni cargar como chat.',
  'streamBError.705ef1d387': 'La bóveda de la discusión cambió durante la búsqueda.',
  'streamBError.3fe6722d6b': 'Debe volver a abrir este chat antes de guardarlo.',
  'streamBError.653067e964': 'La discusión se eliminó durante su preparación.',
  'streamBError.f43a0fbfa4': 'La revisión de la discusión cambió.',
  'streamBError.3fcb34cb40': 'La revisión de la discusión se movió.',
  'streamBError.8bbaf67475':
    'La discusión sigue cambiando. Vuelva a abrirla cuando termine la sincronización.',
  'streamBError.33d4df464a':
    'La identidad de la discusión cambió en otro lugar. Concilie los cambios antes de guardar.',
  'streamBError.0550ea75bd':
    'Esta discusión cambió en otro lugar. Concilie los cambios antes de guardar.',
  'streamBError.bd60b807a8': 'Solo un chat se puede guardar como registro de chat.',
  'streamBError.1117c0caf4': 'Vuelva a abrir este chat antes de guardar su estado de atención.',
  'streamBError.8f516a3c74':
    'La identidad de la discusión cambió al guardar. Concilie los cambios antes de volver a guardar.',
  'streamBError.1af2ceac85': 'El chat no está disponible.',
  'streamBError.9c6ece335c':
    'Esta ejecución cambió en otro lugar. Vuelva a abrirla antes de modificarla.',
  'streamBError.d0994129e6':
    'La revisión de la selección cambió. Vuelva a abrir el chat antes de seleccionar de nuevo.',
  'streamBError.746178d21f': 'Las identidades de revisión y proyección no pueden estar vacías',
  'streamBError.ed46dd4b52':
    'La proyección de la selección cambió. Use un renderizador compatible.',
  'streamBError.c65ee43131': 'La identidad del anclaje debe ser única',
  'streamBError.65a4ef0134':
    'No se puede verificar la ubicación de la anotación en esta revisión del origen.',
  'streamBError.c40ccc6302':
    'La ruta de la tarjeta renombrada no se puede representar de forma segura en un enlace wiki.',
  'streamBError.e894e2a984': 'El destino del enlace asociado no está disponible.',
  'streamBError.53e7279cb6': 'El enlace renombrado cambiaría el texto mostrado.',
  'streamBError.c6c2d4011f':
    'Esta ruta de tarjeta no se puede representar de forma segura como enlace wiki. Se conservó la tarjeta.',
  'streamBError.7cebc26215': 'Seleccione palabras de una sola línea. Se conservó la tarjeta.',
  'streamBError.9d5338e70f':
    'No se pueden enlazar de forma segura palabras en código o en un enlace existente. Se conservó la tarjeta.',
  'streamBError.378c4d115b': 'La revisión de pertenencia del enlace no está disponible.',
  'streamBError.c6b341f583':
    'El origen de la vinculación cambió al renombrar la tarjeta. Vuelva a abrirlo antes de modificarlo.',
  'streamBError.ae22638387': 'No hay ninguna tarjeta en {v0}. No se enlazó nada.',
  'streamBError.c64a25b1e7': 'Esta recuperación de vinculación no está disponible.',
  'streamBError.b4c33a7187':
    'Esta recuperación antigua no contiene una selección capturada. Vuelva a seleccionar el origen.',
  'streamBError.5294b23ea9':
    'La identidad de la conversación falta o está duplicada. Seleccione y vuelva a abrir el origen antes de enlazar.',
  'streamBError.937df32b6e': 'La tarjeta en {v0} no está disponible. No se enlazó nada.',
  'streamBError.1bf6bcdd28': 'El mensaje de origen guardado no está disponible.',
  'streamBError.fbbba2cf78': 'El anclaje de origen persistente no está disponible.',
  'streamBError.265ca86a61': 'Esta selección ya tiene un enlace a una tarjeta.',
  'streamBError.633d52e3cb': 'El renderizador del origen cambió. Vuelva a seleccionar el origen.',
  'streamBError.b82437d2ea':
    'Este enlace no se puede eliminar con su operación inversa registrada.',
  'streamBError.04fe344540': 'El límite de la rama ya no coincide con su continuación',
  'streamBError.fa7d4d15ec': 'El límite de la rama no tiene continuación registrada',
  'streamBError.9fdbe22680':
    'La llamada seleccionada no tiene resultado registrado para este límite de rama',
  'streamBError.c66ba4f778':
    'El resultado seleccionado no coincide con el turno del límite de rama',
  'streamBError.c321617b3f': 'El resultado seleccionado no tiene turno del asistente',
  'streamBError.aba841b1a9': 'El límite de rama del asistente no tiene turno registrado',
  'streamBError.2791c36446':
    'El límite de contexto de una rama debe seguir a un mensaje del asistente o una llamada completada',
  'streamBError.2a38171bba': 'Una llamada anterior al límite de rama no tiene resultado registrado',
  'streamBError.2b71f61299': 'Vuelva a abrir este chat antes de modificarlo.',
  'streamBError.065c492383': 'Este chat cambió en otro lugar. Vuelva a abrirlo antes de guardar.',
  'streamBError.40172d0726': 'El chat está abierto. Actualice sus enlaces desde la sesión.',
  'streamBError.1a2dbbb5a6':
    'La ubicación de una discusión debe ser una ruta relativa a la bóveda.',
  'streamBError.fa179ed984': 'Guarde este chat antes de aprobar su acceso al nodo',
  'streamBError.427b10788e':
    'La aprobación del propietario debe identificar una entrada de acceso configurada y un principal exactos',
  'streamBError.80385f9f65':
    'La aprobación local del propietario para el acceso de este chat al nodo falta, cambió o fue revocada',
  'streamBError.f853b4f079':
    'La selección cruza el formato Markdown. Seleccione un pasaje dentro de un solo tramo de texto.',
  'streamBError.bafdbeb11b':
    'El pasaje seleccionado es ambiguo. Seleccione más palabras alrededor e inicie un comentario nuevo.',
  'streamBError.eb171d94e0': 'La respuesta del modelo no está disponible.',
  'streamBError.9647637c1d':
    'La respuesta cambió. Solicite una propuesta nueva; no se modificó nada.',
  'streamBError.fa49b0d63c': 'El pasaje seleccionado ya no coincide.',
  'streamBError.fcaee3188e': 'Esta revisión ya no se puede deshacer.',
  'streamBError.b5535ff74d':
    'No se puede garantizar que deshacer esta corrección conserve los enlaces a tarjetas. Elimínelos o resuélvalos primero; no se modificó nada.',
  'streamBError.80abc63be7': 'Cambió desde la instantánea de deshacer: se dejó intacto',
  'streamBError.4306093b59': 'La carpeta contiene otros elementos: se dejó intacta',
  'streamBError.6afac342ef': 'Este almacenamiento no permite deshacer con comprobación de revisión',
  'streamBError.5712d96570':
    'Cambió desde la instantánea de deshacer en {v0}: se rechazó este paso de restauración',
  'streamBError.fe09e1fe71': 'La copia conservada ya no existe',
  'streamBError.39ea7818db': 'No está vacío: se conservó',
  'streamBError.c151463743': 'No se puede deshacer con comprobación de revisión',
  'streamBError.f23e7f24df': 'No hay ninguna copia conservada que restaurar en {v0}',
  'streamBError.a58f1e0c12':
    'No hay clave API para la transcripción. Añada una clave de OpenRouter en los ajustes de voz.',
  'streamBError.7fce93039c': 'Error de transcripción ({v0})',
  'streamBError.b1d3226846': 'No se pudo comprobar la conversación',
  'streamBError.b33ee5dc76': 'Una comparación necesita una versión base y una final.',
  'streamBError.d9d8914a5e': 'No se pudieron calcular las diferencias.',
  'streamBError.c96140e89e':
    'No se pudo iniciar el cálculo de diferencias. Abra cada lado por separado.',
  'streamBError.8bd81bdfdd': 'No se cargaron los archivos de la solicitud de incorporación.',
  'streamBError.72bcafd83f': 'La ubicación del repositorio del nodo no es válida',
  'streamBError.19af983be6': 'No se pudo conectar el nodo',
  'streamBError.64d6fbbc80':
    'Un flujo guardado del nodo ya no está autorizado; aún se pueden abrir las transcripciones secundarias conservadas.',
  'streamBError.5c9cd52ff0': 'El emparejamiento remoto requiere Web Locks en este dispositivo',
  'streamBError.6982c7def2': 'La clave no extraíble del dispositivo no es válida',
  'streamBError.d88eacf052': 'La selección capturada cambió. Vuelva a seleccionar el pasaje.',
  'streamBError.925bf88df9': 'La selección mostrada cambió. Vuelva a seleccionar el pasaje.',
  'streamBError.74479aa0dc': 'La discusión tiene ubicación, pero no identidad.',
  'streamBError.3603052616':
    'La discusión antigua es ambigua. Resuelva explícitamente su identidad antes de abrirla.',
  'streamBError.a32bd46d12':
    'Los propietarios de la discusión entran en conflicto. Resuelva los archivos explícitamente.',
  'streamBError.7281f22f0a':
    'Esta grabación antigua no tiene un chat propietario. Su contenido puede pertenecer a otro autor; el archivo se deja intacto.',
} as const
