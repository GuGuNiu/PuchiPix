"""
用后端 JSON 翻译补齐前端 pt-BR/fr-FR/id-ID 的 log 模块缺失 key（86 个）。
后端 JSON 的 key 与前端一致，直接复用。
"""
import io, json, os, re

LOCALES_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "i18n", "locales", "log")
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "internal", "i18n", "locales")

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

def keys_of(fp):
    s = io.open(fp, encoding="utf-8").read()
    return set(re.findall(r'"([a-zA-Z][a-zA-Z0-9_.]+)"\s*:', s))

for lang in ["pt-BR", "fr-FR", "id-ID"]:
    fp = os.path.join(LOCALES_DIR, f"{lang}.ts")
    content = io.open(fp, encoding="utf-8").read()
    existing = keys_of(fp)
    be = json.load(io.open(os.path.join(BACKEND_DIR, f"{lang}.json"), encoding="utf-8"))
    # 只补 log.* 且当前缺失的
    missing = {k: v for k, v in be.items() if k.startswith("log.") and k not in existing}
    if not missing:
        print(f"[--] {lang}: 无缺失")
        continue
    lines = [f'  "{k}": "{esc(v)}",' for k, v in sorted(missing.items())]
    block = "\n".join(lines) + "\n"
    m = list(re.finditer(r"\};|}\s+satisfies\s+\w+;", content))
    idx = m[-1].start() if m else -1
    if idx == -1:
        print(f"[ERR] {lang}: 找不到闭合")
        continue
    content = content[:idx] + block + content[idx:]
    io.open(fp, "w", encoding="utf-8", newline="").write(content)
    print(f"[OK] {lang}: 补齐 {len(missing)} 个 log key")
