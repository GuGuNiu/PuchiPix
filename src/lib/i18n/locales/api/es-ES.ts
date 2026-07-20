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
};

export default esES;
