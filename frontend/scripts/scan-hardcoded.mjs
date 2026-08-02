/**
 * 硬编码文本扫描脚本：
 * 1. JSX 中的中文文本节点（如 <span>中文</span>）
 * 2. 字符串字面量中的中文（如 const msg = "中文"）
 * 排除：i18n locale 文件本身、注释、样式、store 里的数据值等
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
    // 跳过纯 CSS / 类名
    if (/className\s*=\s*["'`][^"'`]*[\u4e00-\u9fff]/.test(noComment) && !/["'`][^"'`]*[\u4e00-\u9fff][^"'`]*["'`]\s*[,)]/.test(noComment)) {
      return;
    }
    // 跳过 import / require
    if (/^\s*(import|export).*from/.test(noComment)) return;
    // 跳过 type 定义里的中文（比如站名）
    if (/^\s*(type|interface|const .*:)\s/.test(noComment)) return;

    // 判断是否在 t() 调用内 —— 粗略：本行出现 t(" 或 t(`
    const isTranslated = /[^a-zA-Z]t\(\s*["'`]/.test(noComment);

    // 找出含中文的字符串字面量
    const strMatches = [...noComment.matchAll(/["'`]([^"'`]*[\u4e00-\u9fff][^"'`]*)["'`]/g)];
    if (strMatches.length === 0) return;

    const jsxText = />[^<>{}]*[\u4e00-\u9fff][^<>{}]*</.test(noComment);

    if (!isTranslated && (strMatches.length || jsxText)) {
      // 过滤明显非 UI 文本：URL、错误处理常量、站点数据等
      const suspicious = strMatches
        .map((m) => m[1])
        .filter((s) => s.length <= 60 && !s.includes("://") && !/^(https?:|m3u8|M3U8)/.test(s))
        .join(" | ");
      results.push({
        file: rel,
        line: idx + 1,
        code: line.trim().slice(0, 140),
        strings: suspicious || (jsxText ? "<JSX 文本>" : ""),
      });
    }
  });
}

// 输出
for (const r of results) {
  console.log(`${r.file}:${r.line}`);
  console.log(`  ${r.code}`);
  if (r.strings) console.log(`  STR: ${r.strings}`);
}
console.log(`\n总计 ${results.length} 处可疑硬编码`);
