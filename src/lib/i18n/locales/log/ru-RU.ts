import type { TranslationDict } from "../../types";

// Шаблоны лог-сообщений — Русский
const ruRU: TranslationDict = {
  // Безопасное удаление
  "log.safeDelete.fileFailed": "Ошибка удаления файла ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.fileFinalFailed": "Финальная ошибка удаления файла: {path} — {msg}",
  "log.safeDelete.dirFailed": "Ошибка удаления директории ({retry}/{max}): {path} — {msg}",
  "log.safeDelete.dirFinalFailed": "Финальная ошибка удаления директории: {path} — {msg}",

  // Обработчик галерей
  "log.galleryHandler.cancelledInQueue": "Галерея #{id} отменена во время ожидания в очереди",
  "log.galleryHandler.cancelledInScrapeQueue": "Галерея #{id} отменена во время ожидания в очереди сканирования",
  "log.galleryHandler.domainRateLimited": "Домен {url} вернул {status} (ограничение скорости), быстрое переключение",
  "log.galleryHandler.asyncScrapeError": "Ошибка асинхронного сканирования галереи #{id}",
  "log.galleryHandler.scrapeTiming": "{ms}мс — {msg}",
  "log.galleryHandler.downloadFailed": "Download failed: {msg}",
  "log.galleryHandler.downloadComplete": "Download complete: {success} succeeded, {failed} failed, {skipped} skipped",

  // Сайт SJS
  "log.sjs.noAccount": "Нет доступного аккаунта, доступ в режиме гостя (полный контент может быть недоступен)",
  "log.sjs.cookieInjected": "Cookie аккаунта #{id} внедрены ({count} шт.)",
  "log.sjs.cookieInjectionFailed": "Ошибка внедрения Cookie, попытка повторного входа",
  "log.sjs.noCookieStartLogin": "Нет действительного Cookie, запуск процесса входа...",
  "log.sjs.loginSuccess": "Вход аккаунта #{id} успешен, Cookie сохранены ({count} шт.)",
  "log.sjs.loginFailed": "Ошибка входа",
  "log.sjs.paidContent": "Пост — платный контент, необходимо купить для просмотра ссылок скачивания",
  "log.sjs.detectedDownloadLinks": "Обнаружено ссылок для скачивания: {count} (пост куплен)",
  "log.sjs.pageNewImages": "Страница поста {page}: новые изображения (всего {total})",
  "log.sjs.scrapePageFailed": "Ошибка сканирования страницы поста {page}",
  "log.sjs.learnPersonFailed": "Ошибка learnPerson",
  "log.sjs.listPageNoResults": "Страница списка {page}: нет результатов, завершение",
  "log.sjs.listPageNewResults": "Страница списка {page}: новых результатов {count} (всего {total})",
  "log.sjs.listPageNoNext": "Нет ссылки на следующую страницу, завершение",
  "log.sjs.navNextFailed": "Ошибка навигации на следующую страницу",
  "log.sjs.gotFormhash": "Получен formhash: {value}",
  "log.sjs.httpLoginSuccess": "HTTP-вход успешен (Cookie: {count} шт.)",
  "log.sjs.signLink": "Ссылка для отметки: {href}",
  "log.sjs.postNotPurchased": "Пост \"{title}\" не куплен, запуск процесса покупки...",
  "log.sjs.buyFormParams": "Параметры формы покупки: formhash={formhash}, tid={tid}",
  "log.sjs.startSign": "Начало отметки: {username}",

  // Реестр сайтов
  "log.siteRegistry.providerNotFound": "Не найдена реализация Provider для сайта \"{id}\"",

  // Управление аккаунтами сайтов
  "log.siteAccountManager.cookieSaved": "Cookie аккаунта #{id} сохранены ({count} шт.)",

  // ExHentai
  "log.exhentai.scrapePageFailed": "Ошибка сканирования страницы галереи {page}",
  "log.exhentai.pageNewLinks": "Страница галереи {page}: собрано ссылок на страницы изображений {count} (всего {total})",
  "log.exhentai.batchFailed": "Ошибка пакетного получения URL изображений (пакет {batch})",
  "log.exhentai.listPageNoResults": "Страница списка {page}: нет результатов, завершение",
  "log.exhentai.listPageNewResults": "Страница списка {page}: новых результатов {count} (всего {total})",
  "log.exhentai.listPageNoNext": "Нет ссылки на следующую страницу, завершение",
  "log.exhentai.navNextFailed": "Ошибка навигации на следующую страницу",

  // Aimeizizi
  "log.aimeizizi.learnPersonFailed": "Ошибка learnPerson",
  "log.aimeizizi.blockedSearchResult": "Заблокированный результат поиска: \"{title}...\", причина: {reason}",
  "log.aimeizizi.domainRateLimited": "Страница {page} получила {status}, домен {domain} помечен как ограниченный по скорости",
  "log.aimeizizi.domainSwitchSuccess": "Страница {page}: переключение на домен {domain} успешно",
  "log.aimeizizi.domainSwitchFailed": "Страница {page}: ошибка домена {domain}: {msg}",
  "log.aimeizizi.scrapePageFailed": "Ошибка сканирования страницы {page} (домен {domain})",
  "log.aimeizizi.blockedGalleryScrape": "Заблокировано сканирование галереи: \"{title}...\", причина: {reason}",
  "log.aimeizizi.gameCharDetected": "Обнаружены игровые персонажи: {chars}",
  "log.aimeizizi.listPageFailed": "Ошибка сканирования страницы списка {page}",

  // Общее сканирование
  "log.scrape.capturedM3u8": "{url} — захвачено M3U8 URL: {count} шт.: {urls}",

  // Сервис персонажей
  "log.protagonist.personCacheInitFailed": "Ошибка инициализации кэша персонажей",

  // Поисковая система
  "log.search.batchComplete": "Пакетное сканирование завершено! Успешно {ok}, с ошибками {fail}",
  "log.search.terminated": "Search task terminated abnormally: {msg}",
  "log.search.batchTerminated": "Batch search task terminated abnormally: {msg}",
  "log.taskCreator.downloadStartFailed": "Download task #{taskId} failed to start: {msg}",
  "log.parallelDL.writeFailed": "[ParallelDL] Write failed: {msg}",
  "log.parallelDL.requestFailed": "[ParallelDL] Request failed: {msg}",
  "log.downloadManager.segmentFailed": "  Segment #{idx}: {msg}",
  "log.downloadManager.incomplete": "Download incomplete: {failedCount} segments failed (out of {totalSegments} total)\n{details}",

  // Менеджер очереди задач
  "log.taskQueue.slotAllocated": "Слот выделен: {key} (выполняется: обычные={normal}/{maxNormal}, сниффинг={sniff}/{maxSniff})",
  "log.taskQueue.slotReleased": "Слот освобождён: {key} (выполняется: обычные={normal}/{maxNormal}, сниффинг={sniff}/{maxSniff})",
  "log.taskQueue.scrapingAllocated": "Слот идентификации выделен: {key} (идентификация: {scraping}/{maxScraping})",
  "log.taskQueue.scrapingReleased": "Слот идентификации освобождён: {key} (идентификация: {scraping}/{maxScraping})",
  "log.taskQueue.pendingCancel": "Задача из очереди отменена: {type}-{id}",
  "log.taskQueue.scrapingCancel": "Задача идентификации из очереди отменена: {type}-{id}",
  "log.taskQueue.pendingGranted": "Задаче из очереди выделен слот: {key} (выполняется: обычные={normal}/{maxNormal}, сниффинг={sniff}/{maxSniff})",
  "log.taskQueue.scrapingGranted": "Задаче идентификации из очереди выделен слот: {key} (идентификация: {scraping}/{maxScraping})",
  "log.taskQueue.slotFull": "Слоты заполнены, задача в очереди: {key} (позиция в очереди {position})",
  "log.taskQueue.scrapingFull": "Слоты идентификации заполнены, задача в очереди: {key} (позиция в очереди {position})",
  "log.taskQueue.configLoaded": "Конфигурация загружена: лимит обычных задач={maxConcurrent}, лимит идентификации={maxScraping}, лимит сниффинга={maxSniff}, параллельность TS={tsSegment}, параллельность изображений галереи={galleryImage}",
  "log.taskQueue.configUpdated": "Конфигурация обновлена: лимит обычных задач={maxConcurrent}, лимит идентификации={maxScraping}, лимит сниффинга={maxSniff}, параллельность TS={tsSegment}, параллельность изображений галереи={galleryImage}",
  "log.taskQueue.configSeeded": "Конфигурация по умолчанию записана в БД: {keys}",
  "log.taskQueue.listenersRegistered": "Слушатели терминальных состояний EventBus зарегистрированы",
  "log.taskQueue.resetWarn": "Счётчики принудительно сброшены",
"log.taskQueue.startupRecovery": "Восстановление при запуске: перезапланировано задач: {count}",
  "log.taskQueue.configLoadFailed": "Ошибка загрузки конфигурации, используются значения по умолчанию: {error}",

  // Жизненный цикл сервера
  "log.server.taskStateReset": "Сброс состояния задач при запуске завершён",
  "log.server.downloadManagerInit": "Менеджер загрузок инициализирован",
  "log.server.eventBusBridgeInit": "Мост EventBus инициализирован",
  "log.server.ouoOrchestratorStart": "Оркестратор OUO запущен",

  // Сброс состояния задач
  "log.taskStateReset.started": "Запуск сброса состояния выполняющихся задач...",
  "log.taskStateReset.cleanupSlots": "Очистка зависших слотов: обычные={normal}, сниффинг={sniff}, идентификация={scraping}",
  "log.taskStateReset.completed": "Сброс завершён: видео {videoTasks}, галереи {galleries}, изображения {galleryImages}, видео {galleryVideos}, сниффинг {sniffTasks}, ZIP-инфо {galleryDownloadInfos}, всего {total} задач сброшено в ожидание",
  "log.taskStateReset.noop": "Выполняющихся задач не найдено, сброс не требуется",

  "log.seed.presetDataSeeded": "Предустановленные данные записаны в базу данных: {prefs} настроек, {blocklists} правил блокировки",
};

export default ruRU;
