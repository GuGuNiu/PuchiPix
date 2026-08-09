/**
 * SSE 事件契约交叉验证脚本
 *
 * 比对后端 task_stream.go 发射的事件名 与 前端 store 订阅的事件名，
 * 防止"后端改了事件名、前端没同步"的契约漂移（P-TSG 高复发模式）。
 *
 * 用法:
 *   node scripts/sse-contract-check.mjs            # 从仓库根目录运行
 *
 * 退出码:
 *   0 = 契约一致（或仅存在白名单内的事件）
 *   1 = 发现不匹配（后端发射但前端未订阅 / 前端订阅但后端不发射）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const backendStream = path.resolve(root, "../backend/internal/api/task_stream.go");
const storeDir = path.resolve(root, "src/store");

// 前端不消费的后端事件白名单（有专门订阅通道或无需实时展示）
const BACKEND_ONLY_ALLOWLIST = new Set([
  // slot:stateChanged 由 /api/tasks/stream 推送；前端当前无槽位面板消费，
  // 需要实时占用时订阅该事件或轮询 GET /api/slots。
  // 原 /api/slots/stream 专用端点已于 260806 移除（无任何消费者）。
  "slot:stateChanged",
  // dag:nodeStateChanged 供 CLI `watch` 命令经 /api/dag/stream 专用通道消费；
  // 前端任务列表/图库页无需实时展示 DAG 节点状态。
  "dag:nodeStateChanged",
  // gallery:downloadProgress 历史遗留转发：后端 EventBus 实际零发射点（见 260803 排查），
  // 画廊下载进度由 task:progress(completed/total/failed) 承担；待后端清理发射源后移除
  "gallery:downloadProgress",
]);

// 基础设施事件（shared-sse 内部处理，非业务 store 订阅）
const INFRA_EVENTS = new Set(["initial", "status", "heartbeat"]);

function fail(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
  return false;
}

function pass(msg) {
  console.log(`\x1b[32m✅ ${msg}\x1b[0m`);
  return true;
}

// ── 1. 从后端 task_stream.go 提取 SendEvent 事件名 ──
function extractBackendEvents() {
  if (!fs.existsSync(backendStream)) {
    console.error(`\x1b[33m⚠️ 未找到后端文件: ${backendStream}\x1b[0m（跳过后端侧检查）`);
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

// ── 2. 从前端 store 提取 subscribeSseEvent 订阅名 ──
function extractFrontendSubscriptions() {
  const files = fs.readdirSync(storeDir).filter((f) => f.endsWith(".ts"));
  const subs = new Set();
  const fileMap = new Map(); // event -> [files]
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
  console.log("🔍 SSE 事件契约交叉验证\n");

  const backend = extractBackendEvents();
  const frontend = extractFrontendSubscriptions();

  let ok = true;

  // ── A. 前端订阅但后端不发射（死订阅） ──
  if (backend.found) {
    console.log("── 前端订阅 vs 后端发射 ──");
    for (const ev of [...frontend.subs].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      if (backend.events.has(ev)) {
        pass(`前端订阅 "${ev}" ← 后端发射 ✓ (${frontend.fileMap.get(ev).join(", ")})`);
      } else {
        ok = fail(`前端订阅 "${ev}" 但后端 task_stream.go 从不发射 → 死订阅 (${frontend.fileMap.get(ev).join(", ")})`);
      }
    }
    console.log();

    // ── B. 后端发射但前端未订阅（事件断层） ──
    console.log("── 后端发射 vs 前端订阅 ──");
    for (const ev of [...backend.events].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      if (frontend.subs.has(ev) || BACKEND_ONLY_ALLOWLIST.has(ev)) {
        if (BACKEND_ONLY_ALLOWLIST.has(ev) && !frontend.subs.has(ev)) {
          pass(`后端发射 "${ev}" — 白名单事件（前端有专用通道）`);
        }
      } else {
        ok = fail(`后端发射 "${ev}" 但前端 store 无订阅 → 事件断层，前端状态将滞后`);
      }
    }
  } else {
    // 后端文件不可见时仅做前端死订阅检查
    for (const ev of [...frontend.subs].sort()) {
      if (INFRA_EVENTS.has(ev)) continue;
      ok = fail(`前端订阅 "${ev}"（后端文件不可见，无法验证发射源）`);
    }
  }

  console.log();
  if (ok) {
    console.log("\x1b[32m🎉 SSE 事件契约一致：无死订阅，无事件断层\x1b[0m");
    process.exit(0);
  }
  console.log("\x1b[31m📋 SSE 事件契约存在漂移，请先修复再提交。\x1b[0m");
  process.exit(1);
}

main();
