import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP, Socket } from "node:net";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";

const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet("0.0.0.0", 32, "ipv4");
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_ADDRESSES.addAddress("::", "ipv6");
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6");

const PRIVATE_NETWORK_ADDRESSES = new BlockList();
PRIVATE_NETWORK_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NETWORK_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NETWORK_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_NETWORK_ADDRESSES.addSubnet("fc00::", 7, "ipv6");

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_BROWSER_PREVIEW_PROXIES = 12;
const BROWSER_PREVIEW_IDLE_MS = 30 * 60 * 1000;
const UPSTREAM_RESPONSE_TIMEOUT_MS = 30 * 1000;

export type BrowserPreviewProxyErrorCode =
  | "invalid-target"
  | "target-not-local"
  | "target-unresolved"
  | "recursive-target"
  | "proxy-start-failed";

export class BrowserPreviewProxyError extends Error {
  readonly code: BrowserPreviewProxyErrorCode;

  constructor(
    code: BrowserPreviewProxyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrowserPreviewProxyError";
    this.code = code;
  }
}

export interface BrowserPreviewProxyOptions {
  parentOrigin: string;
  forbiddenOrigins?: string[];
  addressProvider?: BrowserPreviewAddressProvider;
}

export type BrowserPreviewAddressProvider = () => readonly string[];

interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
  requiresAddressOwnership: boolean;
}

interface ManagedBrowserPreviewProxy {
  registryKey: string;
  targetOrigin: string;
  previewOrigin: string;
  endpointKey: string;
  server: Server;
  touch: () => void;
  dispose: () => Promise<void>;
}

declare global {
  // Kept on globalThis so Next.js hot reload cannot orphan duplicate listeners.
  var __ateBrowserPreviewProxies: Map<string, Promise<ManagedBrowserPreviewProxy>> | undefined;
  var __ateBrowserPreviewProxyOrigins: Set<string> | undefined;
  var __ateBrowserPreviewProxyEndpoints: Set<string> | undefined;
}

const proxyRegistry = globalThis.__ateBrowserPreviewProxies
  ?? (globalThis.__ateBrowserPreviewProxies = new Map());
const proxyOrigins = globalThis.__ateBrowserPreviewProxyOrigins
  ?? (globalThis.__ateBrowserPreviewProxyOrigins = new Set());
const proxyEndpoints = globalThis.__ateBrowserPreviewProxyEndpoints
  ?? (globalThis.__ateBrowserPreviewProxyEndpoints = new Set());

function withoutIpv6Brackets(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function systemInterfaceAddresses(): readonly string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .map(({ address }) => address);
}

export function isBrowserPreviewAddressAllowed(
  address: string,
  allowPrivateNetwork = true,
  family = isIP(address),
): boolean {
  if (family === 4) {
    return LOOPBACK_ADDRESSES.check(address, "ipv4")
      || (allowPrivateNetwork && PRIVATE_NETWORK_ADDRESSES.check(address, "ipv4"));
  }
  if (family !== 6) return false;

  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) {
    return isBrowserPreviewAddressAllowed(mappedIpv4, allowPrivateNetwork, 4);
  }
  return LOOPBACK_ADDRESSES.check(address, "ipv6")
    || (allowPrivateNetwork && PRIVATE_NETWORK_ADDRESSES.check(address, "ipv6"));
}

function connectionAddress(address: string): string {
  if (address === "0.0.0.0") return "127.0.0.1";
  if (address === "::") return "::1";
  return address;
}

function isLoopbackAddress(address: string, family = isIP(address)): boolean {
  return isBrowserPreviewAddressAllowed(address, false, family);
}

function addressProviderOwns(
  addressProvider: BrowserPreviewAddressProvider,
  address: string,
  family: 4 | 6,
): boolean {
  if (!PRIVATE_NETWORK_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6")) {
    return false;
  }

  let addresses: readonly string[];
  try {
    addresses = addressProvider();
  } catch {
    return false;
  }

  const exactAddress = new BlockList();
  exactAddress.addAddress(address, family === 4 ? "ipv4" : "ipv6");
  return addresses.some((candidate) => {
    const normalized = withoutIpv6Brackets(candidate);
    const candidateFamily = isIP(normalized);
    return candidateFamily === family
      && exactAddress.check(normalized, family === 4 ? "ipv4" : "ipv6");
  });
}

function isResolvedTargetStillAllowed(
  resolved: ResolvedTarget,
  addressProvider: BrowserPreviewAddressProvider,
): boolean {
  return !resolved.requiresAddressOwnership
    || addressProviderOwns(addressProvider, resolved.address, resolved.family);
}

function endpointKey(address: string, port: string | number): string {
  return `${address.toLowerCase()}:${port}`;
}

function targetPort(url: URL): number {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

function browserHostForParent(parent: ResolvedTarget): string {
  const hostname = withoutIpv6Brackets(parent.url.hostname);
  if (hostname === "0.0.0.0") return "127.0.0.1";
  if (hostname === "::") return "[::1]";
  return parent.family === 6 ? `[${hostname}]` : hostname;
}

async function resolveLocalTarget(
  rawTarget: string,
  allowPrivateNetwork = false,
  addressProvider: BrowserPreviewAddressProvider = systemInterfaceAddresses,
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawTarget);
  } catch (error) {
    throw new BrowserPreviewProxyError("invalid-target", "Invalid browser preview target", { cause: error });
  }

  if (url.protocol !== "http:" || url.username || url.password) {
    throw new BrowserPreviewProxyError("invalid-target", "The compatibility proxy accepts credential-free loopback HTTP URLs only");
  }
  if (proxyOrigins.has(url.origin)) {
    throw new BrowserPreviewProxyError("recursive-target", "A browser preview proxy cannot proxy another preview proxy");
  }

  const hostname = withoutIpv6Brackets(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isBrowserPreviewAddressAllowed(hostname, allowPrivateNetwork, literalFamily)) {
      throw new BrowserPreviewProxyError("target-not-local", "Only loopback and private-network services can use the compatibility proxy");
    }
    const address = connectionAddress(hostname);
    const requiresAddressOwnership = !isLoopbackAddress(address, literalFamily);
    if (requiresAddressOwnership && !addressProviderOwns(addressProvider, address, literalFamily as 4 | 6)) {
      throw new BrowserPreviewProxyError("target-not-local", "The private service address is not assigned to this machine");
    }
    return {
      url,
      address,
      family: literalFamily as 4 | 6,
      requiresAddressOwnership,
    };
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { url, address: "127.0.0.1", family: 4, requiresAddressOwnership: false };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new BrowserPreviewProxyError("target-unresolved", "The local service hostname could not be resolved", { cause: error });
  }

  if (addresses.length === 0) {
    throw new BrowserPreviewProxyError("target-unresolved", "The local service hostname did not resolve to an address");
  }
  if (addresses.some(({ address, family }) => {
    if (!isBrowserPreviewAddressAllowed(address, allowPrivateNetwork, family)) return true;
    return !isLoopbackAddress(address, family)
      && !addressProviderOwns(addressProvider, address, family as 4 | 6);
  })) {
    throw new BrowserPreviewProxyError("target-not-local", "The compatibility proxy refuses hostnames that resolve outside loopback or private networks");
  }

  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  const address = connectionAddress(selected.address);
  return {
    url,
    address,
    family: selected.family as 4 | 6,
    requiresAddressOwnership: !isLoopbackAddress(address, selected.family),
  };
}

export function stripFrameAncestorsDirective(policy: string): string | null {
  const directives = policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .filter((directive) => !/^frame-ancestors(?:\s|$)/i.test(directive));
  return directives.length > 0 ? directives.join("; ") : null;
}

function rawHeaderValues(message: IncomingMessage, headerName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    if (message.rawHeaders[index]?.toLowerCase() === headerName) {
      values.push(message.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function sanitizedCspPolicies(message: IncomingMessage, headerName: string): string[] {
  return rawHeaderValues(message, headerName)
    .flatMap((value) => value.split(","))
    .map((policy) => stripFrameAncestorsDirective(policy.trim()))
    .filter((policy): policy is string => policy !== null);
}

function setHeaderValues(headers: OutgoingHttpHeaders, name: string, values: string[]): void {
  headers[name] = values.length > 0 ? values : undefined;
}

function rewriteRedirectLocation(
  location: string | undefined,
  targetUrl: URL,
  previewOrigin: string,
): string | undefined {
  const rewrite = (value: string): string => {
    try {
      const resolved = new URL(value, targetUrl);
      if (resolved.origin !== targetUrl.origin) return value;
      return `${previewOrigin}${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      return value;
    }
  };
  return location ? rewrite(location) : location;
}

function rewriteRequestUrlHeader(value: string | undefined, previewOrigin: string, targetOrigin: string): string | undefined {
  if (!value) return value;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== previewOrigin) return value;
    return `${targetOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

function forwardHeaders(
  incoming: IncomingHttpHeaders,
  target: URL,
  previewOrigin: string,
  keepUpgradeHeaders = false,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...incoming, host: target.host };
  for (const header of HOP_BY_HOP_HEADERS) {
    if (keepUpgradeHeaders && (header === "connection" || header === "upgrade")) continue;
    delete headers[header];
  }

  const connection = Array.isArray(incoming.connection) ? incoming.connection.join(",") : incoming.connection;
  for (const namedHeader of connection?.split(",") ?? []) {
    const normalized = namedHeader.trim().toLowerCase();
    if (normalized && (!keepUpgradeHeaders || normalized !== "upgrade")) delete headers[normalized];
  }

  const origin = Array.isArray(incoming.origin) ? incoming.origin[0] : incoming.origin;
  if (origin === previewOrigin) headers.origin = target.origin;
  const referer = Array.isArray(incoming.referer) ? incoming.referer[0] : incoming.referer;
  const rewrittenReferer = rewriteRequestUrlHeader(referer, previewOrigin, target.origin);
  if (rewrittenReferer) headers.referer = rewrittenReferer;
  else delete headers.referer;
  if (keepUpgradeHeaders) {
    headers.connection = "Upgrade";
    headers.upgrade = incoming.upgrade ?? "websocket";
  }
  return headers;
}

function isolateSetCookie(value: string): string {
  return value
    .split(";")
    .filter((part) => !/^\s*domain=/i.test(part))
    .join(";");
}

function responseHeaders(
  upstreamResponse: IncomingMessage,
  targetUrl: URL,
  previewOrigin: string,
  parentOrigin: string,
): OutgoingHttpHeaders {
  const incoming = upstreamResponse.headers;
  const headers: OutgoingHttpHeaders = { ...incoming };
  for (const header of HOP_BY_HOP_HEADERS) delete headers[header];
  const connection = Array.isArray(incoming.connection) ? incoming.connection.join(",") : incoming.connection;
  for (const namedHeader of connection?.split(",") ?? []) {
    const normalized = namedHeader.trim().toLowerCase();
    if (normalized) delete headers[normalized];
  }
  delete headers["x-frame-options"];
  delete headers["alt-svc"];

  const enforcedPolicies = sanitizedCspPolicies(upstreamResponse, "content-security-policy");
  setHeaderValues(headers, "content-security-policy", [
    ...enforcedPolicies,
    `frame-ancestors ${parentOrigin}`,
  ]);
  const reportOnlyPolicies = sanitizedCspPolicies(upstreamResponse, "content-security-policy-report-only");
  setHeaderValues(headers, "content-security-policy-report-only", reportOnlyPolicies);
  headers.location = rewriteRedirectLocation(incoming.location, targetUrl, previewOrigin);
  if (incoming["set-cookie"]) {
    headers["set-cookie"] = incoming["set-cookie"].map(isolateSetCookie);
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete headers[name];
  }
  return headers;
}

function targetRequestUrl(requestUrl: string | undefined, targetOrigin: string): URL | null {
  if (!requestUrl?.startsWith("/")) return null;
  try {
    const url = new URL(requestUrl, targetOrigin);
    return url.origin === targetOrigin ? url : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function sendHttpError(response: ServerResponse, status: number, message: string): void {
  if (response.writableEnded || response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title><p>${escapeHtml(message)}</p>`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function canonicalHttpAuthority(value: string | undefined): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

function isPreviewRequestAllowed(request: IncomingMessage, previewOrigin: string): boolean {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(previewOrigin).origin;
  } catch {
    return false;
  }
  if (canonicalHttpAuthority(request.headers.host) !== new URL(expectedOrigin).host) return false;
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).origin !== expectedOrigin) return false;
    } catch {
      return false;
    }
  }
  return request.headers["sec-fetch-site"] !== "cross-site";
}

function proxyHttpRequest(
  resolved: ResolvedTarget,
  addressProvider: BrowserPreviewAddressProvider,
  previewOrigin: string,
  parentOrigin: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!ALLOWED_METHODS.has(request.method ?? "")) {
    response.setHeader("Allow", [...ALLOWED_METHODS].join(", "));
    sendHttpError(response, 405, "This HTTP method is not allowed in browser preview.");
    return;
  }
  const targetUrl = targetRequestUrl(request.url, resolved.url.origin);
  if (!targetUrl) {
    sendHttpError(response, 400, "Invalid preview request path.");
    return;
  }
  if (!isResolvedTargetStillAllowed(resolved, addressProvider)) {
    sendHttpError(response, 403, "The private service address is no longer assigned to this machine.");
    return;
  }

  const requestOptions: RequestOptions = {
    protocol: resolved.url.protocol,
    hostname: resolved.address,
    family: resolved.family,
    localAddress: resolved.requiresAddressOwnership ? resolved.address : undefined,
    port: resolved.url.port || (resolved.url.protocol === "https:" ? 443 : 80),
    method: request.method,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    headers: forwardHeaders(request.headers, resolved.url, previewOrigin),
    servername: isIP(withoutIpv6Brackets(resolved.url.hostname)) ? undefined : withoutIpv6Brackets(resolved.url.hostname),
  };
  const makeRequest = resolved.url.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = makeRequest(requestOptions, (upstreamResponse) => {
    upstream.setTimeout(0);
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      upstreamResponse.statusMessage,
      responseHeaders(upstreamResponse, targetUrl, previewOrigin, parentOrigin),
    );
    const abortDownstream = (): void => {
      if (!response.writableEnded) response.destroy();
    };
    upstreamResponse.once("aborted", abortDownstream);
    upstreamResponse.once("error", abortDownstream);
    response.once("close", () => {
      if (response.writableFinished) return;
      upstreamResponse.destroy();
      upstream.destroy();
    });
    upstreamResponse.pipe(response);
  });

  upstream.on("error", () => sendHttpError(response, 502, `Unable to reach ${resolved.url.host}.`));
  upstream.once("upgrade", (_upgradeResponse, socket) => {
    socket.destroy();
    sendHttpError(response, 502, "The local service attempted an unexpected protocol upgrade.");
  });
  upstream.setTimeout(UPSTREAM_RESPONSE_TIMEOUT_MS, () => {
    upstream.destroy();
    sendHttpError(response, 504, `Timed out while connecting to ${resolved.url.host}.`);
  });
  request.on("aborted", () => upstream.destroy());
  request.on("error", () => upstream.destroy());
  request.pipe(upstream);
}

function serializeUpgradeHeaders(headers: OutgoingHttpHeaders): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
    } else {
      lines.push(`${name}: ${String(value)}`);
    }
  }
  return lines.join("\r\n");
}

function sendSocketError(
  socket: Duplex,
  message: string,
  status = 502,
  statusText = "Bad Gateway",
): void {
  if (socket.destroyed) return;
  const body = message;
  socket.end(
    `HTTP/1.1 ${status} ${statusText}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function proxyWebSocket(
  resolved: ResolvedTarget,
  addressProvider: BrowserPreviewAddressProvider,
  previewOrigin: string,
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): void {
  if (request.method !== "GET") {
    sendSocketError(clientSocket, "WebSocket upgrades require GET.", 405, "Method Not Allowed");
    return;
  }
  const targetUrl = targetRequestUrl(request.url, resolved.url.origin);
  if (!targetUrl) {
    sendSocketError(clientSocket, "Invalid preview WebSocket path.", 400, "Bad Request");
    return;
  }
  if (!isResolvedTargetStillAllowed(resolved, addressProvider)) {
    sendSocketError(clientSocket, "The private service address is no longer assigned to this machine.", 403, "Forbidden");
    return;
  }

  const port = targetPort(resolved.url);
  const transportSocket = new Socket().connect({
    host: resolved.address,
    port,
    family: resolved.family,
    localAddress: resolved.requiresAddressOwnership ? resolved.address : undefined,
  });
  const upstreamSocket = resolved.url.protocol === "https:"
    ? tlsConnect({
      socket: transportSocket,
      servername: isIP(withoutIpv6Brackets(resolved.url.hostname)) ? undefined : withoutIpv6Brackets(resolved.url.hostname),
    })
    : transportSocket;
  const connectedEvent = resolved.url.protocol === "https:" ? "secureConnect" : "connect";

  upstreamSocket.once(connectedEvent, () => {
    const headers = forwardHeaders(request.headers, resolved.url, previewOrigin, true);
    const startLine = `${request.method ?? "GET"} ${targetUrl.pathname}${targetUrl.search} HTTP/${request.httpVersion}`;
    upstreamSocket.write(`${startLine}\r\n${serializeUpgradeHeaders(headers)}\r\n\r\n`);
    if (head.length > 0) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket).pipe(clientSocket);
  });
  upstreamSocket.once("error", () => sendSocketError(clientSocket, `Unable to reach ${resolved.url.host}.`));
  clientSocket.once("error", () => upstreamSocket.destroy());
  clientSocket.once("close", () => upstreamSocket.destroy());
}

async function startProxy(
  registryKey: string,
  resolved: ResolvedTarget,
  parent: ResolvedTarget,
  addressProvider: BrowserPreviewAddressProvider,
): Promise<ManagedBrowserPreviewProxy> {
  let previewOrigin = "";
  let listenerEndpoint = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disposePromise: Promise<void> | undefined;
  const sockets = new Set<Socket>();
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposePromise = new Promise((resolve) => {
      if (idleTimer) clearTimeout(idleTimer);
      proxyRegistry.delete(registryKey);
      proxyOrigins.delete(previewOrigin);
      if (listenerEndpoint) proxyEndpoints.delete(listenerEndpoint);
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    return disposePromise;
  };
  const touch = (): void => {
    if (disposePromise) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void dispose(), BROWSER_PREVIEW_IDLE_MS);
    idleTimer.unref();
  };
  const server = createServer((request, response) => {
    touch();
    if (!isPreviewRequestAllowed(request, previewOrigin)) {
      sendHttpError(response, 421, "This request does not belong to this browser preview.");
      return;
    }
    proxyHttpRequest(resolved, addressProvider, previewOrigin, parent.url.origin, request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    touch();
    if (!isPreviewRequestAllowed(request, previewOrigin)) {
      sendSocketError(socket, "This request does not belong to this browser preview.", 421, "Misdirected Request");
      return;
    }
    proxyWebSocket(resolved, addressProvider, previewOrigin, request, socket, head);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("data", touch);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.on("connect", (request, socket) => {
    if (!isPreviewRequestAllowed(request, previewOrigin)) {
      sendSocketError(socket, "This request does not belong to this browser preview.", 421, "Misdirected Request");
      return;
    }
    if (!socket.destroyed) socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, parent.address, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    throw new BrowserPreviewProxyError("proxy-start-failed", "Unable to start the local browser preview proxy", { cause: error });
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new BrowserPreviewProxyError("proxy-start-failed", "The local browser preview proxy did not expose a TCP port");
  }

  previewOrigin = `http://${browserHostForParent(parent)}:${address.port}`;
  listenerEndpoint = endpointKey(parent.address, address.port);
  proxyOrigins.add(previewOrigin);
  proxyEndpoints.add(listenerEndpoint);
  touch();
  server.unref();
  return {
    registryKey,
    targetOrigin: resolved.url.origin,
    previewOrigin,
    endpointKey: listenerEndpoint,
    server,
    touch,
    dispose,
  };
}

export async function createBrowserPreviewUrl(
  rawTarget: string,
  options: BrowserPreviewProxyOptions,
): Promise<string> {
  let parentOrigin: string;
  try {
    parentOrigin = new URL(options.parentOrigin).origin;
  } catch (error) {
    throw new BrowserPreviewProxyError("invalid-target", "Invalid browser preview parent origin", { cause: error });
  }
  const addressProvider = options.addressProvider ?? systemInterfaceAddresses;
  const parent = await resolveLocalTarget(parentOrigin, false, addressProvider);
  const resolved = await resolveLocalTarget(rawTarget, true, addressProvider);
  if (resolved.requiresAddressOwnership && targetPort(resolved.url) === targetPort(parent.url)) {
    throw new BrowserPreviewProxyError("recursive-target", "A private-address alias of the Wireless ATE Agent service cannot be previewed inside itself");
  }
  if (proxyEndpoints.has(endpointKey(resolved.address, targetPort(resolved.url)))) {
    throw new BrowserPreviewProxyError("recursive-target", "A browser preview proxy cannot proxy an active preview listener");
  }
  for (const forbiddenOrigin of options.forbiddenOrigins ?? []) {
    const forbidden = await resolveLocalTarget(forbiddenOrigin);
    if (endpointKey(forbidden.address, targetPort(forbidden.url)) === endpointKey(resolved.address, targetPort(resolved.url))) {
      throw new BrowserPreviewProxyError("recursive-target", "The Wireless ATE Agent service cannot be previewed inside itself");
    }
  }
  if (proxyRegistry.size >= MAX_BROWSER_PREVIEW_PROXIES && !proxyRegistry.has(`${parent.url.origin}\0${resolved.url.origin}`)) {
    throw new BrowserPreviewProxyError("proxy-start-failed", "Too many browser preview services are active");
  }

  const registryKey = `${parent.url.origin}\0${resolved.url.origin}`;
  let proxyPromise = proxyRegistry.get(registryKey);
  if (!proxyPromise) {
    proxyPromise = startProxy(registryKey, resolved, parent, addressProvider);
    proxyRegistry.set(registryKey, proxyPromise);
    void proxyPromise.catch(() => proxyRegistry.delete(registryKey));
  }

  const proxy = await proxyPromise;
  proxy.touch();
  return `${proxy.previewOrigin}${resolved.url.pathname}${resolved.url.search}${resolved.url.hash}`;
}

export async function closeBrowserPreviewProxies(): Promise<void> {
  const proxies = await Promise.allSettled(proxyRegistry.values());
  proxyRegistry.clear();
  await Promise.all(proxies.flatMap((result) => result.status === "fulfilled" ? [result.value.dispose()] : []));
}
