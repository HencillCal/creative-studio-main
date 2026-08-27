import net from "node:net";

const LISTEN_PORT = Number(process.env.PROXY_LISTEN_PORT || 8081);
const TARGET_HOST = process.env.PROXY_TARGET_HOST || "127.0.0.1";
const TARGET_PORT = Number(process.env.PROXY_TARGET_PORT || 5000);

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const cleanup = () => {
    try { client.destroy(); } catch {}
    try { upstream.destroy(); } catch {}
  };
  upstream.on("error", cleanup);
  client.on("error", cleanup);
  upstream.on("close", () => client.destroy());
  client.on("close", () => upstream.destroy());
});

server.on("error", (err) => {
  console.error("[dev-port-proxy] listen error:", err.message);
});

server.listen(LISTEN_PORT, "::", () => {
  console.log(
    `[dev-port-proxy] forwarding [::]:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`,
  );
});
