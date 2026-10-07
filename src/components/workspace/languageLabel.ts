// File-extension → human-readable language label for the status bar
// and editor chrome. VS Code's mode registry returns a similar
// "TypeScript", "TypeScript JSX", "JSON with Comments" string; we
// replicate just the subset that comes up in the Lattice codebase
// (React/TS, Markdown, JSON, plain text). Falls back to "Plain text"
// for unknown extensions so the status bar never renders a blank
// slot.

const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript JSX",
  js: "JavaScript",
  jsx: "JavaScript JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  jsonc: "JSON with Comments",
  md: "Markdown",
  mdx: "MDX",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  html: "HTML",
  htm: "HTML",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "INI",
  sh: "Shell Script",
  bash: "Shell Script",
  zsh: "Shell Script",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C Header",
  cpp: "C++",
  hpp: "C++ Header",
  cs: "C#",
  php: "PHP",
  sql: "SQL",
  graphql: "GraphQL",
  gql: "GraphQL",
  vue: "Vue",
  svelte: "Svelte",
  env: "Environment",
  txt: "Plain Text",
  log: "Log",
  lock: "Lockfile",
  gitignore: "Gitignore",
  dockerignore: "Dockerignore",
  editorconfig: "EditorConfig",
  prettierrc: "Prettier Config",
  eslintrc: "ESLint Config",
};

export function languageLabel(path: string): string {
  if (!path) return "Plain Text";
  const lower = path.toLowerCase();
  // Config-style files use the whole basename (e.g. ".eslintrc",
  // "tsconfig.json", "prettier.config.js"). Match the basename
  // against common config names before falling back to the
  // extension lookup.
  const slash = lower.lastIndexOf("/");
  const basename = slash === -1 ? lower : lower.slice(slash + 1);
  const dot = basename.lastIndexOf(".");
  if (dot === -1) {
    // No extension — try the basename itself (e.g. "Dockerfile",
    // "Makefile").
    return LANG_BY_EXT[basename] ?? "Plain Text";
  }
  const ext = basename.slice(dot + 1);
  return LANG_BY_EXT[ext] ?? "Plain Text";
}
