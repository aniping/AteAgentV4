"use client";

import { getBrowserTabLabel, getCurrentBrowserUrl, type BrowserTabState } from "@/lib/browser-tab-state";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";
import { useI18n } from "@/hooks/useI18n";
import { useRef } from "react";
import { getFileIcon } from "./FileIcons";

export interface FileTab {
  kind: "file";
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

export interface BrowserTab {
  kind: "browser";
  id: string;
  label: string;
  browserState: BrowserTabState;
}

export type Tab = FileTab | BrowserTab;

export function getWorkspaceTabDomId(tabId: string): string {
  return `workspace-tab-${encodeURIComponent(tabId)}`;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onTabsEmpty?: () => void;
}

function BrowserTabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </svg>
  );
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onTabsEmpty }: Props) {
  const { t } = useI18n();
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const focusTab = (tabId: string | undefined) => {
    if (!tabId) return;
    requestAnimationFrame(() => tabButtonRefs.current.get(tabId)?.focus());
  };

  const selectRelativeTab = (index: number, offset: -1 | 1) => {
    if (tabs.length < 2) return;
    const nextIndex = (index + offset + tabs.length) % tabs.length;
    const nextId = tabs[nextIndex].id;
    onSelectTab(nextId);
    focusTab(nextId);
  };

  const closeTab = (tabId: string, index: number) => {
    const nextFocusId = tabId === activeTabId
      ? (tabs[index + 1] ?? tabs[index - 1])?.id
      : activeTabId;
    onCloseTab(tabId);
    if (nextFocusId) focusTab(nextFocusId);
    else requestAnimationFrame(() => onTabsEmpty?.());
  };

  return (
    <div className="workspace-tab-bar" role="tablist" aria-label={t("workspacePanel.tabs")}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const tabLabel = tab.kind === "browser"
          ? getBrowserTabLabel(tab.browserState, t("browser.newTab"))
          : tab.label;
        const tabTitle = tab.kind === "file"
          ? tab.filePath
          : getCurrentBrowserUrl(tab.browserState) ?? t("browser.newTab");

        return (
          <div
            key={tab.id}
            className={isActive ? "workspace-tab is-active" : "workspace-tab"}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              closeTab(tab.id, index);
            }}
          >
            <button
              ref={(node) => {
                if (node) tabButtonRefs.current.set(tab.id, node);
                else tabButtonRefs.current.delete(tab.id);
              }}
              id={getWorkspaceTabDomId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="workspace-panel-content"
              tabIndex={isActive ? 0 : -1}
              className="workspace-tab-main"
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  selectRelativeTab(index, event.key === "ArrowLeft" ? -1 : 1);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const nextId = event.key === "Home" ? tabs[0]?.id : tabs[tabs.length - 1]?.id;
                  if (nextId) onSelectTab(nextId);
                  focusTab(nextId);
                }
              }}
              title={tabTitle}
            >
              <span className="workspace-tab-icon">
                {tab.kind === "browser" ? <BrowserTabIcon /> : getFileIcon(tab.label, 14)}
              </span>
              <span className="workspace-tab-label">{tabLabel}</span>
            </button>
            <button
              type="button"
              tabIndex={isActive ? 0 : -1}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id, index);
              }}
              className="workspace-tab-close"
              title={t("i18n.close")}
              aria-label={`${t("i18n.close")} ${tabLabel}`}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
