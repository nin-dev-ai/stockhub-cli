CLAUDE.md

Project Overview

This repository contains a financial terminal application.

This file provides instructions for Claude Code and other AI coding agents working on the project.

Core principle: Treat the codebase as the source of truth. Read existing implementations before making changes, preserve established patterns, and keep documentation synchronized with the code.

1. Getting Started

Before implementing changes:

1. Read the root README.md to understand the project’s purpose, architecture, and setup.
2. Read docs/README.md to locate relevant technical documentation.
3. Identify the components, functions, and dependencies involved in the requested task.
4. Inspect existing implementations before introducing new patterns.
5. Understand how the proposed changes affect existing functionality.

Do not assume documentation is accurate when it conflicts with the implementation.

2. Codebase Navigation

The following files are important entry points:

File	Responsibility
app/src/lib/functions.ts	Supported commands and command parser
app/src/App.tsx	Screen registration and application layout
app/src/lib/api.ts	Data endpoints and API providers
app/src/lib/signals.ts	Signal thresholds and verdict logic
app/src/store/workspaceStore.ts	Workspace tabs, state, and persistence
app/package.json	Dependencies, scripts, and build commands

Consult these files when making changes to their respective areas.

3. Development Principles

Understand Before Modifying

* Read relevant source files before editing.
* Reuse existing utilities, components, and abstractions.
* Follow the established project structure and naming conventions.
* Avoid introducing unnecessary dependencies.
* Prefer simple, maintainable implementations over excessive abstraction.
* Preserve existing functionality unless explicitly instructed otherwise.

Keep Changes Focused

* Make the smallest coherent change that fully solves the task.
* Avoid unrelated refactoring.
* Do not rewrite working components unnecessarily.
* Keep functions modular and responsibilities clearly separated.
* Remove dead code introduced or made obsolete by your changes.

Maintain UI Consistency

* Follow the application’s existing design language.
* Reuse established components and styling conventions.
* Preserve terminal interactions, keyboard navigation, and workspace behavior.
* Ensure new screens integrate with the existing layout and navigation.
* Maintain consistent spacing, typography, and visual hierarchy.

4. Documentation Routine

Whenever implementation changes affect documentation:

1. Identify which user flow, screen, API call, command, or setup step changed.
2. Locate the corresponding document using docs/README.md.
3. Update the relevant documentation and affected README sections in the same change.
4. Verify documented paths, commands, links, and behavior against the current codebase.
5. Remove outdated or superseded instructions.
6. Keep documentation concise, accurate, and useful.

Do not create unnecessary documentation files when existing documents can be updated.

5. Key Implementation Areas

Commands and Parsing

Source: app/src/lib/functions.ts

When adding or modifying commands:

* Inspect existing command definitions.
* Follow established parsing conventions.
* Preserve compatibility with existing commands.
* Handle invalid arguments and unexpected input.
* Update command documentation where appropriate.

Application Layout and Screens

Source: app/src/App.tsx

When modifying screens:

* Follow existing screen registration patterns.
* Preserve navigation and layout behavior.
* Reuse existing UI components.
* Avoid unnecessary changes to the application shell.

API and Data Providers

Source: app/src/lib/api.ts

When working with external data:

* Reuse existing API abstractions.
* Handle loading, errors, and unavailable data.
* Avoid unnecessary API requests.
* Never hardcode credentials or API keys.
* Distinguish live data from cached, delayed, or simulated data.

Signals and Financial Logic

Source: app/src/lib/signals.ts

When modifying signal calculations:

* Preserve existing threshold and verdict behavior unless changes are required.
* Keep calculations deterministic where possible.
* Validate boundary conditions.
* Avoid presenting calculated signals as guaranteed predictions.
* Add or update tests for material changes to financial logic.

Workspace State

Source: app/src/store/workspaceStore.ts

When modifying workspace behavior:

* Preserve existing tab management.
* Maintain compatibility with persisted state where possible.
* Avoid unnecessary global state.
* Consider the impact on existing user workspaces.

6. Validation and Testing

After implementing a change:

1. Review the diff for unintended modifications.
2. Inspect app/package.json for available validation scripts.
3. Run relevant tests, linting, type checks, and builds where available.
4. Verify the affected functionality.
5. Confirm existing functionality remains intact.
6. Fix issues introduced by the change.

Never claim tests passed unless they were actually executed successfully.

If validation cannot be completed, clearly explain what remains unverified.

7. Git and Version Control

* Use descriptive commit messages.
* Prefer focused commits representing coherent changes.
* Do not overwrite unrelated user changes.
* Do not force-push without explicit authorization.
* Avoid destructive Git operations unless explicitly requested.
* Do not commit generated build artifacts unless required by the repository.

Use the Git identity configured for the repository.

Do not add automatic AI co-author attribution or Co-authored-by trailers to commits unless explicitly requested.

8. Security and Privacy

Never store the following in source code or documentation:

* API keys
* Authentication tokens
* Passwords
* Private credentials
* Personal or sensitive user information

Use environment variables and existing configuration mechanisms for secrets.

Do not expose sensitive values in logs, error messages, screenshots, or generated documentation.

9. Agent Execution Workflow

For each development task, follow this process:

Understand → Inspect → Plan → Implement → Validate → Document → Summarize

Before Implementation

* Understand the requested outcome.
* Identify affected files and dependencies.
* Inspect the relevant code.
* Determine whether documentation or tests require updates.

During Implementation

* Follow existing architecture.
* Keep changes focused.
* Avoid unnecessary complexity.
* Validate incrementally where practical.

After Implementation

* Run relevant checks.
* Review the final diff.
* Update affected documentation.
* Summarize the changes and validation results.

For the final response, briefly communicate:

1. What changed.
2. Which files were modified.
3. What validation was performed.
4. Any remaining limitations or follow-up work.

10. Maintaining This File

Keep CLAUDE.md aligned with the current repository.

Update it when major architectural changes affect how coding agents should navigate, implement, or validate changes.

Avoid duplicating detailed documentation already maintained elsewhere.

Remember: The repository’s code is the implementation authority. Documentation provides context and must remain consistent with it.