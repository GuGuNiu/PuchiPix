/**
 * Deep placeholder consistency audit:
 * Type A: translation contains placeholders zh-CN lacks (real bug; runtime renders literal {xxx}).
 * Type B: translation is missing placeholders present in zh-CN (information loss).
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
console.log("=== Type A: translation has placeholders zh-CN lacks (renders literal {xxx}) ===");
for (const lang of LANGS) {
  for (const mod of MODULES) {
    const d = parseKeys(path.join(localesDir, mod, `${lang}.ts`));
    for (const [k, v] of d) {
      const zhv = zh[mod].get(k);
      if (!zhv) continue;
      const extra = [...ph(v)].filter((p) => !ph(zhv).has(p));
      if (extra.length) {
        console.log(`${lang} ${mod} ${k} => extra: ${extra.join(",")}`);
        a++;
      }
    }
  }
}
console.log("Type A total:", a);
console.log();
console.log("=== Type B: translation missing zh-CN placeholders (information loss, not an error) ===");
for (const lang of LANGS) {
  for (const mod of MODULES) {
    const d = parseKeys(path.join(localesDir, mod, `${lang}.ts`));
    for (const [k, v] of d) {
      const zhv = zh[mod].get(k);
      if (!zhv) continue;
      const miss = [...ph(zhv)].filter((p) => !ph(v).has(p));
      if (miss.length) {
        console.log(`${lang} ${mod} ${k} => missing: ${miss.join(",")}`);
        b++;
      }
    }
  }
}
console.log("Type B total:", b);
