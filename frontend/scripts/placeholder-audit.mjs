/**
 * 占位符一致性深入审计：
 * A类: 翻译含 zh-CN 没有的占位符（真 bug，运行时显示 {xxx} 原文）
 * B类: 翻译缺失 zh-CN 的占位符（信息丢失）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "../src/lib/i18n/locales");
const MODULES = ["ui", "tasks", "blocklist", "api", "log"];
const LANGS = ["zh-TW", "en-US", "ja-JP", "ko-KR", "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID"];

function parseKeys(fp) {
  const content = fs.readFileSync(fp, "utf8");
  const entries = [];
  const regex = /"([A-Za-z0-9_.]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = regex.exec(content)) !== null) entries.push([m[1], m[2]]);
  return new Map(entries);
}

function ph(s) {
  return new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

const zh = {};
for (const mod of MODULES) zh[mod] = parseKeys(path.join(localesDir, mod, "zh-CN.ts"));

let a = 0, b = 0;
console.log("=== A类: 翻译含 zh 没有的占位符（会显示 {xxx} 原文）===");
for (const lang of LANGS) {
  for (const mod of MODULES) {
    const d = parseKeys(path.join(localesDir, mod, `${lang}.ts`));
    for (const [k, v] of d) {
      const zhv = zh[mod].get(k);
      if (!zhv) continue;
      const extra = [...ph(v)].filter((p) => !ph(zhv).has(p));
      if (extra.length) {
        console.log(`${lang} ${mod} ${k} => 多余: ${extra.join(",")}`);
        a++;
      }
    }
  }
}
console.log("A类总数:", a);
console.log();
console.log("=== B类: 翻译缺失 zh 的占位符（信息丢失，非错误）===");
for (const lang of LANGS) {
  for (const mod of MODULES) {
    const d = parseKeys(path.join(localesDir, mod, `${lang}.ts`));
    for (const [k, v] of d) {
      const zhv = zh[mod].get(k);
      if (!zhv) continue;
      const miss = [...ph(zhv)].filter((p) => !ph(v).has(p));
      if (miss.length) {
        console.log(`${lang} ${mod} ${k} => 缺失: ${miss.join(",")}`);
        b++;
      }
    }
  }
}
console.log("B类总数:", b);
