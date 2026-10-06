/*
 * Flags Chinese text in JSX text nodes and in string literals outside t() calls,
 * excluding the i18n locale files, comments, styles and store data values.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");
const EXCLUDE_DIRS = ["node_modules", "lib/i18n/locales"].map((d) => d.replace(/\//g, path.sep));

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.some((d) => full.includes(d))) continue;
      if (ent.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(srcDir);
const results = [];

for (const fp of files) {
  const content = fs.readFileSync(fp, "utf8");
  const lines = content.split("\n");
  const rel = path.relative(srcDir, fp).replace(/\\/g, "/");

  lines.forEach((line, idx) => {
    const noComment = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/[\u4e00-\u9fff]/.test(noComment)) return;
    // Skip pure CSS / class names.
    if (/className\s*=\s*["'`][^"'`]*[\u4e00-\u9fff]/.test(noComment) && !/["'`][^"'`]*[\u4e00-\u9fff][^"'`]*["'`]\s*[,)]/.test(noComment)) {
      return;
    }
    if (/^\s*(import|export).*from/.test(noComment)) return;

    // Skip Chinese inside type definitions (e.g. site names).
    if (/^\s*(type|interface|const .*:)\s/.test(noComment)) return;

    // Rough heuristic for being inside a t() call: the line contains t(" or t(`.
    const isTranslated = /[^a-zA-Z]t\(\s*["'`]/.test(noComment);

    const strMatches = [...noComment.matchAll(/["'`]([^"'`]*[\u4e00-\u9fff][^"'`]*)["'`]/g)];
    if (strMatches.length === 0) return;

    const jsxText = />[^<>{}]*[\u4e00-\u9fff][^<>{}]*</.test(noComment);

    if (!isTranslated && (strMatches.length || jsxText)) {
      // Filter obvious non-UI text: URLs, error-handling constants, site data, etc.
      const suspicious = strMatches
        .map((m) => m[1])
        .filter((s) => s.length <= 60 && !s.includes("://") && !/^(https?:|m3u8|M3U8)/.test(s))
        .join(" | ");
      results.push({
        file: rel,
        line: idx + 1,
        code: line.trim().slice(0, 140),
        strings: suspicious || (jsxText ? "<JSX text>" : ""),
      });
    }
  });
}

for (const r of results) {
  console.log(`${r.file}:${r.line}`);
  console.log(`  ${r.code}`);
  if (r.strings) console.log(`  STR: ${r.strings}`);
}
console.log(`\nTotal: ${results.length} suspicious hardcoded strings`);
