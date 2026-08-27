"use client";

import { useI18n } from "@/hooks/useI18n";

function WorkspaceMark() {
  return (
    <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="4.75" y="7.75" width="38.5" height="32.5" rx="7.25" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <path d="M5.5 16.5h37" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="10" cy="12" r="1.25" fill="currentColor" opacity="0.65" />
      <circle cx="14.5" cy="12" r="1.25" fill="currentColor" opacity="0.45" />
      <path d="m19 25-4 4 4 4M29 25l4 4-4 4M26 23l-4 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3Z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function WorkspaceEmptyState({
  onOpenBrowser,
  onShowFiles,
}: {
  onOpenBrowser: () => void;
  onShowFiles: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="workspace-empty-state">
      <div className="workspace-empty-mark"><WorkspaceMark /></div>
      <h2>{t("workspacePanel.emptyTitle")}</h2>
      <p>{t("workspacePanel.emptyDescription")}</p>
      <div className="workspace-empty-actions">
        <button type="button" onClick={onOpenBrowser}>
          <span className="workspace-empty-action-icon"><GlobeIcon /></span>
          <span>
            <strong>{t("workspacePanel.openBrowser")}</strong>
            <small>{t("workspacePanel.openBrowserHelp")}</small>
          </span>
          <ArrowIcon />
        </button>
        <button type="button" onClick={onShowFiles}>
          <span className="workspace-empty-action-icon"><FileIcon /></span>
          <span>
            <strong>{t("workspacePanel.openFile")}</strong>
            <small>{t("workspacePanel.openFileHelp")}</small>
          </span>
          <ArrowIcon />
        </button>
      </div>
    </div>
  );
}
