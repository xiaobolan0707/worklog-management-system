# Static Scan Report Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the 185 exported Sonar issues an evidence-based conclusion and fix every issue confirmed in the current release source.

**Architecture:** Work in `work/release-audit-fixes-20261019`, the latest production source copy. Retain existing module and UI boundaries, apply small local corrections, and keep the original issue IDs in a reviewable ledger. Do not edit Prisma generator output or weaken the production proxy and acceptance-test boundaries to silence a rule.

**Tech Stack:** TypeScript, React, Fastify, CSS, Vitest, Playwright, Prisma, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-21-sonar-report-remediation-design.md`

## Global Constraints

- Preserve log submission, approval permissions, plan due-date rules, audit persistence, and API shapes.
- Do not overwrite the root checkout's existing uncommitted changes.
- No new dependency for these repairs.
- Report source: `C:/Users/admin/Documents/xwechat_files/wxid_pao2pnm6c9kq22_143e/msg/file/2026-10/worklog_export.tar.gz`, entry `worklog_export/issues_dev.csv`.
- The Sonar server may be unavailable; separate source verification from a fresh Sonar result.
- `prisma validate` requires `DATABASE_URL`; use a non-secret local validation URL when running `pnpm verify`.

## Review Focus

- Missing `FormData` fields produce empty values or existing validation, never literal `"null"`; Task 2 test.
- `FileReader` returning `null` or non-string data shows the existing image error and sends no malformed image; Task 2 test.
- A non-submit button inside a form never submits it, while actual submit buttons still do; Task 3 test.
- The seven-day plan picker remains usable by keyboard after accessibility changes; Task 3 test.
- Primary button and table-header text meet 4.5:1 contrast after theme consolidation, including narrow-screen styles; Task 4 check.

---

### Task 1: Baseline and issue ledger

**Files:** Create `docs/quality/sonar-2026-10-21-issue-ledger.csv`; read `work/release-audit-fixes-20261019/{compose.yaml,infra/nginx/default.conf,src/app.ts,tests/e2e/*.spec.ts}`.

**Interfaces:** The ledger retains `编号,规则,文件,原行号,当前行号,处置,理由,验证`. Every one of 185 report IDs appears exactly once; later tasks update `处置` and `验证`.

- [ ] Extract `issues_dev.csv`; write all 185 IDs to the ledger with current file/line mapping and initial disposition, retaining evidence for generated Prisma files, intentional E2E skips, and trusted private proxy ranges.
- [ ] Verify unique IDs = 185, original rules/file distribution matches the export, and no source path is missing.
- [ ] Record baseline: 203 Vitest tests, typecheck and build pass; plain `pnpm verify` stops at `prisma validate` because `DATABASE_URL` is absent.

### Task 2: Real input and image failure handling

**Files:** Modify `src/web/{pages/LoginPage.tsx,pages/ChangeInitialPasswordPage.tsx,pages/admin/DepartmentsPage.tsx,components/logs/WorkItemEditor.tsx,components/logs/WorkPlanPanel.tsx}` in the release copy; test `tests/unit/web/{auth.test.tsx,employee-pages.test.tsx}`.

**Interfaces:** Keep existing component props and API payloads. `FileReader.result` must be a Data URL string before constructing `LetterImage`; reject with an `Error` otherwise.

- [ ] Add failing tests for missing form entries and for a failed/invalid image read; assert no `"null"`/`"[object Object]"` value and existing UI error text.
- [ ] Run targeted Vitest; confirm the new assertions fail for the current implementation.
- [ ] Replace unsafe string coercion with typed string extraction, reject image failures with `Error`, and preserve current user-visible messages.
- [ ] Run targeted Vitest and typecheck; update each affected ledger row.

### Task 3: Button semantics and keyboard accessibility

**Files:** Modify all report-listed `S9011`, `S6759`, `S6819`, `S6847`, `S6845`, `S6822` TSX paths under `src/web` in the release copy; test `tests/unit/web/{auth.test.tsx,employee-pages.test.tsx,leader-admin-pages.test.tsx}`.

**Interfaces:** Existing React props remain structurally identical and become read-only types. Buttons in forms use `type="submit"` only when intended; other buttons use `type="button"`. Dialog Escape/Tab behavior and plan-date navigation remain keyboard accessible.

- [ ] Add failing interaction tests for submit intent, SuccessDialog keyboard handling, and keyboard use of the plan date picker.
- [ ] Run targeted Vitest and inspect failures.
- [ ] Add explicit button types, read-only prop types, native semantic elements where appropriate, and keyboard handling without placing `tabIndex` on a non-interactive section.
- [ ] Run targeted Vitest, typecheck, and update ledger rows.

### Task 4: Theme consolidation and contrast

**Files:** Modify `src/web/theme.css` in the release copy; use existing page tests and browser for visual checks.

**Interfaces:** Keep the final computed appearance of the current Fairweather theme, apart from colors changed to meet text contrast. Do not remove unique base declarations that the later theme still uses.

- [ ] Capture current computed styles or screenshots for login, employee, leader, management, and admin pages at desktop and narrow viewport; record the two currently active low-contrast pairs.
- [ ] Consolidate duplicate selectors without altering cascade-dependent unique declarations; replace the active primary-button and table-header colors with values at least 4.5:1 against their backgrounds.
- [ ] Recheck computed styles/screenshots and contrast, build CSS, and update all 42 `theme.css` ledger rows (including overridden warnings).

### Task 5: Focused source and fixture cleanup

**Files:** Modify report-listed `S3358`, `S6582`, `S3863`, `S7718`, `S1128`, `S4323`, `S2681`, `S4624`, `S6671`, `S1186` paths under `src/` and `tests/support/` in the release copy; test the existing corresponding `tests/unit` and `tests/integration` suites.

**Interfaces:** Preserve service return values, archive text, and audit behavior. Make the in-memory administration repository's `appendAudit(input: AuditInput): Promise<void>` observable through a test-only array instead of silently doing nothing.

- [ ] Add a focused test asserting the in-memory repository records an audit input; run it and observe failure.
- [ ] Apply the smallest equivalent readability and fixture changes; use optional chaining only where null behavior stays identical.
- [ ] Run relevant tests and typecheck; update ledger rows with exact outcomes.

### Task 6: Final evidence and delivery

**Files:** Finalize `docs/quality/sonar-2026-10-21-issue-ledger.csv` and a concise `docs/quality/sonar-2026-10-21-summary.md` in the root workspace.

**Interfaces:** The summary reports counts by disposition, links to the ledger, test commands and outcomes, plus whether a fresh Sonar scan ran. All 185 IDs have a final disposition.

- [ ] Reconcile the ledger against the original export: 185 unique IDs, no blank disposition or reason; verify every marked fix against the modified source.
- [ ] Run `pnpm verify` on the release copy, targeted Playwright/UI checks when available, and inspect the final diff for unrelated changes.
- [ ] If the Sonar server is reachable, rerun or inspect the current scan; otherwise state that scan closure is unverified.
- [ ] Prepare a deployment package only if verification passes and deployment remains in scope; compare the server version and keep rollback material before any production change.
