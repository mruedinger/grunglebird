# Styling guardrail

The styling rule lives in [`AGENTS.md`](../AGENTS.md) ("## Styling"): one stylesheet,
one set of design tokens — [`src/styles/global.css`](../src/styles/global.css) — as the
single source of truth. Pages consume the tokens and shared primitives; they never
hardcode token-able values or re-declare a shared primitive locally. This doc is the
**automatic safety net** around that rule (issue #13): what's enforced, how to satisfy
it, and how to deliberately override it.

It is a safety net, **not** a redefinition of the system: it enforces the tokens and
primitives `global.css` already defines — it never creates new ones. The color and
primitive-redeclaration locks landed with #13; the dimensional lock (off-scale
font-size / spacing / radius) with #38.

## The model: pages own layout, the system owns appearance

The line the whole guardrail draws: **a page owns *where things go* — grids, widths,
arrangement, its own layout classes. The system (`global.css`) owns *what shared things
look like* — the type/spacing/radius scale and every shared primitive (headings, copy,
buttons, inputs, card, badge, table, modal, …).** Per-page layout built from the shared
tokens is encouraged; per-page *restyling of a shared element*, or a raw off-scale
dimension, is what the net stops.

### Need a new shared element?

When a page genuinely needs an element the system doesn't have yet, **grow the system —
don't hack a local one:**

1. Define it in [`src/styles/global.css`](../src/styles/global.css), built from the
   existing tokens (no new hardcoded values).
2. Render it on [`/styleguide`](../src/pages/styleguide.astro) — the living registry is
   where every primitive lives and is reviewed.
3. Surface it in the PR for approval (the styleguide diff makes it reviewable).

A one-off that's truly page-specific and not worth systematizing uses the reasoned escape
hatch below instead — which puts the same decision in the diff for review.

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
   - **No hardcoded token-able dimensions** — a raw `px`/`rem` (or `em` on `font-size`) on
     **`font-size`, `margin`, `padding`, or `border-radius`** (shorthand or any longhand,
     e.g. `margin-top`, `border-top-left-radius`). Use a scale token: `var(--text-md)`,
     `var(--space-sm)`, `var(--radius-md)`. Unitless `0`, `100%`, and `calc(… var(--…) …)`
     stay legal. **Only these appearance scale-steps are enforced** — `gap`, widths,
     heights and other true *layout* values are left to the review checklist below, where
     mechanical detection would just be noise.
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

When a rule is genuinely wrong for a specific line, disable it **with a reason**:

```css
/* stylelint-disable-next-line color-no-hex -- one-off brand asset, not token-able */
/* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px optical nudge, not a scale step */
```

The reason is **required** — a bare `stylelint-disable` with no `-- …` is itself an error
(`reportDescriptionlessDisables`). That's deliberate: every exception then explains itself
inline and shows up in the diff, so it gets surfaced for review by construction.

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
