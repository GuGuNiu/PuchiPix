/*
 * Compares the event names emitted by the backend task stream against the event
 * names subscribed by the frontend stores, so a backend rename cannot silently
 * drift the contract. Exits 1 on a mismatch.
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
   * Pushed via /api/tasks/stream; the frontend has no slot panel consumer.
   * Subscribe to it (or poll GET /api/slots) when live occupancy display is needed.
   */
  "slot:stateChanged",
  /*
   * Consumed by the CLI watch command through the dedicated /api/dag/stream
   * channel; the task list and gallery pages do not need real-time node status.
   */
  "dag:nodeStateChanged",
  /*
   * Legacy event with no emission site in the backend EventBus; gallery download
   * progress is carried by task:progress (completed/total/failed).
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

  // Dead subscription: the frontend subscribes but the backend never emits
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

    // Contract gap: the backend emits but no frontend store subscribes
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
