"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { ConfigAddButton } from "@/components/ConfigAddButton";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";
import { MAX_SKILL_ARCHIVE_LABEL } from "@/lib/skill-archive-limits";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function skillGroupLabel(skill: Skill): string {
  const source = sourceLabel(skill);
  if (source === "path") return source;
  return skill.install?.skillsShUrl ? `${source} / skills.sh` : source;
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function formatArchiveSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? t("i18n.visibleInPrompt")
          : t("i18n.hiddenFromPrompt")
      }
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

export function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
  uninstalling,
  uninstallError,
  onUninstall,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
  uninstalling: boolean;
  uninstallError: string | null;
  onUninstall: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Path + tag + toggle, with a stable status row below. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 3,
              flexShrink: 0,
              background:
                label === "project"
                  ? "rgba(99,102,241,0.12)"
                  : "rgba(120,120,120,0.12)",
              color:
                label === "project" ? "rgba(99,102,241,0.8)" : "var(--text-dim)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayPath(skill.filePath)}
          </span>
          <Toggle
            enabled={enabled}
            loading={toggling}
            onToggle={() => onToggle(skill)}
          />
        </div>
        <div
          style={{
            minHeight: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            flexWrap: "wrap",
            textAlign: "right",
          }}
        >
          {!enabled && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: 12, color: "#f87171", overflowWrap: "anywhere" }}>
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            Source
          </span>
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "fit-content",
              maxWidth: "100%",
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </div>
      )}

      {skill.install && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span
            style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
          >
            Version
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <button
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
                style={{
                  padding: "4px 9px",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  background: "none",
                  color: "var(--text-muted)",
                  cursor: checkingUpdate || updating ? "not-allowed" : "pointer",
                  opacity: checkingUpdate || updating ? 0.5 : 1,
                  fontSize: 11,
                }}
              >
                 {t("i18n.check")}
              </button>
            )}
            {updateStatus?.state === "update-available" && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "#d97706",
                }}
              >
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                style={{
                  fontSize: 12,
                  color: checkingUpdate
                    ? "var(--accent)"
                    : updateStatus?.state === "up-to-date"
                      ? "#16a34a"
                      : updateStatus?.state === "error"
                          ? "#ef4444"
                          : "var(--text-dim)",
                }}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <button
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
                style={{
                  padding: "4px 10px",
                  border: "none",
                  borderRadius: 5,
                  background: "var(--accent)",
                  color: "#fff",
                  cursor: updating || checkingUpdate ? "not-allowed" : "pointer",
                  opacity: updating || checkingUpdate ? 0.5 : 1,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </button>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{updateError}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          Name
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            color: "var(--text)",
          }}
        >
          {skill.name}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}
        >
          Description
        </span>
        <span
          style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}
        >
          {skill.description}
        </span>
      </div>

      {skill.archiveInstall && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingTop: 14,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            onClick={onUninstall}
            disabled={uninstalling}
            style={{
              padding: "5px 12px",
              border: "1px solid rgba(239,68,68,0.45)",
              borderRadius: 5,
              background: "none",
              color: "#ef4444",
              cursor: uninstalling ? "not-allowed" : "pointer",
              opacity: uninstalling ? 0.5 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {uninstalling ? t("i18n.uninstallingArchive") : t("i18n.uninstallArchive")}
          </button>
          {uninstallError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{uninstallError}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDragCounterRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const res = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setSearchError(t("i18n.noSkills"));
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [t]);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const uploadArchive = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("scope", scope);
      form.set("cwd", cwd);
      const res = await fetch("/api/skills/upload", { method: "POST", body: form });
      const data = await res.json() as {
        error?: string;
        skillName?: string;
        kind?: "skill" | "integration";
      };
      if (!res.ok || data.error) {
        setUploadError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setUploadMessage(t(
        data.kind === "integration" ? "i18n.skillIntegrationInstalled" : "i18n.skillZipInstalled",
        { name: data.skillName ?? uploadFile.name },
      ));
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      onInstalled();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  }, [cwd, onInstalled, scope, t, uploadFile]);

  const selectUploadFile = useCallback((file: File | null) => {
    setUploadMessage(null);
    setUploadError(null);
    if (file && !file.name.toLowerCase().endsWith(".zip")) {
      setUploadFile(null);
      setUploadError(t("i18n.skillZipOnly"));
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    setUploadFile(file);
  }, [t]);

  const handleUploadDragEnter = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (uploading) return;
    event.preventDefault();
    uploadDragCounterRef.current += 1;
    setUploadDragActive(true);
  }, [uploading]);

  const handleUploadDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (uploading) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, [uploading]);

  const handleUploadDragLeave = useCallback(() => {
    uploadDragCounterRef.current = Math.max(0, uploadDragCounterRef.current - 1);
    if (uploadDragCounterRef.current === 0) setUploadDragActive(false);
  }, []);

  const handleUploadDrop = useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    uploadDragCounterRef.current = 0;
    setUploadDragActive(false);
    if (uploading) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setUploadFile(null);
      setUploadMessage(null);
      setUploadError(t("i18n.skillZipSingle"));
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    selectUploadFile(files[0]);
  }, [selectUploadFile, t, uploading]);

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header area ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
           {t("i18n.addSkill")}
        </div>

        {/* Search row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
             placeholder={t("i18n.skillSearchPlaceholder")}
            style={{
              flex: 1,
              padding: "7px 10px",
              fontSize: 13,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              outline: "none",
            }}
          />
          <button
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
            style={{
              padding: "7px 16px",
              fontSize: 13,
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: searching || !query.trim() ? "not-allowed" : "pointer",
              opacity: searching || !query.trim() ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
             {searching ? t("i18n.searching") : t("i18n.search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 5,
              border: "1px solid var(--border)",
              overflow: "hidden",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "global" || projectResourcesLoaded) setScope(s);
                }}
                disabled={s === "project" && !projectResourcesLoaded}
                title={s === "project" && !projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: s === "project" && !projectResourcesLoaded ? "not-allowed" : "pointer",
                  background: scope === s ? "var(--bg-selected)" : "none",
                  color: scope === s ? "var(--text)" : "var(--text-dim)",
                  fontWeight: scope === s ? 600 : 400,
                  opacity: s === "project" && !projectResourcesLoaded ? 0.45 : 1,
                  borderRight:
                    s === "global" ? "1px solid var(--border)" : "none",
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            → {installPath}
          </span>
        </div>

        <div
          style={{
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: 9,
            background: "var(--bg-panel)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(99,102,241,0.12)",
                color: "var(--accent)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              ZIP
            </span>
            <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)" }}>
              {t("i18n.installFromZip")}
            </div>
          </div>

          <input
            ref={uploadInputRef}
            type="file"
            accept=".zip,application/zip"
            disabled={uploading}
            onChange={(event) => selectUploadFile(event.target.files?.[0] ?? null)}
            hidden
          />
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            onDragEnter={handleUploadDragEnter}
            onDragOver={handleUploadDragOver}
            onDragLeave={handleUploadDragLeave}
            onDrop={handleUploadDrop}
            disabled={uploading}
            aria-label={uploadFile ? `${t("i18n.replaceSkillZip")}: ${uploadFile.name}` : t("i18n.chooseSkillZip")}
            style={{
              width: "100%",
              minHeight: 88,
              padding: "14px 16px",
              border: uploadDragActive
                ? "1.5px solid var(--accent)"
                : uploadFile
                  ? "1px solid rgba(99,102,241,0.5)"
                  : "1px dashed var(--border)",
              borderRadius: 8,
              background: uploadDragActive
                ? "rgba(99,102,241,0.12)"
                : uploadFile
                  ? "rgba(99,102,241,0.06)"
                  : "var(--bg)",
              color: "var(--text)",
              cursor: uploading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: uploadFile ? "flex-start" : "center",
              gap: 12,
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s, transform 0.15s",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: uploadFile || uploadDragActive
                  ? "rgba(99,102,241,0.14)"
                  : "var(--bg-hover)",
                color: uploadFile || uploadDragActive ? "var(--accent)" : "var(--text-muted)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {uploadFile ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2h9l4 4v16H6z" />
                  <path d="M14 2v5h5M9 13h6M9 17h6" />
                </svg>
              ) : (
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" />
                  <path d="M5 13v6h14v-6" />
                </svg>
              )}
            </span>

            {uploadFile ? (
              <>
                <span style={{ flex: 1, minWidth: 0 }} aria-live="polite">
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {uploadFile.name}
                  </span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
                    {t("i18n.skillZipSelected", { size: formatArchiveSize(uploadFile.size) })}
                  </span>
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "4px 8px",
                    borderRadius: 5,
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {t("i18n.replaceSkillZip")}
                </span>
              </>
            ) : (
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, textAlign: "center" }}>
                  {t("i18n.chooseSkillZip")}
                </span>
                <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>
                  {t("i18n.dropSkillZip")}
                </span>
              </span>
            )}
          </button>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("i18n.skillZipFileRules", { size: MAX_SKILL_ARCHIVE_LABEL })}
            </span>
            <button
              type="button"
              onClick={uploadArchive}
              disabled={!uploadFile || uploading || installing !== null}
              style={{
                minWidth: 126,
                padding: "7px 14px",
                border: "none",
                borderRadius: 6,
                background: "var(--accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: !uploadFile || uploading || installing !== null ? "not-allowed" : "pointer",
                opacity: !uploadFile || uploading || installing !== null ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {uploading && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                </svg>
              )}
              {uploading
                ? t("i18n.uploadingSkillZip")
                : uploadFile
                  ? t("i18n.installZip")
                  : t("i18n.selectZipBeforeInstall")}
            </button>
          </div>

          {uploadError && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                padding: "7px 9px",
                borderRadius: 6,
                background: "rgba(239,68,68,0.08)",
                color: "#ef4444",
                fontSize: 11,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              <span aria-hidden="true">!</span>
              <span>{uploadError}</span>
            </div>
          )}
          {uploadMessage && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                padding: "7px 9px",
                borderRadius: 6,
                background: "rgba(34,197,94,0.09)",
                color: "#16a34a",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              <span aria-hidden="true">✓</span>
              <span>{uploadMessage}</span>
            </div>
          )}

          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.55 }}>
            {t("i18n.skillZipHint")}
          </div>
          <div style={{ fontSize: 11, color: "#d97706", lineHeight: 1.55 }}>
            {t("i18n.skillZipTrustWarning")}
          </div>
        </div>

        {/* Errors */}
        {searchError && (
          <div style={{ fontSize: 12, color: "#f87171" }}>{searchError}</div>
        )}
        {installError && (
          <div
            style={{ fontSize: 12, color: "#f87171", wordBreak: "break-word" }}
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* skill name prominent */}
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: 3,
                    }}
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {repopart}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  style={{
                    flexShrink: 0,
                    padding: "5px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    cursor:
                      isInstalled || isInstalling || installing !== null
                        ? "not-allowed"
                        : "pointer",
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled
                      ? "#16a34a"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                    transition: "color 0.12s",
                  }}
                >
                  {isInstalled
                     ? `✓ ${t("i18n.installed")}`
                    : isInstalling
                       ? t("i18n.installing")
                       : t("i18n.install")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.8 }}
          >
            {t("i18n.skillCatalogBefore")}
            <a
              href="https://skills.sh/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              skills.sh
            </a>
            {t("i18n.skillCatalogAfter")}
          </div>
        )
      )}
    </div>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  onResourcesChanged,
}: {
  cwd: string;
  onClose: () => void;
  onResourcesChanged?: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [uninstallingArchive, setUninstallingArchive] = useState<string | null>(null);
  const [archiveUninstallError, setArchiveUninstallError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [dormantGroupsOpen, setDormantGroupsOpen] = useState<Record<string, boolean>>({});

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      setSkills(list);
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        if (current && list.some((skill) => skill.filePath === current)) return current;
        const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
        if (initialSkill?.disableModelInvocation) {
          setDormantGroupsOpen((openGroups) => ({
            ...openGroups,
            [skillGroupLabel(initialSkill)]: true,
          }));
        }
        return initialSkill?.filePath ?? null;
      });
      if (list.length === 0) setAddMode(true);
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
      if (next) {
        setDormantGroupsOpen((current) => ({
          ...current,
          [skillGroupLabel(skill)]: true,
        }));
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  const uninstallArchive = useCallback(async (skill: Skill) => {
    if (!skill.archiveInstall) return;
    if (!window.confirm(t("i18n.uninstallArchiveConfirm", { name: skill.name }))) return;
    setUninstallingArchive(skill.filePath);
    setArchiveUninstallError(null);
    try {
      const res = await fetch("/api/skills/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          scope: skill.archiveInstall.scope,
          skillName: skill.name,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSelected(null);
      await loadSkills();
      onResourcesChanged?.();
    } catch (error) {
      setArchiveUninstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setUninstallingArchive(null);
    }
  }, [cwd, loadSkills, onResourcesChanged, t]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}
            >
               {t("common.skills")}
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {!projectResourcesLoaded && (
          <div
            role="status"
            style={{
              padding: "8px 18px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            {t("trust.skillsNotLoaded")}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          {/* Left: skill list */}
          <div
            style={{
              width: isMobile ? "100%" : 210,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <ConfigAddButton
              active={addMode}
              label={t("i18n.addSkill")}
              onClick={() => {
                setSelected(null);
                setAddMode(true);
              }}
            />
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                   {t("i18n.loading")}
                </div>
              ) : error ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 11,
                    color: "#f87171",
                  }}
                >
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div
                  style={{
                    padding: "10px 8px",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                   {t("i18n.noSkills")}
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof skills }[] = [];
                  const groupDefinitions = [
                    {
                      label: "project / skills.sh",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: "project",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: "global / skills.sh",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: "global",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: "path",
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = skills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      !addMode && selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <div
                        key={skill.filePath}
                        onClick={() => {
                          setSelected(skill.filePath);
                          setAddMode(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          padding: "8px 8px",
                          borderRadius: 5,
                          cursor: "pointer",
                          background: isSelected
                            ? "var(--bg-selected)"
                            : "none",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background =
                              "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "none";
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: disabled
                              ? "var(--border)"
                              : "var(--accent)",
                            boxShadow: disabled
                              ? "none"
                              : "0 0 4px var(--accent)",
                            transition:
                              "background 0.15s, box-shadow 0.15s",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isSelected ? 600 : 400,
                            color: disabled
                              ? "var(--text-dim)"
                              : "var(--text)",
                            fontFamily: "var(--font-mono)",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {skill.name}
                        </span>
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          return (
                            <span
                               title={t("i18n.updateAvailable")}
                              style={{
                                color: "#d97706",
                                fontSize: 13,
                                lineHeight: 1,
                                flexShrink: 0,
                              }}
                            >
                              ↑
                            </span>
                          );
                        })()}
                      </div>
                    );
                  };
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => {
                      const activeSkills = grpSkills.filter(
                        (skill) => !skill.disableModelInvocation,
                      );
                      const dormantSkills = grpSkills.filter(
                        (skill) => skill.disableModelInvocation,
                      );
                      const dormantOpen = dormantGroupsOpen[grpLabel] ?? false;
                      return (
                        <div key={grpLabel} style={{ marginBottom: 6 }}>
                          <div
                            style={{
                              padding: "4px 8px 3px",
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--text-dim)",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {grpLabel}
                          </div>
                          {activeSkills.map(renderSkillRow)}
                          {dormantSkills.length > 0 && (
                            <>
                              <div
                                onClick={() =>
                                  setDormantGroupsOpen((current) => ({
                                    ...current,
                                    [grpLabel]: !dormantOpen,
                                  }))
                                }
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                  padding: "4px 8px 3px",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--text-dim)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                  cursor: "pointer",
                                  userSelect: "none",
                                }}
                              >
                                <span style={{ fontSize: 8 }}>
                                  {dormantOpen ? "▾" : "▸"}
                                </span>
                                {t("i18n.dormant")} ({dormantSkills.length})
                              </div>
                              {dormantOpen && dormantSkills.map(renderSkillRow)}
                            </>
                          )}
                        </div>
                      );
                    },
                  );
                })()
              )}
            </div>
          </div>

          {/* Right: detail or add panel */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                projectResourcesLoaded={projectResourcesLoaded}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                  onResourcesChanged?.();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
                uninstalling={uninstallingArchive === selectedSkill.filePath}
                uninstallError={archiveUninstallError}
                onUninstall={() => void uninstallArchive(selectedSkill)}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                 {t("i18n.selectSkill")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {skills.some((skill) => Boolean(skill.install)) && (
              <button
                onClick={() => void checkForUpdates()}
                disabled={checkingAll || updatingSkill !== null}
                style={{
                  padding: "6px 12px",
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text-muted)",
                  cursor:
                    checkingAll || updatingSkill !== null
                      ? "not-allowed"
                      : "pointer",
                  opacity: checkingAll || updatingSkill !== null ? 0.5 : 1,
                  fontSize: 12,
                }}
              >
                 {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
              </button>
            )}
            {Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span style={{ fontSize: 12, color: "#d97706" }}>
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
             {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
