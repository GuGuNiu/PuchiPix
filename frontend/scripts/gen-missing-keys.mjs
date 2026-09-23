/**
 * Generate the missing-key worksheet (zh-CN source text as reference).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "../src/lib/i18n/locales");
const MODULES = ["ui", "tasks", "blocklist", "api", "log"];
const LANGS = ["zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID"];

function parseKeys(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const entries = [];
  const regex = /"([A-Za-z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    entries.push({
      key: m[1],
      value: m[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    });
  }
  return entries;
}

const zh = {};
for (const mod of MODULES) {
  zh[mod] = new Map(parseKeys(path.join(localesDir, mod, "zh-CN.ts")).map((e) => [e.key, e.value]));
}

let out = "";
for (const lang of LANGS) {
  const missing = {};
  for (const mod of MODULES) {
    const d = parseKeys(path.join(localesDir, mod, `${lang}.ts`)).map((e) => e.key);
    const m = [...zh[mod].keys()].filter((k) => !d.includes(k));
    if (m.length) missing[mod] = m;
  }
  const total = Object.values(missing).reduce((a, b) => a + b.length, 0);
  if (total === 0) continue;
  out += `### ${lang} (${total})\n`;
  for (const [mod, keys] of Object.entries(missing)) {
    out += `[${mod}]\n`;
    for (const k of keys) {
      out += `  ${k} => ${zh[mod].get(k)}\n`;
    }
  }
}
fs.writeFileSync(path.resolve(__dirname, "missing-keys.txt"), out, "utf8");
console.log(out.length > 200 ? out.slice(0, 200) + "\n...(total " + out.length + " chars)" : out);
