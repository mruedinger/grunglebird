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

## Git hygiene
When opening a PR, by default:
- If the change meets the CHANGELOG.md criteria (see its header), add a changelog entry in the same PR.
- If the PR resolves an issue, put `Closes #N` in the PR body so it auto-closes on merge.

## Documentation and continuous improvement
Keep md files up to date as the project evolves.
Keep this file sparse - too many instructions overcomplicate things and muddy the waters.
