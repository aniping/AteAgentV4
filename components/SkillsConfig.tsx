"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import type {
  SkillArchiveInspection,
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";
import { MAX_SKILL_ARCHIVE_LABEL } from "@/lib/skill-archive-limits";
import {
  getSceneDefinition,
  getSceneLabel,
  type SceneId,
} from "@/lib/scenes";
import styles from "./SkillsConfig.module.css";

type Translate = ReturnType<typeof useI18n>["t"];
type SkillView = "available" | "manage" | "add";
type ManageFilter = "all" | "project" | "global" | "path";
type AddSource = "market" | "zip";
type SkillScope = "scene" | "project" | "global" | "path";

const SKILL_VIEWS: SkillView[] = ["available", "manage", "add"];

function shortenPath(path: string): string {
  return path
    .replace(/^[A-Za-z]:\\Users\\[^\\]+/i, "~")
    .replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function projectName(cwd: string): string {
  const segments = cwd.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? cwd;
}

function skillScope(skill: Skill): SkillScope {
  if (skill.builtInSceneId) return "scene";
  const scope = skill.sourceInfo?.scope;
  const source = skill.sourceInfo?.source;
  if (scope === "project" || source === "project") return "project";
  if (scope === "user" || scope === "global" || source === "user") return "global";
  return "path";
}

function scopeLabel(scope: SkillScope, t: Translate): string {
  if (scope === "scene") return t("skills.sceneBuiltInGroup");
  if (scope === "project") return t("skills.currentProject");
  if (scope === "global") return t("skills.globalGroup");
  return t("skills.customPath");
}

function updateKey(skill: Skill): string | null {
  return skill.install ? `${skill.install.scope}\0${skill.install.package}` : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function formatArchiveSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesSkill(skill: Skill, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(normalized);
}

function sortSkills(skills: Skill[]): Skill[] {
  const order: Record<SkillScope, number> = { scene: 0, project: 1, global: 2, path: 3 };
  return [...skills].sort((left, right) => {
    const scopeDifference = order[skillScope(left)] - order[skillScope(right)];
    return scopeDifference || left.name.localeCompare(right.name);
  });
}

function sourceValue(skill: Skill, t: Translate): string {
  if (skill.builtInSceneId) return t("skills.builtIntoScene");
  if (skill.install?.skillsShUrl) return "skills.sh";
  if (skill.archiveInstall) return t("skills.localZip");
  return scopeLabel(skillScope(skill), t);
}

function SkillListRow({
  skill,
  selected,
  updateAvailable,
  onSelect,
  t,
}: {
  skill: Skill;
  selected: boolean;
  updateAvailable: boolean;
  onSelect: () => void;
  t: Translate;
}) {
  const modelCallable = !skill.disableModelInvocation;
  return (
    <button
      type="button"
      className={`${styles.row} ${selected ? styles.rowSelected : ""}`}
      aria-pressed={selected}
      data-skill-row
      onClick={onSelect}
    >
      <span className={styles.rowMain}>
        <span className={styles.rowName}>{skill.name}</span>
        <span className={styles.rowMeta}>{scopeLabel(skillScope(skill), t)}</span>
      </span>
      <span className={`${styles.status} ${modelCallable ? styles.statusOn : styles.statusManual}`}>
        {updateAvailable
          ? t("i18n.updateAvailable")
          : modelCallable
            ? t("skills.modelCallable")
            : t("skills.manualOnly")}
      </span>
    </button>
  );
}

function SkillGroups({
  groups,
  selectedPath,
  updateStatuses,
  emptyMessage,
  onSelect,
  t,
}: {
  groups: Array<{ key: string; label: string; skills: Skill[]; showWhenEmpty?: boolean; emptyMessage?: string }>;
  selectedPath: string | null;
  updateStatuses: Record<string, SkillUpdateResult>;
  emptyMessage: string;
  onSelect: (skill: Skill) => void;
  t: Translate;
}) {
  const visibleGroups = groups.filter((group) => group.skills.length > 0 || group.showWhenEmpty);
  if (visibleGroups.length === 0) return <div className={styles.empty}>{emptyMessage}</div>;

  return visibleGroups.map((group) => (
    <section className={styles.group} key={group.key}>
      <div className={styles.groupHeader}>
        <span>{group.label}</span>
        <span>{group.skills.length}</span>
      </div>
      <div className={styles.list}>
        {group.skills.length === 0 && (
          <div className={styles.empty}>{group.emptyMessage ?? emptyMessage}</div>
        )}
        {group.skills.map((skill) => {
          const key = updateKey(skill);
          return (
            <SkillListRow
              key={skill.filePath}
              skill={skill}
              selected={selectedPath === skill.filePath}
              updateAvailable={Boolean(key && updateStatuses[key]?.state === "update-available")}
              onSelect={() => onSelect(skill)}
              t={t}
            />
          );
        })}
      </div>
    </section>
  ));
}

function Toggle({
  enabled,
  loading,
  label,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={loading}
      className={`${styles.switch} ${enabled ? styles.switchOn : ""}`}
      onClick={onToggle}
    />
  );
}

export function SkillDetail({
  skill,
  cwd,
  mode = "manage",
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
  mode?: "available" | "manage";
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
  const [copied, setCopied] = useState(false);
  const enabled = !skill.disableModelInvocation;
  const command = `/skill:${skill.name}`;
  const scope = skillScope(skill);
  const displayedPath = scope === "project" && skill.filePath.startsWith(cwd)
    ? `./${skill.filePath.slice(cwd.length).replace(/^[/\\]/, "")}`
    : shortenPath(skill.filePath);

  const copyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [command]);

  return (
    <article className={styles.detail}>
      <div className={styles.titleRow}>
        <div>
          <h2 className={styles.title}>{skill.name}</h2>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${styles.badgeAccent}`}>{sourceValue(skill, t)}</span>
            <span className={`${styles.badge} ${enabled ? "" : styles.badgeWarning}`}>
              {enabled ? t("skills.modelCallable") : t("skills.manualOnly")}
            </span>
            {skill.builtInSceneId && <span className={styles.badge}>{t("skills.intentMatched")}</span>}
            {skill.readOnly && <span className={styles.badge}>{t("skills.readOnly")}</span>}
          </div>
        </div>
        {mode === "manage" && !skill.readOnly && (
          <div className={styles.switchControl}>
            <span className={styles.switchLabel}>{t("skills.allowModel")}</span>
            <Toggle
              enabled={enabled}
              loading={toggling}
              label={t("skills.allowModel")}
              onToggle={() => onToggle(skill)}
            />
          </div>
        )}
      </div>

      <p className={styles.description}>{skill.description}</p>
      <div className={styles.codeRow}>
        <code className={styles.code}>{command}</code>
        <button type="button" className={styles.copyButton} onClick={() => void copyCommand()}>
          {copied ? t("skills.copied") : t("skills.copy")}
        </button>
      </div>
      <p className={styles.resultMeta}>{t("skills.manualCommandHint")}</p>

      <div className={styles.info}>
        <strong>{t("skills.whenAutomatic")}</strong>
        <div>{t("skills.whenAutomaticBody")}</div>
      </div>

      <dl className={styles.propertyGrid}>
        <dt>{t("skills.source")}</dt>
        <dd>
          {skill.install?.skillsShUrl ? (
            <a href={skill.install.skillsShUrl} target="_blank" rel="noreferrer">{sourceValue(skill, t)}</a>
          ) : sourceValue(skill, t)}
        </dd>
        <dt>{t("skills.scope")}</dt>
        <dd>{scopeLabel(scope, t)}</dd>
        <dt>{t("skills.invocation")}</dt>
        <dd>{enabled ? t("skills.modelCallable") : t("skills.manualOnly")}</dd>
        <dt>{t("skills.technicalPath")}</dt>
        <dd><code>{displayedPath}</code></dd>
        {skill.install && (
          <>
            <dt>{t("i18n.version")}</dt>
            <dd><code>{shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}</code></dd>
          </>
        )}
      </dl>

      {!enabled && <div className={styles.runtimeWarning}>{t("i18n.hiddenButInvocable")}</div>}
      {saveError && <div className={styles.error} role="alert">{saveError}</div>}
      {updateError && <div className={styles.error} role="alert">{updateError}</div>}
      {uninstallError && <div className={styles.error} role="alert">{uninstallError}</div>}

      {mode === "manage" && (skill.install || skill.archiveInstall) && (
        <div className={styles.actions}>
          {skill.install?.canCheckForUpdates && (
            <button type="button" className={styles.secondary} disabled={checkingUpdate || updating} onClick={onCheckUpdate}>
              {checkingUpdate ? t("i18n.checking") : t("i18n.check")}
            </button>
          )}
          {updateStatus?.state === "update-available" && (
            <button type="button" className={styles.primary} disabled={checkingUpdate || updating} onClick={onUpdate}>
              {updating ? t("i18n.updating") : t("i18n.update")}
            </button>
          )}
          {skill.archiveInstall && (
            <button type="button" className={styles.secondary} disabled={uninstalling} onClick={onUninstall}>
              {uninstalling ? t("i18n.uninstallingArchive") : t("i18n.uninstallArchive")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ScopeOptions({
  scope,
  projectResourcesLoaded,
  onChange,
  t,
}: {
  scope: SkillInstallScope;
  projectResourcesLoaded: boolean;
  onChange: (scope: SkillInstallScope) => void;
  t: Translate;
}) {
  return (
    <fieldset className={styles.scopeGroup}>
      <legend>{t("skills.installDestination")}</legend>
      <div className={styles.scopeOptions}>
        <label className={`${styles.scopeOption} ${scope === "project" ? styles.scopeOptionSelected : ""}`}>
          <input
            type="radio"
            name="skill-scope"
            value="project"
            checked={scope === "project"}
            disabled={!projectResourcesLoaded}
            onChange={() => onChange("project")}
          />
          <span>
            <strong>{t("skills.projectScope")} · {t("skills.recommended")}</strong>
            <small>{t("skills.projectScopeDescription")}</small>
          </span>
        </label>
        <label className={`${styles.scopeOption} ${scope === "global" ? styles.scopeOptionSelected : ""}`}>
          <input
            type="radio"
            name="skill-scope"
            value="global"
            checked={scope === "global"}
            onChange={() => onChange("global")}
          />
          <span>
            <strong>{t("skills.globalScope")}</strong>
            <small>{t("skills.globalScopeDescription")}</small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function packageParts(pkg: string): { name: string; repository: string } {
  const atIndex = pkg.lastIndexOf("@");
  if (atIndex > 0) return { name: pkg.slice(atIndex + 1), repository: pkg.slice(0, atIndex) };
  const parts = pkg.split("/");
  return { name: parts.at(-1) ?? pkg, repository: pkg };
}

export function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  initialSource = "market",
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  initialSource?: AddSource;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<AddSource>(initialSource);
  const [scope, setScope] = useState<SkillInstallScope>(projectResourcesLoaded ? "project" : "global");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [newlyInstalled, setNewlyInstalled] = useState<Set<string>>(new Set());
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<SkillArchiveInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [trustAcknowledged, setTrustAcknowledged] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const searchSequenceRef = useRef(0);

  useEffect(() => {
    if (!projectResourcesLoaded && scope === "project") setScope("global");
  }, [projectResourcesLoaded, scope]);

  useEffect(() => {
    if (source === "market") searchInputRef.current?.focus();
  }, [source]);

  const search = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;
    const sequence = ++searchSequenceRef.current;
    setSearching(true);
    setSearchError(null);
    setInstallError(null);
    try {
      const response = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await response.json() as { results?: SkillSearchResult[]; error?: string };
      if (sequence !== searchSequenceRef.current) return;
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const nextResults = data.results ?? [];
      setResults(nextResults);
      setSelectedPackage(nextResults[0]?.package ?? null);
      if (nextResults.length === 0) setSearchError(t("i18n.noSkills"));
    } catch (error) {
      if (sequence === searchSequenceRef.current) {
        setSearchError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (sequence === searchSequenceRef.current) setSearching(false);
    }
  }, [t]);

  const installMarketSkill = useCallback(async (pkg: string) => {
    setInstalling(true);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const response = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: pkg, scope, cwd }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setNewlyInstalled((current) => new Set(current).add(`${scope}:${pkg}`));
      setInstallMessage(t("skills.installedSuccess", { name: packageParts(pkg).name }));
      onInstalled();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  }, [cwd, onInstalled, scope, t]);

  const inspectArchive = useCallback(async (file: File, nextScope: SkillInstallScope) => {
    setInspecting(true);
    setInspection(null);
    setTrustAcknowledged(false);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("cwd", cwd);
      form.append("scope", nextScope);
      const response = await fetch("/api/skills/upload/inspect", { method: "POST", body: form });
      const data = await response.json() as { inspection?: SkillArchiveInspection; error?: string };
      if (!response.ok || data.error || !data.inspection) throw new Error(data.error ?? `HTTP ${response.status}`);
      setInspection(data.inspection);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInspecting(false);
    }
  }, [cwd]);

  const selectUploadFile = useCallback((file: File | null) => {
    setUploadFile(file);
    setInspection(null);
    setTrustAcknowledged(false);
    setInstallError(null);
    setInstallMessage(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setInstallError(t("i18n.skillZipOnly"));
      return;
    }
    void inspectArchive(file, scope);
  }, [inspectArchive, scope, t]);

  const changeScope = useCallback((nextScope: SkillInstallScope) => {
    setScope(nextScope);
    setTrustAcknowledged(false);
    setInstallError(null);
    setInstallMessage(null);
    if (source === "zip" && uploadFile) void inspectArchive(uploadFile, nextScope);
  }, [inspectArchive, source, uploadFile]);

  const installArchive = useCallback(async () => {
    if (!uploadFile || !inspection || !trustAcknowledged) return;
    setInstalling(true);
    setInstallError(null);
    setInstallMessage(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("scope", scope);
      form.append("cwd", cwd);
      form.append("expectedSha256", inspection.sha256);
      form.append("riskAcknowledged", "true");
      const response = await fetch("/api/skills/upload", { method: "POST", body: form });
      const data = await response.json() as {
        success?: boolean;
        skill?: { name?: string };
        skillName?: string;
        error?: string;
      };
      if (!response.ok || data.error || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      const name = data.skill?.name ?? data.skillName ?? inspection.skill.name;
      setInstallMessage(t("skills.installedSuccess", { name }));
      onInstalled();
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setInstalling(false);
    }
  }, [cwd, inspection, onInstalled, scope, t, trustAcknowledged, uploadFile]);

  const selectedResult = results.find((result) => result.package === selectedPackage) ?? null;
  const selectedParts = selectedResult ? packageParts(selectedResult.package) : null;
  const installedHere = Boolean(selectedResult && (
    installedPackages[scope].has(selectedResult.package) || newlyInstalled.has(`${scope}:${selectedResult.package}`)
  ));
  const otherScope: SkillInstallScope = scope === "project" ? "global" : "project";
  const installedElsewhere = Boolean(selectedResult && (
    installedPackages[otherScope].has(selectedResult.package) || newlyInstalled.has(`${otherScope}:${selectedResult.package}`)
  ));
  const destination = scope === "project" ? `${shortenPath(cwd)}/.pi/skills` : "~/.pi/agent/skills";
  const riskCopy = inspection?.risk === "integration-runtime"
    ? t("skills.archiveRiskIntegration")
    : inspection?.risk === "supporting-files"
      ? t("skills.archiveRiskSupporting")
      : t("skills.archiveRiskInstructions");

  return (
    <div className={styles.addLayout}>
      <div className={styles.addToolbar}>
        <div className={styles.segments} role="tablist" aria-label={t("skills.add")}>
          <button
            type="button"
            role="tab"
            aria-selected={source === "market"}
            className={`${styles.segment} ${source === "market" ? styles.segmentActive : ""}`}
            onClick={() => setSource("market")}
          >
            {t("skills.market")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === "zip"}
            className={`${styles.segment} ${source === "zip" ? styles.segmentActive : ""}`}
            onClick={() => setSource("zip")}
          >
            {t("skills.localZip")}
          </button>
        </div>
        <span className={styles.toolbarHelp}>{t("skills.addHelp")}</span>
      </div>

      {source === "market" ? (
        <div className={styles.marketGrid} role="tabpanel">
          <div className={styles.results}>
            <form onSubmit={(event) => { event.preventDefault(); void search(query); }}>
              <input
                ref={searchInputRef}
                className={styles.search}
                value={query}
                aria-label={t("skills.marketPlaceholder")}
                placeholder={t("skills.marketPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="submit" className={styles.secondary} disabled={searching || !query.trim()}>
                {searching ? t("i18n.searching") : t("i18n.search")}
              </button>
            </form>
            {searching && <div className={styles.empty} role="status">{t("i18n.searching")}</div>}
            {!searching && results.length > 0 && (
              <p className={styles.resultMeta}>{t("skills.resultCount", { count: results.length })}</p>
            )}
            {!searching && results.map((result) => {
              const parts = packageParts(result.package);
              const selected = result.package === selectedPackage;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${styles.result} ${selected ? styles.resultSelected : ""}`}
                  key={result.package}
                  onClick={() => setSelectedPackage(result.package)}
                >
                  <span>{parts.name}</span>
                  <span>{parts.repository} · {result.installs}</span>
                </button>
              );
            })}
            {!searching && results.length === 0 && !searchError && (
              <p className={styles.empty}>
                {t("i18n.skillCatalogBefore")}
                <a href="https://skills.sh/" target="_blank" rel="noreferrer">skills.sh</a>
                {t("i18n.skillCatalogAfter")}
              </p>
            )}
            {searchError && <div className={styles.error} role="alert">{searchError}</div>}
          </div>

          <div className={styles.addPane}>
            {selectedResult && selectedParts ? (
              <>
                <div className={styles.titleRow}>
                  <div>
                    <h2 className={styles.title}>{selectedParts.name}</h2>
                    <p className={styles.resultMeta}>{selectedParts.repository}</p>
                  </div>
                  {selectedResult.url && (
                    <a href={selectedResult.url} target="_blank" rel="noreferrer">skills.sh</a>
                  )}
                </div>
                <ScopeOptions
                  scope={scope}
                  projectResourcesLoaded={projectResourcesLoaded}
                  onChange={changeScope}
                  t={t}
                />
                {installedElsewhere && !installedHere && (
                  <div className={styles.runtimeWarning}>{t("skills.installedElsewhere")}</div>
                )}
                <div className={styles.installSummary}>
                  <p>{t("skills.installDestination")}: <code>{destination}</code></p>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={installing || installedHere}
                    onClick={() => void installMarketSkill(selectedResult.package)}
                  >
                    {installedHere
                      ? t("skills.alreadyInstalledHere")
                      : installing
                        ? t("skills.installing")
                        : scope === "project"
                          ? t("skills.installProjectCopy")
                          : t("skills.installGlobal")}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.empty}>{t("skills.selectMarketSkill")}</div>
            )}
            {installError && <div className={styles.error} role="alert">{installError}</div>}
            {installMessage && <div className={styles.success} role="status">{installMessage}</div>}
          </div>
        </div>
      ) : (
        <div className={styles.zipGrid} role="tabpanel">
          <div className={styles.zipLeft}>
            <input
              ref={uploadInputRef}
              hidden
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => selectUploadFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className={styles.dropZone}
              onClick={() => uploadInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                const files = [...event.dataTransfer.files];
                if (files.length !== 1) {
                  setInstallError(t("i18n.skillZipSingle"));
                  return;
                }
                selectUploadFile(files[0]);
              }}
            >
              <strong>{uploadFile ? t("skills.replaceZip") : t("skills.chooseZip")}</strong>
              <span>{dragActive ? t("skills.chooseZip") : t("skills.dropZip")}</span>
            </button>
            <div className={styles.fileMeta}>
              <span>{uploadFile?.name ?? `.zip · ${MAX_SKILL_ARCHIVE_LABEL}`}</span>
              <span>{uploadFile ? formatArchiveSize(uploadFile.size) : ""}</span>
            </div>
            {inspecting && <div className={styles.checkCard} role="status">{t("skills.archiveInspecting")}</div>}
            {inspection && (
              <>
                <div className={styles.checkCard}>
                  <strong>{t("skills.archiveStructurePassed")}</strong>
                  <span>
                    {t("skills.archiveFileCount", { count: inspection.archive.fileCount })} · {t("skills.skillFileCount", { count: inspection.skill.fileCount })}
                  </span>
                </div>
                <div className={styles.checkCard}>
                  <strong>{t("skills.archiveIntegrityPassed")}</strong>
                  <span>{inspection.sha256.slice(0, 16)}… · {formatArchiveSize(inspection.archive.expandedBytes)}</span>
                </div>
              </>
            )}
            {installError && <div className={styles.error} role="alert">{installError}</div>}
            {installMessage && <div className={styles.success} role="status">{installMessage}</div>}
          </div>

          <div className={styles.addPane}>
            {inspection ? (
              <>
                <div className={styles.titleRow}>
                  <div>
                    <h2 className={styles.title}>{inspection.skill.name}</h2>
                    <p className={styles.description}>{inspection.skill.description}</p>
                  </div>
                  <span className={`${styles.badge} ${inspection.risk === "instructions-only" ? "" : styles.badgeWarning}`}>
                    {inspection.kind === "integration" ? "Integration" : "Skill"}
                  </span>
                </div>
                <div className={styles.riskCard} id="skill-archive-risk">
                  <h3>{t("skills.archiveRiskTitle")}</h3>
                  <p>{riskCopy}</p>
                  {inspection.integration?.mcp && (
                    <ul className={styles.riskList}>
                      <li>{t("skills.mcpServer")}: {inspection.integration.mcp.serverName}</li>
                      <li>{t("skills.executable")}: {inspection.integration.mcp.executable}</li>
                      <li>{t("skills.requiredTools")}: {inspection.integration.mcp.requiredTools.join(", ") || t("skills.noneDeclared")}</li>
                      <li>{t("skills.environmentNames")}: {inspection.integration.mcp.environmentNames.join(", ") || t("skills.noneDeclared")}</li>
                    </ul>
                  )}
                </div>
                <ScopeOptions
                  scope={scope}
                  projectResourcesLoaded={projectResourcesLoaded}
                  onChange={changeScope}
                  t={t}
                />
                <label className={styles.trustCheck}>
                  <input
                    type="checkbox"
                    checked={trustAcknowledged}
                    aria-describedby="skill-archive-risk skill-archive-trust-detail"
                    onChange={(event) => setTrustAcknowledged(event.target.checked)}
                  />
                  <span>
                    <strong>{t("skills.trustArchive")}</strong>
                    <small id="skill-archive-trust-detail">{t("skills.trustArchiveBody")}</small>
                  </span>
                </label>
                <div className={styles.installSummary}>
                  <p>{t("skills.installDestination")}: <code>{destination}</code></p>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={installing || inspecting || !trustAcknowledged}
                    onClick={() => void installArchive()}
                  >
                    {installing ? t("skills.installing") : t("skills.confirmInstall")}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.empty}>{t("i18n.skillZipHint")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SkillsConfig({
  cwd,
  sceneId,
  onClose,
  onResourcesChanged,
}: {
  cwd: string;
  sceneId?: SceneId;
  onClose: () => void;
  onResourcesChanged?: () => void;
}) {
  const { locale, t } = useI18n();
  const [view, setView] = useState<SkillView>("available");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [availableQuery, setAvailableQuery] = useState("");
  const [manageQuery, setManageQuery] = useState("");
  const [manageFilter, setManageFilter] = useState<ManageFilter>("all");
  const [selectedAvailable, setSelectedAvailable] = useState<string | null>(null);
  const [selectedManage, setSelectedManage] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [uninstallingArchive, setUninstallingArchive] = useState<string | null>(null);
  const [archiveUninstallError, setArchiveUninstallError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      previousFocus?.focus();
    };
  }, []);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ cwd });
      if (sceneId) query.set("sceneId", sceneId);
      const response = await fetch(`/api/skills?${query.toString()}`);
      const data = await response.json() as Partial<SkillsResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const list = sortSkills(data.skills ?? []);
      setSkills(list);
      setProjectResourcesLoaded(data.projectResourcesLoaded ?? true);
      setSelectedAvailable((current) => list.some((skill) => skill.filePath === current)
        ? current
        : (list.find((skill) => Boolean(skill.builtInSceneId)) ?? list[0])?.filePath ?? null);
      const manageable = list.filter((skill) => !skill.builtInSceneId);
      setSelectedManage((current) => manageable.some((skill) => skill.filePath === current)
        ? current
        : manageable[0]?.filePath ?? null);
      return list;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [cwd, sceneId]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadSkills();
  }, [loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    if (skill.readOnly) return;
    const disableModelInvocation = !skill.disableModelInvocation;
    setToggling((current) => new Set(current).add(skill.filePath));
    setSaveError(null);
    try {
      const response = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: skill.filePath, disableModelInvocation }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSkills((current) => current.map((item) => item.filePath === skill.filePath
        ? { ...item, disableModelInvocation }
        : item));
      onResourcesChanged?.();
    } catch (toggleError) {
      setSaveError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setToggling((current) => {
        const next = new Set(current);
        next.delete(skill.filePath);
        return next;
      });
    }
  }, [onResourcesChanged]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill ? [skill] : skills.filter((item) => Boolean(item.install));
    const keys = targets.map(updateKey).filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;
    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const response = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = await response.json() as { updates?: SkillUpdateResult[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) next[`${update.scope}\0${update.package}`] = update;
        return next;
      });
    } catch (checkError) {
      setUpdateError(checkError instanceof Error ? checkError.message : String(checkError));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        keys.forEach((key) => next.delete(key));
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
      const response = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, package: skill.install.package, scope: skill.install.scope }),
      });
      const data = await response.json() as { success?: boolean; skill?: Skill; error?: string };
      if (!response.ok || data.error || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
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
      onResourcesChanged?.();
    } catch (installError) {
      setUpdateError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills, onResourcesChanged]);

  const uninstallArchive = useCallback(async (skill: Skill) => {
    if (!skill.archiveInstall) return;
    if (!window.confirm(t("i18n.uninstallArchiveConfirm", { name: skill.name }))) return;
    setUninstallingArchive(skill.filePath);
    setArchiveUninstallError(null);
    try {
      const response = await fetch("/api/skills/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: skill.archiveInstall.scope, skillName: skill.name }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || data.error || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSelectedManage(null);
      await loadSkills();
      onResourcesChanged?.();
    } catch (uninstallError) {
      setArchiveUninstallError(uninstallError instanceof Error ? uninstallError.message : String(uninstallError));
    } finally {
      setUninstallingArchive(null);
    }
  }, [cwd, loadSkills, onResourcesChanged, t]);

  const availableSkills = useMemo(
    () => skills.filter((skill) => matchesSkill(skill, availableQuery)),
    [availableQuery, skills],
  );
  const managedSkills = useMemo(() => skills.filter((skill) => {
    if (skill.builtInSceneId || !matchesSkill(skill, manageQuery)) return false;
    return manageFilter === "all" || skillScope(skill) === manageFilter;
  }), [manageFilter, manageQuery, skills]);

  const availableGroups = useMemo(() => ([
    { key: "scene", label: t("skills.sceneBuiltInGroup"), skills: availableSkills.filter((skill) => skillScope(skill) === "scene") },
    { key: "project", label: t("skills.currentProject"), skills: availableSkills.filter((skill) => skillScope(skill) === "project"), showWhenEmpty: true, emptyMessage: t("skills.noProjectSkills") },
    { key: "global", label: t("skills.allProjects"), skills: availableSkills.filter((skill) => skillScope(skill) === "global") },
    { key: "path", label: t("skills.customPath"), skills: availableSkills.filter((skill) => skillScope(skill) === "path") },
  ]), [availableSkills, t]);
  const managedGroups = useMemo(() => ([
    { key: "project", label: t("skills.currentProject"), skills: managedSkills.filter((skill) => skillScope(skill) === "project") },
    { key: "global", label: t("skills.globalGroup"), skills: managedSkills.filter((skill) => skillScope(skill) === "global") },
    { key: "path", label: t("skills.customPath"), skills: managedSkills.filter((skill) => skillScope(skill) === "path") },
  ]), [managedSkills, t]);

  const selectedAvailableSkill = availableSkills.find((skill) => skill.filePath === selectedAvailable) ?? availableSkills[0] ?? null;
  const selectedManageSkill = managedSkills.find((skill) => skill.filePath === selectedManage) ?? managedSkills[0] ?? null;
  const currentSkill = view === "available" ? selectedAvailableSkill : selectedManageSkill;
  const currentUpdateKey = currentSkill ? updateKey(currentSkill) : null;
  const installedPackages = useMemo<Record<SkillInstallScope, ReadonlySet<string>>>(() => ({
    global: new Set(skills.filter((skill) => skill.install?.scope === "global").map((skill) => skill.install!.package)),
    project: new Set(skills.filter((skill) => skill.install?.scope === "project").map((skill) => skill.install!.package)),
  }), [skills]);

  const automaticCount = skills.filter((skill) => !skill.disableModelInvocation).length;
  const userSkills = skills.filter((skill) => !skill.builtInSceneId);
  const manualCount = userSkills.filter((skill) => skill.disableModelInvocation).length;
  const updateCount = Object.values(updateStatuses).filter((status) => status.state === "update-available").length;
  const sceneLabel = sceneId ? getSceneLabel(getSceneDefinition(sceneId), locale) : t("skills.unknownScene");
  const context = t("skills.sceneContext", { scene: sceneLabel, project: projectName(cwd) });
  const summary = view === "available"
    ? t("skills.availableSummary", { count: skills.length, automatic: automaticCount })
    : view === "manage"
      ? t("skills.manageSummary", { count: userSkills.length, manual: manualCount })
      : t("skills.addSummary");

  const switchView = useCallback((nextView: SkillView, focus = false) => {
    setView(nextView);
    setSaveError(null);
    setUpdateError(null);
    setArchiveUninstallError(null);
    if (focus) {
      window.requestAnimationFrame(() => {
        dialogRef.current?.querySelector<HTMLElement>(`#skills-tab-${nextView}`)?.focus();
      });
    }
  }, []);

  const handleDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRef.current();
      return;
    }
    const target = event.target as HTMLElement;
    if (target.getAttribute("role") === "tab" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const currentIndex = SKILL_VIEWS.indexOf(view);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? SKILL_VIEWS.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + SKILL_VIEWS.length) % SKILL_VIEWS.length;
      switchView(SKILL_VIEWS[nextIndex], true);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
    ) ?? [])].filter((element) => !element.hidden && element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [switchView, view]);

  const renderDetail = (skill: Skill, mode: "available" | "manage") => (
    <SkillDetail
      key={skill.filePath}
      skill={skill}
      cwd={cwd}
      mode={mode}
      onToggle={toggle}
      toggling={toggling.has(skill.filePath)}
      saveError={saveError}
      updateStatus={currentUpdateKey ? updateStatuses[currentUpdateKey] : undefined}
      checkingUpdate={currentUpdateKey ? checkingUpdates.has(currentUpdateKey) : false}
      updating={updatingSkill === currentUpdateKey}
      updateError={updateError}
      onCheckUpdate={() => void checkForUpdates(skill)}
      onUpdate={() => void updateInstalledSkill(skill)}
      uninstalling={uninstallingArchive === skill.filePath}
      uninstallError={archiveUninstallError}
      onUninstall={() => void uninstallArchive(skill)}
    />
  );

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-dialog-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1 id="skills-dialog-title">{t("i18n.skills")}</h1>
            <p className={styles.context}>{context}</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose}>{t("i18n.close")}</button>
        </header>

        <nav className={styles.topTabs} role="tablist" aria-label={t("i18n.skills")}>
          {SKILL_VIEWS.map((item) => {
            const labels: Record<SkillView, string> = {
              available: t("skills.currentAvailable"),
              manage: t("skills.manage"),
              add: t("skills.add"),
            };
            return (
              <button
                type="button"
                role="tab"
                id={`skills-tab-${item}`}
                aria-controls={`skills-panel-${item}`}
                aria-selected={view === item}
                tabIndex={view === item ? 0 : -1}
                className={styles.topTab}
                key={item}
                onClick={() => switchView(item)}
              >
                {labels[item]}
              </button>
            );
          })}
        </nav>

        <main
          id={`skills-panel-${view}`}
          className={styles.content}
          role="tabpanel"
          aria-labelledby={`skills-tab-${view}`}
        >
          {view === "add" ? (
            <AddSkillPanel
              cwd={cwd}
              installedPackages={installedPackages}
              projectResourcesLoaded={projectResourcesLoaded}
              onInstalled={() => { void loadSkills(); onResourcesChanged?.(); }}
            />
          ) : (
            <div className={styles.split}>
              <aside className={styles.rail}>
                <div className={styles.railIntro}>
                  <strong>{view === "available" ? t("skills.currentAvailable") : t("skills.manage")}</strong>
                  <span>{view === "available" ? t("skills.currentAvailableHint") : t("skills.manageHint")}</span>
                </div>
                <input
                  className={styles.search}
                  value={view === "available" ? availableQuery : manageQuery}
                  aria-label={view === "available" ? t("skills.searchAvailable") : t("skills.searchManaged")}
                  placeholder={view === "available" ? t("skills.searchAvailable") : t("skills.searchManaged")}
                  onChange={(event) => view === "available"
                    ? setAvailableQuery(event.target.value)
                    : setManageQuery(event.target.value)}
                />
                {view === "manage" && (
                  <div className={styles.filterRow} aria-label={t("skills.scope")}>
                    {(["all", "project", "global", "path"] as ManageFilter[]).map((filter) => (
                      <button
                        type="button"
                        className={`${styles.filterButton} ${manageFilter === filter ? styles.filterActive : ""}`}
                        aria-pressed={manageFilter === filter}
                        key={filter}
                        onClick={() => setManageFilter(filter)}
                      >
                        {t(`skills.${filter}`)}
                      </button>
                    ))}
                  </div>
                )}
                {!projectResourcesLoaded && <div className={styles.runtimeWarning} role="status">{t("trust.skillsNotLoaded")}</div>}
                {loading ? (
                  <div className={styles.empty}>{t("i18n.loading")}</div>
                ) : error ? (
                  <div className={styles.error} role="alert">{error}</div>
                ) : (
                  <SkillGroups
                    groups={view === "available" ? availableGroups : managedGroups}
                    selectedPath={(view === "available" ? selectedAvailableSkill : selectedManageSkill)?.filePath ?? null}
                    updateStatuses={updateStatuses}
                    emptyMessage={view === "available" ? t("skills.noAvailable") : t("skills.noManaged")}
                    onSelect={(skill) => view === "available"
                      ? setSelectedAvailable(skill.filePath)
                      : setSelectedManage(skill.filePath)}
                    t={t}
                  />
                )}
                {view === "manage" && <div className={styles.empty}>{t("skills.runtimeInventoryNote")}</div>}
              </aside>
              {currentSkill
                ? renderDetail(currentSkill, view)
                : !loading && <div className={styles.detail}><div className={styles.empty}>{t("i18n.selectSkill")}</div></div>}
            </div>
          )}
        </main>

        <footer className={styles.footer}>
          <p className={styles.summary}>{summary}</p>
          {view === "manage" && skills.some((skill) => Boolean(skill.install)) && (
            <button
              type="button"
              className={styles.secondary}
              disabled={checkingAll || updatingSkill !== null}
              onClick={() => void checkForUpdates()}
            >
              {checkingAll
                ? t("i18n.checking")
                : updateCount > 0
                  ? t("skills.updateAvailableCount", { count: updateCount })
                  : t("skills.checkUpdates")}
            </button>
          )}
          <button type="button" className={styles.doneButton} onClick={onClose}>{t("skills.done")}</button>
        </footer>
      </div>
    </div>
  );
}
