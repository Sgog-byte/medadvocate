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

  /**
   * Guard: call at top of every protected page.
   * Redirects to login if not authenticated.
   */
  async requireAuth() {
    const user = await Auth.user();
    if (!user) {
      window.location.href = 'advocate-login.html?next=' + encodeURIComponent(window.location.pathname);
      return null;
    }
    return user;
  }
};

// ============================================================
// PATIENT / PROFILE HELPERS
// ============================================================

const DB = {
  // ── internal cache ──
  _patientId: null,

  /** Get or create the active patient ID for the current user */
  async patientId() {
    if (DB._patientId) return DB._patientId;

    // Check user_settings for active patient
    const { data: settings } = await _supa
      .from('user_settings')
      .select('active_patient_id')
      .single();

    if (settings?.active_patient_id) {
      DB._patientId = settings.active_patient_id;
      return DB._patientId;
    }

    // Fall back to default patient
    const { data: patients } = await _supa
      .from('patients')
      .select('id')
      .eq('is_default', true)
      .limit(1);

    if (patients?.length) {
      DB._patientId = patients[0].id;
      return DB._patientId;
    }

    return null;
  },

  /** Switch active patient */
  async switchPatient(patientId) {
    DB._patientId = patientId;
    await _supa
      .from('user_settings')
      .upsert({ user_id: (await Auth.user()).id, active_patient_id: patientId });
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

  async setSymptomConfig(symptoms) {
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
      .order('entry_date', { ascending: true })
      .limit(limit);
    return (data || []).map(row => ({
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

  // ── DIAGNOSTIC TESTS ────────────────────────────────────────

  async getDiagnosticTests() {
    const pid = await DB.patientId();
    if (!pid) return [];
    const { data } = await _supa
      .from('diagnostic_tests')
      .select('*')
      .eq('patient_id', pid)
      .order('test_date', { ascending: false });
    return data || [];
  },

  async saveDiagnosticTest(test) {
    const pid = await DB.patientId();
    if (!pid) return;
    if (test.id) {
      await _supa.from('diagnostic_tests').update({
        test_name: test.name || test.test_name,
        test_type: test.type || test.test_type,
        test_date: test.date || test.test_date,
        result: test.result, ordering_doctor: test.doctor || test.ordering_doctor,
        facility: test.facility, notes: test.notes
      }).eq('id', test.id);
    } else {
      await _supa.from('diagnostic_tests').insert({
        patient_id: pid,
        test_name: test.name || test.test_name,
        test_type: test.type || test.test_type || null,
        test_date: test.date || test.test_date || null,
        result: test.result || null,
        ordering_doctor: test.doctor || test.ordering_doctor || null,
        facility: test.facility || null, notes: test.notes || null
      });
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
    return data || [];
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
      await _supa.from('research_library').insert({
        patient_id: pid,
        title: item.title, content: item.content || null,
        source_url: item.url || item.source_url || null,
        category: item.category || null, notes: item.notes || null
      });
    }
  },

  async deleteResearchItem(id) {
    await _supa.from('research_library').delete().eq('id', id);
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
      await DB.setSymptomConfig(symState.trackedSymptoms);
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
    const tests = get('advocate_tests') || [];
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

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${patients.length > 1 ? `
        <select onchange="DB.switchPatient(this.value).then(()=>window.location.reload())"
          style="font-size:12px;padding:5px 10px;border:1px solid var(--border,#dde);border-radius:8px;background:transparent;color:inherit">
          ${patientOptions}
        </select>` : `<span style="font-size:12px;color:var(--ink-muted,#888)">${patients[0]?.name || ''}</span>`
      }
      <span style="font-size:11px;color:var(--ink-muted,#888)">${user.email}</span>
      <button onclick="Auth.signOut()"
        style="font-size:12px;padding:5px 12px;border:1px solid var(--border,#dde);border-radius:100px;background:transparent;cursor:pointer;color:inherit">
        Sign out
      </button>
    </div>`;
}
