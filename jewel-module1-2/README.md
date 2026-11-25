# MedMinder - Jewel Gharami (241-35-469): Module 1 and Module 2 contribution

SE331 Software Engineering Design Capstone, Group 01 (lab 42C2). This folder holds **only my features** from Module 1 and Module 2 of the project proposal. Code is copied unchanged from the integrated project, except that parts that belong to teammates or to Module 3 were removed from the shared pages/files.

## My features and where the code is

| Proposal item | Feature | Backend | Frontend |
|---|---|---|---|
| M1-12 | Password reset and change password via email link | `backend/src/password.ts` | `app/(auth)/forgot`, `app/(auth)/reset`, `app/(app)/profile` (change password), `lib/password.tsx` |
| M1-13 | Profile creation and editing | `backend/src/profile.ts` | `app/(app)/profile` |
| M1-14 | Add, edit, delete medications | `backend/src/medications.ts` | `app/(app)/meds` |
| M1-16 | Calendar view (day, week, month) | `backend/src/doses.ts` (list) | `app/(app)/calendar` |
| M2-12 | Snooze and reschedule a reminder | `backend/src/doses.ts` | `app/(app)/dashboard` |
| M2-13 | Mark doses taken / missed / skipped with timestamp | `backend/src/doses.ts` | `app/(app)/dashboard` |
| M2-14 | Dose history with filters (backend only so far) | `backend/src/doses.ts` | - (no filter page yet) |
| M2-15 | In-app notification center (read / unread) | `backend/src/notifications.ts` | `app/(app)/notifications` |
| M2-16 | Patient-controlled permissions per caregiver | `backend/src/permissions.ts` | `app/(app)/permissions` |

Not implemented yet: M1-15 (photo upload for medications and packaging).

## What these files need from the team project (not included)
- `backend/src/common.ts`: `PrismaService`, `Mailer`, `Access`, `AuthGuard`, `Me`, `Public`, `parse`, `passwordSchema`, `tzSchema`, `publicUser`, `limit`, `rand`, `sha`, `APP_URL`, `allergyWarnings`, `doseTimes`, `localDate`, `ALL_PERMS`.
- `backend/src/services.ts`: `Engine` (dose generation and reminders), `Sync` (live updates), `Notifier`.
- `frontend/lib/api.ts`, `frontend/lib/ui.tsx`, `frontend/app/(app)/layout.tsx` (app shell and navigation).
- `backend/prisma/schema.prisma`: models used are in `backend/prisma/schema.reference.prisma` (reference only).

## Wiring into the team project
In `backend/src/app.module.ts` add to `controllers`:
```ts
import { PasswordController } from './password'
import { ProfileSelfController, PatientProfileController } from './profile'
import { MedsController } from './medications'
import { DosesController } from './doses'
import { NotificationsController } from './notifications'
import { PermissionsController } from './permissions'
```
If the team repo already has controllers with the same routes, keep one version of each route. In the nav (`layout.tsx`) add links to `/profile` and `/permissions`.

## Notes
- No `.env` files are included. Never commit `.env` (SMTP password, JWT secret). Use `.env.example`.
- Branches used: `feature/jewel-medication-crud`, `feature/jewel-password-reset`.
