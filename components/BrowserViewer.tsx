"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  formatBrowserPreviewHost,
  getCurrentBrowserUrl,
  isLocalBrowserUrl,
  moveBrowserHistory,
  navigateBrowserTabState,
  normalizeBrowserAddress,
  reloadBrowserTab,
  shouldFallbackToDirectBrowserFrame,
  shouldUseBrowserPreviewProxy,
  type BrowserAddressError,
  type BrowserTabState,
} from "@/lib/browser-tab-state";

interface Props {
  state: BrowserTabState;
  onStateChange: (state: BrowserTabState) => void;
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 1 0 2 5.3" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function GlobeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </svg>
  );
}

function getAddressErrorMessage(error: BrowserAddressError, t: ReturnType<typeof useI18n>["t"]): string {
  switch (error) {
    case "empty":
      return t("browser.addressRequired");
    case "unsupported":
      return t("browser.httpOnly");
    case "credentials":
      return t("browser.credentialsBlocked");
    case "current-app":
      return t("browser.currentAppBlocked");
    default:
      return t("browser.invalidAddress");
  }
}

export function BrowserViewer({ state, onStateChange }: Props) {
  const { t } = useI18n();
  const currentUrl = getCurrentBrowserUrl(state);
  const [address, setAddress] = useState(currentUrl ?? "");
  const [addressError, setAddressError] = useState<BrowserAddressError | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded">(
    currentUrl ? "loading" : "idle",
  );
  const [frameSource, setFrameSource] = useState<string | null>(
    currentUrl && !shouldUseBrowserPreviewProxy(currentUrl) ? currentUrl : null,
  );
  const [previewError, setPreviewError] = useState(false);
  const [previewHost, setPreviewHost] = useState("localhost");
  const addressErrorId = useId();
  const addressRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++previewRequestRef.current;
    setAddress(currentUrl ?? "");
    setAddressError(null);
    setPreviewError(false);
    setLoadState(currentUrl ? "loading" : "idle");
    if (!currentUrl) {
      setFrameSource(null);
      return;
    }
    if (!shouldUseBrowserPreviewProxy(currentUrl)) {
      setFrameSource(currentUrl);
      return;
    }

    setFrameSource(null);
    const controller = new AbortController();
    void fetch("/api/browser-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { previewUrl?: string; error?: unknown };
      if (controller.signal.aborted || previewRequestRef.current !== requestId) return;
      if (shouldFallbackToDirectBrowserFrame(response.status, payload.error)) {
        setFrameSource(currentUrl);
        return;
      }
      if (!response.ok || !payload.previewUrl) throw new Error("browser-preview-unavailable");
      setFrameSource(payload.previewUrl);
    }).catch(() => {
      if (controller.signal.aborted || previewRequestRef.current !== requestId) return;
      setPreviewError(true);
      setLoadState("idle");
    });

    return () => controller.abort();
  }, [currentUrl, state.reloadRevision]);

  useEffect(() => {
    if (currentUrl) return;
    const frame = requestAnimationFrame(() => addressRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [currentUrl]);

  useEffect(() => {
    setPreviewHost(formatBrowserPreviewHost(window.location.hostname));
  }, []);

  const navigate = (rawAddress: string) => {
    const result = normalizeBrowserAddress(rawAddress, window.location.origin);
    if (!result.ok) {
      setAddressError(result.error);
      return;
    }

    setAddressError(null);
    setLoadState("loading");
    onStateChange(navigateBrowserTabState(state, result.url));
  };

  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(address);
  };

  const moveHistory = (offset: -1 | 1) => {
    const next = moveBrowserHistory(state, offset);
    if (next === state) return;
    setLoadState("loading");
    onStateChange(next);
  };

  const openExternal = () => {
    if (!currentUrl) return;
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  };

  const canGoBack = state.historyIndex > 0;
  const canGoForward = state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
  const localPreview = isLocalBrowserUrl(currentUrl);

  return (
    <div className="browser-viewer-shell">
      <div className="browser-navigation">
        <div className="browser-navigation-controls">
          <button
            type="button"
            className="browser-icon-button"
            disabled={!canGoBack}
            onClick={() => moveHistory(-1)}
            title={t("browser.back")}
            aria-label={t("browser.back")}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            disabled={!canGoForward}
            onClick={() => moveHistory(1)}
            title={t("browser.forward")}
            aria-label={t("browser.forward")}
          >
            <ArrowIcon direction="right" />
          </button>
          <button
            type="button"
            className="browser-icon-button"
            disabled={!currentUrl}
            onClick={() => onStateChange(reloadBrowserTab(state))}
            title={t("browser.reload")}
            aria-label={t("browser.reload")}
          >
            <RefreshIcon />
          </button>
        </div>

        <form className="browser-address-form" onSubmit={submitAddress}>
          <span className={localPreview ? "browser-origin-mark is-local" : "browser-origin-mark"}>
            <GlobeIcon size={14} />
          </span>
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              if (addressError) setAddressError(null);
            }}
            onFocus={(event) => event.currentTarget.select()}
            aria-invalid={Boolean(addressError)}
            aria-describedby={addressError ? addressErrorId : undefined}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
            placeholder={t("browser.addressPlaceholder")}
            aria-label={t("browser.address")}
          />
          <button type="submit" className="browser-go-button" title={t("browser.go")}>
            {t("browser.go")}
          </button>
        </form>

        <button
          type="button"
          className="browser-external-button"
          disabled={!currentUrl}
          onClick={openExternal}
          title={t("browser.openExternalHelp")}
          aria-label={t("browser.openExternal")}
        >
          <ExternalIcon />
          <span>{t("browser.openExternal")}</span>
        </button>
        {loadState === "loading" && <span className="browser-loading-bar" aria-hidden="true" />}
      </div>

      {addressError && (
        <div id={addressErrorId} className="browser-address-error" role="alert">
          {getAddressErrorMessage(addressError, t)}
        </div>
      )}

      <div className="browser-viewport" aria-busy={loadState === "loading"}>
        {currentUrl ? (
          frameSource ? (
            <iframe
              key={`${frameSource}:${state.reloadRevision}`}
              src={frameSource}
              title={t("browser.previewTitle", { url: currentUrl })}
              sandbox="allow-forms allow-same-origin allow-scripts"
              allow="camera 'none'; clipboard-read 'none'; clipboard-write 'none'; geolocation 'none'; microphone 'none'"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoadState("loaded")}
            />
          ) : (
            <div className="browser-start-page" role={previewError ? "alert" : "status"}>
              <div className="browser-start-mark"><GlobeIcon size={30} /></div>
              <h2>{t(previewError ? "browser.proxyFailed" : "browser.proxyStarting")}</h2>
              <p>{t(previewError ? "browser.proxyFailedDescription" : "browser.proxyStartingDescription")}</p>
            </div>
          )
        ) : (
          <div className="browser-start-page">
            <div className="browser-start-mark"><GlobeIcon size={30} /></div>
            <h2>{t("browser.startTitle")}</h2>
            <p>{t("browser.startDescription")}</p>
            <div className="browser-quick-links" aria-label={t("browser.quickLinks")}>
              {[3000, 5173, 4173].map((port) => {
                const url = `http://${previewHost}:${port}`;
                return (
                <button key={url} type="button" onClick={() => navigate(url)}>
                  <span className="browser-quick-link-dot" aria-hidden="true" />
                  <span>{url.replace("http://", "")}</span>
                  <ArrowIcon direction="right" />
                </button>
                );
              })}
            </div>
            <p className="browser-embed-note">{t("browser.embedNotice")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
