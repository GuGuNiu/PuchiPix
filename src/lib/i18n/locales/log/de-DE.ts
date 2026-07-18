import type { TranslationDict } from "../../types";

const deDE: TranslationDict = {
    // Sicheres Löschen
    "log.safeDelete.fileFailed": "Dateilöschung fehlgeschlagen ({retry}/{max}): {path} — {msg}",
    "log.safeDelete.fileFinalFailed": "Dateilöschung endgültig fehlgeschlagen: {path} — {msg}",
    "log.safeDelete.dirFailed": "Verzeichnislöschung fehlgeschlagen ({retry}/{max}): {path} — {msg}",
    "log.safeDelete.dirFinalFailed": "Verzeichnislöschung endgültig fehlgeschlagen: {path} — {msg}",

    // Galerie-Handler
    "log.galleryHandler.cancelledInQueue": "Galerie #{id} in Warteschlange zur Löschung abgebrochen",
    "log.galleryHandler.cancelledInScrapeQueue": "Galerie #{id} im Scraping-Wartezustand abgebrochen",
    "log.galleryHandler.domainRateLimited": "Domain {url} hat {status} zurückgegeben (Rate-Limit), schnelles Umschalten",
    "log.galleryHandler.asyncScrapeError": "Galerie #{id} Async-Scraping-Fehler",
    "log.galleryHandler.scrapeTiming": "{ms}ms — {msg}",
    "log.galleryHandler.downloadFailed": "Download failed: {msg}",
    "log.galleryHandler.downloadComplete": "Download complete: {success} succeeded, {failed} failed, {skipped} skipped",

    // SJS-Seite
    "log.sjs.noAccount": "Kein verfügbares Konto, Zugriff als Gast (Inhalt möglicherweise unvollständig)",
    "log.sjs.cookieInjected": "Konto-{id} Cookie injiziert ({count} Stück)",
    "log.sjs.cookieInjectionFailed": "Cookie-Injektion fehlgeschlagen, erneuter Login wird versucht",
    "log.sjs.noCookieStartLogin": "Kein gültiger Cookie, Login-Prozess wird gestartet...",
    "log.sjs.loginSuccess": "Konto-#{id} Login erfolgreich, Cookie gespeichert ({count} Stück)",
    "log.sjs.loginFailed": "Login fehlgeschlagen",
    "log.sjs.paidContent": "Post ist kostenpflichtiger Inhalt, muss gekauft werden, um Download-Links zu sehen",
    "log.sjs.detectedDownloadLinks": "{count} Download-Links erkannt (Post gekauft)",
    "log.sjs.pageNewImages": "Post-Seite {page}: neue Bilder (gesamt {total})",
    "log.sjs.scrapePageFailed": "Scraping der Post-Seite {page} fehlgeschlagen",
    "log.sjs.learnPersonFailed": "learnPerson fehlgeschlagen",
    "log.sjs.listPageNoResults": "Listenseite {page}: keine Ergebnisse, Beendigung",
    "log.sjs.listPageNewResults": "Listenseite {page}: {count} neue Ergebnisse (gesamt {total})",
    "log.sjs.listPageNoNext": "Kein Link zur nächsten Seite auf Listenseite, Beendigung",
    "log.sjs.navNextFailed": "Navigation zur nächsten Seite fehlgeschlagen",
    "log.sjs.gotFormhash": "Formhash erhalten: {value}",
    "log.sjs.httpLoginSuccess": "HTTP-Login erfolgreich ({count} Cookies)",
    "log.sjs.signLink": "Sign-in-Link: {href}",
    "log.sjs.postNotPurchased": "Post \"{title}\" nicht gekauft, Kaufvorgang wird gestartet...",
    "log.sjs.buyFormParams": "Kaufen-Formularparameter: formhash={formhash}, tid={tid}",
    "log.sjs.startSign": "Sign-in wird gestartet: {username}",

    // Seitenregistrierung
    "log.siteRegistry.providerNotFound": "Keine Provider-Implementierung für die Seite \"{id}\" gefunden",

    // Seitenkonto-Verwaltung
    "log.siteAccountManager.cookieSaved": "Konto-#{id} Cookie gespeichert ({count} Stück)",

    // ExHentai
    "log.exhentai.scrapePageFailed": "Scraping der Galerieseite {page} fehlgeschlagen",
    "log.exhentai.pageNewLinks": "Galerieseite {page}: {count} Bildseiten-Links gesammelt (gesamt {total})",
    "log.exhentai.batchFailed": "Stapel-Abruf von Bild-URLs fehlgeschlagen (Stapel {batch})",
    "log.exhentai.listPageNoResults": "Listenseite {page}: keine Ergebnisse, Beendigung",
    "log.exhentai.listPageNewResults": "Listenseite {page}: {count} neue Ergebnisse (gesamt {total})",
    "log.exhentai.listPageNoNext": "Kein Link zur nächsten Seite auf Listenseite, Beendigung",
    "log.exhentai.navNextFailed": "Navigation zur nächsten Seite fehlgeschlagen",

    // Aimeizizi
    "log.aimeizizi.learnPersonFailed": "learnPerson fehlgeschlagen",
    "log.aimeizizi.blockedSearchResult": "Suchergebnis blockiert: \"{title}...\", Grund: {reason}",
    "log.aimeizizi.domainRateLimited": "Seite {page} hat {status} erhalten, Domain {domain} als Rate-Limit markiert",
    "log.aimeizizi.domainSwitchSuccess": "Seite {page} erfolgreich auf Domain {domain} umgeschaltet",
    "log.aimeizizi.domainSwitchFailed": "Seite {page} Domain {domain} fehlgeschlagen: {msg}",
    "log.aimeizizi.scrapePageFailed": "Scraping der Seite {page} fehlgeschlagen (Domain {domain})",
    "log.aimeizizi.blockedGalleryScrape": "Galerie-Scraping blockiert: \"{title}...\", Grund: {reason}",
    "log.aimeizizi.gameCharDetected": "Spiel-Charaktere erkannt: {chars}",
    "log.aimeizizi.listPageFailed": "Scraping der Listenseite {page} fehlgeschlagen",

    // Allgemeines Scraping
    "log.scrape.capturedM3u8": "{url} — {count} M3U8-URLs erfasst: {urls}",

    // Charakter-Service
    "log.protagonist.personCacheInitFailed": "Initialisierung des Person-Cache fehlgeschlagen",

    // Suchmaschine
    "log.search.batchComplete": "Massen-Scraping abgeschlossen! {ok} erfolgreich, {fail} fehlgeschlagen",
    "log.search.terminated": "Search task terminated abnormally: {msg}",
    "log.search.batchTerminated": "Batch search task terminated abnormally: {msg}",
    "log.taskCreator.downloadStartFailed": "Download task #{taskId} failed to start: {msg}",
    "log.parallelDL.writeFailed": "[ParallelDL] Write failed: {msg}",
    "log.parallelDL.requestFailed": "[ParallelDL] Request failed: {msg}",
    "log.downloadManager.segmentFailed": "  Segment #{idx}: {msg}",
    "log.downloadManager.incomplete": "Download incomplete: {failedCount} segments failed (out of {totalSegments} total)\n{details}",

    // Aufgabenwarteschlangen-Manager
    "log.taskQueue.slotAllocated": "Slot zugewiesen: {key} (läuft: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
    "log.taskQueue.slotReleased": "Slot freigegeben: {key} (läuft: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
    "log.taskQueue.scrapingAllocated": "Scraping-Slot zugewiesen: {key} (Scraping: {scraping}/{maxScraping})",
    "log.taskQueue.scrapingReleased": "Scraping-Slot freigegeben: {key} (Scraping: {scraping}/{maxScraping})",
    "log.taskQueue.pendingCancel": "Ausstehende Aufgabe abgebrochen: {type}-{id}",
    "log.taskQueue.scrapingCancel": "Ausstehende Scraping-Aufgabe abgebrochen: {type}-{id}",
    "log.taskQueue.pendingGranted": "Ausstehende Aufgabe hat Slot erhalten: {key} (läuft: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
    "log.taskQueue.scrapingGranted": "Ausstehende Scraping-Aufgabe hat Slot erhalten: {key} (Scraping: {scraping}/{maxScraping})",
    "log.taskQueue.slotFull": "Slots voll, Aufgabe in Warteschlange: {key} (Warteposition {position})",
    "log.taskQueue.scrapingFull": "Scraping-Slots voll, Aufgabe in Warteschlange: {key} (Warteposition {position})",
    "log.taskQueue.configLoaded": "Konfiguration geladen: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
    "log.taskQueue.configUpdated": "Konfiguration aktualisiert: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
    "log.taskQueue.configSeeded": "Standardkonfiguration in Datenbank geschrieben: {keys}",
    "log.taskQueue.listenersRegistered": "EventBus-Terminal-Listener registriert",
    "log.taskQueue.resetWarn": "Zähler zwangsweise zurückgesetzt",
    "log.taskQueue.startupRecovery": "Startwiederherstellung: {count} Aufgabe(n) neu eingeplant",
    "log.taskQueue.configLoadFailed": "Konfiguration konnte nicht geladen werden, Standardwerte werden verwendet: {error}",

    // Server-Lebenszyklus
    "log.server.taskStateReset": "Zurücksetzen des Aufgabenstatus beim Start abgeschlossen",
    "log.server.downloadManagerInit": "Download-Manager initialisiert",
    "log.server.eventBusBridgeInit": "EventBus-Brücke initialisiert",
    "log.server.ouoOrchestratorStart": "OUO-Orchestrator gestartet",

    // Aufgabenstatus-Zurücksetzung
    "log.taskStateReset.started": "Zurücksetzen laufender Aufgaben gestartet...",
    "log.taskStateReset.cleanupSlots": "Alte Slots bereinigen: normal={normal}, sniff={sniff}, Scraping={scraping}",
    "log.taskStateReset.completed": "Zurücksetzung abgeschlossen: Video {videoTasks}, Galerien {galleries}, Bilder {galleryImages}, Videos {galleryVideos}, Sniffing {sniffTasks}, ZIP-Informationen {galleryDownloadInfos}, insgesamt {total} Aufgaben wurden auf Ausstehend zurückgesetzt",
    "log.taskStateReset.noop": "Keine laufenden Aufgaben gefunden, keine Rücksetzung erforderlich",

    "log.seed.presetDataSeeded": "Voreingestellte Daten in Datenbank geschrieben: {prefs} Einstellungen, {blocklists} Blocklist-Regeln",
};

export default deDE;
