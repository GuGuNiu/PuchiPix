/**
 * I18n audit script: compare all language files against zh-CN (authoritative key source).
 * Output: missing keys / extra keys / placeholder mismatches per language.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "../src/lib/i18n/locales");
const MODULES = ["ui", "tasks", "blocklist", "api", "log"];
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID"];

function parseKeys(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  // Match "key": "value" pairs (string values may span lines).
  const entries = [];
  const regex = /"([A-Za-z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const key = m[1];
    const value = m[2]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    entries.push({ key, value });
  }
  return entries;
}

function placeholders(value) {
  const set = new Set();
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(value)) !== null) set.add(m[1]);
  return set;
}

const data = {};
for (const lang of LANGS) {
  data[lang] = {};
  for (const mod of MODULES) {
    const fp = path.join(localesDir, mod, `${lang}.ts`);
    if (!fs.existsSync(fp)) {
      data[lang][mod] = null;
      continue;
    }
    const entries = parseKeys(fp);
    data[lang][mod] = { entries, map: new Map(entries.map((e) => [e.key, e])) };
  }
}

const zh = data["zh-CN"];
const zhAllKeys = new Set();
for (const mod of MODULES) {
  for (const e of zh[mod].entries) zhAllKeys.add(`${mod}.${e.key}`);
}

console.log("=".repeat(90));
console.log("[1] Missing keys (vs zh-CN, by module)");
console.log("=".repeat(90));
console.log(`${"Language".padEnd(8)} ${MODULES.map((m) => m.padEnd(8)).join(" ")}  Total missing`);
for (const lang of LANGS) {
  if (lang === "zh-CN") continue;
  const parts = [];
  let total = 0;
  for (const mod of MODULES) {
    const d = data[lang][mod];
    if (!d) { parts.push("no file  ".padEnd(8)); total += zh[mod].entries.length; continue; }
    const zhKeys = zh[mod].entries.map((e) => e.key);
    const missing = zhKeys.filter((k) => !d.map.has(k));
    parts.push(String(missing.length).padEnd(8));
    total += missing.length;
  }
  console.log(`${lang.padEnd(8)} ${parts.join(" ")}  ${total}`);
}

console.log();
console.log("=".repeat(90));
console.log("[2] Extra keys (absent from zh-CN; may render untranslated text)");
console.log("=".repeat(90));
for (const lang of LANGS) {
  if (lang === "zh-CN") continue;
  for (const mod of MODULES) {
    const d = data[lang][mod];
    if (!d) continue;
    const zhKeys = new Set(zh[mod].entries.map((e) => e.key));
    const extra = d.entries.filter((e) => !zhKeys.has(e.key));
    if (extra.length) {
      console.log(`${lang} ${mod}: ${extra.map((e) => e.key).join(", ")}`);
    }
  }
}

console.log();
console.log("=".repeat(90));
console.log("[3] Placeholder mismatches ({xxx} differs from zh-CN)");
console.log("=".repeat(90));
for (const lang of LANGS) {
  if (lang === "zh-CN") continue;
  for (const mod of MODULES) {
    const d = data[lang][mod];
    if (!d) continue;
    for (const [key, e] of d.map) {
      const zhE = zh[mod].map.get(key);
      if (!zhE) continue;
      const zhPh = placeholders(zhE.value);
      const ph = placeholders(e.value);
      if (zhPh.size !== ph.size || [...zhPh].some((p) => !ph.has(p))) {
        console.log(`${lang} ${mod} ${key}`);
        console.log(`  zh: ${JSON.stringify(zhE.value)}`);
        console.log(`  ${lang}: ${JSON.stringify(e.value)}`);
      }
    }
  }
}

// Detailed missing-key listing per language (for translation follow-up).
console.log();
console.log("=".repeat(90));
console.log("[4] Missing key details (by language)");
console.log("=".repeat(90));
for (const lang of LANGS) {
  if (lang === "zh-CN") continue;
  const missingAll = [];
  for (const mod of MODULES) {
    const d = data[lang][mod];
    if (!d) {
      missingAll.push(`[${mod} 整个文件缺失: ${zh[mod].entries.length} keys]`);
      continue;
    }
    const zhKeys = zh[mod].entries.map((e) => e.key);
    const missing = zhKeys.filter((k) => !d.map.has(k));
    if (missing.length) missingAll.push(`[${mod}: ${missing.join(", ")}]`);
  }
  console.log(`\n### ${lang} (${missingAll.length} missing groups)`);
  for (const g of missingAll) console.log(`  ${g}`);
}
