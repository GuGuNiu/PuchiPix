/**
 * SSE event contract cross-check script.
 *
 * Compares event names emitted by backend task_stream.go against event names
 * subscribed by frontend stores, guarding against contract drift where the
 * backend renames an event and the frontend does not follow (a high-recurrence
 * P-TSG pattern).
 *
 * Usage:
 *   node scripts/sse-contract-check.mjs            # run from the repo root
 *
 * Exit codes:
 *   0 = contract consistent (or only allowlisted events differ)
 *   1 = mismatch found (backend emits but frontend never subscribes, or vice versa)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const backendStream = path.resolve(root, "../backend/internal/api/task_stream.go");
const storeDir = path.resolve(root, "src/store");

// Backend events the frontend does not consume (dedicated channel or no real-time UI needed).
const BACKEND_ONLY_ALLOWLIST = new Set([
  /*
   * Slot:stateChanged is pushed via /api/tasks/stream; the frontend has no
   * slot panel consumer today. Subscribe to this event (or poll GET /api/slots)
   * when live occupancy display is needed.
   * The dedicated /api/slots/stream endpoint was removed on 260806 (no consumers).
   */
  "slot:stateChanged",
  /*
   * Dag:nodeStateChanged is consumed by the CLI `watch` command through the
   * dedicated /api/dag/stream channel; the frontend task list / gallery pages
   * do not need real-time DAG node status.
   */
  "dag:nodeStateChanged",
  /*
   * Gallery:downloadProgress is a legacy forward: the backend EventBus has zero
   * emission sites (see 260803 investigation). Gallery download progress is
   * carried by task:progress (completed/total/failed). Remove once the backend
   * emission source is cleaned up.
   */
  "gallery:downloadProgress",
]);

// Infrastructure events (handled inside shared-sse, not subscribed by business stores).
const INFRA_EVENTS = new Set(["initial", "status", "heartbeat"]);

function fail(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
  return false;
}

function pass(msg) {
  console.log(`\x1b[32m✅ ${msg}\x1b[0m`);
  return true;
}

// ── 1. Extract SendEvent event names from backend task_stream.go ──
function extractBackendEvents() {
  if (!fs.existsSync(backendStream)) {
    console.error(`\x1b[33m⚠️ Backend file not found: ${backendStream}\x1b[0m (skipping backend-side check)`);
    return { events: new Set(), found: false };
  }
  const src = fs.readFileSync(backendStream, "utf8");
  const events = new Set();
  const re = /SendEvent\(\s*"([A-Za-z0-9:_-]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    events.add(m[1]);
  }
  return { events, found: true };
}

// ── 2. Extract subscribeSseEvent subscription names from frontend stores ──
function extractFrontendSubscriptions() {
  const files = fs.readdirSync(storeDir).filter((f) => f.endsWith(".ts"));
  const subs = new Set();
  const fileMap = new Map(); // Event -> [files]
  for (const file of files) {
    const src = fs.readFileSync(path.join(storeDir, file), "utf8");
    const re = /subscribeSseEvent\(\s*'([A-Za-z0-9:_-]+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const ev = m[1];
      subs.add(ev);
      if (!fileMap.has(ev)) fileMap.set(ev, []);
      fileMap.get(ev).push(file);
    }
  }
  return { subs, fileMap };
}

function main() {
  console.log("🔍 SSE event contract cross-check\n");

  const backend = extractBackendEvents();
  const frontend = extractFrontendSubscriptions();

  let ok = true;

  // ── A. Frontend subscribes but backend never emits (dead subscription) ──
  if (backend.found) {
    console.log("── Frontend subscriptions vs backend emissions ──");
    for (const ev of [...frontend.subs].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      if (backend.events.has(ev)) {
        pass(`frontend subscribes "${ev}" ← backend emits ✓ (${frontend.fileMap.get(ev).join(", ")})`);
      } else {
        ok = fail(`frontend subscribes "${ev}" but backend task_stream.go never emits it → dead subscription (${frontend.fileMap.get(ev).join(", ")})`);
      }
    }
    console.log();

    // ── B. Backend emits but frontend never subscribes (contract gap) ──
    console.log("── Backend emissions vs frontend subscriptions ──");
    for (const ev of [...backend.events].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      if (frontend.subs.has(ev) || BACKEND_ONLY_ALLOWLIST.has(ev)) {
        if (BACKEND_ONLY_ALLOWLIST.has(ev) && !frontend.subs.has(ev)) {
          pass(`backend emits "${ev}" — allowlisted (frontend has a dedicated channel)`);
        }
      } else {
        ok = fail(`backend emits "${ev}" but no frontend store subscribes → contract gap; frontend state will lag`);
      }
    }
  } else {
    // Backend file invisible: only check frontend dead subscriptions.
    for (const ev of [...frontend.subs].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      ok = fail(`frontend subscribes "${ev}" (backend file not visible; emission source cannot be verified)`);
    }
  }

  console.log();
  if (ok) {
    console.log("\x1b[32m🎉 SSE event contract consistent: no dead subscriptions, no gaps\x1b[0m");
    process.exit(0);
  }
  console.log("\x1b[31m📋 SSE event contract drifted; fix before committing.\x1b[0m");
  process.exit(1);
}

main();
