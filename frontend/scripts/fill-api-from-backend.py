"""
将后端使用的 35 个 api key 同步到前端所有语言（防御性：后端 dict 缺失时返回 key 原文，前端需能翻译）。
数据源：后端各语言 JSON 的翻译。
"""
import io, json, os, re

FRONTEND_API_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "i18n", "locales", "api")
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "internal", "i18n", "locales")
LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID"]

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

def keys_of(s):
    return set(re.findall(r'"([a-zA-Z][a-zA-Z0-9_.]+)"\s*:', s))

# 后端使用的 api key（排除前端已存在的）
BACKEND_KEYS_FILE = os.path.join(os.path.dirname(__file__), "backend-keys.txt")
backend_keys = [l.strip() for l in io.open(BACKEND_KEYS_FILE, encoding="utf-8") if l.strip()]

for lang in LANGS:
    fp = os.path.join(FRONTEND_API_DIR, f"{lang}.ts")
    content = io.open(fp, encoding="utf-8").read()
    existing = keys_of(content)
    be = json.load(io.open(os.path.join(BACKEND_DIR, f"{lang}.json"), encoding="utf-8"))
    missing = {k: be[k] for k in backend_keys if k not in existing and k in be}
    if not missing:
        print(f"[--] {lang}: 无需补充")
        continue
    lines = [f'  "{k}": "{esc(v)}",' for k, v in sorted(missing.items())]
    block = "\n".join(lines) + "\n"
    m = list(re.finditer(r"\};|}\s+satisfies\s+\w+;", content))
    idx = m[-1].start() if m else -1
    content = content[:idx] + block + content[idx:]
    io.open(fp, "w", encoding="utf-8", newline="").write(content)
    print(f"[OK] {lang}: 补充 {len(missing)} 个后端 api key")
