"""
后端 i18n 补齐脚本 v2（正确优先级）：
1. 前端同语言 api 模块翻译（最准确）
2. 后端 en-US 翻译
3. 手工提供的剩余 key（api.slots.* / api.tasks.* 等 11 个）多语言翻译
"""
import io, json, os, re

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "internal", "i18n", "locales")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "i18n", "locales", "api")

LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID"]

def parse_ts(fp):
    content = io.open(fp, encoding="utf-8").read()
    entries = {}
    regex = re.compile(r'"([A-Za-z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"')
    for m in regex.finditer(content):
        entries[m.group(1)] = m.group(2).replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
    return entries

# 1. 前端各语言 api 模块翻译
front = {}
for lang in LANGS:
    fp = os.path.join(FRONTEND_DIR, f"{lang}.ts")
    front[lang] = parse_ts(fp) if os.path.exists(fp) else {}

# 2. 手工提供剩余 11 个 key 的全语言翻译
EXTRA = {
    "api.slots.invalidMax": {
        "zh-CN": "插槽最大值无效", "zh-TW": "插槽最大值無效", "en-US": "Invalid slot max value",
        "ja-JP": "スロット最大値が無効です", "ko-KR": "슬롯 최대값이 잘못되었습니다", "ru-RU": "Недопустимое максимальное значение слотов",
        "de-DE": "Ungültiger maximaler Slot-Wert", "vi-VN": "Giá trị tối đa slot không hợp lệ", "es-ES": "Valor máximo de ranura no válido",
        "pt-BR": "Valor máximo de slot inválido", "fr-FR": "Valeur maximale de slot invalide", "id-ID": "Nilai maksimal slot tidak valid",
    },
    "api.slots.missingSlotType": {
        "zh-CN": "缺少 slotType 参数", "zh-TW": "缺少 slotType 參數", "en-US": "Missing slotType parameter",
        "ja-JP": "slotType パラメータが不足しています", "ko-KR": "slotType 매개변수가 없습니다", "ru-RU": "Отсутствует параметр slotType",
        "de-DE": "slotType-Parameter fehlt", "vi-VN": "Thiếu tham số slotType", "es-ES": "Falta el parámetro slotType",
        "pt-BR": "Parâmetro slotType ausente", "fr-FR": "Paramètre slotType manquant", "id-ID": "Parameter slotType tidak ada",
    },
    "api.slots.slotTypeNotFound": {
        "zh-CN": "未找到该类型的插槽", "zh-TW": "找不到該類型的插槽", "en-US": "Slot type not found",
        "ja-JP": "該当タイプのスロットが見つかりません", "ko-KR": "해당 유형의 슬롯을 찾을 수 없습니다", "ru-RU": "Тип слота не найден",
        "de-DE": "Slot-Typ nicht gefunden", "vi-VN": "Không tìm thấy loại slot", "es-ES": "Tipo de ranura no encontrado",
        "pt-BR": "Tipo de slot não encontrado", "fr-FR": "Type de slot introuvable", "id-ID": "Jenis slot tidak ditemukan",
    },
    "api.sniff.deleteFailed": {
        "zh-CN": "删除嗅探任务失败", "zh-TW": "刪除嗅探任務失敗", "en-US": "Failed to delete sniff task",
        "ja-JP": "スニッフタスクの削除に失敗しました", "ko-KR": "스니프 작업 삭제에 실패했습니다", "ru-RU": "Не удалось удалить задачу сниффинга",
        "de-DE": "Löschen der Sniff-Aufgabe fehlgeschlagen", "vi-VN": "Xóa tác vụ sniff thất bại", "es-ES": "Error al eliminar la tarea de sniffing",
        "pt-BR": "Falha ao excluir tarefa de sniffing", "fr-FR": "Échec de la suppression de la tâche de sniffing", "id-ID": "Gagal menghapus tugas sniff",
    },
    "api.sniff.missingId": {
        "zh-CN": "缺少嗅探任务 ID", "zh-TW": "缺少嗅探任務 ID", "en-US": "Missing sniff task ID",
        "ja-JP": "スニッフタスク ID が不足しています", "ko-KR": "스니프 작업 ID가 없습니다", "ru-RU": "Отсутствует ID задачи сниффинга",
        "de-DE": "Sniff-Aufgaben-ID fehlt", "vi-VN": "Thiếu ID tác vụ sniff", "es-ES": "Falta el ID de la tarea de sniffing",
        "pt-BR": "ID da tarefa de sniffing ausente", "fr-FR": "ID de tâche de sniffing manquant", "id-ID": "ID tugas sniff tidak ada",
    },
    "api.tasks.deleteFailed": {
        "zh-CN": "删除任务失败", "zh-TW": "刪除任務失敗", "en-US": "Failed to delete task",
        "ja-JP": "タスクの削除に失敗しました", "ko-KR": "작업 삭제에 실패했습니다", "ru-RU": "Не удалось удалить задачу",
        "de-DE": "Löschen der Aufgabe fehlgeschlagen", "vi-VN": "Xóa tác vụ thất bại", "es-ES": "Error al eliminar la tarea",
        "pt-BR": "Falha ao excluir tarefa", "fr-FR": "Échec de la suppression de la tâche", "id-ID": "Gagal menghapus tugas",
    },
    "api.tasks.pauseFailed": {
        "zh-CN": "暂停任务失败", "zh-TW": "暫停任務失敗", "en-US": "Failed to pause task",
        "ja-JP": "タスクの一時停止に失敗しました", "ko-KR": "작업 일시 중지에 실패했습니다", "ru-RU": "Не удалось приостановить задачу",
        "de-DE": "Pausieren der Aufgabe fehlgeschlagen", "vi-VN": "Tạm dừng tác vụ thất bại", "es-ES": "Error al pausar la tarea",
        "pt-BR": "Falha ao pausar tarefa", "fr-FR": "Échec de la pause de la tâche", "id-ID": "Gagal menjeda tugas",
    },
    "api.tasks.resumeFailed": {
        "zh-CN": "恢复任务失败", "zh-TW": "恢復任務失敗", "en-US": "Failed to resume task",
        "ja-JP": "タスクの再開に失敗しました", "ko-KR": "작업 재개에 실패했습니다", "ru-RU": "Не удалось возобновить задачу",
        "de-DE": "Fortsetzen der Aufgabe fehlgeschlagen", "vi-VN": "Tiếp tục tác vụ thất bại", "es-ES": "Error al reanudar la tarea",
        "pt-BR": "Falha ao retomar tarefa", "fr-FR": "Échec de la reprise de la tâche", "id-ID": "Gagal melanjutkan tugas",
    },
    "api.tasks.retryFailed": {
        "zh-CN": "重试任务失败", "zh-TW": "重試任務失敗", "en-US": "Failed to retry task",
        "ja-JP": "タスクの再試行に失敗しました", "ko-KR": "작업 재시도에 실패했습니다", "ru-RU": "Не удалось повторить задачу",
        "de-DE": "Wiederholen der Aufgabe fehlgeschlagen", "vi-VN": "Thử lại tác vụ thất bại", "es-ES": "Error al reintentar la tarea",
        "pt-BR": "Falha ao tentar novamente a tarefa", "fr-FR": "Échec de la nouvelle tentative de la tâche", "id-ID": "Gagal mencoba ulang tugas",
    },
    "api.tasks.startFailed": {
        "zh-CN": "启动任务失败", "zh-TW": "啟動任務失敗", "en-US": "Failed to start task",
        "ja-JP": "タスクの開始に失敗しました", "ko-KR": "작업 시작에 실패했습니다", "ru-RU": "Не удалось запустить задачу",
        "de-DE": "Starten der Aufgabe fehlgeschlagen", "vi-VN": "Khởi động tác vụ thất bại", "es-ES": "Error al iniciar la tarea",
        "pt-BR": "Falha ao iniciar tarefa", "fr-FR": "Échec du démarrage de la tâche", "id-ID": "Gagal memulai tugas",
    },
    "api.tasks.unknownAction": {
        "zh-CN": "未知操作", "zh-TW": "未知操作", "en-US": "Unknown action",
        "ja-JP": "不明な操作です", "ko-KR": "알 수 없는 작업입니다", "ru-RU": "Неизвестное действие",
        "de-DE": "Unbekannte Aktion", "vi-VN": "Hành động không xác định", "es-ES": "Acción desconocida",
        "pt-BR": "Ação desconhecida", "fr-FR": "Action inconnue", "id-ID": "Tindakan tidak diketahui",
    },
}

total_filled = 0
for lang in LANGS:
    fp = os.path.join(BACKEND_DIR, f"{lang}.json")
    d = json.load(io.open(fp, encoding="utf-8"))
    filled = 0
    # 1. 前端同语言 api 翻译
    for k, v in front[lang].items():
        if k not in d:
            d[k] = v
            filled += 1
    # 2. 后端 en-US
    en_dict = json.load(io.open(os.path.join(BACKEND_DIR, "en-US.json"), encoding="utf-8"))
    for k, v in en_dict.items():
        if k not in d:
            d[k] = v
            filled += 1
    # 3. 手工 EXTRA
    for k, vmap in EXTRA.items():
        if k not in d:
            d[k] = vmap[lang]
            filled += 1
    json.dump(d, io.open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    total_filled += filled
    print(f"[OK] backend/{lang}.json: 补齐 {filled} 个 key (共 {len(d)})")

print(f"\n后端总计补齐 {total_filled} 个 key")
