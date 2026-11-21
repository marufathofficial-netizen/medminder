# MedMinder: Member 2 contribution (Kazi Auniruddho Islam, ID 241-35-094)

SE331 Software Engineering Design Capstone Project, Fall 2026. Group 01, Lab Section 42C2.
MedMinder is a medication reminder and adherence tracking web platform.
This repository holds the files that implement my features from Module 1 and Module 2.

**Stack:** Next.js 14 + React 18 + Tailwind (frontend), NestJS 10 + TypeScript (backend), MongoDB via Prisma, BullMQ/Redis (optional), Nodemailer.

## My features and where they live

| # | Feature | Main files |
|---|---------|------------|
| 1 | Secure login and logout with JWT and refresh tokens | `backend/src/auth.ts`, `frontend/lib/api.ts`, `frontend/app/(auth)/login/page.tsx` |
| 2 | Role-based accounts and access control | `backend/src/common.ts` (AuthGuard, Access), `frontend/app/(app)/layout.tsx` |
| 3 | Privacy settings, account deactivation and deletion | `backend/src/users.ts`, `frontend/app/(app)/settings/page.tsx` |
| 4 | Drug and allergy warnings | `backend/src/common.ts` (allergyWarnings), `backend/src/allergies.ts`, `backend/src/meds.ts`, `frontend/app/(app)/allergies/page.tsx` |
| 5 | Medication start date, end date and duration | `backend/src/meds.ts`, `frontend/app/(app)/meds/page.tsx` |
| 6 | Automatic reminder generation | `backend/src/services.ts` (Engine), `backend/src/common.ts` (genDoses), `backend/src/schedule.spec.ts` |
| 7 | Customizable reminder preferences | `backend/src/users.ts`, `backend/src/services.ts` (Notifier), `frontend/app/(app)/settings/page.tsx`, `frontend/public/sw.js` |
| 8 | Auto-mark unconfirmed doses as missed | `backend/src/services.ts` (Engine.tick) |
| 9 | Email notifications | `backend/src/common.ts` (Mailer), `backend/src/services.ts`, `backend/src/mailtest.ts` |
| 10 | Caregiver invitation by secure link | `backend/src/links.ts`, `frontend/app/(app)/care/page.tsx`, `frontend/app/(app)/accept/page.tsx` |
| 11 | Caregiver manages medications on behalf of a patient | `backend/src/meds.ts`, `backend/src/common.ts` (Access), `frontend/app/(app)/layout.tsx` |

## Notes
- Some files (`common.ts`, `services.ts`, `meds.ts`, `links.ts`, `layout.tsx`) are shared with my teammates' features, so they also contain code that is not mine.
- Teammates' pages and controllers (admin, health, reports, notifications, prescriptions and others) are not included. `backend/src/app.module.ts` still lists them, so this folder is meant to be merged into the full project rather than run on its own.
- Secrets are not included. Copy `backend/.env.example` to `backend/.env` and fill in your own values. `.env` files are listed in `.gitignore`.

## Run (inside the full project)
```
cd backend && npm install && npm run db && npm run dev
cd frontend && npm install && npm run dev
```
