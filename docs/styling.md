# Styling guardrail

The styling rule lives in [`AGENTS.md`](../AGENTS.md) ("## Styling"): one stylesheet,
one set of design tokens — [`src/styles/global.css`](../src/styles/global.css) — as the
single source of truth. Pages consume the tokens and shared primitives; they never
hardcode token-able values or re-declare a shared primitive locally. This doc is the
**automatic safety net** around that rule (issue #13): what's enforced, how to satisfy
it, and how to deliberately override it.

It is a safety net, **not** a stricter rule. It does not change the styling rule or
expand the token system — that fuller "tokenize every dimension" effort is tracked
separately.

## What's enforced

`npm run lint:styles` runs on every PR (a step in the CI `Required checks` gate) and is
available locally any time. It runs two complementary checks:

1. **Stylelint** ([`stylelint.config.mjs`](../stylelint.config.mjs)) on `.astro`
   `<style>` blocks (and `style=` attributes):
   - **No hardcoded colors** — hex (`#fff`), named (`red`), or `rgb()/rgba()/hsl()/hsla()`
     literals. Use a token: `var(--accent)`, or `color-mix(in srgb, var(--accent) …)`.
   - **No re-declaring a shared primitive** — the visual-component / shell classes
     (`.card`, `.button` + `.ghost`/`.sm`/`.danger`, `.badge`, `.promo`/`.pdot`/`.arr`,
     `.select-wrap`, `.eyebrow`, the `.table`/`.modal`/`.alert` families — root and any
     `-`-suffixed member, e.g. `.modal-head` — and `.search-*`; plus the shell:
     `.site-header`, `.shell-bar`, `.brand`, `.nav`, `.admin-dot`, `.site-footer`,
     `.footer-note`) must not be targeted in a page `<style>` block. Bare element
     selectors (`button`, `input`, `code`, …) are *not* on this list — pages may scope or
     extend those for layout.
2. **Inline/SVG color scan** ([`scripts/lint-inline-colors.mjs`](../scripts/lint-inline-colors.mjs)) —
   catches color literals in `style=` / `fill=` / `stroke=` / `stop-color=` attributes,
   which Stylelint can't see for the SVG cases.

### The good pattern

Don't restyle `.card`; **compose it from markup and add a page-specific layout class.**
[`src/pages/cocktails.astro`](../src/pages/cocktails.astro) is the model:

```astro
<article class="card recipe-card"> … </article>
<style>
  /* layout only — surface/border/radius/padding come from the shared .card */
  .recipe-card { max-width: 340px; margin: 0 auto; text-align: left; }
</style>
```

Page-specific *layout* (your own classes, scoped element selectors like
`.recipe-card h3`, spacing, grids) is fine — it just has to be built from the shared
tokens/scale, and may not hardcode colors or re-declare a primitive.

## Authoring-time feedback

Install the recommended **Stylelint** VS Code extension (prompted via
[`.vscode/extensions.json`](../.vscode/extensions.json)); `.vscode/settings.json` already
enables it for `.astro`, so violations surface as you type — no need to wait for CI.

## Exemptions

- **`src/styles/global.css`** — the source of truth; it *defines* the literals and
  primitives, so it's never linted.
- **Event poster pages** (`src/pages/events/<event>.astro`) — the sanctioned event-body
  exception (bespoke fonts/elements). They're exempt. The events **listing**
  (`src/pages/events/index.astro`) is a normal page and stays enforced.

## Deliberately overriding (the escape hatch)

When a rule is genuinely wrong for a specific line, disable it with a reason:

```css
/* stylelint-disable-next-line color-no-hex -- one-off brand asset, not token-able */
```

For the inline/SVG scan, prefer moving the value into a `<style>` block with a token; if
you truly must keep an inline literal, that's a signal to reconsider (or, if it belongs
on a poster, it's already exempt).

## What the net can't catch — review checklist

Some drift is impractical to detect mechanically. When reviewing a PR that touches
styles, eyeball these:

- [ ] **A primitive rebuilt under a new name** — e.g. a `.recipe-panel` that re-creates
      the `.card` look (background + border + radius + padding) instead of using `.card`.
      The linter can't know the new class was "supposed to be" the primitive.
- [ ] **A primitive's properties overridden via a scoped element selector** — e.g.
      `.signin button { padding: … }` making a button look different here than elsewhere.
      Prefer a shared variant (`.button.sm`) over a local override.
- [ ] **JS-constructed color strings** — a color built in a `<script>` (e.g. `#${hex}`)
      bypasses both checks. Keep colors in CSS, referencing tokens.
