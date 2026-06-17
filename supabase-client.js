// ============================================================
// supabase-client.js  — shared across all MedAdvocate pages
// Load BEFORE any page script that uses Supabase.
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
// <script src="supabase-client.js"></script>
// ============================================================

const SUPA_URL  = 'https://ytzlpqzvaxfrkozspzoa.supabase.co';
const SUPA_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0emxwcXp2YXhmcmtvenNwem9hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODg1NDUsImV4cCI6MjA5MzE2NDU0NX0.JxHeLaaEsQbo_aRh8WJ2JFYrwNCa2WpQq_-usWORBnw'; // ← paste rotated key here

const _supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// ============================================================
// AUTH HELPERS
// ============================================================

const Auth = {
  /** Returns the current session or null */
  async session() {
    const { data } = await _supa.auth.getSession();
    return data.session;
  },

  /** Returns the current user or null */
  async user() {
    const s = await Auth.session();
    return s ? s.user : null;
  },

  /** Sign up with email + password */
  async signUp(email, password, name) {
    const { data, error } = await _supa.auth.signUp({ email, password });
    if (error) throw error;
    // Create a default patient profile
    if (data.user && name) {
      await DB.createPatient({ name, is_default: true });
    }
    return data;
  },

  /** Sign in with email + password */
  async signIn(email, password) {
    const { data, error } = await _supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  /** Sign out */
  async signOut() {
    await _supa.auth.signOut();
    // Clear per-session state so a stale patient ID never survives into the
    // next account on this browser (see DB.patientId validation).
    localStorage.removeItem('advocate_active_patient_id');
    localStorage.removeItem('advocate_unlocked');
    DB._patientId = null;
    window.location.href = 'advocate-login.html';
  },

  /** Send password reset email */
  async resetPassword(email) {
    const { error } = await _supa.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/advocate-login.html?mode=reset'
    });
    if (error) throw error;
  },

  /** Update password (called from reset flow) */
  async updatePassword(newPassword) {
    const { error } = await _supa.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  /** Store arbitrary metadata on the auth user (e.g. plan, trial_end) */
  async setUserMeta(data) {
    const { error } = await _supa.auth.updateUser({ data });
    if (error) throw error;
  },

  /**
   * Guard: call at top of every protected page.
   * Redirects to login if not authenticated.
   * Also checks beta trial status and shows warning/expired UI.
   */
  async requireAuth() {
    const user = await Auth.user();
    if (!user) {
      window.location.href = 'advocate-login.html?next=' + encodeURIComponent(window.location.pathname);
      return null;
    }
    Auth._checkTrial(user);
    return user;
  },

  _checkTrial(user) {
    try {
      const meta = user.user_metadata || {};
      if (meta.plan !== 'beta' || !meta.trial_end) return;
      const daysLeft = Math.ceil((new Date(meta.trial_end) - new Date()) / 864e5);
      if (daysLeft > 10) return;
      if (daysLeft <= 0) {
        Auth._showExpiredModal();
      } else {
        Auth._showWarningBanner(daysLeft);
      }
    } catch(e) {}
  },

  _showWarningBanner(daysLeft) {
    if (sessionStorage.getItem('trial_banner_dismissed')) return;
    const b = document.createElement('div');
    b.id = 'trialBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1b4332;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:14px;font-family:DM Sans,sans-serif;font-size:13px;font-weight:400';
    b.innerHTML = `
      <span>🌿 Your free trial ends in <strong>${daysLeft} day${daysLeft===1?'':'s'}</strong> — subscribe to keep your data and full access.</span>
      <a href="advocate-checkout.html" style="padding:6px 16px;background:#95d5b2;color:#0d1f15;border-radius:100px;font-weight:600;font-size:12px;text-decoration:none;white-space:nowrap">Subscribe now</a>
      <button onclick="sessionStorage.setItem('trial_banner_dismissed','1');document.getElementById('trialBanner').remove()" style="background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;margin-left:4px">×</button>
    `;
    document.body.prepend(b);
    // Push page content down so the banner doesn't overlap the nav
    document.body.style.paddingTop = (document.body.style.paddingTop ? parseInt(document.body.style.paddingTop) + b.offsetHeight : b.offsetHeight) + 'px';
  },

  _showExpiredModal() {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(13,31,21,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px';
    o.innerHTML = `
      <div style="background:#fdfcf8;border-radius:24px;padding:40px 36px;max-width:440px;width:100%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.3)">
        <div style="font-size:52px;margin-bottom:16px">🌿</div>
        <div style="font-family:Fraunces,serif;font-size:28px;font-weight:300;color:#0d1f15;margin-bottom:10px;line-height:1.2">Your free trial <em style="font-style:italic;color:#2d6a4f">has ended.</em></div>
        <p style="font-size:14px;color:#1b4332;line-height:1.75;font-weight:300;margin-bottom:8px">Your data is safe and waiting for you. Subscribe to pick up right where you left off — everything you've added is still here.</p>
        <p style="font-size:13px;color:#4a7a5e;margin-bottom:28px;font-weight:300">Thank you for being an early tester. Your feedback has meant everything.</p>
        <a href="advocate-checkout.html" style="display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:#1b4332;color:#fff;border-radius:100px;font-family:DM Sans,sans-serif;font-size:15px;font-weight:500;text-decoration:none;transition:background .2s">Subscribe &amp; continue →</a>
        <div style="margin-top:16px">
          <a href="mailto:hello@medadvocate.org?subject=Beta trial question" style="font-size:12px;color:#4a7a5e;text-decoration:none">Questions? Email us</a>
        </div>
      </div>
    `;
    document.body.appendChild(o);
  }
};

// ============================================================
// AUTHENTICATED FETCH HEADERS
// Returns headers for calls to our Netlify functions (claude-proxy,
// claude-proxy-background). Attaches the current Supabase access token
// as a Bearer credential so the server can verify the caller. Use this
// for every proxy fetch — without it the server responds 401.
// ============================================================
async function aiHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  try {
    const s = await Auth.session();
    if (s && s.access_token) headers['Authorization'] = 'Bearer ' + s.access_token;
  } catch (e) { /* no session — request will be rejected server-side */ }
  return headers;
}

// ============================================================
// PATIENT / PROFILE HELPERS
// ============================================================

const DB = {
  // ── internal cache ──
  _patientId: null,
  _patientIdValidated: false,
  _noPatientNotified: false,

  /**
   * Show a one-time, dismissible banner when we have no patient context.
   * Without this, save/read calls silently no-op (e.g. after a session
   * expires mid-use) and the user loses data without any feedback.
   */
  _notifyNoPatient() {
    if (DB._noPatientNotified) return;
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('noPatientBanner')) return;
    DB._noPatientNotified = true;
    const b = document.createElement('div');
    b.id = 'noPatientBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7a1f1f;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:14px;font-family:DM Sans,sans-serif;font-size:13px;font-weight:400';
    b.innerHTML = `
      <span>⚠️ We couldn't find your patient profile — your session may have expired. Anything you enter now won't be saved. Please sign in again.</span>
      <a href="advocate-login.html?next=${encodeURIComponent(window.location.pathname)}" style="padding:6px 16px;background:#fff;color:#7a1f1f;border-radius:100px;font-weight:600;font-size:12px;text-decoration:none;white-space:nowrap">Sign in</a>
      <button onclick="document.getElementById('noPatientBanner').remove()" style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;margin-left:4px">×</button>
    `;
    document.body.prepend(b);
  },

  /** Get or create the active patient ID for the current user */
  async patientId() {
    if (DB._patientId) return DB._patientId;

    // 1. Check localStorage — fastest and most reliable (set by switchPatient).
    // But a cached ID can belong to a *different* account if someone signed out
    // and back in on the same browser. Validate it against the current user's
    // patients once per session before trusting it; if it doesn't belong to
    // this user, drop it and fall through to re-select below.
    const lsPid = localStorage.getItem('advocate_active_patient_id');
    if (lsPid) {
      if (!DB._patientIdValidated) {
        try {
          const patients = await DB.getPatients();
          DB._patientIdValidated = true;
          if (!patients.some(p => p.id === lsPid)) {
            localStorage.removeItem('advocate_active_patient_id');
            // fall through to user_settings / default lookup
          } else {
            DB._patientId = lsPid;
            return DB._patientId;
          }
        } catch (e) {
          // Couldn't verify (offline / transient) — trust the cache for now
          // without marking validated, so we re-check on the next call.
          DB._patientId = lsPid;
          return DB._patientId;
        }
      } else {
        DB._patientId = lsPid;
        return DB._patientId;
      }
    }

    // 2. Check user_settings in Supabase — filter by user_id and use limit(1)
    // so duplicate rows (from old buggy upserts) don't cause .single() to error.
    try {
      const user = await Auth.user();
      if (user) {
        const { data: rows } = await _supa
          .from('user_settings')
          .select('active_patient_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        const pid = rows?.[0]?.active_patient_id;
        if (pid) {
          DB._patientId = pid;
          localStorage.setItem('advocate_active_patient_id', DB._patientId);
          return DB._patientId;
        }
      }
    } catch (e) { /* fall through */ }

    // 3. Fall back to default patient
    const { data: patients } = await _supa
      .from('patients')
      .select('id')
      .eq('is_default', true)
      .limit(1);

    if (patients?.length) {
      DB._patientId = patients[0].id;
      localStorage.setItem('advocate_active_patient_id', DB._patientId);
      return DB._patientId;
    }

    // No patient context at all — surface a visible error instead of letting
    // callers silently no-op (see _notifyNoPatient).
    DB._notifyNoPatient();
    return null;
  },

  /** Switch active patient */
  async switchPatient(patientId) {
    DB._patientId = patientId;
    // Store in localStorage so every page gets the right PID without hitting Supabase
    localStorage.setItem('advocate_active_patient_id', patientId);
    try {
      await _supa
        .from('user_settings')
        .upsert(
          { user_id: (await Auth.user()).id, active_patient_id: patientId },
          { onConflict: 'user_id' }   // update existing row, don't insert duplicates
        );
    } catch (e) { /* localStorage is the fallback — Supabase failure is non-fatal */ }
  },

  /** Create a new patient profile */
  async createPatient(profile) {
    const user = await Auth.user();
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await _supa
      .from('patients')
      .insert({ user_id: user.id, ...profile })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Get all patients for current user */
  async getPatients() {
    const { data, error } = await _supa
      .from('patients')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at');
    if (error) throw error;
    return data || [];
  },

  /** Get / update the active patient profile */
  async getProfile() {
    const pid = await DB.patientId();
    if (!pid) return {};
    const { data } = await _supa.from('patients').select('*').eq('id', pid).single();
    return data || {};
  },

  async saveProfile(fields) {
    const pid = await DB.patientId();
    if (!pid) return;
    const { error } = await _supa.from('patients').update(fields).eq('id', pid);
    if (error) throw error;
  },

  // ── SYMPTOM CONFIG ──────────────────────────────────────────

  async getSymptomConfig() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('symptom_config')
      .select('*')
      .eq('patient_id', pid)
      .order('sort_order');
    return data || [];
  },

  async saveSymptomConfig(symptoms) {
    // symptoms = [{ symptom_id, label, icon, is_custom }]
    const pid = await DB.patientId();
    if (!pid) return;
    // Delete all then re-insert (simple replace strategy)
    await _supa.from('symptom_config').delete().eq('patient_id', pid);
    if (!symptoms.length) return;
    const rows = symptoms.map((s, i) => ({
      patient_id: pid,
      symptom_id: s.id,
      label: s.label,
      icon: s.icon || '⚡',
      is_custom: !!s.custom,
      sort_order: i
    }));
    const { error } = await _supa.from('symptom_config').insert(rows);
    if (error) throw error;
  },

  // ── SYMPTOM ENTRIES ─────────────────────────────────────────

  async getSymptomEntries(limit = 200) {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('symptom_entries')
      .select('*')
      .eq('patient_id', pid)
      .order('entry_date', { ascending: false })
      .limit(limit);
    // Fetch newest `limit` rows (descending), then restore chronological order
    return (data || []).reverse().map(row => ({
      date: row.entry_date,
      symptoms: row.symptoms || {},
      overall: row.overall,
      interference: row.interference || {},
      notes: row.notes,
      savedAt: row.saved_at,
      _id: row.id
    }));
  },

  async upsertSymptomEntry(entry) {
    const pid = await DB.patientId();
    if (!pid) return;
    const { error } = await _supa.from('symptom_entries').upsert({
      patient_id: pid,
      entry_date: entry.date,
      symptoms: entry.symptoms || {},
      overall: entry.overall || null,
      interference: entry.interference || {},
      notes: entry.notes || null,
      saved_at: new Date().toISOString()
    }, { onConflict: 'patient_id,entry_date' });
    if (error) throw error;
  },

  async deleteSymptomEntry(date) {
    const pid = await DB.patientId();
    if (!pid) return;
    await _supa.from('symptom_entries')
      .delete().eq('patient_id', pid).eq('entry_date', date);
  },

  // ── MEDICATIONS ─────────────────────────────────────────────

  async getMedications() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('medications')
      .select('*')
      .eq('patient_id', pid)
      .order('created_at');
    return data || [];
  },

  async saveMedication(med) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (med.id && !med.id.startsWith('local_')) {
      const { error } = await _supa.from('medications').update({
        name: med.name, dose: med.dose, frequency: med.frequency,
        type: med.type, doctor: med.doctor,
        start_date: med.start_date || med.startDate || null,
        status: med.status, notes: med.notes
      }).eq('id', med.id);
      if (error) throw error;
      return med.id;
    } else {
      const { data, error } = await _supa.from('medications').insert({
        patient_id: pid,
        name: med.name, dose: med.dose, frequency: med.frequency,
        type: med.type || 'prescription', doctor: med.doctor,
        start_date: med.start_date || med.startDate || null,
        status: med.status || 'active', notes: med.notes || null
      }).select().single();
      if (error) throw error;
      return data.id;
    }
  },

  async deleteMedication(id) {
    await _supa.from('medications').delete().eq('id', id);
  },

  // ── MEDICATION LOGS ─────────────────────────────────────────

  async getMedicationLogs(limit = 300) {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('medication_logs')
      .select('*')
      .eq('patient_id', pid)
      .order('log_date', { ascending: false })
      .limit(limit);
    return data || [];
  },

  async saveMedicationLog(entry) {
    const pid = await DB.patientId();
    if (!pid) return;
    // Pack extra fields into notes JSON
    const notesJson = JSON.stringify({
      note: entry.note || entry.notes || '',
      effectiveness: entry.effectiveness || 3,
      type: entry.type || 'note'
    });
    const { data, error } = await _supa.from('medication_logs').insert({
      patient_id: pid,
      medication_id: entry.medId || entry.medication_id || null,
      log_date: entry.date || entry.log_date || new Date().toISOString().split('T')[0],
      taken: entry.taken !== undefined ? entry.taken : null,
      notes: notesJson
    }).select().single();
    if (error) throw error;
    return data;
  },

  async deleteMedicationLog(id) {
    await _supa.from('medication_logs').delete().eq('id', id);
  },

  // ── LAB RESULTS ─────────────────────────────────────────────

  async getLabResults() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('lab_results')
      .select('*')
      .eq('patient_id', pid)
      .order('lab_date', { ascending: false });
    return data || [];
  },

  async saveLabResult(lab) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (lab.id) {
      const { error } = await _supa.from('lab_results').update({
        test_name: lab.test_name || lab.name,
        result_value: lab.result_value || lab.value,
        unit: lab.unit, reference_range: lab.reference_range,
        status: lab.status, lab_date: lab.lab_date || lab.date,
        ordering_doctor: lab.ordering_doctor || lab.doctor, notes: lab.notes
      }).eq('id', lab.id);
      if (error) throw error;
    } else {
      const { error } = await _supa.from('lab_results').insert({
        patient_id: pid,
        test_name: lab.test_name || lab.name,
        result_value: lab.result_value || lab.value,
        unit: lab.unit, reference_range: lab.reference_range,
        status: lab.status || 'pending',
        lab_date: lab.lab_date || lab.date || null,
        ordering_doctor: lab.ordering_doctor || lab.doctor || null,
        notes: lab.notes || null
      });
      if (error) throw error;
    }
  },

  async deleteLabResult(id) {
    await _supa.from('lab_results').delete().eq('id', id);
  },

  // ── LAB REPORTS (full processed report blobs) ────────────────
  // Stored as sentinel rows (test_name='__report__') with JSON in notes.

  async getLabReports() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('lab_results')
      .select('id, lab_date, notes')
      .eq('patient_id', pid)
      .eq('test_name', '__report__')
      .order('lab_date', { ascending: true });

    const good = [];

    for (const row of (data || [])) {
      try {
        const report = JSON.parse(row.notes);
        // _pid is an extra in-blob sanity check. The SQL patient_id column already scopes
        // to the correct patient, so we trust the DB and never auto-delete based on _pid.
        // A stale _pid (e.g. from a patient-switch race) must not destroy real data.
        good.push({ dbId: row.id, ...report });
      } catch { /* skip unparseable rows */ }
    }

    return good;
  },

  async saveLabReport(report) {
    const pid = await DB.patientId();
    if (!pid) return;
    // Embed _pid inside the blob so cross-patient contamination can be auto-detected on load
    const blob = JSON.stringify({ ...report, _pid: pid });
    // Use null for empty/missing dates — empty string '' is invalid for Postgres date column
    const dateVal = report.date || null;
    // Only check for an existing row if we have a date to match on
    let existing = null;
    if (dateVal) {
      const { data } = await _supa
        .from('lab_results').select('id')
        .eq('patient_id', pid).eq('test_name', '__report__').eq('lab_date', dateVal)
        .maybeSingle();
      existing = data;
    }
    if (existing?.id) {
      const { error } = await _supa.from('lab_results').update({ notes: blob }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await _supa.from('lab_results').insert({
        patient_id: pid, test_name: '__report__',
        lab_date: dateVal, notes: blob
      });
      if (error) throw error;
    }
  },

  async deleteLabReport(id) {
    await _supa.from('lab_results').delete().eq('id', id);
  },

  /** Delete every lab report row for the active patient (clears corrupted / wrong-patient data) */
  async deleteAllLabReports() {
    const pid = await DB.patientId();
    if (!pid) return;
    await _supa.from('lab_results')
      .delete()
      .eq('patient_id', pid)
      .eq('test_name', '__report__');
  },

  // ── DIAGNOSTIC TESTS ────────────────────────────────────────

  async getDiagnosticTests() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data, error } = await _supa
      .from('diagnostic_tests')
      .select('*')
      .eq('patient_id', pid)
      .order('test_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async saveDiagnosticTest(test) {
    const pid = await DB.patientId();
    if (!pid) return null;
    const TYPE_LABELS = {
      eeg:'EEG', ekg:'EKG / ECG', echo:'Echocardiogram', mri:'MRI',
      ct:'CT Scan', xray:'X-Ray', tilt:'Tilt Table', holter:'Holter Monitor',
      sleep:'Sleep Study', nerve:'Nerve Conduction', dexa:'DEXA Scan',
      pulmonary:'Pulmonary Function', gastric:'Gastric Emptying',
      ultrasound:'Ultrasound', autonomic:'Autonomic Testing', other:'Other'
    };
    const testType = test.type || test.test_type || null;
    const testName = test.name || test.test_name
      || TYPE_LABELS[test.type] || TYPE_LABELS[test.test_type]
      || test.type || 'Unknown Test';
    const hasSupabaseId = test.id && typeof test.id === 'string';
    if (hasSupabaseId) {
      const { data, error } = await _supa.from('diagnostic_tests').update({
        test_name: testName,
        test_type: testType,
        test_date: test.date || test.test_date,
        result: test.status || test.result,
        ordering_doctor: test.doctor || test.ordering_doctor,
        facility: test.facility, notes: test.notes,
        extracted: test.extracted || null
      }).eq('id', test.id).select().single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await _supa.from('diagnostic_tests').insert({
        patient_id: pid,
        test_name: testName,
        test_type: testType,
        test_date: test.date || test.test_date || null,
        result: test.status || test.result || null,
        ordering_doctor: test.doctor || test.ordering_doctor || null,
        facility: test.facility || null,
        notes: test.notes || null,
        extracted: test.extracted || null
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteDiagnosticTest(id) {
    await _supa.from('diagnostic_tests').delete().eq('id', id);
  },

  // ── TIMELINE EVENTS ──────────────────────────────────────────

  async getTimelineEvents() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('timeline_events')
      .select('*')
      .eq('patient_id', pid)
      .order('event_date', { ascending: false });
    return data || [];
  },

  async saveTimelineEvent(evt) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (evt.id) {
      await _supa.from('timeline_events').update({
        event_date: evt.date || evt.event_date,
        event_year: evt.year || evt.event_year,
        title: evt.title, description: evt.description || evt.notes,
        category: evt.category
      }).eq('id', evt.id);
    } else {
      const { data, error } = await _supa.from('timeline_events').insert({
        patient_id: pid,
        event_date: evt.date || evt.event_date || null,
        event_year: evt.year || evt.event_year || null,
        title: evt.title,
        description: evt.description || evt.notes || null,
        category: evt.category || null
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteTimelineEvent(id) {
    await _supa.from('timeline_events').delete().eq('id', id);
  },

  // ── FLARE LOG ────────────────────────────────────────────────

  async getFlares() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('flare_log')
      .select('*')
      .eq('patient_id', pid)
      .order('start_date', { ascending: false });
    return data || [];
  },

  async saveFlare(flare) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (flare.id) {
      await _supa.from('flare_log').update({
        start_date: flare.startDate || flare.start_date,
        end_date: flare.endDate || flare.end_date || null,
        severity: flare.severity, triggers: flare.triggers || [],
        symptoms: flare.symptoms || [], notes: flare.notes || null
      }).eq('id', flare.id);
    } else {
      await _supa.from('flare_log').insert({
        patient_id: pid,
        start_date: flare.startDate || flare.start_date,
        end_date: flare.endDate || flare.end_date || null,
        severity: flare.severity || null,
        triggers: flare.triggers || [],
        symptoms: flare.symptoms || [],
        notes: flare.notes || null
      });
    }
  },

  async deleteFlare(id) {
    await _supa.from('flare_log').delete().eq('id', id);
  },

  // ── CARE TEAM ────────────────────────────────────────────────

  async getCareTeam() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('care_team')
      .select('*')
      .eq('patient_id', pid)
      .order('is_primary', { ascending: false })
      .order('created_at');
    return data || [];
  },

  async saveContact(contact) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (contact.id) {
      await _supa.from('care_team').update({
        name: contact.name, role: contact.role, phone: contact.phone,
        email: contact.email, address: contact.address,
        notes: contact.notes, is_primary: contact.is_primary || false
      }).eq('id', contact.id);
    } else {
      const { data, error } = await _supa.from('care_team').insert({
        patient_id: pid,
        name: contact.name, role: contact.role || null,
        phone: contact.phone || null, email: contact.email || null,
        address: contact.address || null, notes: contact.notes || null,
        is_primary: contact.is_primary || false
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteContact(id) {
    await _supa.from('care_team').delete().eq('id', id);
  },

  // ── DOCUMENTS ────────────────────────────────────────────────

  async getDocuments() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('documents')
      .select('*')
      .eq('patient_id', pid)
      .order('created_at', { ascending: false });
    return data || [];
  },

  async saveDocument(doc) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (doc.id) {
      await _supa.from('documents').update({
        title: doc.title, doc_type: doc.type || doc.doc_type,
        content: doc.content, file_name: doc.fileName || doc.file_name,
        doc_date: doc.date || doc.doc_date || null,
        source: doc.source, notes: doc.notes
      }).eq('id', doc.id);
    } else {
      const { data, error } = await _supa.from('documents').insert({
        patient_id: pid,
        title: doc.title,
        doc_type: doc.type || doc.doc_type || null,
        content: doc.content || null,
        file_name: doc.fileName || doc.file_name || null,
        doc_date: doc.date || doc.doc_date || null,
        source: doc.source || null,
        notes: doc.notes || null
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteDocument(id) {
    await _supa.from('documents').delete().eq('id', id);
  },

  // ── SAVED SCRIPTS ────────────────────────────────────────────

  async getSavedScripts() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('saved_scripts')
      .select('*')
      .eq('patient_id', pid)
      .order('created_at', { ascending: false });
    return (data || []).map(row => ({
      id: row.id,
      type: row.type || 'visit',
      title: row.title || row.specialist || 'Saved Script',
      content: row.content || '',
      savedAt: row.created_at,
      specialist: row.specialist,
      opener_line: row.opener_line,
      priorities: row.priorities,
      questions: row.questions,
      timing_tip: row.timing_tip,
      emotional_note: row.emotional_note
    }));
  },

  async saveRawScript(type, title, content) {
    const pid = await DB.patientId();
    if (!pid) return null;
    const { data, error } = await _supa.from('saved_scripts').insert({
      patient_id: pid, type: type || 'custom', title: title || 'Script', content: content || ''
    }).select().single();
    if (error) throw error;
    return data;
  },

  async saveScript(script) {
    const pid = await DB.patientId();
    if (!pid) return;
    const { error } = await _supa.from('saved_scripts').insert({
      patient_id: pid,
      specialist: script.specialist,
      opener_line: script.openerLine || script.opener_line,
      priorities: script.priorities || [],
      questions: script.questionsToAsk || script.questions || [],
      timing_tip: script.timingTip || script.timing_tip,
      emotional_note: script.emotionalNote || script.emotional_note
    });
    if (error) throw error;
  },

  async deleteScript(id) {
    await _supa.from('saved_scripts').delete().eq('id', id);
  },

  // ── RESEARCH LIBRARY ─────────────────────────────────────────

  async getResearchLibrary() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('research_library')
      .select('*')
      .eq('patient_id', pid)
      .order('created_at', { ascending: false });
    return data || [];
  },

  async saveResearchItem(item) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (item.id) {
      await _supa.from('research_library').update({
        title: item.title, content: item.content,
        source_url: item.url || item.source_url,
        category: item.category, notes: item.notes
      }).eq('id', item.id);
    } else {
      const { data, error } = await _supa.from('research_library').insert({
        patient_id: pid,
        title: item.title, content: item.content || null,
        source_url: item.url || item.source_url || null,
        category: item.category || null, notes: item.notes || null
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteResearchItem(id) {
    await _supa.from('research_library').delete().eq('id', id);
  },

  // ── SCRIPT INSIGHTS ──────────────────────────────────────────

  async saveInsight(patientId, source, insightText) {
    const { data, error } = await _supa.from('script_insights').insert({
      patient_id: patientId, source, insight_text: insightText
    }).select().single();
    if (error) throw error;
    return data;
  },

  async loadInsights(patientId) {
    const { data } = await _supa.from('script_insights')
      .select('*').eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    return data || [];
  },

  async deleteInsight(id) {
    const { error } = await _supa.from('script_insights').delete().eq('id', id);
    return !error;
  },

  async deleteAllInsights() {
    const pid = await DB.patientId();
    if (!pid) return;
    await _supa.from('script_insights').delete().eq('patient_id', pid);
  },

  // ── APPOINTMENT RECORDINGS ───────────────────────────────────

  async saveRecording(rec) {
    const pid = await DB.patientId();
    if (!pid) return null;
    const { data, error } = await _supa.from('appointment_recordings').insert({
      patient_id: pid,
      doctor: rec.doctor || null,
      appointment_type: rec.appointment_type || null,
      transcript: rec.transcript || null,
      manual_notes: rec.manual_notes || null,
      summary: rec.summary || null,
      duration_secs: rec.duration_secs || 0,
      recorded_at: rec.recorded_at || new Date().toISOString()
    }).select().single();
    if (error) throw error;
    return data;
  },

  async updateRecording(id, fields) {
    const { error } = await _supa.from('appointment_recordings').update(fields).eq('id', id);
    if (error) throw error;
  },

  async getRecordings(limit) {
    limit = limit || 50;
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('appointment_recordings')
      .select('*')
      .eq('patient_id', pid)
      .order('recorded_at', { ascending: false })
      .limit(limit);
    return data || [];
  },

  async deleteRecording(id) {
    await _supa.from('appointment_recordings').delete().eq('id', id);
  },

  // ── CONCIERGE TASKS ──────────────────────────────────────────

  async getConciergeTasksAndLogs() {
    const pid = await DB.patientId();
    if (!pid) return { tasks: [], logs: [] };
    const [tasksRes, logsRes] = await Promise.all([
      _supa.from('concierge_tasks').select('*').eq('patient_id', pid).order('created_at', { ascending: false }),
      _supa.from('concierge_log').select('*').eq('patient_id', pid).order('log_datetime', { ascending: false })
    ]);
    return { tasks: tasksRes.data || [], logs: logsRes.data || [] };
  },

  async saveConciergeTask(task) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (task.id) {
      const { error } = await _supa.from('concierge_tasks').update({
        title: task.title, contact: task.contact || null,
        category: task.cat || task.category || 'other',
        priority: task.priority || 'normal',
        due_date: task.due || null,
        notes: task.notes || null,
        done: !!task.done, done_at: task.doneAt || task.done_at || null
      }).eq('id', task.id);
      if (error) throw error;
    } else {
      const { data, error } = await _supa.from('concierge_tasks').insert({
        patient_id: pid,
        title: task.title, contact: task.contact || null,
        category: task.cat || task.category || 'other',
        priority: task.priority || 'normal',
        due_date: task.due || null,
        notes: task.notes || null,
        done: false
      }).select().single();
      if (error) throw error;
      return data;
    }
  },

  async deleteConciergeTask(id) {
    await _supa.from('concierge_tasks').delete().eq('id', id);
  },

  async saveConciergeLog(entry) {
    const pid = await DB.patientId();
    if (!pid) return;
    const { data, error } = await _supa.from('concierge_log').insert({
      patient_id: pid,
      log_datetime: entry.datetime || new Date().toISOString(),
      log_type: entry.type || null,
      contact: entry.contact || null,
      person: entry.person || null,
      notes: entry.notes || null,
      outcome: entry.outcome || 'resolved',
      ref_num: entry.ref || null,
      followup_date: entry.followup || null
    }).select().single();
    if (error) throw error;
    return data;
  },

  async deleteConciergeLog(id) {
    await _supa.from('concierge_log').delete().eq('id', id);
  },

  // ── MIGRATION ────────────────────────────────────────────────
  /**
   * One-time migration: pull everything from localStorage and
   * push to Supabase, then clear localStorage.
   * Call this once after first login on an existing device.
   */
  async migrateFromLocalStorage() {
    const pid = await DB.patientId();
    if (!pid) return;

    const get = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };

    // Profile
    const profile = get('advocate_lab_profile');
    if (profile?.name) {
      await DB.saveProfile({
        name: profile.name,
        age: profile.age || null,
        diagnoses: profile.diagnoses || null,
        meds: profile.meds || null,
        notes: profile.notes || null
      });
    }

    // Symptom config
    const symState = get('advocate_symptoms');
    if (symState?.trackedSymptoms?.length) {
      await DB.saveSymptomConfig(symState.trackedSymptoms);
    }

    // Symptom entries
    const entries = get('advocate_entries') || [];
    for (const e of entries) {
      await DB.upsertSymptomEntry(e);
    }

    // Medications
    const meds = get('advocate_medications') || [];
    for (const m of meds) {
      const { id: _, ...fields } = m;
      await DB.saveMedication(fields);
    }

    // Lab results
    const labs = get('advocate_lab_entries') || [];
    for (const l of labs) {
      const { id: _, ...fields } = l;
      await DB.saveLabResult(fields);
    }

    // Diagnostic tests
    const tests = get('advocate_testing') || [];
    for (const t of tests) {
      const { id: _, ...fields } = t;
      await DB.saveDiagnosticTest(fields);
    }

    // Timeline
    const timeline = get('advocate_timeline') || [];
    for (const e of timeline) {
      const { id: _, ...fields } = e;
      await DB.saveTimelineEvent(fields);
    }

    // Flares
    const flares = get('advocate_flares') || [];
    for (const f of flares) {
      const { id: _, ...fields } = f;
      await DB.saveFlare(fields);
    }

    // Care team
    const contacts = get('advocate_contacts') || [];
    for (const c of contacts) {
      const { id: _, ...fields } = c;
      await DB.saveContact(fields);
    }

    // Documents
    const docs = get('advocate_documents') || [];
    for (const d of docs) {
      const { id: _, ...fields } = d;
      await DB.saveDocument(fields);
    }

    // Research
    const research = get('advocate_research_library') || [];
    for (const r of research) {
      const { id: _, ...fields } = r;
      await DB.saveResearchItem(fields);
    }

    // Mark migration complete
    localStorage.setItem('advocate_migrated_to_supabase', '1');
    console.log('[MedAdvocate] localStorage → Supabase migration complete');
  },

  // ============================================================
  // BACKGROUND AI  (shared by labs, testing, summary, …)
  // ------------------------------------------------------------
  // Heavy AI calls (large documents, long generations) can exceed the
  // synchronous proxy's ~26s limit and 504 silently. This routes them through
  // the same two-step background pattern the Document Interpreter uses:
  //   1. insert an analysis_jobs row
  //   2. fire claude-proxy-background (returns 202 immediately, runs up to ~15m)
  //   3. poll the row until the result is written back, then delete it (PHI)
  // Returns the raw Anthropic response object — callers read result.content[0].text
  // exactly as they did from the sync proxy, so only the transport changes.
  //
  // `onProgress(label)` is optional — called with calm status strings as the
  // job moves from "submitted" to "still working" so the page can reassure.
  // Throws an Error with a friendly, non-alarming `.message` on failure.
  async runBackgroundAI({ system, messages, model, max_tokens, onProgress } = {}) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const pid = await DB.patientId();
    if (!pid) {
      DB._notifyNoPatient();
      throw new Error('We couldn’t find your patient profile — please sign in again and try once more.');
    }

    // Best-effort sweep of abandoned rows (>1h) so PHI doesn't accumulate.
    try {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await _supa.from('analysis_jobs').delete().eq('patient_id', pid).lt('created_at', cutoff);
    } catch (e) { /* table may lack created_at / delete denied — never block the call */ }

    // 1. Insert the job row the background function will write back to.
    const { data: jobRow, error: insErr } = await _supa
      .from('analysis_jobs')
      .insert({ patient_id: pid, status: 'pending' })
      .select('id')
      .single();
    if (insErr || !jobRow) {
      throw new Error('We couldn’t start the analysis just now. Give it a moment and try again.');
    }
    const jobId = jobRow.id;

    const cleanup = async () => {
      try { await _supa.from('analysis_jobs').delete().eq('id', jobId); } catch (e) {}
    };

    if (onProgress) onProgress('submitted');

    // 2. Fire the background function — 202 means "accepted and running".
    const resp = await fetch('/.netlify/functions/claude-proxy-background', {
      method: 'POST',
      headers: await aiHeaders(),
      body: JSON.stringify({ job_id: jobId, systemPrompt: system, messages, model, max_tokens })
    });
    // ── TEMP DIAGNOSTIC — remove after debugging ──────────────────────
    console.log('[runBackgroundAI] bg fetch status:', resp.status, resp.statusText);
    if (resp.status !== 202) {
      let _diagBody = '';
      try { _diagBody = await resp.clone().text(); } catch (e) { _diagBody = '(could not read body: ' + e.message + ')'; }
      console.log('[runBackgroundAI] bg fetch body:', _diagBody);
    }
    // ── END TEMP DIAGNOSTIC ───────────────────────────────────────────
    if (resp.status === 401) {
      await cleanup();
      throw new Error('You’ve been signed out. Sign in again and we’ll pick right back up.');
    }
    if (!resp.ok && resp.status !== 202) {
      await cleanup();
      throw new Error('We couldn’t start the analysis just now. Give it a moment and try again.');
    }

    // 3. Poll the row: immediately, then every 2s, up to 180s.
    const POLL_MS = 2000;
    const TIMEOUT_MS = 180000;
    const start = Date.now();
    let warned = false;
    while (true) {
      let data;
      try {
        const res = await _supa.from('analysis_jobs').select('status, result, error').eq('id', jobId).single();
        if (res.error) throw res.error;
        data = res.data;
      } catch (e) {
        // Transient read hiccup — the job is still safe; keep polling.
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error('This is taking a little longer than usual — your analysis is still safe. Please try again in a moment.');
        }
        await sleep(POLL_MS);
        continue;
      }
      if (data.status === 'complete') {
        await cleanup();
        return data.result;
      }
      if (data.status === 'error') {
        await cleanup();
        const code = (data.error || '').match(/error\s+(\d{3})/i);
        if (code && (code[1] === '429' || code[1] === '529')) {
          throw new Error('Things are a little busy right now. Give it a few seconds, then try again.');
        }
        throw new Error('The analysis didn’t finish. Please try again — your information is safe.');
      }
      if (!warned && Date.now() - start > 20000) {
        warned = true;
        if (onProgress) onProgress('working');
      }
      if (Date.now() - start > TIMEOUT_MS) {
        // Don't delete — the job may still complete; the next attempt sweeps it.
        throw new Error('This is taking a little longer than usual — your analysis is still safe. Please try again in a moment.');
      }
      await sleep(POLL_MS);
    }
  }
};

// ============================================================
// UI AUTH BAR HELPER
// Call renderAuthBar('nav-container-id') on any page to show
// the current user email + sign-out button in the nav.
// ============================================================
async function renderAuthBar(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const user = await Auth.user();
  if (!user) {
    container.innerHTML = `<a href="advocate-login.html" style="font-size:13px;color:var(--ink-muted);text-decoration:none;padding:7px 14px;border:1px solid var(--border,#dde);border-radius:100px">Sign in</a>`;
    return;
  }
  const patients = await DB.getPatients();
  const activePid = await DB.patientId();
  const patientOptions = patients.map(p =>
    `<option value="${p.id}" ${p.id === activePid ? 'selected' : ''}>${p.name}</option>`
  ).join('');

  // Inject mobile-responsive styles once per page
  if (!document.getElementById('auth-bar-styles')) {
    const s = document.createElement('style');
    s.id = 'auth-bar-styles';
    s.textContent = '@media(max-width:600px){.auth-bar-email{display:none!important}.auth-bar-inner{gap:6px!important}}';
    document.head.appendChild(s);
  }

  container.innerHTML = `
    <div class="auth-bar-inner" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${patients.length > 1 ? `
        <select onchange="DB.switchPatient(this.value).then(()=>window.location.reload())"
          style="font-size:12px;padding:5px 10px;border:1px solid var(--border,#dde);border-radius:8px;background:transparent;color:inherit">
          ${patientOptions}
        </select>` : `<span style="font-size:12px;color:var(--ink-muted,#888)">${patients[0]?.name || ''}</span>`
      }
      <span class="auth-bar-email" style="font-size:11px;color:var(--ink-muted,#888)">${user.email}</span>
      <button onclick="Auth.signOut()"
        style="font-size:12px;padding:5px 12px;border:1px solid var(--border,#dde);border-radius:100px;background:transparent;cursor:pointer;color:inherit">
        Sign out
      </button>
    </div>`;
}
