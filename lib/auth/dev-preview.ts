export function canUseDevPreview(nodeEnv: string | undefined, enabled: string | undefined): boolean {
  return nodeEnv === "development" && enabled === "true";
}
