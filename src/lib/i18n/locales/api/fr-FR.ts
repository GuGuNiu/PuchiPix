import type { TranslationDict } from "../../types";
const frFR: TranslationDict = {
  "api.validation.maxConcurrentTasks": "Le max. de tâches simultanées doit être entre 1 et 50", "api.validation.maxSniffConcurrent": "Le max. de concurrence sniffing doit être entre 1 et 10", "api.validation.maxScrapingSlots": "Le max. d'emplacements d'extraction doit être entre 1 et 50", "api.validation.tsSegmentConcurrent": "La concurrence des segments TS doit être entre 1 et 200", "api.validation.galleryImageConcurrent": "La concurrence des images de galerie doit être entre 1 et 50", "api.sjs.missingAction": "Paramètre action manquant", "api.sjs.signMissingAccountId": "Le login nécessite le paramètre accountId", "api.sjs.buyMissingAccountId": "L'achat de publication nécessite le paramètre accountId", "api.sjs.buyMissingTid": "L'achat de publication nécessite le paramètre tid (ID publication)", "api.sjs.loginMissingAccountId": "Le login nécessite le paramètre accountId", "api.search.missingJobId": "Veuillez fournir un jobId", "api.search.batchScrapeStarted": "Extraction par lots démarrée", "api.search.missingPageUrl": "Veuillez fournir un pageUrl", "api.search.videoNotFound": "Élément vidéo non trouvé", "api.search.missingKeyword": "Veuillez fournir des mots-clés", "api.search.missingVideoTitle": "Veuillez fournir le titre de la vidéo", "api.protagonist.galleryNotFound": "Aucune galerie trouvée pour ce personnage", "api.protagonist.fetchFailed": "Échec de récupération des infos du personnage", "api.ouo.missingParams": "Paramètres obligatoires manquants: galleryId, ouoUrl", "api.ouo.missingGalleryId": "Paramètre obligatoire manquant: galleryId", "api.gallery.notFound": "Galerie non trouvée", "api.gallery.noProviderMatch": "Aucun fournisseur de site correspondant, impossible de ré-extraire", "api.gallery.rescrapeStarted": "Ré-extraction de galerie démarrée", "api.gallery.retryFailedStarted": "Réessai fichiers échoués démarré", "api.gallery.downloadStarted": "Téléchargement de galerie démarré", "api.gallery.noZipInfo": "Cette galerie n'a pas d'informations de téléchargement ZIP", "api.gallery.noDownloadUrl": "Aucun URL de téléchargement disponible, fournissez un lien miroir manuellement", "api.gallery.invalidSource": "Seule la source ouo.io supporte la file d'orchestrateur, la source actuelle est {source}", "api.gallery.noZipData": "Pas d'informations de téléchargement ZIP", "api.gallery.noProvider": "Aucun fournisseur de site correspondant", "api.gallery.alreadyScraping": "Cette galerie est en cours d'extraction par une autre tâche, réessayez plus tard", "api.gallery.pageNotFound": "Page non trouvée (404)", "api.gallery.pageNotFoundSkipped": "Page non trouvée (404), ignorée",
  "api.gallery.identifying": "Galerie en cours d'identification, attendez la fin avant de télécharger",
  "api.gallery.scrapeComplete": "Extraction de la galerie terminée, téléchargement démarré asynchronement",
  "api.gallery.batchMissingUrls": "Le paramètre urls doit être un tableau non vide",
  "api.characterDb.syncRunning": "La tâche de synchronisation est déjà en cours",
  "api.gallery.batchEmptyUrl": "URL vide", "api.tasks.noM3u8Extracted": "Impossible d'extraire le lien M3U8 de la page", "api.blocklist.addFailed": "Échec d'ajout",
  "api.logs.systemReady": "Système prêt, en attente de tâches...",
  "api.logs.taskNumber": "Tâche #{id}",
  "api.logs.fetchFailed": "Échec de récupération des logs",
  "api.gallery.unsupportedScrape": "Le site {site} ne supporte pas l'extraction de galerie",
  "api.gallery.allDomainsFailed": "Tous les domaines ont échoué à l'extraction",
  "api.tasks.multipleM3u8Detected": "{count} adresses M3U8 détectées, veuillez sélectionner",
  "api.tasks.unsupportedListScrape": "Le fournisseur ne supporte pas l'extraction de page de liste",
  "api.common.internalError": "Erreur interne du serveur", "api.common.missingParams": "Paramètres obligatoires manquants: {params}",
  "api.gallery.noProviderForRescrape": "Aucun fournisseur de galerie trouvé, impossible de re-scrapr",

  // DAG
  "api.dag.notFound": "DAG {dagId} introuvable",
  "api.dag.invalidAction": "Action invalide: {action}",
};
export default frFR;
