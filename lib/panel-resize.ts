export type PanelResizeConfig = {
  minWidth: number;
  maxWidth: number;
  collapseThreshold: number;
};

export function getAvailablePanelMaxWidth(
  viewportWidth: number,
  otherPanelWidth: number,
  centerMinWidth: number,
  config: PanelResizeConfig,
): number {
  const availableWidth = viewportWidth - otherPanelWidth - centerMinWidth;
  return Math.max(config.minWidth, Math.min(config.maxWidth, availableWidth));
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
  return Math.max(config.minWidth, Math.min(config.maxWidth, parsed));
}
