import type { TranslationDict } from "../../types";
const ptBR: TranslationDict = {
  "api.validation.maxConcurrentTasks": "Máx. de tarefas simultâneas deve estar entre 1 e 50", "api.validation.maxSniffConcurrent": "Máx. de concorrência de sniffing deve estar entre 1 e 10", "api.validation.maxScrapingSlots": "Máx. de slots de raspagem deve estar entre 1 e 50", "api.validation.tsSegmentConcurrent": "Concorrência de segmentos TS deve estar entre 1 e 200", "api.validation.galleryImageConcurrent": "Concorrência de imagens de galeria deve estar entre 1 e 50", "api.sjs.missingAction": "Parâmetro action ausente", "api.sjs.signMissingAccountId": "Login requer parâmetro accountId", "api.sjs.buyMissingAccountId": "Compra de publicação requer parâmetro accountId", "api.sjs.buyMissingTid": "Compra de publicação requer parâmetro tid (ID da publicação)", "api.sjs.loginMissingAccountId": "Login requer parâmetro accountId", "api.sjsShelf.noUrls": "Forneça uma lista de URL", "api.sjsShelf.emptyUrl": "URL vazia", "api.sjsShelf.invalidSjsUrl": "Não é uma URL SJS válida", "api.sjsShelf.missingId": "Parâmetro id ausente", "api.sjsShelf.invalidId": "id inválido", "api.sjsShelf.notFound": "Favorito não encontrado", "api.sjsShelf.refreshFailed": "Falha ao atualizar metadados", "api.sjsShelf.unknownAction": "Ação desconhecida", "api.search.missingJobId": "Forneça um jobId", "api.search.batchScrapeStarted": "Raspagem em lote iniciada", "api.search.missingPageUrl": "Forneça um pageUrl", "api.search.videoNotFound": "Item de vídeo não encontrado", "api.search.missingKeyword": "Forneça palavras-chave de busca", "api.search.missingVideoTitle": "Forneça o título do vídeo", "api.protagonist.galleryNotFound": "Nenhuma galeria encontrada para este personagem", "api.protagonist.fetchFailed": "Falha ao obter informações do personagem", "api.ouo.missingParams": "Parâmetros obrigatórios ausentes: galleryId, ouoUrl", "api.ouo.missingGalleryId": "Parâmetro obrigatório ausente: galleryId", "api.gallery.notFound": "Galeria não encontrada", "api.gallery.noProviderMatch": "Nenhum provedor de site correspondente, não é possível raspar novamente", "api.gallery.rescrapeStarted": "Re-raspagem da galeria iniciada", "api.gallery.retryFailedStarted": "Tentativa de arquivos falhos iniciada", "api.gallery.downloadStarted": "Download da galeria iniciado", "api.gallery.noZipInfo": "Esta galeria não tem informações de download ZIP", "api.gallery.noDownloadUrl": "Nenhum URL de download disponível, forneça um link de espelho manualmente", "api.gallery.invalidSource": "Apenas a fonte ouo.io suporta fila do orquestrador, fonte atual é {source}", "api.gallery.noZipData": "Sem informações de download ZIP", "api.gallery.noProvider": "Nenhum provedor de site correspondente", "api.gallery.alreadyScraping": "Esta galeria está sendo raspada por outra tarefa, tente mais tarde", "api.gallery.pageNotFound": "Página não encontrada (404)", "api.gallery.pageNotFoundSkipped": "Página não encontrada (404), ignorada",
  "api.gallery.identifying": "Galeria em identificação, aguarde a conclusão antes de baixar",
  "api.gallery.scrapeComplete": "Raspagem da galeria concluída, download iniciado assincronamente",
  "api.gallery.batchMissingUrls": "Parâmetro urls deve ser um array não vazio",
  "api.characterDb.syncRunning": "A tarefa de sincronização já está em execução",
  "api.gallery.batchEmptyUrl": "URL vazia", "api.tasks.noM3u8Extracted": "Não foi possível extrair o link M3U8 da página", "api.blocklist.addFailed": "Falha ao adicionar",
  "api.logs.systemReady": "Sistema pronto, aguardando tarefas...",
  "api.logs.taskNumber": "Tarefa #{id}",
  "api.logs.fetchFailed": "Falha ao buscar logs",
  "api.gallery.unsupportedScrape": "O site {site} não suporta raspagem de galeria",
  "api.gallery.allDomainsFailed": "Todos os domínios falharam na raspagem",
  "api.tasks.multipleM3u8Detected": "{count} endereços M3U8 detectados, selecione",
  "api.tasks.unsupportedListScrape": "O provedor não suporta raspagem de página de listagem",
  "api.common.internalError": "Erro interno do servidor", "api.common.missingParams": "Parâmetros obrigatórios ausentes: {params}",
  "api.gallery.noProviderForRescrape": "Nenhum provedor de galeria encontrado, não é possível re-raspar",

  // DAG
  "api.dag.notFound": "DAG {dagId} não encontrado",
  "api.dag.invalidAction": "Ação inválida: {action}",
};
export default ptBR;
