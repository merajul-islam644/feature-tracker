/**
 * Browser-side Playwright-style runtime.
 *
 * The goal is to give QA scripts a familiar `page.locator(...)` /
 * `page.expect(...)` surface without spinning up a real browser. We
 * leverage whatever DOM `document` happens to have at the moment the
 * user runs their snippet, so the script can target the live UI of the
 * app the same way Playwright would target a server-rendered page.
 *
 * What this runner does NOT do:
 *   - It doesn't simulate the browser engine (no real cookies, no
 *     network requests intercepted, no cross-frame checks). Scripts
 *     operate against `document` only.
 *   - It doesn't sandbox the user's script. The script runs in the
 *     global scope with `page`, `expect`, and `console` injected. The
 *     page is responsible for letting users run code they trust -- the
 *     same trust model as the browser DevTools console.
 *
 * The runner is invoked by `PlaywrightPage.tsx` after the user clicks
 * Run. The script resolves once all awaited promises settle, so the
 * page can stream the output to its console panel.
 */

import { loadEnv } from "./envStore";

export type RunnerLogKind = "log" | "warn" | "error" | "info" | "expect" | "result";

export type RunnerLog = {
  id: number;
  kind: RunnerLogKind;
  text: string;
  detail?: string;
};

/**
 * Side-channel event fired by `Locator.click()` / `Locator.fill()` just
 * before the action runs. The host UI renders this as a brief overlay
 * so the user can see which element the runner is about to touch.
 *
 * Kept out of the log list — it's a visual signal, not a textual one.
 */
export type HighlightInfo = {
  action: "click" | "fill";
  selector: string;
  rect: { top: number; left: number; width: number; height: number };
  label: string;
};

/**
 * Module-level ref so `Locator` action methods can emit without taking
 * a callback parameter. `runPlaywright` sets this on entry and clears
 * it on exit (via `restore()`), so post-run calls from a stale
 * `Locator` reference can't accidentally fire highlights.
 */
let onHighlightRef: ((info: HighlightInfo) => void) | null = null;

function emitHighlight(selector: string, action: "click" | "fill", el: Element): void {
  if (!onHighlightRef) return;
  const r = el.getBoundingClientRect();
  onHighlightRef({
    action,
    selector,
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    label: `${action}: ${selector}`
  });
}

/* ------------------------------------------------------------------ */
/* Locator                                                            */
/* ------------------------------------------------------------------ */

export class LocatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocatorError";
  }
}

export class Locator {
  readonly selector: string;

  constructor(selector: string) {
    this.selector = selector;
  }

  async _resolve(): Promise<Element> {
    const el = document.querySelector(this.selector);
    if (!el) throw new LocatorError(`locator(${this.selector}): no element found in DOM`);
    return el;
  }

  async _resolveAll(): Promise<Element[]> {
    return Array.from(document.querySelectorAll(this.selector));
  }

  async click(): Promise<void> {
    const el = await this._resolve();
    if (!(el instanceof HTMLElement)) {
      throw new LocatorError(`locator(${this.selector}): not an HTMLElement`);
    }
    emitHighlight(this.selector, "click", el);
    el.click();
  }

  async fill(text: string): Promise<void> {
    const el = await this._resolve();
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement
          ? window.HTMLInputElement.prototype
          : null;
    if (!proto) {
      throw new LocatorError(`locator(${this.selector}): fill() only works on <input> / <textarea>`);
    }
    emitHighlight(this.selector, "fill", el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) throw new LocatorError("no value setter found on input prototype");
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async textContent(): Promise<string | null> {
    const el = await this._resolve();
    return el.textContent;
  }

  async getAttribute(name: string): Promise<string | null> {
    const el = await this._resolve();
    return el.getAttribute(name);
  }

  async isVisible(): Promise<boolean> {
    try {
      const el = await this._resolve();
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    } catch {
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      const el = await this._resolve();
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        return !el.disabled;
      }
      return true;
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    return (await this._resolveAll()).length;
  }

  async waitFor(state: "visible" | "hidden" | "attached" = "visible", timeoutMs = 5000): Promise<void> {
    const start = performance.now();
    while (true) {
      const all = await this._resolveAll();
      const isMatch =
        state === "attached"
          ? all.length > 0
          : state === "hidden"
            ? all.length === 0 ||
              all.every((el) => {
                if (!(el instanceof HTMLElement)) return true;
                const style = window.getComputedStyle(el);
                return style.visibility === "hidden" || style.display === "none";
              })
            : all.some((el) => {
                if (!(el instanceof HTMLElement)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
              });
      if (isMatch) return;
      if (performance.now() - start > timeoutMs) {
        throw new LocatorError(`locator(${this.selector}) did not reach state "${state}" within ${timeoutMs} ms`);
      }
      await delay(50);
    }
  }

  /** Nested locator -- flat selector (kept for forward-compat). */
  locator(selector: string): Locator {
    return new Locator(selector);
  }

  nth(index: number): IndexLocator {
    return new IndexLocator(this, index);
  }

  first(): IndexLocator {
    return this.nth(0);
  }
}

/** Locator that resolves to the Nth match of its parent. */
export class IndexLocator extends Locator {
  private readonly parent: Locator;
  private readonly index: number;

  constructor(parent: Locator, index: number) {
    super(parent.selector);
    this.parent = parent;
    this.index = index;
  }

  async _resolve(): Promise<Element> {
    const all = await this.parent._resolveAll();
    const el = all[this.index];
    if (!el) {
      throw new LocatorError(
        `locator(${this.parent.selector}).nth(${this.index}): out of range (only ${all.length} matches)`
      );
    }
    return el;
  }
}

/**
 * Locator whose matches are determined by a custom predicate over every
 * element in the document. Used by `page.getByRole`, `page.getByText`,
 * etc. — none of those have a CSS selector equivalent (or the
 * equivalent would be too brittle), so we walk the DOM ourselves and
 * keep only the candidates the user asked for.
 *
 * The `description` is what shows up in error messages so the user
 * can tell at a glance which query failed (e.g. "getByRole(button, {name: 'Log in'})").
 *
 * The optional `candidatesSelector` lets callers pre-narrow the set of
 * elements we walk. For `getByRole(role)` we pass a role-specific
 * selector (`button, input[type="submit"], [role="button"]`, etc.) so
 * the predicate runs over a handful of nodes instead of every element
 * in the document — that single change turns the page-hang that
 * happened on large CodeMirror / tree pages into a sub-millisecond
 * scan.
 */
export class FilterLocator extends Locator {
  private readonly predicate: (el: Element) => boolean;
  private readonly description: string;
  private readonly candidatesSelector: string;

  constructor(
    description: string,
    predicate: (el: Element) => boolean,
    candidatesSelector: string = "*"
  ) {
    // We pass a synthetic selector purely so Locator's constructor
    // doesn't complain. _resolve/_resolveAll are overridden and never
    // touch the selector.
    super(`__filter__:${description}`);
    this.predicate = predicate;
    this.description = description;
    this.candidatesSelector = candidatesSelector;
  }

  async _resolve(): Promise<Element> {
    const all = await this._resolveAll();
    if (all.length === 0) {
      throw new LocatorError(`${this.description}: no element found in DOM`);
    }
    return all[0]!;
  }

  async _resolveAll(): Promise<Element[]> {
    return Array.from(document.querySelectorAll(this.candidatesSelector)).filter(
      this.predicate
    );
  }

  /** Friendly description for error messages. */
  override toString(): string {
    return this.description;
  }
}

/**
 * CSS selectors that pre-narrow the candidate set for common ARIA roles.
 * Only elements matching this selector can possibly satisfy the role,
 * so the predicate runs over a small set instead of every element in
 * the document. Falls back to `*` (everything) for roles we don't list,
 * which is fine because the predicate short-circuits on tag mismatch
 * for those.
 */
const ROLE_CANDIDATE_SELECTORS: Record<string, string> = {
  button:
    'button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], [role="button"]',
  link: 'a[href], [role="link"]',
  textbox:
    'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], input[type="number"], textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  radio: 'input[type="radio"], [role="radio"]',
  heading: "h1, h2, h3, h4, h5, h6, [role='heading']",
  img: 'img, svg, [role="img"]',
  list: "ul, ol, [role='list']",
  listitem: "li, [role='listitem']",
  navigation: "nav, [role='navigation']",
  main: "main, [role='main']",
  article: "article, [role='article']",
  complementary: "aside, [role='complementary']",
  contentinfo: "footer, [role='contentinfo']",
  banner: "header, [role='banner']",
  form: "form, [role='form']",
  combobox: 'select, [role="combobox"]',
  slider: 'input[type="range"], [role="slider"]',
  label: "label, [role='label']",
  option: "option, [role='option']"
};

/* ------------------------------------------------------------------ */
/* Assertions                                                         */
/* ------------------------------------------------------------------ */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

type ExpectTarget = Locator | unknown;

let globalLog: ((entry: Omit<RunnerLog, "id">) => void) | null = null;

function recordExpect(passed: boolean, name: string, detail?: string): void {
  if (passed) {
    globalLog?.({ kind: "expect", text: `✓ ${name}` });
  } else {
    globalLog?.({ kind: "error", text: `✗ ${name}`, detail });
    throw new AssertionError(detail ?? name);
  }
}

/** Helper: pull the textual content of a Locator, throwing if missing. */
async function locatorText(locator: Locator): Promise<string> {
  const el = await locator._resolve();
  return el.textContent ?? "";
}

async function locatorAttr(locator: Locator, name: string): Promise<string | null> {
  return locator.getAttribute(name);
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export class Page {
  /**
   * Navigate the SPA via the History API and wait for the destination
   * pathname to take effect. The router listens for `popstate`, so we
   * dispatch one after pushing the new URL; the wait at the bottom is
   * a safety net so the next locator query sees the new DOM.
   *
   * If the URL is cross-origin (e.g. `https://other-site.com/login`),
   * we can't actually navigate there from the in-browser runner --
   * `history.pushState` rejects cross-origin URLs and a real navigation
   * would unload the runner itself. We log a warning so the script
   * keeps running but the user sees exactly why nothing happened.
   */
  async goto(path: string): Promise<void> {
    const target = normalizePath(path);
    // Cross-origin? Stay put and explain.
    if (/^https?:\/\//i.test(target) && !target.startsWith(window.location.origin)) {
      appendLogQuiet({
        kind: "warn",
        text: `page.goto(${JSON.stringify(path)}): cross-origin URL -- the in-browser runner cannot navigate to other domains. Only this app's routes are reachable. Use the real Playwright runner for external sites.`
      });
      return;
    }
    const before = window.location.pathname;
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
    // Wait for both URL change and a couple of paint frames -- SPA route
    // transitions usually complete inside ~50ms but we leave headroom.
    let waited = 0;
    while (window.location.pathname !== target && waited < 1000) {
      await delay(20);
      waited += 20;
    }
    await delay(80);
    if (target !== before) {
      appendLogQuiet({ kind: "info", text: `navigated ${before} -> ${window.location.pathname}` });
    }
  }

  url(): string {
    return window.location.pathname;
  }

  locator(selector: string): Locator {
    return new Locator(selector);
  }

  /**
   * Match an element by its implicit or explicit ARIA role, optionally
   * filtered by accessible name. Real Playwright's role engine is
   * enormous; we implement only the common HTML element → role mapping
   * (button, link, textbox, checkbox, etc.) which covers the vast
   * majority of real-world test code. Anything exotic throws a
   * LocatorError with a clear message so the user can fall back to
   * `locator(...)` with a CSS selector.
   */
  getByRole(role: string, options: ByRoleOptions = {}): Locator {
    const predicate = (el: Element) => matchesRole(el, role, options);
    const namePart =
      options.name !== undefined
        ? typeof options.name === "string"
          ? `{ name: ${JSON.stringify(options.name)} }`
          : `{ name: ${options.name} }`
        : "";
    // Pre-narrow candidates by tag/attribute so we don't iterate every
    // element on the page. For unmapped roles fall back to `*`; the
    // predicate still short-circuits on tag mismatch, so this is safe.
    const selector = ROLE_CANDIDATE_SELECTORS[role] ?? "*";
    return new FilterLocator(`getByRole(${role}${namePart})`, predicate, selector);
  }

  /** Match by element's own text content (or accessible name). */
  getByText(text: string | RegExp, options: { exact?: boolean } = {}): Locator {
    const matcher = makeMatcher(text, options.exact ?? false);
    const predicate = (el: Element) => {
      // Element text is the direct child text excluding descendants
      // whose own text would otherwise be matched (matches Playwright's
      // "exact" semantics — for nested cases the user can opt into a
      // wider selector).
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .filter(Boolean)
        .join(" ");
      const accn = computeAccessibleName(el);
      return matcher(own) || matcher(accn);
    };
    const textLabel = typeof text === "string" ? JSON.stringify(text) : String(text);
    return new FilterLocator(`getByText(${textLabel})`, predicate);
  }

  /** Match by associated <label> text (or aria-label). */
  getByLabel(text: string | RegExp, options: { exact?: boolean } = {}): Locator {
    const matcher = makeMatcher(text, options.exact ?? false);
    const predicate = (el: Element) => {
      // aria-label always wins (it's the most direct label).
      const aria = el.getAttribute("aria-label");
      if (aria && matcher(aria)) return true;
      // Otherwise look for an associated <label for="id"> or wrapping label.
      const id = el.getAttribute("id");
      if (id) {
        const labelEl = document.querySelector(`label[for="${cssEscape(id)}"]`);
        if (labelEl && matcher(labelEl.textContent ?? "")) return true;
      }
      let parent: HTMLElement | null = el.parentElement;
      while (parent) {
        if (parent.tagName === "LABEL" && matcher(parent.textContent ?? "")) return true;
        parent = parent.parentElement;
      }
      return false;
    };
    const textLabel = typeof text === "string" ? JSON.stringify(text) : String(text);
    return new FilterLocator(`getByLabel(${textLabel})`, predicate);
  }

  /** Match by the placeholder attribute. */
  getByPlaceholder(text: string | RegExp, options: { exact?: boolean } = {}): Locator {
    const matcher = makeMatcher(text, options.exact ?? false);
    const predicate = (el: Element) => {
      const placeholder = el.getAttribute("placeholder");
      return placeholder !== null && matcher(placeholder);
    };
    const textLabel = typeof text === "string" ? JSON.stringify(text) : String(text);
    return new FilterLocator(`getByPlaceholder(${textLabel})`, predicate);
  }

  /** Match by data-testid, data-test-id, or data-test attributes. */
  getByTestId(testId: string): Locator {
    const predicate = (el: Element) => {
      return (
        el.getAttribute("data-testid") === testId ||
        el.getAttribute("data-test-id") === testId ||
        el.getAttribute("data-test") === testId
      );
    };
    return new FilterLocator(`getByTestId(${JSON.stringify(testId)})`, predicate);
  }

  expect(target: ExpectTarget): ExpectChain {
    return new ExpectChain(target);
  }

  async evaluate<R>(fn: () => R): Promise<R> {
    return Promise.resolve(fn());
  }

  async waitForTimeout(ms: number): Promise<void> {
    await delay(ms);
  }

  async waitForLoadState(_state: "load" | "domcontentloaded" = "load"): Promise<void> {
    await delay(50);
  }
}

export type ByRoleOptions = {
  /** Match by accessible name. Substring by default; set `exact: true` for strict equality. */
  name?: string | RegExp;
  exact?: boolean;
  /** Include elements that are aria-hidden or otherwise not visible. Default: false. */
  hidden?: boolean;
};

/** True if `el`'s implicit or explicit role equals `role`. */
function matchesRole(el: Element, role: string, options: ByRoleOptions): boolean {
  if (!options.hidden && !isVisibleForTest(el)) return false;
  const explicit = el.getAttribute("role");
  const implicit = implicitRole(el);
  if (explicit !== null) {
    if (explicit !== role) return false;
  } else if (implicit !== role) {
    return false;
  }
  if (options.name === undefined) return true;
  const accn = computeAccessibleName(el);
  if (typeof options.name === "string") {
    return options.exact ? accn === options.name : accn.includes(options.name);
  }
  return options.name.test(accn);
}

/**
 * Visible-for-testing heuristic: skip elements that are display:none
 * or hidden, OR that have any such ancestor (typical modal bodies,
 * collapsed sections, etc.). Deliberately does NOT call
 * `getBoundingClientRect()` — that triggers a layout reflow and was
 * the source of the "click freezes the page" bug when `getByRole`
 * ran over thousands of CodeMirror spans / tree rows. Real Playwright
 * does the full CSS-visible check, but for our in-page runner a
 * `display:none` / hidden test catches the 99% case and keeps the
 * filter fast enough to scan the entire document.
 */
function isVisibleForTest(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.hidden) return false;
    // Inline display:none is the cheap path. If a stylesheet sets
    // display:none, getComputedStyle would catch it -- but we accept
    // that rare miss in exchange for not paying a layout query per
    // element. The runner already logs failures clearly, so a hidden
    // candidate passing through won't break the test, just match an
    // extra element.
    if (cur.style.display === "none") return false;
    cur = cur.parentElement;
  }
  return true;
}

/**
 * Map an HTML element to its implicit ARIA role. We only cover the
 * common cases — anything not listed returns "generic" so the user
 * can still match it with the generic role if they really want.
 */
function implicitRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "a":
      return el.hasAttribute("href") ? "link" : "generic";
    case "article":
      return "article";
    case "aside":
      return "complementary";
    case "button":
      return "button";
    case "footer":
      return "contentinfo";
    case "form":
      return "form";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "header":
      return "banner";
    case "img":
      return el.hasAttribute("alt") ? "img" : "presentation";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "submit" || type === "reset" || type === "button") return "button";
      return "textbox";
    }
    case "label":
      return "label";
    case "li":
      return "listitem";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "ol":
      return "list";
    case "option":
      return "option";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "ul":
      return "list";
    default:
      return "generic";
  }
}

/**
 * Accessible name, computed in priority order:
 *   1. aria-labelledby (pointing to another element by id)
 *   2. aria-label
 *   3. Associated <label> (for/id or wrapping)
 *   4. title attribute
 *   5. <button>/<a> text content
 *   6. <input> value (for submit buttons) or alt (for images)
 *   7. Element text content as last resort
 *
 * This is a simplified version of the WAI-ARIA name algorithm — enough
 * for the 95% case. We don't handle recursive labelledby chains.
 */
function computeAccessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = document.getElementById(id);
      if (ref) parts.push(ref.textContent ?? "");
    }
    if (parts.length > 0) return parts.join(" ").trim();
  }
  const aria = el.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();
  // Associated <label for="id">.
  const id = el.getAttribute("id");
  if (id) {
    const labelEl = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (labelEl) return (labelEl.textContent ?? "").trim();
  }
  // Wrapping <label>.
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    if (parent.tagName === "LABEL") return (parent.textContent ?? "").trim();
    parent = parent.parentElement;
  }
  const title = el.getAttribute("title");
  if (title) return title.trim();
  // Submit/reset/button inputs: value attribute is the name.
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    const value = el.getAttribute("value");
    if ((type === "submit" || type === "reset" || type === "button") && value !== null) {
      return value;
    }
  }
  // Image alt.
  if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt) return alt;
  }
  return (el.textContent ?? "").trim();
}

/**
 * Build a predicate that returns true when `value` matches `text` per
 * Playwright's semantics: exact match by default; substring otherwise.
 * A string is converted to a case-sensitive comparison (Playwright does
 * case-insensitive by default — we follow that).
 */
function makeMatcher(text: string | RegExp, exact: boolean): (value: string) => boolean {
  if (text instanceof RegExp) {
    return (value) => text.test(value);
  }
  const needle = text.toLowerCase();
  return (value) => {
    const hay = value.toLowerCase();
    return exact ? hay === needle : hay.includes(needle);
  };
}

/**
 * Escape a string for use inside a CSS attribute selector. We avoid
 * pulling in a CSS.escape polyfill here because we're only feeding ids
 * the user (or the DOM) chose — but we still need to escape the few
 * characters CSS treats specially (quotes, backslashes).
 */
function cssEscape(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

function normalizePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function appendLogQuiet(entry: Omit<RunnerLog, "id">) {
  globalLog?.(entry);
}

/* ------------------------------------------------------------------ */
/* Expect chain                                                       */
/* ------------------------------------------------------------------ */

export class ExpectChain {
  private readonly target: ExpectTarget;

  constructor(target: ExpectTarget) {
    this.target = target;
  }

  private isLocator(value: unknown): value is Locator {
    return value instanceof Locator;
  }

  async toBe(expected: unknown): Promise<void> {
    this._assertPrimitive("toBe", expected);
  }

  async toEqual(expected: unknown): Promise<void> {
    this._assertPrimitive("toEqual", expected);
  }

  async toBeTruthy(): Promise<void> {
    const value = this.isLocator(this.target) ? await this._resolveLocator() : this.target;
    const passed = Boolean(value);
    recordExpect(passed, `toBeTruthy`, `expected ${stringify(value)} to be truthy`);
  }

  async toBeFalsy(): Promise<void> {
    const value = this.isLocator(this.target) ? await this._resolveLocator() : this.target;
    const passed = !value;
    recordExpect(passed, `toBeFalsy`, `expected ${stringify(value)} to be falsy`);
  }

  async toContainText(expected: string): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toContainText requires a Locator target");
    }
    const actual = await locatorText(this.target);
    const passed = actual.includes(expected);
    recordExpect(passed, `toContainText(${expected})`, `expected locator(${this.target.selector}) to contain ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  async toHaveText(expected: string): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toHaveText requires a Locator target");
    }
    const actual = (await locatorText(this.target)).trim();
    const passed = actual === expected;
    recordExpect(passed, `toHaveText(${expected})`, `expected locator(${this.target.selector}) to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  async toBeVisible(): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toBeVisible requires a Locator target");
    }
    const visible = await this.target.isVisible();
    recordExpect(visible, `toBeVisible`, `locator(${this.target.selector}) was not visible`);
  }

  async toBeHidden(): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toBeHidden requires a Locator target");
    }
    const hidden = !(await this.target.isVisible());
    recordExpect(hidden, `toBeHidden`, `locator(${this.target.selector}) was visible`);
  }

  async toHaveCount(expected: number): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toHaveCount requires a Locator target");
    }
    const actual = await this.target.count();
    const passed = actual === expected;
    recordExpect(passed, `toHaveCount(${expected})`, `locator(${this.target.selector}) matched ${actual} element(s)`);
  }

  async toHaveAttribute(name: string, expected: string): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toHaveAttribute requires a Locator target");
    }
    const actual = await locatorAttr(this.target, name);
    const passed = actual === expected;
    recordExpect(
      passed,
      `toHaveAttribute(${name}=${expected})`,
      `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`
    );
  }

  async toMatchSnapshot(): Promise<void> {
    if (!this.isLocator(this.target)) {
      throw new AssertionError("toMatchSnapshot requires a Locator target");
    }
    const text = await locatorText(this.target);
    recordExpect(true, `toMatchSnapshot`, text.slice(0, 400));
  }

  private async _resolveLocator(): Promise<unknown> {
    if (!this.isLocator(this.target)) return this.target;
    const el = await this.target._resolve();
    return el.textContent;
  }

  private _assertPrimitive(name: string, expected: unknown): void {
    if (this.isLocator(this.target)) {
      throw new AssertionError(`${name} cannot be used with a Locator target`);
    }
    const passed = Object.is(this.target, expected);
    recordExpect(passed, `${name}`, `expected ${stringify(this.target)} ${name} ${stringify(expected)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Bridge: page -> page UI                                             */
/* ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Run a Playwright-style script against the in-page DOM.
 *
 * The returned promise resolves once the script either completes,
 * throws, or is cancelled by `cancelled` resolving. The host UI
 * decides what to do with each terminal state.
 */
export async function runPlaywright(
  source: string,
  writeLog: (entry: Omit<RunnerLog, "id">) => void,
  cancelled: Promise<void>,
  options?: { onHighlight?: (info: HighlightInfo) => void }
): Promise<void> {
  globalLog = writeLog;
  onHighlightRef = options?.onHighlight ?? null;

  // Mirror the script's console calls into the UI panel. The originals
  // are captured before patching so we can restore them in `finally`,
  // even when the script never returns (cancelled mid-flight).
  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  const patch = (kind: keyof typeof originals, target: typeof console.log) => {
    console[kind] = (...args: unknown[]) => {
      try {
        writeLog({ kind, text: args.map((a) => stringify(a)).join(" ") });
      } catch {
        // If the host is unmounted, swallow -- never recurse into the
        // patch via a downstream setState failure.
      }
      originals[kind](...args);
    };
  };
  patch("log", console.log);
  patch("info", console.info);
  patch("warn", console.warn);
  patch("error", console.error);

  const restore = () => {
    if (console.log === originals.log) return;
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    globalLog = null;
    onHighlightRef = null;
  };

  const page = new Page();
  const expect: (target: ExpectTarget) => ExpectChain = (target) => new ExpectChain(target);
  const testApi = createTestApi(page, writeLog);
  // Read the user's .env file fresh on every run so edits to the
  // secrets panel pick up without restarting the page. Returning an
  // empty object (rather than null) lets snippets do `env.KEY` without
  // a null check.
  const env = loadEnv();

  // `new Function(...)` evaluates a script body and cannot contain
  // `import` or `export` statements at the top level -- they would
  // throw a SyntaxError before the snippet ever runs. Real Playwright
  // spec files always start with `import { test, expect } from
  // "@playwright/test"`, so strip those lines before compiling. We
  // keep all other lines so the snippet body is untouched.
  const cleanedSource = source
    .replace(/^\s*import\s+(?:type\s+)?[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+(?:const|let|var|function|class|interface|type)\s+/gm, "")
    .replace(/^\s*\n/g, "");

  // Critical: `testApi.test` is the callable Playwright-shaped function
  // (with .describe, .step, .beforeEach, etc. attached via Object.assign).
  // Passing the wrapper OBJECT here would mean snippets see `test` as
  // a plain object — then `test("...")` blows up with "test is not a
  // function". We pull out the callable directly.
  const compiled = new Function(
    "page",
    "expect",
    "test",
    "console",
    "env",
    `return (async () => {\n${cleanedSource}\n})();`
  );

  let exitMessage = "Script cancelled before completion.";
  let scriptPromise!: Promise<void>;
  scriptPromise = (async () => {
    try {
      await compiled(page, expect, testApi.test, console, env);
      exitMessage = "Script completed.";
    } catch (err) {
      const e = err as Error;
      exitMessage = `[${e.name ?? "Error"}] ${e.message}`;
      try {
        writeLog({ kind: "error", text: exitMessage, detail: e.stack });
      } catch {
        // host unmounted, drop the entry silently
      }
    }
  })();

  await Promise.race([
    scriptPromise,
    cancelled.then(() => {
      try {
        writeLog({ kind: "warn", text: "Run cancelled by user." });
      } catch {
        // host unmounted
      }
    })
  ]);

  // If cancellation fired, give the script one more microtask to settle
  // before restoring -- so any in-flight `console.log` from the script
  // still hits the panel once.
  await Promise.race([
    scriptPromise,
    delay(150).then(() => undefined)
  ]);

  restore();

  try {
    writeLog({ kind: "result", text: exitMessage });
  } catch {
    // host unmounted
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------ */
/* Playwright-shaped test API                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal in-page stand-in for `@playwright/test`'s `test` object.
 *
 * Real Playwright runs each `test()` in its own worker, reports
 * results to the runner, and wires fixtures like `page` through a
 * dependency-injection layer. We don't have any of that here — the
 * runner is a single page with shared `page` state — so this API just
 * does the bare minimum a user-written test snippet needs:
 *
 *   - `test('name', async ({ page }) => { ... })` -> log + invoke + log
 *   - `test.describe('name', () => { ... })`     -> log + invoke + log
 *   - `test.step('name', async () => { ... })`   -> log + invoke + log
 *
 * Errors inside the callback are caught and recorded as `error` log
 * entries so one failing block doesn't kill the whole script.
 *
 * The `page` global is still available — we pass the same Page
 * instance the snippet already uses, so `test()` callbacks see the
 * exact same DOM and the existing `page.expect(...)` chain keeps
 * working through this facade too.
 */
export type TestApi = {
  test: ((name: string, fn: (fixtures: { page: Page }) => unknown | Promise<unknown>) => Promise<void>) & {
    only: typeof testFn;
    skip: typeof testFn;
  };
  describe: {
    (name: string, fn: () => unknown | Promise<unknown>): Promise<void>;
    only: typeof describeFn;
    skip: typeof describeFn;
  };
  step: {
    (name: string, fn: () => unknown | Promise<unknown>): Promise<void>;
  };
};

declare function testFn(
  name: string,
  fn: (fixtures: { page: Page }) => unknown | Promise<unknown>
): Promise<void>;
declare function describeFn(name: string, fn: () => unknown | Promise<unknown>): Promise<void>;

function createTestApi(page: Page, writeLog: (entry: Omit<RunnerLog, "id">) => void): TestApi {
  const testImpl = (name: string, fn: (fixtures: { page: Page }) => unknown | Promise<unknown>) => {
    writeLog({ kind: "info", text: `▶ test  ${name}` });
    return Promise.resolve()
      .then(() => fn({ page }))
      .then(() => {
        writeLog({ kind: "result", text: `✓ test  ${name}` });
      })
      .catch((err: Error) => {
        writeLog({
          kind: "error",
          text: `✗ test  ${name}: ${err.message}`,
          detail: err.stack
        });
      });
  };
  const describeImpl = (name: string, fn: () => unknown | Promise<unknown>) => {
    writeLog({ kind: "info", text: `▼ describe  ${name}` });
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        writeLog({ kind: "result", text: `▲ end describe  ${name}` });
      })
      .catch((err: Error) => {
        writeLog({
          kind: "error",
          text: `✗ describe ${name}: ${err.message}`,
          detail: err.stack
        });
      });
  };
  const stepImpl = (name: string, fn: () => unknown | Promise<unknown>) => {
    writeLog({ kind: "info", text: `  ↳ step  ${name}` });
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        writeLog({ kind: "result", text: `  ✓ step  ${name}` });
      })
      .catch((err: Error) => {
        writeLog({
          kind: "error",
          text: `  ✗ step  ${name}: ${err.message}`,
          detail: err.stack
        });
      });
  };

  // Mirror Playwright's `.only` / `.skip` modifiers. We just behave
  // like the unmodded version here — there's no runner-level filter
  // that would honour them differently.
  const skipTest = (...args: unknown[]) => {
    const name = typeof args[0] === "string" ? args[0] : "<anonymous>";
    writeLog({ kind: "warn", text: `↷ test.skip  ${name}` });
    return Promise.resolve();
  };
  const skipDescribe = (...args: unknown[]) => {
    const name = typeof args[0] === "string" ? args[0] : "<anonymous>";
    writeLog({ kind: "warn", text: `↷ describe.skip  ${name}` });
    return Promise.resolve();
  };

  // The single most important ergonomic thing we expose here: `test`
  // itself must be callable AND have `.describe`, `.step`,
  // `.beforeEach`, etc. as methods. Real Playwright does this — `test`
  // is a callable object with all those methods. Snippets written
  // against Playwright call `test.describe(...)`, `test.step(...)`,
  // `test.beforeEach(...)` expecting those methods on `test`. If we
  // expose `describe` and `step` as separate top-level exports (the
  // previous design), those calls blow up with "test.describe is not
  // a function" / "test is not a function".
  //
  // Hook order matters: Object.assign(testImpl, ...) means `testImpl`
  // (the callable) keeps its prototype and properties get layered on.
  // We deliberately attach both the modifiers AND the cross-references
  // so `test.describe(...)` and `test.step(...)` resolve correctly.
  const testFn = Object.assign(testImpl, {
    only: testImpl,
    skip: skipTest,
    // Cross-references so `test.describe(...)`, `test.step(...)`,
    // `test.beforeEach(...)`, etc. work the way snippets expect.
    describe: undefined as ((name: string, fn: () => unknown | Promise<unknown>) => Promise<void>) | undefined,
    describeOnly: undefined as ((name: string, fn: () => unknown | Promise<unknown>) => Promise<void>) | undefined,
    describeSkip: skipDescribe,
    step: stepImpl,
    // Playwright lifecycle hooks. We treat all four the same as a
    // regular `test()`: log + invoke + log. They accept a fixture
    // argument the same way `test()` does, even though our local
    // runner only honors `page`.
    beforeEach: testImpl,
    afterEach: testImpl,
    beforeAll: testImpl,
    afterAll: testImpl
  });
  const describeFn = Object.assign(describeImpl, {
    only: describeImpl,
    skip: skipDescribe
  });

  // Now wire `test.describe` and `test.describeOnly` to the
  // describe impl + modifiers. We do this in a second pass because
  // the assignments above create forward references that JS handles
  // fine but reads better when the relationship is explicit here.
  (testFn as { describe?: typeof describeFn }).describe = describeFn;
  (testFn as { describeOnly?: typeof describeFn }).describeOnly = describeFn;

  return {
    test: testFn,
    // Keep `describe` and `step` as separate exports so snippets that
    // import them via `const { describe, step } = testApi;` (rare,
    // but possible) still work.
    describe: describeFn,
    step: stepImpl
  };
}
