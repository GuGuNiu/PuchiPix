import type { Server as HTTPServer, IncomingMessage, ServerResponse } from "http";
import { createServer, request as httpRequest } from "http";
import { parse } from "url";
import next from "next";

const serverLogger = {
  info: (msg: string, data?: unknown) => console.log(`[Server] ${msg}`, data ?? ''),
  error: (msg: string, data?: unknown) => console.error(`[Server] ${msg}`, data ?? ''),
};

const GO_BACKEND_PORT = parseInt(process.env.GO_BACKEND_PORT || "10541", 10);
const GO_BACKEND_HOST = "localhost";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

function proxyToGo(req: IncomingMessage, res: ServerResponse): void {
  const options = {
    hostname: GO_BACKEND_HOST,
    port: GO_BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers },
  };

  // Remove hop-by-hop headers
  delete options.headers['connection'];
  delete options.headers['keep-alive'];
  delete options.headers['transfer-encoding'];

  const proxyReq = httpRequest(options, (proxyRes) => {
    // Preserve SSE content type for streaming
    if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    serverLogger.error("Proxy error", { error: err.message, url: req.url });
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Backend unavailable" }));
    }
  });

  // Set timeout to match typical API response
  proxyReq.setTimeout(60000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Gateway timeout" }));
    }
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }

  // Use res.on('close') instead of req.on('close') to detect
  // premature client disconnection. req 'close' fires when the
  // request body stream ends (e.g. POST body fully piped), which
  // is BEFORE the Go backend responds — destroying proxyReq at
  // that point kills the connection and causes 502.
  // res 'close' fires when the response is complete or the client
  // disconnects; writableEnded distinguishes the two.
  res.on('close', () => {
    if (!res.writableEnded) {
      proxyReq.destroy();
    }
  });
}

app.prepare().then(async () => {
  const server: HTTPServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const pathname = parsedUrl.pathname || "";

    // Proxy API requests and WebSocket to Go backend
    if (pathname.startsWith("/api/") || pathname === "/ws") {
      proxyToGo(req, res);
      return;
    }

    handle(req, res, parsedUrl);
  });

  // Handle WebSocket upgrade proxying to Go backend.
  // The frontend connects directly to ws://localhost:10541/ws via NativeWsClient,
  // so the Next.js proxy is bypassed for WebSocket. This handler ensures any
  // legacy /ws requests through the proxy are properly forwarded (rather than
  // silently destroyed).
  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url || "";
    if (pathname === "/ws" || pathname.startsWith("/ws?")) {
      serverLogger.info("WebSocket upgrade proxying to Go backend");
      const net = require('net');
      const proxySocket = net.connect(GO_BACKEND_PORT, GO_BACKEND_HOST, () => {
        // Write the original upgrade request to Go backend
        const headers = [
          `${req.method} ${req.url} HTTP/${req.httpVersion}`,
          ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`),
          '\r\n',
        ].join('\r\n');
        proxySocket.write(headers);
        if (head.length > 0) proxySocket.write(head);
        // Bidirectional pipe
        socket.pipe(proxySocket);
        proxySocket.pipe(socket);
      });
      proxySocket.on('error', (err: Error) => {
        serverLogger.error("WS proxy error", err.message);
        socket.destroy();
      });
      socket.on('error', (err: Error) => {
        serverLogger.error("WS client error", err.message);
        proxySocket.destroy();
      });
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    serverLogger.info("Shutting down HTTP server");
    return new Promise<void>((resolve) => {
      server.close(() => {
        serverLogger.info("HTTP server closed");
        resolve();
      });
    });
  };

  process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
  process.on('SIGINT', () => shutdown().then(() => process.exit(0)));

  const port = parseInt(process.env.PORT || "10540", 10);
  server.listen(port, () => {
    serverLogger.info(`PuchiPix server ready on http://localhost:${port}`);
    serverLogger.info(`Proxying /api/* to http://${GO_BACKEND_HOST}:${GO_BACKEND_PORT}`);
  });
});
