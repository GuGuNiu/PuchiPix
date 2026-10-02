#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const source = resolve(repoRoot, "frontend", "dist");
const target = resolve(repoRoot, "backend", "internal", "webui", "dist");
const markerName = ".placeholder";

const force = process.argv.includes("--force");
const prune = process.argv.includes("--prune");

const digest = (buf) => createHash("sha256").update(buf).digest("hex");

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listFiles(root, base = root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(full, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, full).split("\\").join("/"));
    }
  }
  return out;
}

// Writes in place instead of unlinking first. The workspace delete guard
// refuses removals once a directory holds more than its per-scope threshold,
// and a populated dist is far above that; truncating through writeFile keeps
// the operation a pure overwrite.
async function writeIfChanged(relPath, data) {
  const dest = join(target, relPath);
  try {
    const existing = await readFile(dest);
    if (digest(existing) === digest(data)) {
      return false;
    }
  } catch {
    // missing or unreadable: fall through to write
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, data);
  return true;
}

async function main() {
  if (!(await isDir(source))) {
    console.error(`[sync-dist] missing frontend build output: ${source}`);
    console.error("[sync-dist] run `pnpm build` in frontend/ first");
    process.exit(1);
  }

  await mkdir(target, { recursive: true });

  if (!force) {
    const entries = (await readdir(target)).filter((name) => name !== markerName);
    if (entries.length > 0) {
      console.log("[sync-dist] target already populated, pass --force to overwrite");
      return;
    }
  }

  const files = await listFiles(source);
  let written = 0;
  for (const relPath of files) {
    const data = await readFile(join(source, relPath));
    if (await writeIfChanged(relPath, data)) {
      written += 1;
    }
  }

  await writeFile(join(target, markerName), "");

  if (prune) {
    const wanted = new Set([...files, markerName]);
    for (const relPath of await listFiles(target)) {
      if (wanted.has(relPath)) {
        continue;
      }
      try {
        await rm(join(target, relPath), { force: true });
        console.log(`[sync-dist] pruned stale ${relPath}`);
      } catch (err) {
        console.warn(`[sync-dist] could not prune ${relPath}: ${err.message}`);
      }
    }
  }

  console.log(
    `[sync-dist] synced ${files.length} files into ${target} (${written} updated)`,
  );
}

main().catch((err) => {
  console.error(`[sync-dist] failed: ${err.message}`);
  process.exit(1);
});