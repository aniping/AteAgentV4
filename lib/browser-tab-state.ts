export interface BrowserTabState {
  history: string[];
  historyIndex: number;
  reloadRevision: number;
}

export type BrowserAddressError = "empty" | "invalid" | "unsupported" | "credentials" | "current-app";

export type BrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; error: BrowserAddressError };

const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/i;
const BROWSER_HISTORY_LIMIT = 50;
const COMMON_DEVELOPMENT_PORTS = new Set(["3000", "30141", "4173", "4200", "5000", "5173", "5174", "8000", "8080"]);

function withoutIpv6Brackets(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function formatBrowserPreviewHost(hostname: string): string {
  const normalized = withoutIpv6Brackets(hostname);
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = withoutIpv6Brackets(hostname);
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "0.0.0.0"
    || normalized === "::"
    || normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function parseIpv4Octets(hostname: string): number[] | null {
  const octets = withoutIpv6Brackets(hostname).split(".").map(Number);
  return octets.length === 4 && octets.every((octet) => (
    Number.isInteger(octet) && octet >= 0 && octet <= 255
  )) ? octets : null;
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = withoutIpv6Brackets(hostname);
  const octets = parseIpv4Octets(normalized);
  if (octets) {
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }

  return /^(?:fc|fd)[\da-f]{2}:/.test(normalized);
}

function isIpHostname(hostname: string): boolean {
  const normalized = withoutIpv6Brackets(hostname);
  return parseIpv4Octets(normalized) !== null || normalized.includes(":");
}

function shouldDefaultToHttp(address: string): boolean {
  try {
    const provisional = new URL(`http://${address}`);
    const hostname = withoutIpv6Brackets(provisional.hostname);
    return isLoopbackHostname(hostname)
      || isIpHostname(hostname)
      || isPrivateNetworkHostname(hostname)
      || hostname === "0.0.0.0"
      || hostname.endsWith(".local")
      || !hostname.includes(".")
      || COMMON_DEVELOPMENT_PORTS.has(provisional.port);
  } catch {
    return false;
  }
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

export function createBrowserTabState(initialUrl?: string): BrowserTabState {
  return {
    history: initialUrl ? [initialUrl] : [],
    historyIndex: initialUrl ? 0 : -1,
    reloadRevision: 0,
  };
}

export function getCurrentBrowserUrl(state: BrowserTabState): string | null {
  if (state.historyIndex < 0 || state.historyIndex >= state.history.length) return null;
  return state.history[state.historyIndex] ?? null;
}

export function normalizeBrowserAddress(
  rawAddress: string,
  currentAppOrigin?: string,
): BrowserAddressResult {
  const address = rawAddress.trim();
  if (!address) return { ok: false, error: "empty" };

  if (EXPLICIT_SCHEME.test(address) && !/^https?:/i.test(address)) {
    return { ok: false, error: "unsupported" };
  }

  const candidate = /^https?:/i.test(address)
    ? address
    : `${shouldDefaultToHttp(address) ? "http" : "https"}://${address}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: "unsupported" };
    }
    if (url.username || url.password) return { ok: false, error: "credentials" };

    if (currentAppOrigin) {
      const appUrl = new URL(currentAppOrigin);
      const loopbackAlias = isLoopbackHostname(url.hostname)
        && isLoopbackHostname(appUrl.hostname)
        && url.protocol === appUrl.protocol
        && effectivePort(url) === effectivePort(appUrl);
      if (url.origin === appUrl.origin || loopbackAlias) {
        return { ok: false, error: "current-app" };
      }
    }

    return { ok: true, url: url.href };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

export function navigateBrowserTabState(
  state: BrowserTabState,
  url: string,
): BrowserTabState {
  if (getCurrentBrowserUrl(state) === url) {
    return { ...state, reloadRevision: state.reloadRevision + 1 };
  }

  const history = [...state.history.slice(0, state.historyIndex + 1), url]
    .slice(-BROWSER_HISTORY_LIMIT);
  return {
    history,
    historyIndex: history.length - 1,
    reloadRevision: 0,
  };
}

export function moveBrowserHistory(
  state: BrowserTabState,
  offset: -1 | 1,
): BrowserTabState {
  const historyIndex = state.historyIndex + offset;
  if (historyIndex < 0 || historyIndex >= state.history.length) return state;
  return { ...state, historyIndex };
}

export function reloadBrowserTab(state: BrowserTabState): BrowserTabState {
  if (!getCurrentBrowserUrl(state)) return state;
  return { ...state, reloadRevision: state.reloadRevision + 1 };
}

export function getBrowserTabLabel(state: BrowserTabState, fallback: string): string {
  const currentUrl = getCurrentBrowserUrl(state);
  if (!currentUrl) return fallback;

  try {
    const url = new URL(currentUrl);
    return url.host || fallback;
  } catch {
    return fallback;
  }
}

export function isLocalBrowserUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return isLoopbackHostname(hostname) || isPrivateNetworkHostname(hostname);
  } catch {
    return false;
  }
}

const DIRECT_FRAME_FALLBACK_RESPONSES = [
  { status: 403, error: "target-unroutable" },
  { status: 502, error: "target-unresolved" },
] as const;

export function shouldFallbackToDirectBrowserFrame(status: number, error: unknown): boolean {
  return DIRECT_FRAME_FALLBACK_RESPONSES.some(
    (candidate) => candidate.status === status && candidate.error === error,
  );
}

export function shouldUseBrowserPreviewProxy(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = withoutIpv6Brackets(parsed.hostname);
    const likelyPrivateName = hostname.endsWith(".local")
      || (!hostname.includes(".") && !hostname.includes(":"));
    return parsed.protocol === "http:"
      && (isLoopbackHostname(hostname) || isIpHostname(hostname) || likelyPrivateName);
  } catch {
    return false;
  }
}
