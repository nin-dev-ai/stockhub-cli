# Repository documentation

Keep the Markdown documentation accurate as part of each relevant change.

- `README.md` is the public entry point for installation, usage, and known limits.
- `docs/PRD.md` records the product purpose, current capabilities, and requirements.
- `docs/design.md` records the user experience and visual conventions.
- `docs/technical_design.md` records architecture, data flow, and implementation decisions.
- `docs/Codex.md` records working notes and the documentation update routine.

When changing a feature, setup step, dependency, data source, user flow, or known limitation, update the matching document in the same change. Check facts against the code before editing. Remove outdated statements instead of accumulating contradictory notes. Keep the README concise and link to detailed docs. Do not put secrets or local credentials in Markdown files.
