// Material Icon Theme registry — imports a curated subset of the
// `material-extensions/vscode-material-icon-theme` SVGs and exposes
// two lookup tables:
//
//   • `fileIconsByExt[ext]?: ComponentType`   — file extension → SVG
//   • `fileIconsByName[name]?: ComponentType` — filename → SVG (lockfiles, configs)
//   • `folderIconsClosed[name]?: ComponentType` — folder name → SVG
//
// The icons live in `./material-icons/*.svg` as static files. Every
// component is imported through Vite's `?react` suffix, which the
// `vite-plugin-svgr` plugin turns into a real React component that
// accepts standard `<svg>` props (className, width, height, fill, …).
//
// **Open vs closed folder** — the upstream Material Icon Theme ships
// only the closed variant per folder (`folder-src.svg`); the
// `folder-src-open.svg` open variant is generated at build time and
// uses the *same* artwork (VS Code's icon engine differentiates by
// filename and applies the "tilt" effect itself). We follow the same
// pattern: one component per folder, used for both expansion states.
// The chevron row indicator already conveys the open/closed state to
// the user; the icon stays put.
//
// Why a static registry (and not a directory-glob import): Vite needs
// a fixed list of import specifiers at build time, and we want the
// failure mode of "missing icon for extension X" to surface as a
// compile-time TypeScript error rather than a runtime `undefined`.

import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

// ── File icons (extension lookup, case-insensitive) ──────────────
import TsSvg from "./material-icons/typescript.svg?react";
import JsSvg from "./material-icons/javascript.svg?react";
import PySvg from "./material-icons/python.svg?react";
import RsSvg from "./material-icons/rust.svg?react";
import GoSvg from "./material-icons/go.svg?react";
import RbSvg from "./material-icons/ruby.svg?react";
import JavaSvg from "./material-icons/java.svg?react";
import CSvg from "./material-icons/c.svg?react";
import CppSvg from "./material-icons/cpp.svg?react";
import CsharpSvg from "./material-icons/csharp.svg?react";
import SwiftSvg from "./material-icons/swift.svg?react";
import KotlinSvg from "./material-icons/kotlin.svg?react";
import HtmlSvg from "./material-icons/html.svg?react";
import CssSvg from "./material-icons/css.svg?react";
import SassSvg from "./material-icons/sass.svg?react";
import LessSvg from "./material-icons/less.svg?react";
import VueSvg from "./material-icons/vue.svg?react";
import SvelteSvg from "./material-icons/svelte.svg?react";
import ReactSvg from "./material-icons/react.svg?react";
import ReactTsSvg from "./material-icons/react_ts.svg?react";
import JsonSvg from "./material-icons/json.svg?react";
import MarkdownSvg from "./material-icons/markdown.svg?react";
import MdxSvg from "./material-icons/mdx.svg?react";
import YamlSvg from "./material-icons/yaml.svg?react";
import TomlSvg from "./material-icons/toml.svg?react";
import XmlSvg from "./material-icons/xml.svg?react";
import GraphqlSvg from "./material-icons/graphql.svg?react";
import PrismaSvg from "./material-icons/prisma.svg?react";
import ShellSvg from "./material-icons/shell.svg?react";
import BashSvg from "./material-icons/bash.svg?react";
import PowershellSvg from "./material-icons/powershell.svg?react";
import DockerSvg from "./material-icons/docker.svg?react";
import DockerComposeSvg from "./material-icons/docker-compose.svg?react";
import KubernetesSvg from "./material-icons/kubernetes.svg?react";
import ViteSvg from "./material-icons/vite.svg?react";
import NextSvg from "./material-icons/next.svg?react";
import NuxtSvg from "./material-icons/nuxt.svg?react";
import TailwindSvg from "./material-icons/tailwindcss.svg?react";
import PostcssSvg from "./material-icons/postcss.svg?react";
import EslintSvg from "./material-icons/eslint.svg?react";
import PrettierSvg from "./material-icons/prettier.svg?react";
import EditorconfigSvg from "./material-icons/editorconfig.svg?react";
import FontSvg from "./material-icons/font.svg?react";
import CompressedSvg from "./material-icons/compressed.svg?react";
import PdfSvg from "./material-icons/pdf.svg?react";
import ImageSvg from "./material-icons/image.svg?react";
import AudioSvg from "./material-icons/audio.svg?react";
import VideoSvg from "./material-icons/video.svg?react";
import DatabaseSvg from "./material-icons/database.svg?react";
import LicenseSvg from "./material-icons/license.svg?react";
import ReadmeSvg from "./material-icons/readme.svg?react";
import TodoSvg from "./material-icons/todo.svg?react";
import CertSvg from "./material-icons/cert.svg?react";

export const fileIconsByExt: Record<string, IconComponent> = {
  ts: TsSvg,
  tsx: ReactTsSvg,
  js: JsSvg,
  jsx: ReactSvg,
  mjs: JsSvg,
  cjs: JsSvg,
  py: PySvg,
  rs: RsSvg,
  go: GoSvg,
  rb: RbSvg,
  java: JavaSvg,
  c: CSvg,
  cpp: CppSvg,
  cxx: CppSvg,
  cc: CppSvg,
  h: CSvg,
  cs: CsharpSvg,
  swift: SwiftSvg,
  kt: KotlinSvg,
  kts: KotlinSvg,
  html: HtmlSvg,
  htm: HtmlSvg,
  css: CssSvg,
  scss: SassSvg,
  sass: SassSvg,
  less: LessSvg,
  vue: VueSvg,
  svelte: SvelteSvg,
  json: JsonSvg,
  md: MarkdownSvg,
  mdx: MdxSvg,
  yaml: YamlSvg,
  yml: YamlSvg,
  toml: TomlSvg,
  xml: XmlSvg,
  graphql: GraphqlSvg,
  gql: GraphqlSvg,
  prisma: PrismaSvg,
  sql: DatabaseSvg,
  sh: ShellSvg,
  bash: BashSvg,
  ps1: PowershellSvg,
  conf: EslintSvg,
  png: ImageSvg,
  jpg: ImageSvg,
  jpeg: ImageSvg,
  gif: ImageSvg,
  svg: ImageSvg,
  webp: ImageSvg,
  ico: ImageSvg,
  mp3: AudioSvg,
  wav: AudioSvg,
  flac: AudioSvg,
  mp4: VideoSvg,
  mov: VideoSvg,
  webm: VideoSvg,
  ttf: FontSvg,
  otf: FontSvg,
  woff: FontSvg,
  woff2: FontSvg,
  zip: CompressedSvg,
  gz: CompressedSvg,
  rar: CompressedSvg,
  "7z": CompressedSvg,
  pem: CertSvg,
  key: CertSvg,
  crt: CertSvg,
  pdf: PdfSvg,
};

// ── File icons (filename lookup, mixed case — camelCase wins) ────
export const fileIconsByName: Record<string, IconComponent> = {
  "vite.config.ts": ViteSvg,
  "vite.config.js": ViteSvg,
  "vite.config.mjs": ViteSvg,
  "next.config.js": NextSvg,
  "next.config.ts": NextSvg,
  "next.config.mjs": NextSvg,
  "nuxt.config.ts": NuxtSvg,
  "tailwind.config.js": TailwindSvg,
  "tailwind.config.ts": TailwindSvg,
  "postcss.config.js": PostcssSvg,
  ".eslintrc": EslintSvg,
  ".eslintrc.js": EslintSvg,
  ".eslintrc.cjs": EslintSvg,
  ".eslintrc.json": EslintSvg,
  ".eslintrc.yaml": EslintSvg,
  ".prettierrc": PrettierSvg,
  ".prettierrc.json": PrettierSvg,
  ".prettierrc.js": PrettierSvg,
  ".editorconfig": EditorconfigSvg,
  "README.md": ReadmeSvg,
  "readme.md": ReadmeSvg,
  "TODO.md": TodoSvg,
  "LICENSE": LicenseSvg,
  "LICENSE.md": LicenseSvg,
  "Dockerfile": DockerSvg,
  "docker-compose.yml": DockerComposeSvg,
  "docker-compose.yaml": DockerComposeSvg,
};

// ── Folder icons (single variant per name — same artwork whether
//    open or closed; VS Code's chevron conveys expansion state) ──
import FolderSrcSvg from "./material-icons/folder-src.svg?react";
import FolderDistSvg from "./material-icons/folder-dist.svg?react";
import FolderPublicSvg from "./material-icons/folder-public.svg?react";
import FolderImagesSvg from "./material-icons/folder-images.svg?react";
import FolderComponentsSvg from "./material-icons/folder-components.svg?react";
import FolderViewsSvg from "./material-icons/folder-views.svg?react";
import FolderCssSvg from "./material-icons/folder-css.svg?react";
import FolderLibSvg from "./material-icons/folder-lib.svg?react";
import FolderUtilsSvg from "./material-icons/folder-utils.svg?react";
import FolderHookSvg from "./material-icons/folder-hook.svg?react";
import FolderApiSvg from "./material-icons/folder-api.svg?react";
import FolderRoutesSvg from "./material-icons/folder-routes.svg?react";
import FolderControllerSvg from "./material-icons/folder-controller.svg?react";
import FolderTypescriptSvg from "./material-icons/folder-typescript.svg?react";
import FolderServerSvg from "./material-icons/folder-server.svg?react";
import FolderClientSvg from "./material-icons/folder-client.svg?react";
import FolderScriptsSvg from "./material-icons/folder-scripts.svg?react";
import FolderConfigSvg from "./material-icons/folder-config.svg?react";
import FolderDocsSvg from "./material-icons/folder-docs.svg?react";
import FolderTestSvg from "./material-icons/folder-test.svg?react";
import FolderPrismaSvg from "./material-icons/folder-prisma.svg?react";
import FolderDockerSvg from "./material-icons/folder-docker.svg?react";
import FolderKubernetesSvg from "./material-icons/folder-kubernetes.svg?react";
import FolderMiddlewareSvg from "./material-icons/folder-middleware.svg?react";
import FolderResourceSvg from "./material-icons/folder-resource.svg?react";
import FolderPluginSvg from "./material-icons/folder-plugin.svg?react";
import FolderToolsSvg from "./material-icons/folder-tools.svg?react";
import FolderMobileSvg from "./material-icons/folder-mobile.svg?react";
import FolderDesktopSvg from "./material-icons/folder-desktop.svg?react";
import FolderUiSvg from "./material-icons/folder-ui.svg?react";
import FolderEventSvg from "./material-icons/folder-event.svg?react";
import FolderFormSvg from "./material-icons/folder-form.svg?react";
import FolderReviewSvg from "./material-icons/folder-review.svg?react";

/** Folder-name → icon component. Same component for open + closed. */
export const folderIconsClosed: Record<string, IconComponent> = {
  src: FolderSrcSvg,
  dist: FolderDistSvg,
  build: FolderDistSvg,
  public: FolderPublicSvg,
  assets: FolderImagesSvg,
  images: FolderImagesSvg,
  img: FolderImagesSvg,
  components: FolderComponentsSvg,
  pages: FolderComponentsSvg,
  views: FolderViewsSvg,
  layouts: FolderViewsSvg,
  styles: FolderCssSvg,
  css: FolderCssSvg,
  scss: FolderCssSvg,
  lib: FolderLibSvg,
  utils: FolderUtilsSvg,
  helpers: FolderUtilsSvg,
  hooks: FolderHookSvg,
  hook: FolderHookSvg,
  api: FolderApiSvg,
  routes: FolderRoutesSvg,
  controllers: FolderControllerSvg,
  controller: FolderControllerSvg,
  services: FolderUtilsSvg,
  service: FolderUtilsSvg,
  models: FolderUtilsSvg,
  model: FolderUtilsSvg,
  types: FolderTypescriptSvg,
  server: FolderServerSvg,
  client: FolderClientSvg,
  scripts: FolderScriptsSvg,
  config: FolderConfigSvg,
  configs: FolderConfigSvg,
  docs: FolderDocsSvg,
  doc: FolderDocsSvg,
  documentation: FolderDocsSvg,
  tests: FolderTestSvg,
  test: FolderTestSvg,
  __tests__: FolderTestSvg,
  spec: FolderTestSvg,
  prisma: FolderPrismaSvg,
  migrations: FolderPrismaSvg,
  seeds: FolderPrismaSvg,
  fixtures: FolderPrismaSvg,
  docker: FolderDockerSvg,
  kubernetes: FolderKubernetesSvg,
  auth: FolderResourceSvg,
  account: FolderResourceSvg,
  user: FolderResourceSvg,
  users: FolderResourceSvg,
  members: FolderResourceSvg,
  member: FolderResourceSvg,
  profile: FolderResourceSvg,
  "my-profile": FolderResourceSvg,
  myProfile: FolderResourceSvg,
  middleware: FolderMiddlewareSvg,
  vendor: FolderResourceSvg,
  plugins: FolderPluginSvg,
  plugin: FolderPluginSvg,
  tools: FolderToolsSvg,
  blocks: FolderResourceSvg,
  block: FolderResourceSvg,
  mobile: FolderMobileSvg,
  desktop: FolderDesktopSvg,
  web: FolderComponentsSvg,
  resources: FolderResourceSvg,
  resource: FolderResourceSvg,
  workspace: FolderResourceSvg,
  ui: FolderUiSvg,
  dashboard: FolderViewsSvg,
  calendar: FolderEventSvg,
  meetings: FolderEventSvg,
  meeting: FolderEventSvg,
  events: FolderEventSvg,
  forms: FolderFormSvg,
  form: FolderFormSvg,
  review: FolderReviewSvg,
  reviews: FolderReviewSvg,
  notification: FolderResourceSvg,
  notifications: FolderResourceSvg,
  section: FolderViewsSvg,
  sections: FolderViewsSvg,
  itemDetail: FolderResourceSvg,
  "item-detail": FolderResourceSvg,
  sidebar: FolderComponentsSvg,
  sidebars: FolderComponentsSvg,
  topbar: FolderComponentsSvg,
  "top-bar": FolderComponentsSvg,
  topBar: FolderComponentsSvg,
  settings: FolderConfigSvg,
  setting: FolderConfigSvg,
};

/**
 * Resolve a folder basename to its icon component. Same component is
 * returned regardless of `open` — the upstream Material Icon Theme
 * reuses the closed artwork for the open state and the chevron row
 * indicator already conveys expansion. Returns `null` when the name
 * isn't in the curated map — caller falls back to the default amber
 * codicon.
 */
export function getFolderIcon(
  folderName: string,
  _open: boolean,
): IconComponent | null {
  return folderIconsClosed[folderName] ?? null;
}

/**
 * Resolve a file basename to its icon component. Filename overrides
 * win over extension (lockfiles, configs, README). Case-insensitive
 * for the extension; exact for the filename.
 */
export function getFileIcon(fileName: string): IconComponent | null {
  const byName = fileIconsByName[fileName];
  if (byName) return byName;
  const lower = fileName.toLowerCase();
  const byLowerName = fileIconsByName[lower];
  if (byLowerName) return byLowerName;
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return null;
  return fileIconsByExt[lower.slice(dot + 1)] ?? null;
}
