const DEFAULT_WORKSPACE_ID = "default";

export function getWorkspaceId() {
  return process.env.SENTINEL_WORKSPACE_ID?.trim().toLowerCase() || DEFAULT_WORKSPACE_ID;
}
