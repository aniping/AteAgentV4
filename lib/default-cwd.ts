export const DEFAULT_CWD_NAME_PATTERN = /^ate-cwd-\d{8}$/;

export function getDefaultCwdName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `ate-cwd-${date}`;
}
