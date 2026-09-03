// The gateway's default upgrade path is `/ws` (server/src/gateway/{ws-server,multi-table-router}.ts).
// Same-origin by construction: in dev this rides Vite's own `/ws` proxy
// (vite.config.ts); built and deployed, `web`'s static bundle and the
// server's `/ws` path share an origin per docs/27_Deployment_Architecture.md.
export function tableGatewayUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws`;
}
