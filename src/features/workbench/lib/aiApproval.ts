// Approval mode for the embedded AI panel — localStorage, keyed per
// project (same scheme as plan mode / sessions / memory).
//
//   "manual" — file edits land as diff proposals; the user Accepts or
//              Rejects each batch (the classic gate).
//   "auto"   — file edits apply to disk IMMEDIATELY; no cards, no gate.
//              The AI decides and reports "applied".

export type AiApprovalMode = "manual" | "auto";

const KEY_PREFIX = "wb-ai-approval.v1:";

export function loadApprovalMode(projectId: string): AiApprovalMode {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${projectId}`) === "auto"
      ? "auto"
      : "manual";
  } catch {
    return "manual";
  }
}

export function saveApprovalMode(
  projectId: string,
  mode: AiApprovalMode,
): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${projectId}`, mode);
  } catch {
    // quota / private mode — in-memory only for this session
  }
}
