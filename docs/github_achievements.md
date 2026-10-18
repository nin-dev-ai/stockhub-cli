# GitHub Achievements Playbook

**Audience:** Claude Code and other coding agents working in this repository, and the repository owner.
**Target profile:** <https://github.com/KaremSD?tab=achievements>
**Status:** Active from Phase 6 ([PRD_phase6.md](PRD_phase6.md)). Last baseline check: 18 October 2026 (see [Baseline audit](#baseline-audit)).

This playbook says how GitHub activity from this project may count toward the target profile's achievements. It permits only legitimate, useful activity. It is not a plan to farm badges.

## Ground rules

- **Check the account first, every session.** Run `gh auth status` and `gh api user --jq .login`. If the login is not `KaremSD`, stop achievement work for the target profile and report the mismatch. Activity by another account counts toward that account, not the target profile.
- **This repository pushes only as `nin-dev-ai`.** That rule overrides this playbook: never switch accounts in this repository to earn a badge for another profile.
- **Never claim a badge without seeing it.** A badge counts as earned only when it is visible on the profile's Achievements tab. GitHub can take days to show one.
- **Never manufacture activity.** No fake stars, discussions, co-authors, reviews, collaborations, second accounts or throwaway changes made only to raise a count. Do not spam other repositories.
- **No AI co-author trailers.** Commits in this repository carry no `Co-authored-by` lines for Claude, Codex or any other tool (see [Claude.md](Claude.md), section 7). Pair Extraordinaire needs a real human collaborator.
- **Ask before outward-facing steps.** Get the owner's approval before creating public content outside this repository, merging changes, spending money or contacting people.
- **Respect the repository.** Follow branch protection and CI. Do not change the owner's profile README without permission.
- **Phase 6 work comes first.** Achievements are a by-product of the Phase 6 issues and pull requests, never a reason to add work that isn't in the plan.

## Baseline audit

Run at the start of any session that touches achievements, and record the result here.

1. `gh auth status`, `gh api user --jq .login`, `gh repo list KaremSD --limit 100`.
2. Open the target Achievements tab in a browser and record the badges and tiers shown. If no browser is available, ask the owner for a screenshot; the GitHub API does not reliably expose badges.
3. Look at the merged pull requests and repository settings (branch protection, required reviews) before choosing where to act.
4. Change a status from UNKNOWN only on evidence: EARNED, NOT EARNED or PENDING VERIFICATION.

**18 October 2026:** `gh` is logged in as `nin-dev-ai` (active) and `nnoronha12`, not `KaremSD`. Under the stopping rules, no achievement work was done for the target profile. The owner has also ruled that this repository pushes **only as `nin-dev-ai`** ([Claude.md](Claude.md), section 7), so Phase 6 issues, pull requests and merges count toward `nin-dev-ai`. Activity counts toward the account that performs it. For KaremSD's profile to benefit, KaremSD itself must do the work, in a repository and session outside this rule. Agents here must not switch accounts.

## Achievement checklist

| Done | Achievement | Requirement | Priority | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| [ ] | Quickdraw | Close a real issue or pull request within five minutes of opening it | P1 | UNKNOWN | — |
| [ ] | YOLO | Merge an eligible own pull request without a formal review | P1 | UNKNOWN | — |
| [ ] | Pull Shark | 2 merged pull requests; higher tiers at 16 / 128 / 1024 | P1 | UNKNOWN | — |
| [ ] | Pair Extraordinaire | Co-author a commit in a merged pull request with a real collaborator; tiers at 10 / 24 / 48 | P2 | UNKNOWN | — |
| [ ] | Public Sponsor | Publicly sponsor open-source work through GitHub Sponsors | Optional, paid | UNKNOWN | — |
| [ ] | Galaxy Brain | 2 accepted answers in public Q&A Discussions; tiers at 8 / 16 / 32 | P3 | UNKNOWN | — |
| [ ] | Starstruck | One owned repository receives 16 genuine stars; tiers at 128 / 512 / 4096 | P3 | UNKNOWN | — |

### What Phase 6 can and cannot deliver

| Achievement | Within Phase 6? | Why |
| --- | --- | --- |
| Pull Shark, YOLO | Yes, once the work is done as KaremSD | Phase 6 has about 12 real pull requests. They count only if KaremSD authors and merges them, in a repository that allows merging without a required review. |
| Quickdraw | Only if a genuine case arises | It needs a real issue or pull request that is resolved within five minutes, such as a duplicate of an item that's already fixed. Never open one just to close it. |
| Pair Extraordinaire | Only with a real teammate | A real person must contribute to a Phase 6 change and agree to a `Co-authored-by` trailer with an email linked to their GitHub account. |
| Public Sponsor | Only by the owner | It is a paid subscription. The owner chooses whom to sponsor and completes checkout personally. Agents never start a payment. |
| Galaxy Brain | Not guaranteed | Other people decide whether to accept an answer. Agents may draft answers to real unanswered questions for the owner to review and post. |
| Starstruck | Not guaranteed | Stars must come from real people. Phase 6 makes StockHub better to show (README, screenshots, demo script); promotion is the owner's choice. |

So Phase 6 can deliver three achievements reliably (Pull Shark, YOLO and, given a genuine case, Quickdraw). The other four depend on other people or on payment, and no agent can promise them.

## Phase 1 — achievements earned through ordinary work

**Pull Shark and YOLO.** Use the Phase 6 workflow: one issue per item, a focused branch, tests, a pull request that closes the issue, merged with a merge commit after CI passes. Self-merge without review only where the repository allows it; never bypass required reviews, CI or protection. Record each pull request's URL, author, merge time and merger in the evidence log.

**Quickdraw.** When a genuine issue turns out to be already fixed, a duplicate or invalid within minutes of being opened, close it with an explanation and record both timestamps. If no such case arises, skip it.

```bash
gh auth status
gh api user --jq .login   # must print KaremSD before any achievement work
gh repo list KaremSD --limit 100
```

## Phase 2 — collaboration

**Pair Extraordinaire.** Ask the owner to name a real teammate who contributed to a change. With their consent, add `Co-authored-by: Full Name <email linked to their GitHub account>` to that commit. Merge after checks, then verify the badge. Never invent an account or attribute work to a tool.

**Public Sponsor.** Present eligible maintainers (for example, projects StockHub depends on) with the monthly amount and billing details. The owner decides and pays. Check afterwards that the sponsorship is public.

## Phase 3 — community

**Galaxy Brain.** Find unanswered Q&A Discussions in projects the owner knows well (for example OpenBB, Vite, Playwright, Vitest). Draft accurate answers for the owner to review and post. Mark it earned only after two answers are accepted and the badge appears. Never self-ask or self-accept.

**Starstruck.** Keep one owned public repository genuinely useful: README, quickstart, screenshots, examples, license and release notes. Suggest honest places to share it. No bought stars, bots or star swaps.

## Not achievable now

Arctic Code Vault Contributor and Mars 2020 Contributor are historical. Heart On Your Sleeve and Open Sourcerer are experimental or disabled. Proxima variants are internal to GitHub. Higher tiers upgrade an existing badge; they are not new achievements.

## Evidence log

| Date | Achievement | Activity URL | What happened | Badge verified? | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-18 | — | — | Baseline: `gh` is logged in as `nin-dev-ai`, not `KaremSD`; achievement work stopped | No | Owner must log in as KaremSD |

## End-of-session report

At the end of any session that touches achievements, report:

1. The authenticated GitHub account.
2. Badges verified on the target profile.
3. Legitimate actions completed, with URLs.
4. Remaining actions, ordered by ease and dependency.
5. Pending approvals or external dependencies.

Stop on an account mismatch, missing repository permission, a branch protection conflict, missing collaborator consent or a paid step.

## References

- Target Achievements page: <https://github.com/KaremSD?tab=achievements>
- Community overview: <https://github.com/SharmARohitt/Github-Achievement>
- Community badge reference: <https://github.com/compusophy/profile-achievements>

Requirements reflect community documentation reviewed in October 2026; GitHub may change eligibility or thresholds.
