// Plan-mode state for the embedded AI panel — localStorage, keyed per
// project (same scheme as sessions/memory/skills). A produced plan must
// survive a page reload: the approval card IS the user's pending
// decision, and losing it would force re-running the whole prompt.

export type AiPlanState = {
  /** Plan mode toggle — tasks plan first, execute on approval. */
  planMode: boolean;
  /** The produced plan awaiting the user's Execute/Discard decision. */
  pendingPlan: string | null;
};

const KEY_PREFIX = "wb-ai-plan.v1:";

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function loadPlanState(projectId: string): AiPlanState {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return { planMode: false, pendingPlan: null };
    const parsed = JSON.parse(raw) as Partial<AiPlanState> | null;
    return {
      planMode: parsed?.planMode === true,
      pendingPlan: typeof parsed?.pendingPlan === "string" ? parsed.pendingPlan : null,
    };
  } catch {
    return { planMode: false, pendingPlan: null };
  }
}

export function savePlanState(projectId: string, state: AiPlanState): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(state));
  } catch {
    // quota / private mode — in-memory only for this session
  }
}
