# MedAdvocate — Supabase Integration Guide

## What was built

| File | Purpose |
|---|---|
| `db-schema.sql` | All Supabase tables + RLS policies. Run this once. |
| `supabase-client.js` | Shared `Auth` + `DB` helpers loaded by every page |
| `advocate-login.html` | Sign up / sign in / forgot password / reset password |
| `advocate-patients.html` | Add, switch, and manage multiple patient profiles |
| `patch-pages.js` | One-time script that injected Supabase into all 20 tool pages |

## Database tables created

| Table | Stores |
|---|---|
| `patients` | One row per patient profile (multiple per user account) |
| `symptom_config` | Which symptoms each patient tracks |
| `symptom_entries` | Daily symptom logs (severity 0–10 per symptom) |
| `medications` | Medications list |
| `medication_logs` | Daily medication taken/skipped logs |
| `lab_results` | Lab result entries |
| `diagnostic_tests` | Imaging, biopsies, other tests |
| `timeline_events` | Medical history timeline |
| `flare_log` | Flare-up logs |
| `care_team` | Doctors, nurses, therapists |
| `documents` | Uploaded/extracted documents |
| `saved_scripts` | Saved visit prep scripts |
| `research_library` | Saved research articles |
| `user_settings` | Per-user plan + active patient pointer |

All tables have **Row Level Security** — users can only read/write their own data.

## Deployment steps

### 1. Run the database schema
Go to Supabase Dashboard → SQL Editor → paste and run `db-schema.sql`

### 2. Rotate your anon key
Dashboard → Settings → API → Reset anon key.
Paste the new key in `supabase-client.js` where it says `YOUR_NEW_ANON_KEY`.

### 3. Set environment variables in Netlify
Dashboard → Site → Environment variables:
```
SUPABASE_URL = https://ytzkpqzvaxfrkozspzoa.supabase.co
SUPABASE_ANON_KEY = your_new_anon_key
```

### 4. Enable email auth in Supabase
Dashboard → Authentication → Providers → Email → Enable

### 5. Add redirect URLs in Supabase
Dashboard → Authentication → URL Configuration:
- Site URL: `https://medadvocate.org`
- Redirect URLs: `https://medadvocate.org/advocate-login.html`

### 6. Deploy to Netlify
```bash
git add .
git commit -m "feat: Supabase auth + data layer"
git push
```

## How each tool saves data now

Each tool page now has `supabase-client.js` loaded. The `DB` object provides:

```js
// Reading data (all async)
await DB.getProfile()
await DB.getMedications()
await DB.getSymptomEntries()
await DB.getLabResults()
// ... etc for all 13 data types

// Writing data
await DB.saveProfile({ name, diagnoses, meds })
await DB.saveMedication(medObject)
await DB.upsertSymptomEntry(entryObject)
// ... etc

// Migration from localStorage (runs once on first login)
await DB.migrateFromLocalStorage()
```

## Multiple patient profiles

- Each user account can have unlimited patient profiles
- Switch profiles: `advocate-patients.html` or nav dropdown
- All data is scoped to the active `patient_id`
- Profile switcher also appears in the nav bar via `renderAuthBar('nav-container-id')`

## Auth flow

1. User visits any tool page → `Auth.requireAuth()` checks session → redirects to `/advocate-login.html?next=/tool-page.html` if not logged in
2. After sign in → redirected back to original page
3. First-ever login on a device with existing localStorage data → `DB.migrateFromLocalStorage()` runs automatically
4. Password reset → Supabase emails a link → user lands on `/advocate-login.html?mode=reset` → sets new password
