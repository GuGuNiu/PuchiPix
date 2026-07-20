import type { TranslationDict } from "../../types";

// Сообщения об ошибках API — Русский
const ruRU: TranslationDict = {
  // Проверка настроек задач
  "api.validation.maxConcurrentTasks": "Макс. одновременных задач должно быть от 1 до 50",
  "api.validation.maxSniffConcurrent": "Макс. параллельных сниффингов должно быть от 1 до 10",
  "api.validation.maxScrapingSlots": "Макс. слотов идентификации должно быть от 1 до 50",
  "api.validation.tsSegmentConcurrent": "Параллельность TS-сегментов должна быть от 1 до 200",
  "api.validation.galleryImageConcurrent": "Параллельность изображений галереи должна быть от 1 до 50",

  // Операции форума SJS
  "api.sjs.missingAction": "Отсутствует параметр action",
  "api.sjs.signMissingAccountId": "Для отметки требуется параметр accountId",
  "api.sjs.buyMissingAccountId": "Для покупки поста требуется параметр accountId",
  "api.sjs.buyMissingTid": "Для покупки поста требуется параметр tid (ID поста)",
  "api.sjs.loginMissingAccountId": "Для входа требуется параметр accountId",

  // Поиск
  "api.search.missingJobId": "Укажите jobId",
  "api.search.batchScrapeStarted": "Пакетное сканирование начато",
  "api.search.missingPageUrl": "Укажите pageUrl",
  "api.search.videoNotFound": "Видео не найдено",
  "api.search.missingKeyword": "Укажите ключевые слова поиска",
  "api.search.missingVideoTitle": "Укажите название видео",

  // Персонажи
  "api.protagonist.galleryNotFound": "Галереи этого персонажа не найдены",
  "api.protagonist.fetchFailed": "Ошибка получения информации о персонаже",

  // Оркестрация OUO
  "api.ouo.missingParams": "Отсутствуют обязательные параметры: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Отсутствует обязательный параметр: galleryId",

  // Галерея
  "api.gallery.notFound": "Галерея не найдена",
  "api.gallery.noProviderMatch": "Не найден подходящий провайдер сайта, повторное сканирование невозможно",
  "api.gallery.rescrapeStarted": "Повторное сканирование галереи начато",
  "api.gallery.retryFailedStarted": "Повтор неудачных файлов начат",
  "api.gallery.downloadStarted": "Скачивание галереи начато",
  "api.gallery.noZipInfo": "У этой галереи нет информации о ZIP-загрузке",
  "api.gallery.noDownloadUrl": "URL для скачивания недоступен. Укажите ссылку на зеркало вручную",
  "api.gallery.invalidSource": "Только источник ouo.io поддерживает очередь оркестратора. Текущий источник: {source}",
  "api.gallery.noZipData": "Нет информации о ZIP-загрузке",
  "api.gallery.noProvider": "Подходящий провайдер сайта не найден",
  "api.gallery.alreadyScraping": "Эта галерея сканируется другой задачей. Повторите позже",
  "api.gallery.pageNotFound": "Страница не найдена (404)",
  "api.gallery.pageNotFoundSkipped": "Страница не найдена (404), пропущено",
  "api.gallery.identifying": "Галерея идентифицируется, дождитесь завершения перед загрузкой",
  "api.gallery.scrapeComplete": "Сканирование галереи завершено, загрузка запущена асинхронно",
  "api.gallery.batchMissingUrls": "Параметр urls должен быть непустым массивом",
  "api.gallery.batchEmptyUrl": "Пустой URL",
  "api.gallery.noProviderForRescrape": "Не найден поставщик галереи, невозможно повторное сканирование",

  // Задачи
  "api.tasks.noM3u8Extracted": "Не удалось извлечь M3U8-ссылку со страницы",

  // Чёрный список
  "api.blocklist.addFailed": "Ошибка добавления",

  // Логи
  "api.logs.systemReady": "Система готова, ожидание задач...",
  "api.logs.taskNumber": "Задача #{id}",
  "api.logs.fetchFailed": "Не удалось получить логи",

  // Галерея (дополнение)
  "api.gallery.unsupportedScrape": "Сайт {site} не поддерживает сбор галерей",
  "api.gallery.allDomainsFailed": "Не удалось выполнить сбор со всех доменов",

  // Задачи (дополнение)
  "api.tasks.multipleM3u8Detected": "Обнаружено {count} адресов M3U8, выберите",
  "api.tasks.unsupportedListScrape": "Провайдер не поддерживает сбор страниц списка",

  // Общее
  "api.characterDb.syncRunning": "Задача синхронизации уже выполняется",
  "api.common.internalError": "Внутренняя ошибка сервера",
  "api.common.missingParams": "Отсутствуют обязательные параметры: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} не найден",
  "api.dag.invalidAction": "Недопустимое действие: {action}",
};

export default ruRU;
