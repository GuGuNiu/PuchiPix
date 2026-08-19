/**
 * i18n 审计脚本：对比所有语言文件 vs zh-CN（权威 key 源）
 * 输出：各语言缺失 key / 多余 key / 占位符不一致
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
  // 匹配 "key": "value" — 注意跨行字符串
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
console.log("【1】缺失 key 统计（相对 zh-CN，按模块）");
console.log("=".repeat(90));
console.log(`${"语言".padEnd(8)} ${MODULES.map((m) => m.padEnd(8)).join(" ")}  合计缺失`);
for (const lang of LANGS) {
  if (lang === "zh-CN") continue;
  const parts = [];
  let total = 0;
  for (const mod of MODULES) {
    const d = data[lang][mod];
    if (!d) { parts.push("文件缺失".padEnd(8)); total += zh[mod].entries.length; continue; }
    const zhKeys = zh[mod].entries.map((e) => e.key);
    const missing = zhKeys.filter((k) => !d.map.has(k));
    parts.push(String(missing.length).padEnd(8));
    total += missing.length;
  }
  console.log(`${lang.padEnd(8)} ${parts.join(" ")}  ${total}`);
}

console.log();
console.log("=".repeat(90));
console.log("【2】多余 key（zh-CN 没有的，可能导致未翻译文本）");
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
console.log("【3】占位符不一致（{xxx} 与 zh-CN 不同）");
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

// 汇总缺失 key 明细（对每个语言列出缺失的 key 名，便于补翻译）
console.log();
console.log("=".repeat(90));
console.log("【4】缺失 key 明细（按语言）");
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
  console.log(`\n### ${lang} (共 ${missingAll.length} 组缺项)`);
  for (const g of missingAll) console.log(`  ${g}`);
}
