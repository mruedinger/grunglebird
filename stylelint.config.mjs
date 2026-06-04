/*
 * grunglebird — styling guardrail (issue #13).
 *
 * A deterministic safety net around the AGENTS.md styling rule. It catches, before
 * merge, the two drift modes seen during the #9 redesign:
 *   1. hardcoded color literals outside the token stylesheet, and
 *   2. local re-declaration of a shared visual-component / shell primitive.
 * It does NOT change the styling rule or expand the token system (both #13 non-goals).
 * See docs/styling.md for what's enforced, how to satisfy it, and how to override.
 *
 * Scope: Astro <style> blocks (parsed via postcss-html). global.css is the source of
 * truth and is never linted. Per-event POSTER pages are exempt (the sanctioned
 * event-body exception); the events listing (/events) is a normal page and stays
 * enforced. Inline / SVG-attribute colors — which Stylelint can't see — are covered by
 * the companion scan in scripts/lint-inline-colors.mjs.
 */

// Exact-token regexes: match the primitive's class, but NOT a longer name that merely
// contains it (the trailing `(?![\w-])` lets `.recipe-card` / `.card-head` through).
const tokenClass = (name) => new RegExp(`\\.${name}(?![\\w-])`);

// Family regexes: match a primitive's root AND every `-`-suffixed member — `.modal`,
// `.modal-head`, `.modal-scrim` are all the one primitive, so re-declaring any part is
// re-declaring it. The boundary `(?![A-Za-z0-9_])` lets the hyphen through but keeps an
// accidental longer word out (`.modalish`, `.modal_body`) and only fires on a literal
// `.<name>` start (so `.sg-modal-scrim` is fine). Used where global.css defines a whole
// class family rather than a single class.
const familyClass = (name) => new RegExp(`\\.${name}(?![A-Za-z0-9_])`);

// Shared VISUAL-COMPONENT + SHELL class primitives whose look must be identical on every
// page. Pages compose these from markup and add their own page-specific layout classes;
// they never re-declare them locally. Deliberately NOT listed: single-purpose layout/
// utility helpers (.container .center .page-title .muted .field) and bare element
// selectors (button, input, h2, code) — pages legitimately scope/extend those for layout.
const SHARED_PRIMITIVES = [
  // exact single-class components (a longer name that merely contains one stays legal)
  ...["card", "button", "ghost", "sm", "danger", "badge", "promo", "pdot", "arr",
    "select-wrap", "eyebrow"].map(tokenClass),
  // multi-class component families (root + every `-`-suffixed member)
  ...["table", "modal", "alert"].map(familyClass),
  // search: only `.search-*` members exist (no bare `.search` root), so match the prefix
  /\.search-/,
  // shell (header / nav / footer)
  ...["site-header", "shell-bar", "brand", "nav", "admin-dot", "site-footer", "footer-note"]
    .map(tokenClass),
];

const rules = {
  // 1 — no hardcoded colors; tokens (var(--…)) and color-mix(…var…) stay legal.
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla"],
  // 2 — no local re-declaration of a shared primitive.
  "selector-disallowed-list": [
    SHARED_PRIMITIVES,
    {
      message:
        "Don't re-declare a shared primitive locally — compose it from markup and add " +
        "a page-specific layout class instead (see docs/styling.md).",
    },
  ],
};

// The same rule set, switched off — for the exempt event poster pages.
const rulesOff = Object.fromEntries(Object.keys(rules).map((name) => [name, null]));

export default {
  // The token stylesheet defines the literals and primitives; never lint it. (Narrow on
  // purpose: a future second stylesheet under src/styles/ stays guarded.)
  ignoreFiles: ["src/styles/global.css"],
  rules,
  overrides: [
    // Parse Astro <style> blocks.
    { files: ["**/*.astro"], customSyntax: "postcss-html" },
    // Event POSTER pages are the sanctioned bespoke-styling exception → rules off.
    { files: ["src/pages/events/**/*.astro"], rules: rulesOff },
    // …but the events LISTING is a normal page — re-enable. (Later override wins, so any
    // future per-event poster stays exempt while only this listing is enforced.)
    { files: ["src/pages/events/index.astro"], rules },
  ],
};
