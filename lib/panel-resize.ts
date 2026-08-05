export type PanelResizeConfig = {
  minWidth: number;
  maxWidth?: number;
  maxViewportRatio?: number;
  collapseThreshold: number;
};

export function getAvailablePanelMaxWidth(
  viewportWidth: number,
  otherPanelWidth: number,
  centerMinWidth: number,
  config: PanelResizeConfig,
): number {
  const availableWidth = viewportWidth - otherPanelWidth - centerMinWidth;
  const configuredMaxWidth = Math.min(
    config.maxWidth ?? Number.POSITIVE_INFINITY,
    viewportWidth * (config.maxViewportRatio ?? 1),
  );
  // 面板上限还要受中心工作区可用空间约束，避免预览区挤掉主要操作区域。
  return Math.max(config.minWidth, Math.min(configuredMaxWidth, availableWidth));
}

export function clampPanelDragWidth(width: number, maxWidth: number): number {
  return Math.max(0, Math.min(maxWidth, width));
}

export function settlePanelResize(
  width: number,
  maxWidth: number,
  config: PanelResizeConfig,
): { open: false } | { open: true; width: number } {
  if (width <= config.collapseThreshold) return { open: false };
  return {
    open: true,
    width: Math.max(config.minWidth, Math.min(maxWidth, width)),
  };
}

export function parseStoredPanelWidth(
  storedWidth: string | null,
  fallbackWidth: number,
  config: PanelResizeConfig,
): number {
  const parsed = Number(storedWidth);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackWidth;
  return Math.max(
    config.minWidth,
    Math.min(config.maxWidth ?? Number.POSITIVE_INFINITY, parsed),
  );
}
