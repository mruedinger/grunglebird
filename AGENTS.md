# Agent instructions
Use these guidelines to inform decisionmaking and workflow.

## Project context
PROJECT_SUMMARY.md contains crucial high-level project context - read it.

## Vibes
This is a passion/hobby project, the stakes are low.
Build smart, but don't overcomplicate.
It's ok to make disruptive changes for long term gains.
Minimize friction and keep things simple.
Design for usability and responsiveness.

## Architecture
Hosted on Cloudflare Workers; prefer solutions that fit that runtime.

## Styling
One stylesheet, one set of design tokens — the single source of truth for color, type, spacing, sizing, headings, buttons, inputs, and every shared primitive. Pages MUST consume these; never redefine shared primitives locally or hardcode their values — a button or heading looks identical on every page. Page-specific layout is fine if built from the shared tokens/scale.
The shell (nav + footer + layout chrome) is constant everywhere — same structure and typography on every page; only its color retints per event via token overrides.
Event pages (`/events/<event>`) are the one exception: within the page body they may use bespoke fonts and non-standard elements — a poster for the event. Every other page sticks strictly to the shared system.
Enforced automatically by `npm run lint:styles` (a CI required check): no hardcoded colors, no re-declaring shared primitives; posters are exempt. See [`docs/styling.md`](docs/styling.md) for what's checked and how to override.

## Voice
grunglebird's personality lives in **microcopy**, not chrome. Actively look for spots — footers, empty states, errors, confirmations, stubs; admin-only corners count too.
- Register: absurd, a little mysterious, unpretentious dive-bar. Deadpan and understated; the craft is real but never bragged about.
- Terse wins. Cut any line that over-explains its own joke.
- The joke is often in what's left unsaid — faint or misdirected praise, not a stated punchline.
- Don't force it, and don't prescribe tone in issues/specs — frame the function and let the voice set the register at drafting time; float options rather than committing early.
- Some things stay unexplained — the name's meaning, who "Mike" is. Mysteries, not origin stories.
- Nothing's canon yet — keep the strongest lines and swap them when something better lands; don't lock in specific phrases.

## Git hygiene
When opening a PR, by default:
- If the change meets the CHANGELOG.md criteria (see its header), add a changelog entry in the same PR.
- If the PR resolves an issue, put `Closes #N` in the PR body so it auto-closes on merge.

## Documentation and continuous improvement
Keep md files up to date as the project evolves.
Keep this file sparse - too many instructions overcomplicate things and muddy the waters.
