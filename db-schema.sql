-- ============================================================
-- MedAdvocate — Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Enable UUID extension (already on by default in Supabase)
create extension if not exists "uuid-ossp";

-- ============================================================
-- PATIENTS
-- One account can have multiple patient profiles
-- ============================================================
create table if not exists patients (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  age         text,
  diagnoses   text,
  meds        text,
  notes       text,
  insurance_id text,
  emergency_contact text,
  is_default  boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists patients_user_id_idx on patients(user_id);

-- ============================================================
-- SYMPTOM CONFIG
-- Which symptoms a patient is tracking
-- ============================================================
create table if not exists symptom_config (
  id          uuid primary key default uuid_generate_v4(),
  patient_id  uuid not null references patients(id) on delete cascade,
  symptom_id  text not null,          -- e.g. 'fatigue' or 'custom_1234'
  label       text not null,
  icon        text not null default '⚡',
  is_custom   boolean default false,
  sort_order  int default 0,
  created_at  timestamptz default now()
);

create index if not exists symptom_config_patient_idx on symptom_config(patient_id);
create unique index if not exists symptom_config_unique on symptom_config(patient_id, symptom_id);

-- ============================================================
-- SYMPTOM ENTRIES
-- Daily logs
-- ============================================================
create table if not exists symptom_entries (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  entry_date   date not null,
  symptoms     jsonb not null default '{}',   -- { symptom_id: 0-10 }
  overall      text check (overall in ('great','ok','hard','worst')),
  interference jsonb default '{}',            -- { activity, sleep, mood, stress }
  notes        text,
  saved_at     timestamptz default now(),
  unique (patient_id, entry_date)
);

create index if not exists symptom_entries_patient_date_idx on symptom_entries(patient_id, entry_date desc);

-- ============================================================
-- MEDICATIONS
-- ============================================================
create table if not exists medications (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  name         text not null,
  dose         text,
  frequency    text,
  type         text check (type in ('prescription','otc','supplement')),
  doctor       text,
  start_date   date,
  end_date     date,
  status       text default 'active' check (status in ('active','paused','stopped')),
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists medications_patient_idx on medications(patient_id);

-- ============================================================
-- MEDICATION LOGS
-- ============================================================
create table if not exists medication_logs (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  medication_id uuid references medications(id) on delete set null,
  log_date     date not null,
  taken        boolean,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists medication_logs_patient_date_idx on medication_logs(patient_id, log_date desc);

-- ============================================================
-- LAB RESULTS
-- ============================================================
create table if not exists lab_results (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  test_name    text not null,
  result_value text,
  unit         text,
  reference_range text,
  status       text check (status in ('normal','low','high','critical','pending')),
  lab_date     date,
  ordering_doctor text,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists lab_results_patient_idx on lab_results(patient_id, lab_date desc);

-- ============================================================
-- DIAGNOSTIC TESTS (imaging, biopsies, etc.)
-- ============================================================
create table if not exists diagnostic_tests (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  test_name    text not null,
  test_type    text,           -- MRI, CT, Biopsy, etc.
  test_date    date,
  result       text,
  ordering_doctor text,
  facility     text,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists diagnostic_tests_patient_idx on diagnostic_tests(patient_id, test_date desc);

-- ============================================================
-- TIMELINE / MEDICAL HISTORY EVENTS
-- ============================================================
create table if not exists timeline_events (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  event_date   date,
  event_year   text,
  title        text not null,
  description  text,
  category     text,           -- diagnosis, surgery, hospitalization, milestone, etc.
  created_at   timestamptz default now()
);

create index if not exists timeline_events_patient_idx on timeline_events(patient_id, event_date desc);

-- ============================================================
-- FLARE LOG
-- ============================================================
create table if not exists flare_log (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  start_date   date not null,
  end_date     date,
  severity     int check (severity between 1 and 10),
  triggers     jsonb default '[]',
  symptoms     jsonb default '[]',
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists flare_log_patient_idx on flare_log(patient_id, start_date desc);

-- ============================================================
-- CARE TEAM CONTACTS
-- ============================================================
create table if not exists care_team (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  name         text not null,
  role         text,            -- cardiologist, PCP, therapist, etc.
  phone        text,
  email        text,
  address      text,
  notes        text,
  is_primary   boolean default false,
  created_at   timestamptz default now()
);

create index if not exists care_team_patient_idx on care_team(patient_id);

-- ============================================================
-- DOCUMENTS
-- ============================================================
create table if not exists documents (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  title        text not null,
  doc_type     text,            -- letter, report, insurance, referral, etc.
  content      text,            -- extracted text
  file_name    text,
  doc_date     date,
  source       text,            -- doctor, hospital, insurance
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists documents_patient_idx on documents(patient_id, created_at desc);

-- ============================================================
-- APPOINTMENTS (upcoming / past appointments calendar)
-- ============================================================
create table if not exists appointments (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  appt_date    date not null,
  appt_time    time,
  doctor       text not null,
  specialty    text,
  location     text,
  notes        text,
  patient_name text,
  created_at   timestamptz default now()
);

create index if not exists appointments_patient_date_idx on appointments(patient_id, appt_date asc);

-- ============================================================
-- APPOINTMENT RECORDINGS
-- ============================================================
create table if not exists appointment_recordings (
  id               uuid primary key default uuid_generate_v4(),
  patient_id       uuid not null references patients(id) on delete cascade,
  doctor           text,
  appointment_type text,
  transcript       text,
  manual_notes     text,
  summary          jsonb,
  duration_secs    integer default 0,
  recorded_at      timestamptz default now() not null,
  created_at       timestamptz default now() not null
);

create index if not exists appt_recordings_patient_idx on appointment_recordings(patient_id, recorded_at desc);

-- ============================================================
-- SAVED SCRIPTS (Visit prep scripts + free-form saved content)
-- ============================================================
create table if not exists saved_scripts (
  id             uuid primary key default uuid_generate_v4(),
  patient_id     uuid not null references patients(id) on delete cascade,
  title          text,              -- free-form script title
  type           text,              -- visit, credibility, iep, lab, custom
  content        text,              -- full free-form script text
  specialist     text,              -- structured scripts: specialist name (was NOT NULL, now nullable)
  opener_line    text,
  priorities     jsonb default '[]',
  questions      jsonb default '[]',
  timing_tip     text,
  emotional_note text,
  created_at     timestamptz default now()
);

-- Migration for existing installations (run in Supabase SQL editor):
-- alter table saved_scripts add column if not exists title text;
-- alter table saved_scripts add column if not exists type text;
-- alter table saved_scripts add column if not exists content text;
-- alter table saved_scripts alter column specialist drop not null;

create index if not exists saved_scripts_patient_idx on saved_scripts(patient_id, created_at desc);

-- ============================================================
-- SCRIPT INSIGHTS (lab / appointment notes pulled into visit scripts)
-- ============================================================
create table if not exists script_insights (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  source       text,              -- e.g. 'Lab 2024-01-15', 'Lab trend'
  insight_text text not null,
  created_at   timestamptz default now()
);

create index if not exists script_insights_patient_idx on script_insights(patient_id, created_at desc);

-- ============================================================
-- RESEARCH LIBRARY
-- ============================================================
create table if not exists research_library (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  title        text not null,
  content      text,
  source_url   text,
  category     text,
  notes        text,
  created_at   timestamptz default now()
);

create index if not exists research_library_patient_idx on research_library(patient_id, created_at desc);

-- ============================================================
-- CONCIERGE TASKS
-- ============================================================
create table if not exists concierge_tasks (
  id           uuid primary key default uuid_generate_v4(),
  patient_id   uuid not null references patients(id) on delete cascade,
  title        text not null,
  contact      text,
  category     text default 'other',
  priority     text default 'normal',
  due_date     date,
  notes        text,
  done         boolean default false,
  done_at      timestamptz,
  created_at   timestamptz default now()
);

create index if not exists concierge_tasks_patient_idx on concierge_tasks(patient_id, created_at desc);

-- ============================================================
-- CONCIERGE COMMUNICATION LOG
-- ============================================================
create table if not exists concierge_log (
  id            uuid primary key default uuid_generate_v4(),
  patient_id    uuid not null references patients(id) on delete cascade,
  log_datetime  timestamptz default now(),
  log_type      text,
  contact       text,
  person        text,
  notes         text,
  outcome       text default 'resolved',
  ref_num       text,
  followup_date date,
  created_at    timestamptz default now()
);

create index if not exists concierge_log_patient_idx on concierge_log(patient_id, created_at desc);

-- ============================================================
-- USER PREFERENCES / SUBSCRIPTION
-- ============================================================
create table if not exists user_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  plan         text default 'free' check (plan in ('free','pro')),
  stripe_customer_id text,
  active_patient_id uuid references patients(id) on delete set null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — users can only see their own data
-- ============================================================

alter table patients           enable row level security;
alter table symptom_config     enable row level security;
alter table symptom_entries    enable row level security;
alter table medications        enable row level security;
alter table medication_logs    enable row level security;
alter table lab_results        enable row level security;
alter table diagnostic_tests   enable row level security;
alter table timeline_events    enable row level security;
alter table flare_log          enable row level security;
alter table care_team          enable row level security;
alter table documents          enable row level security;
alter table saved_scripts           enable row level security;
alter table appointments            enable row level security;
alter table appointment_recordings  enable row level security;
alter table script_insights        enable row level security;
alter table research_library        enable row level security;
alter table concierge_tasks    enable row level security;
alter table concierge_log      enable row level security;
alter table user_settings      enable row level security;

-- Patients: owned by auth user
create policy "users own their patients"
  on patients for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- All patient-child tables: accessible if patient belongs to user
create policy "users own symptom_config"
  on symptom_config for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own symptom_entries"
  on symptom_entries for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own medications"
  on medications for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own medication_logs"
  on medication_logs for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own lab_results"
  on lab_results for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own diagnostic_tests"
  on diagnostic_tests for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own timeline_events"
  on timeline_events for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own flare_log"
  on flare_log for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own care_team"
  on care_team for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own documents"
  on documents for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own saved_scripts"
  on saved_scripts for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own appointments"
  on appointments for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own appointment_recordings"
  on appointment_recordings for all
  using (patient_id in (select id from patients where user_id = auth.uid()))
  with check (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own script_insights"
  on script_insights for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own research_library"
  on research_library for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own concierge_tasks"
  on concierge_tasks for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own concierge_log"
  on concierge_log for all
  using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "users own their settings"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- AUTO-CREATE user_settings on signup
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into user_settings (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- AUTO-UPDATE updated_at timestamps
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger patients_updated_at before update on patients
  for each row execute procedure set_updated_at();

create trigger medications_updated_at before update on medications
  for each row execute procedure set_updated_at();

create trigger user_settings_updated_at before update on user_settings
  for each row execute procedure set_updated_at();
