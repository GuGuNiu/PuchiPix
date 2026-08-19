import type { TranslationDict } from "../../types";

// Mensajes de error de API — Español
const esES: TranslationDict = {
  // Validación de configuración de tareas
  "api.validation.maxConcurrentTasks": "El máximo de tareas simultáneas debe estar entre 1 y 50",
  "api.validation.maxSniffConcurrent": "El máximo de concurrencia de sniffing debe estar entre 1 y 10",
  "api.validation.maxScrapingSlots": "El máximo de ranuras de raspado debe estar entre 1 y 50",
  "api.validation.tsSegmentConcurrent": "La concurrencia de segmentos TS debe estar entre 1 y 200",
  "api.validation.galleryImageConcurrent": "La concurrencia de imágenes de galería debe estar entre 1 y 50",

  // Operaciones del foro SJS
  "api.sjs.missingAction": "Falta el parámetro action",
  "api.sjs.signMissingAccountId": "El inicio de sesión requiere el parámetro accountId",
  "api.sjs.buyMissingAccountId": "La compra de publicación requiere el parámetro accountId",
  "api.sjs.buyMissingTid": "La compra de publicación requiere el parámetro tid (ID de publicación)",
  "api.sjs.loginMissingAccountId": "El inicio de sesión requiere el parámetro accountId",

  // SJS Shelf
  "api.sjsShelf.noUrls": "Proporcione una lista de URL",
  "api.sjsShelf.emptyUrl": "URL vacía",
  "api.sjsShelf.invalidSjsUrl": "No es una URL SJS válida",
  "api.sjsShelf.missingId": "Falta el parámetro id",
  "api.sjsShelf.invalidId": "id no válido",
  "api.sjsShelf.notFound": "Marcador no encontrado",
  "api.sjsShelf.refreshFailed": "Error al actualizar metadatos",
  "api.sjsShelf.unknownAction": "Acción desconocida",

  // Búsqueda
  "api.search.missingJobId": "Por favor, proporciona jobId",
  "api.search.batchScrapeStarted": "Raspado por lotes iniciado",
  "api.search.missingPageUrl": "Por favor, proporciona pageUrl",
  "api.search.videoNotFound": "Elemento de video no encontrado",
  "api.search.missingKeyword": "Por favor, proporciona palabras clave de búsqueda",
  "api.search.missingVideoTitle": "Por favor, proporciona el título del video",

  // Personajes
  "api.protagonist.galleryNotFound": "No se encontraron galerías para este personaje",
  "api.protagonist.fetchFailed": "Error al obtener información del personaje",

  // Orquestación OUO
  "api.ouo.missingParams": "Faltan parámetros obligatorios: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Falta el parámetro obligatorio: galleryId",

  // Galería
  "api.gallery.notFound": "Galería no encontrada",
  "api.gallery.noProviderMatch": "No se encontró un proveedor de sitio coincidente, no se puede volver a raspar",
  "api.gallery.rescrapeStarted": "Re-raspado de galería iniciado",
  "api.gallery.retryFailedStarted": "Reintentar archivos fallidos iniciado",
  "api.gallery.downloadStarted": "Descarga de galería iniciada",
  "api.gallery.noZipInfo": "Esta galería no tiene información de descarga ZIP",
  "api.gallery.noDownloadUrl": "No hay URL de descarga disponible, proporciona manualmente un enlace espejo",
  "api.gallery.invalidSource": "Solo la fuente ouo.io admite la cola del orquestador, la fuente actual es {source}",
  "api.gallery.noZipData": "No hay información de descarga ZIP",
  "api.gallery.noProvider": "No se encontró un proveedor de sitio coincidente",
  "api.gallery.alreadyScraping": "Esta galería está siendo raspada por otra tarea, inténtalo más tarde",
  "api.gallery.pageNotFound": "Página no encontrada (404)",
  "api.gallery.pageNotFoundSkipped": "Página no encontrada (404), omitida",
  "api.gallery.identifying": "Galería en identificación, espere a que se complete antes de descargar",
  "api.gallery.scrapeComplete": "Rastreo de galería completado, descarga iniciada asíncronamente",
  "api.gallery.batchMissingUrls": "El parámetro urls debe ser un array no vacío",
  "api.gallery.batchEmptyUrl": "URL vacía",
  "api.gallery.noProviderForRescrape": "No se encontró proveedor de galería, no se puede volver a rastrear",

  // Tareas
  "api.tasks.noM3u8Extracted": "No se puede extraer el enlace M3U8 de la página",

  // Lista negra
  "api.blocklist.addFailed": "Error al añadir",

  // Registros
  "api.logs.systemReady": "Sistema listo, esperando tareas...",
  "api.logs.taskNumber": "Tarea #{id}",
  "api.logs.fetchFailed": "Error al obtener registros",

  // Galería (suplemento)
  "api.gallery.unsupportedScrape": "El sitio {site} no admite el raspado de galerías",
  "api.gallery.allDomainsFailed": "Todos los dominios fallaron al raspar",

  // Tareas (suplemento)
  "api.tasks.multipleM3u8Detected": "Se detectaron {count} direcciones M3U8, seleccione",
  "api.tasks.unsupportedListScrape": "El proveedor no admite el raspado de páginas de lista",

  // Común
  "api.characterDb.syncRunning": "La tarea de sincronización ya está en ejecución",
  "api.common.internalError": "Error interno del servidor",
  "api.common.missingParams": "Faltan parámetros obligatorios: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} no encontrado",
  "api.dag.invalidAction": "Acción no válida: {action}",
  "api.accounts.createFailed": "Error al crear cuenta",
  "api.accounts.deleteFailed": "Error al eliminar cuenta",
  "api.accounts.missingFields": "siteId, username y password son obligatorios",
  "api.accounts.queryFailed": "Error al consultar cuentas",
  "api.accounts.updateFailed": "Error al actualizar cuenta",
  "api.blocklist.createFailed": "Error al crear regla de bloqueo",
  "api.blocklist.deleteFailed": "Error al eliminar regla de bloqueo",
  "api.blocklist.missingFields": "fieldType y keyword son obligatorios",
  "api.blocklist.queryFailed": "Error al consultar reglas de bloqueo",
  "api.blocklist.updateFailed": "Error al actualizar regla de bloqueo",
  "api.common.databaseUnavailable": "Base de datos no disponible",
  "api.common.endpointNotFound": "Punto final no encontrado",
  "api.common.invalidId": "ID no válido",
  "api.common.invalidJson": "Cuerpo JSON de solicitud no válido",
  "api.common.keyRequired": "El parámetro key es obligatorio",
  "api.common.methodNotAllowed": "Método no permitido",
  "api.common.missingBody": "El cuerpo de la solicitud no puede estar vacío",
  "api.common.streamingNotSupported": "Transmisión no admitida",
  "api.config.queryFailed": "Error al consultar configuración",
  "api.config.updateFailed": "Error al actualizar configuración",
  "api.dag.schedulerRequired": "El control de DAG requiere programador (Phase 3)",
  "api.gallery.invalidId": "ID de galería no válido",
  "api.gallery.queryFailed": "Error al consultar galerías",
  "api.gallery.queryImagesFailed": "Error al consultar imágenes",
  "api.history.queryFailed": "Error al consultar historial de descargas",
  "api.persons.createFailed": "Error al crear protagonista",
  "api.persons.deleteFailed": "Error al eliminar protagonista",
  "api.persons.missingName": "El parámetro name es obligatorio",
  "api.persons.queryFailed": "Error al consultar protagonistas",
  "api.persons.updateFailed": "Error al actualizar protagonista",
  "api.preferences.queryFailed": "Error al consultar preferencias del usuario",
  "api.preferences.updateFailed": "Error al actualizar preferencias del usuario",
  "api.sjsShelf.createFailed": "Error al crear marcador",
  "api.sjsShelf.deleteFailed": "Error al eliminar marcador",
  "api.sjsShelf.missingGalleryId": "El parámetro galleryId es obligatorio",
  "api.sjsShelf.missingUrlAndThreadId": "URL y threadId son obligatorios",
  "api.sjsShelf.missingUrlParam": "El parámetro URL es obligatorio",
  "api.sjsShelf.queryFailed": "Error al consultar marcadores SJS",
  "api.tasks.createFailed": "Error al crear tarea",
  "api.tasks.invalidId": "ID de tarea no válido",
  "api.tasks.missingUrl": "La URL es obligatoria",
  "api.tasks.notFound": "Tarea no encontrada",
  "api.tasks.queryFailed": "Error al consultar tareas",
  "api.tasks.schedulerRequired": "Las operaciones de tarea requieren programador (Phase 3)",
  "api.characterDb.failed": "Character query failed",
  "api.characterDb.missingName": "Name parameter is required",
  "api.ouo.failed": "OUO resolution failed",
  "api.ouo.missingUrl": "URL is required",
  "api.ouo.notAvailable": "OUO orchestrator not available",
  "api.proxy.failed": "Proxy request failed",
  "api.proxy.invalidUrl": "Invalid URL",
  "api.proxy.missingUrl": "URL is required",
  "api.scrape.failed": "Scrape failed",
  "api.scrape.missingUrl": "URL is required",
  "api.scrape.noProvider": "No provider found for this URL",
  "api.scrape.notAvailable": "Scraping is not yet available",
  "api.scrape.notSupported": "Provider does not support gallery scraping",
  "api.search.failed": "Search failed",
  "api.search.missingKeywords": "Keywords are required",
  "api.searchBatch.failed": "Batch search failed",
  "api.searchBatch.missingKeywords": "Keywords array is required",
  "api.sjs.buyHandled": "Buy handled by SJS provider",
  "api.sjs.checkinHandled": "Checkin handled by SJS provider",
  "api.sjs.hideHandled": "Hide handled by SJS provider",
  "api.sjs.notAvailable": "SJS provider not available",
  "api.slots.invalidMax": "Invalid slot max value",
  "api.slots.missingSlotType": "Missing slotType parameter",
  "api.slots.slotTypeNotFound": "Slot type not found",
  "api.sniff.createFailed": "Failed to create sniff task",
  "api.sniff.deleteFailed": "Failed to delete sniff task",
  "api.sniff.missingId": "Missing sniff task ID",
  "api.sniff.missingUrl": "URL is required",
  "api.sniff.queryFailed": "Failed to query sniff tasks",
  "api.tasks.deleteFailed": "Failed to delete task",
  "api.tasks.pauseFailed": "Failed to pause task",
  "api.tasks.resumeFailed": "Failed to resume task",
  "api.tasks.retryFailed": "Failed to retry task",
  "api.tasks.startFailed": "Failed to start task",
  "api.tasks.unknownAction": "Unknown action",
};

export default esES;
