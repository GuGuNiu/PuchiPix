"""
修复 B 类占位符缺失 v2（安全版本）：
按完整行替换（保留 "key": " 前缀），为 es-ES/pt-BR/fr-FR/id-ID 的 log 模块补齐占位符。
"""
import io, os

LOCALES_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "i18n", "locales", "log")

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

# key -> 各语言完整翻译（含全部占位符，参照 en-US 结构）
FIXES = {
    "log.sjs.loginSuccess": {
        "es-ES": "Inicio de sesión exitoso para la cuenta #{id}, Cookie guardada ({count} elementos)",
        "pt-BR": "Login da conta #{id} bem-sucedido, Cookie salvo ({count} itens)",
        "fr-FR": "Connexion du compte #{id} réussie, Cookie enregistré ({count} éléments)",
        "id-ID": "Login akun #{id} berhasil, Cookie disimpan ({count} item)",
    },
    "log.taskQueue.slotReleased": {
        "es-ES": "Ranura liberada: {key} (en ejecución: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "pt-BR": "Slot liberado: {key} (executando: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "fr-FR": "Emplacement libéré : {key} (en cours : normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "id-ID": "Slot dilepaskan: {key} (berjalan: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
    },
    "log.taskQueue.scrapingAllocated": {
        "es-ES": "Ranura de extracción asignada: {key} (extrayendo: {scraping}/{maxScraping})",
        "pt-BR": "Slot de raspagem alocado: {key} (raspando: {scraping}/{maxScraping})",
        "fr-FR": "Emplacement d'extraction alloué : {key} (extraction : {scraping}/{maxScraping})",
        "id-ID": "Slot ekstraksi dialokasikan: {key} (mengekstrak: {scraping}/{maxScraping})",
    },
    "log.taskQueue.scrapingReleased": {
        "es-ES": "Ranura de extracción liberada: {key} (extrayendo: {scraping}/{maxScraping})",
        "pt-BR": "Slot de raspagem liberado: {key} (raspando: {scraping}/{maxScraping})",
        "fr-FR": "Emplacement d'extraction libéré : {key} (extraction : {scraping}/{maxScraping})",
        "id-ID": "Slot ekstraksi dilepaskan: {key} (mengekstrak: {scraping}/{maxScraping})",
    },
    "log.taskQueue.pendingGranted": {
        "es-ES": "Tarea pendiente obtuvo ranura: {key} (en ejecución: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "pt-BR": "Tarefa pendente obteve slot: {key} (executando: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "fr-FR": "Tâche en attente a obtenu un emplacement : {key} (en cours : normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
        "id-ID": "Tugas tertunda mendapat slot: {key} (berjalan: normal={normal}/{maxNormal}, sniff={sniff}/{maxSniff})",
    },
    "log.taskQueue.scrapingGranted": {
        "es-ES": "Tarea de extracción pendiente obtuvo ranura: {key} (extrayendo: {scraping}/{maxScraping})",
        "pt-BR": "Tarefa de raspagem pendente obteve slot: {key} (raspando: {scraping}/{maxScraping})",
        "fr-FR": "Tâche d'extraction en attente a obtenu un emplacement : {key} (extraction : {scraping}/{maxScraping})",
        "id-ID": "Tugas ekstraksi tertunda mendapat slot: {key} (mengekstrak: {scraping}/{maxScraping})",
    },
    "log.taskQueue.slotFull": {
        "es-ES": "Ranuras llenas, tarea en cola: {key} (posición en cola {position})",
        "pt-BR": "Slots cheios, tarefa na fila: {key} (posição na fila {position})",
        "fr-FR": "Emplacements pleins, tâche en file : {key} (position dans la file {position})",
        "id-ID": "Slot penuh, tugas dalam antrean: {key} (posisi antrean {position})",
    },
    "log.taskQueue.scrapingFull": {
        "es-ES": "Ranuras de extracción llenas, tarea en cola: {key} (posición en cola {position})",
        "pt-BR": "Slots de raspagem cheios, tarefa na fila: {key} (posição na fila {position})",
        "fr-FR": "Emplacements d'extraction pleins, tâche en file : {key} (position dans la file {position})",
        "id-ID": "Slot ekstraksi penuh, tugas dalam antrean: {key} (posisi antrean {position})",
    },
    "log.taskQueue.configLoaded": {
        "es-ES": "Config cargada: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "pt-BR": "Config carregada: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "fr-FR": "Config chargée : maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "id-ID": "Konfigurasi dimuat: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
    },
    "log.taskQueue.configUpdated": {
        "es-ES": "Config actualizada: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "pt-BR": "Config atualizada: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "fr-FR": "Config mise à jour : maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
        "id-ID": "Konfigurasi diperbarui: maxConcurrent={maxConcurrent}, maxScraping={maxScraping}, maxSniff={maxSniff}, tsSegment={tsSegment}, galleryImage={galleryImage}",
    },
    "log.taskStateReset.cleanupSlots": {
        "es-ES": "Limpiando ranuras obsoletas: normal={normal}, sniff={sniff}, scraping={scraping}",
        "pt-BR": "Limpando slots antigos: normal={normal}, sniff={sniff}, scraping={scraping}",
        "fr-FR": "Nettoyage des anciens emplacements : normal={normal}, sniff={sniff}, scraping={scraping}",
        "id-ID": "Membersihkan slot lama: normal={normal}, sniff={sniff}, scraping={scraping}",
    },
    "log.taskStateReset.completed": {
        "es-ES": "Restablecimiento completado: videos {videoTasks}, galerías {galleries}, imágenes {galleryImages}, videos {galleryVideos}, sniff {sniffTasks}, info ZIP {galleryDownloadInfos}, total {total} tareas restablecidas a pendiente",
        "pt-BR": "Reset concluído: vídeos {videoTasks}, galerias {galleries}, imagens {galleryImages}, vídeos {galleryVideos}, sniff {sniffTasks}, info ZIP {galleryDownloadInfos}, total {total} tarefas redefinidas para pendente",
        "fr-FR": "Réinitialisation terminée : vidéos {videoTasks}, galeries {galleries}, images {galleryImages}, vidéos {galleryVideos}, sniff {sniffTasks}, infos ZIP {galleryDownloadInfos}, total {total} tâches réinitialisées en attente",
        "id-ID": "Reset selesai: video {videoTasks}, galeri {galleries}, gambar {galleryImages}, video {galleryVideos}, sniff {sniffTasks}, info ZIP {galleryDownloadInfos}, total {total} tugas direset ke tertunda",
    },
}

def fix_file(lang):
    fp = os.path.join(LOCALES_DIR, f"{lang}.ts")
    lines = io.open(fp, encoding="utf-8").read().split("\n")
    out = []
    fixed = 0
    for line in lines:
        replaced = False
        for key, bylang in FIXES.items():
            # 匹配该 key 的已有行（可能带旧前缀或修复后的完整格式）
            if f'"{key}"' in line:
                out.append(f'  "{key}": "{esc(bylang[lang])}",')
                fixed += 1
                replaced = True
                break
        if not replaced:
            out.append(line)
    io.open(fp, "w", encoding="utf-8", newline="").write("\n".join(out))
    print(f"[OK] {lang}/log: 替换 {fixed} 处")

if __name__ == "__main__":
    for lang in ["es-ES", "pt-BR", "fr-FR", "id-ID"]:
        fix_file(lang)
