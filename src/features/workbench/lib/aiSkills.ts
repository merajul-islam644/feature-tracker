// User-authored skills for the embedded AI panel — localStorage, keyed
// per project (same scheme as chat sessions + memory). A skill is a
// reusable prompt package: name + the full prompt the panel sends as a
// normal user message when the skill is clicked. Built-in preset
// prompts stay in the panel; these are the user's own recipes.

export type AiSkill = {
  id: string;
  /** Short display name (menu row). */
  name: string;
  /** The prompt sent verbatim when the skill runs. */
  prompt: string;
  createdAt: number;
};

const KEY_PREFIX = "wb-ai-skills.v1:";
const MAX_SKILLS = 30;
const MAX_NAME = 60;
const MAX_PROMPT = 4_000;

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function loadSkills(projectId: string): AiSkill[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (skill): skill is AiSkill =>
        !!skill &&
        typeof skill.id === "string" &&
        typeof skill.name === "string" &&
        typeof skill.prompt === "string",
    );
  } catch {
    return [];
  }
}

function saveSkills(projectId: string, skills: AiSkill[]): AiSkill[] {
  const cleaned = skills.slice(0, MAX_SKILLS);
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(cleaned));
  } catch {
    // quota / private mode — in-memory only for this session
  }
  return cleaned;
}

export function addSkill(projectId: string, name: string, prompt: string): AiSkill[] {
  const cleanName = name.trim().slice(0, MAX_NAME);
  const cleanPrompt = prompt.trim().slice(0, MAX_PROMPT);
  if (!cleanName || !cleanPrompt) return loadSkills(projectId);
  // Same name replaces the old recipe — the user is editing by intent.
  const rest = loadSkills(projectId).filter(
    (skill) => skill.name.toLowerCase() !== cleanName.toLowerCase(),
  );
  return saveSkills(
    projectId,
    [{ id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: cleanName, prompt: cleanPrompt, createdAt: Date.now() }, ...rest],
  );
}

export function removeSkill(projectId: string, id: string): AiSkill[] {
  return saveSkills(projectId, loadSkills(projectId).filter((skill) => skill.id !== id));
}
