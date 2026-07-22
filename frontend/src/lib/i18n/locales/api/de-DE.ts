import type { TranslationDict } from "../../types";

// API-Fehlermeldungen — Deutsch
const deDE: TranslationDict = {
  // Aufgabeneinstellungen validieren
  "api.validation.maxConcurrentTasks": "Max. gleichzeitige Aufgaben muss zwischen 1 und 50 liegen",
  "api.validation.maxSniffConcurrent": "Max. Sniffing-Parallelität muss zwischen 1 und 10 liegen",
  "api.validation.maxScrapingSlots": "Max. Scraping-Slots muss zwischen 1 und 50 liegen",
  "api.validation.tsSegmentConcurrent": "TS-Segment-Parallelität muss zwischen 1 und 200 liegen",
  "api.validation.galleryImageConcurrent": "Galeriebild-Parallelität muss zwischen 1 und 50 liegen",

  // SJS-Forenoperationen
  "api.sjs.missingAction": "Action-Parameter fehlt",
  "api.sjs.signMissingAccountId": "Anmeldung benötigt accountId-Parameter",
  "api.sjs.buyMissingAccountId": "Kauf des Posts benötigt accountId-Parameter",
  "api.sjs.buyMissingTid": "Kauf des Posts benötigt tid-Parameter (Post-ID)",
  "api.sjs.loginMissingAccountId": "Anmeldung benötigt accountId-Parameter",

  // SJS Shelf
  "api.sjsShelf.noUrls": "Bitte geben Sie eine URL-Liste an",
  "api.sjsShelf.emptyUrl": "Leere URL",
  "api.sjsShelf.invalidSjsUrl": "Keine gültige SJS-URL",
  "api.sjsShelf.missingId": "Parameter id fehlt",
  "api.sjsShelf.invalidId": "Ungültige id",
  "api.sjsShelf.notFound": "Lesezeichen nicht gefunden",
  "api.sjsShelf.refreshFailed": "Aktualisierung der Metadaten fehlgeschlagen",
  "api.sjsShelf.unknownAction": "Unbekannte Aktion",

  // Suche
  "api.search.missingJobId": "Bitte jobId angeben",
  "api.search.batchScrapeStarted": "Massen-Scraping gestartet",
  "api.search.missingPageUrl": "Bitte pageUrl angeben",
  "api.search.videoNotFound": "Videoeintrag nicht gefunden",
  "api.search.missingKeyword": "Bitte Suchbegriffe angeben",
  "api.search.missingVideoTitle": "Bitte Videotitel angeben",

  // Charaktere
  "api.protagonist.galleryNotFound": "Keine Galerien für diesen Charakter gefunden",
  "api.protagonist.fetchFailed": "Abruf der Charakterinformationen fehlgeschlagen",

  // OUO-Orchestrierung
  "api.ouo.missingParams": "Erforderliche Parameter fehlen: galleryId, ouoUrl",
  "api.ouo.missingGalleryId": "Erforderlicher Parameter fehlt: galleryId",

  // Galerie
  "api.gallery.notFound": "Galerie nicht gefunden",
  "api.gallery.noProviderMatch": "Kein passender Seiten-Provider gefunden, erneutes Scrapen nicht möglich",
  "api.gallery.rescrapeStarted": "Galerie-Erneutes-Scrapen gestartet",
  "api.gallery.retryFailedStarted": "Wiederholung fehlgeschlagener Dateien gestartet",
  "api.gallery.downloadStarted": "Galerie-Download gestartet",
  "api.gallery.noZipInfo": "Diese Galerie hat keine ZIP-Download-Informationen",
  "api.gallery.noDownloadUrl": "Keine Download-URL verfügbar, bitte Mirror-Link manuell angeben",
  "api.gallery.invalidSource": "Nur ouo.io-Quelle unterstützt Orchestrator-Warteschlange, aktuelle Quelle ist {source}",
  "api.gallery.noZipData": "Keine ZIP-Download-Informationen",
  "api.gallery.noProvider": "Kein passender Seiten-Provider gefunden",
  "api.gallery.alreadyScraping": "Diese Galerie wird von einer anderen Aufgabe gescrapt, bitte später erneut versuchen",
  "api.gallery.pageNotFound": "Seite nicht gefunden (404)",
  "api.gallery.pageNotFoundSkipped": "Seite nicht gefunden (404), übersprungen",
  "api.gallery.identifying": "Galerie wird identifiziert, bitte warten Sie bis zum Abschluss",
  "api.gallery.scrapeComplete": "Galerie-Scraping abgeschlossen, Download asynchron gestartet",
  "api.gallery.batchMissingUrls": "urls-Parameter muss ein nicht-leeres Array sein",
  "api.gallery.batchEmptyUrl": "Leere URL",
  "api.gallery.noProviderForRescrape": "Kein Galerie-Anbieter gefunden, erneutes Scrapen nicht möglich",

  // Aufgaben
  "api.tasks.noM3u8Extracted": "M3U8-Link konnte nicht aus der Seite extrahiert werden",

  // Sperrliste
  "api.blocklist.addFailed": "Hinzufügen fehlgeschlagen",

  // Logs
  "api.logs.systemReady": "System bereit, warte auf Aufgaben...",
  "api.logs.taskNumber": "Aufgabe #{id}",
  "api.logs.fetchFailed": "Logs konnten nicht abgerufen werden",

  // Galerie (Ergänzung)
  "api.gallery.unsupportedScrape": "Site {site} unterstützt kein Galerie-Scraping",
  "api.gallery.allDomainsFailed": "Alle Domains konnten nicht gescrapt werden",

  // Aufgaben (Ergänzung)
  "api.tasks.multipleM3u8Detected": "{count} M3U8-Adressen erkannt, bitte auswählen",
  "api.tasks.unsupportedListScrape": "Provider unterstützt kein Listen-Seiten-Scraping",

  // Allgemein
  "api.characterDb.syncRunning": "Synchronisierungsaufgabe läuft bereits",
  "api.common.internalError": "Interner Serverfehler",
  "api.common.missingParams": "Erforderliche Parameter fehlen: {params}",

  // DAG
  "api.dag.notFound": "DAG {dagId} nicht gefunden",
  "api.dag.invalidAction": "Ungültige Aktion: {action}",
};

export default deDE;
