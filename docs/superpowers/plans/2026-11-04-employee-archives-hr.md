# Employee archives and HR Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated module implementation and independent review. User explicitly requested implementation of the attached approved design; continue within that authorization.

**Goal:** Implement employee archives, protected attachments, dedicated HR state supervision, personnel maintenance and departure lifecycle without exposing business content to HR.

**Architecture:** Extend User with personnel/lifecycle fields, retain immutable user IDs and Department membership, add private attachment metadata/storage and explicit role allowlists. Reuse Prisma transactions, reminders, audit and minute scheduler; use separate HR selects containing no business content. Preserve dirty workspace and the existing department implementation.

**Tech Stack:** Existing React/TypeScript, Fastify, Prisma/PostgreSQL, Vitest and Playwright, Node filesystem and crypto; no new runtime dependencies.

**Spec:** ../specs/2026-11-04-employee-archives-hr-design.md, including the subsequent self-service department override.

## Global constraints and implementation rulings

- HR is a dedicated fifth role, cannot read logs, full archives, attachments, business reports or audit payloads, nor approve/edit/delete logs.
- Employee self-edit; leader reads own department; management reads all archives and owns bin; admin keeps system/identity permissions and is not implicitly archive management.
- HR edits hire/departure dates/status and allocates department-local numbers from 0001; optional department number prefix configured by admin, no number reuse or automatic renumber on transfer. Keep allocation department visible.
- Accept PDF/JPEG/PNG/DOCX by signature, 10 MiB each, 10 files/category, private persistent directory. Three categories RESUME/DEGREE/AGREEMENT.
- One-time activation timestamp; completion deadline max(registration,activation)+7 days; daily Beijing-date dedupe after 09:00 until complete; stop for departed staff. Missing required name/gender/hire date/department/number also counts incomplete, HR gets only generic overdue state.
- T0 actual departure mark; immediately read-only, +30*24h deny new/existing sessions; +6 calendar months (clamp day) recycle; actual recycle+30 days purge. Restoring history does not enable login/re-employ, and suspends repeated recycling.
- Departing leader requires named active MANAGEMENT successor, atomically transfer pending approval obligations and future assignments with audit; never auto-approve or return logs.
- Purge anonymizes referenced user to preserve other employees' records; removes personal files, owned logs/versions/comments/replies, numbers and residual private metadata. Files deletion retry precedes database completion; purge/restore have one winner.
- No production deployment or production deletion in this task. Existing source is not evidence of server compatibility.

## Review focus

- HR requests old paths, forged attachment IDs and notification routes must not obtain content.
- Time boundaries, missing employment dates, future/returned logs and exemption days must not distort state counts.
- Concurrent number allocation, file upload quota, department change and purge/restore must not overwrite relationships.
- File deletion failure must leave retryable purge state; another employee's approvals and logs must survive.
- Staff leaving while a session is open must lose write rights immediately and all access at day 30 even without scheduler.

## Task 1: Core schema, authorization and archives (root)

- [x] Add HR role, personnel/lifecycle fields, department sequence/prefix and attachment table; forward migration and generated client.
- [x] Tests for role isolation, departure boundaries, filename/type/size validation, archive ownership and upload/delete/read permissions.
- [x] Protected archive endpoints under /api/archives; content returned only to EMPLOYEE/LEADER/MANAGEMENT per scope. Self-edit name/gender and attachments; preserve existing department selector via /api/profile.
- [x] Explicit old-route role allowlists and immediate lifecycle guard at authentication/request boundaries; hide recycled/purged employees/logs from existing queries.

## Task 2: HR status supervision (independent module)

- [x] Add src/modules/hr/hr.service.ts and hr.routes.ts with dedicated metadata selects, date filters, missing-log rows, final-approval rates, exemptions and CSV export.
- [x] HR-only manual submission/overdue approval reminders, daily dedupe and sender/target/time audit without business fields.
- [x] Tests for exemption/hire/departure intervals, final approval and HR response field allowlists.

## Task 3: Personnel lifecycle (independent module)

- [x] Add src/modules/personnel/personnel.service.ts and personnel.routes.ts for HR metadata, employment changes and transactional number allocation; management bin list/detail/restore/purge and private retryable lifecycle jobs.
- [x] Implement leader handover, daily archive-overdue notifications, recycle/purge transitions and safeguards.
- [x] Tests for calendar months, day30, retry failure, restore race, sequence and data-preserving purge.

## Task 4: UI (independent files)

- [x] Extend employee archive page; add read-only scoped archive browser, HR personnel/status/exemption pages and management recycle-bin with explicit feedback and destructive confirmation.
- [x] Wire HR role labels, dedicated navigation and exact route role guards; admin can create dedicated HR accounts and set number prefixes.
- [x] Component tests and responsive browser checks using controlled data.

## Task 5: Integration and verification

- [x] Wire services/routes and production scheduler; persist attachment path via Docker volume; activation and dry-run deployment instructions.
- [x] Full tests, typecheck, build, Prisma validate; isolated migration and browser checks with representative roles.
- [x] Independent review and correction; document verified scope and deployment/backup limitations.
