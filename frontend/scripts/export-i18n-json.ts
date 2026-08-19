/**
 * Exports frontend i18n dictionaries to JSON files for Go embed.
 * Run: npx tsx scripts/export-i18n-json.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOCALES = [
  "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR",
  "ru-RU", "de-DE", "vi-VN", "es-ES", "pt-BR", "fr-FR", "id-ID",
] as const;

const OUTPUT_DIR = resolve(__dirname, "..", "..", "backend", "internal", "i18n", "locales");

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const locale of LOCALES) {
    const mod = await import(`../src/lib/i18n/locales/${locale}.ts`);
    const dict: Record<string, string> = mod.default;
    const json = JSON.stringify(dict, null, 2) + "\n";
    const outPath = resolve(OUTPUT_DIR, `${locale}.json`);
    writeFileSync(outPath, json, "utf-8");
    console.log(`  ${locale}: ${Object.keys(dict).length} keys -> ${outPath}`);
  }

  console.log(`\nDone: ${LOCALES.length} locale files exported to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
