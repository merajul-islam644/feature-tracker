// One-click composer templates for the Dashboard announcements section.
//
// Managers post the same kinds of messages over and over (deploy day,
// maintenance, freezes). These chips fill the composer so a broadcast is
// two clicks instead of a paragraph of typing; the text stays fully
// editable after filling, so a template is a starting point — not a form.
//
// Deliberately NOT localized: the bodies are broadcast CONTENT (the
// language the manager posts in), not UI chrome. Same reason the
// announcement rows themselves aren't translated.

export interface AnnouncementTemplate {
  id: string;
  /** Short chip label shown above the composer. */
  title: string;
  /** Text poured into the textarea on click. */
  body: string;
}

export const ANNOUNCEMENT_TEMPLATES: readonly AnnouncementTemplate[] = [
  {
    id: "going-to-prod",
    title: "Going to prod",
    body: "Hello team! Today we are going to prod. Please finish your final checks and update your tickets before the deploy.",
  },
  {
    id: "deploy-done",
    title: "Deployment done",
    body: "The production deployment is complete. Please smoke-test your areas and report anything unusual right away.",
  },
  {
    id: "code-freeze",
    title: "Code freeze",
    body: "Code freeze starts now. Please merge or park your open changes — only critical fixes until the release is out.",
  },
  {
    id: "maintenance",
    title: "Maintenance",
    body: "Scheduled maintenance tonight — the app may be briefly unavailable. Please save your work beforehand.",
  },
  {
    id: "meeting",
    title: "Meeting reminder",
    body: "Reminder: team meeting today. Please join on time and be ready with a short update on your part.",
  },
  {
    id: "great-work",
    title: "Great work",
    body: "Great work this week, team — this release wouldn't have happened without you. Keep it up!",
  },
];
