#!/usr/bin/env node
// ============================================================
// patch-pages.js
// Patches all MedAdvocate tool pages to use Supabase instead
// of localStorage. Run once: node patch-pages.js
// ============================================================

const fs = require('fs');
const path = require('path');

// Supabase CDN + client injection — goes right before </head>
const SUPABASE_SCRIPTS = `  <!-- Supabase auth + data layer -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="supabase-client.js"></script>`;

// Auth guard — goes right after <script> opens in the page's first <script> block
// We'll inject it as an IIFE that redirects if not authed
const AUTH_GUARD = `
  // ── Supabase auth guard ──────────────────────────────────────
  (async function() {
    const user = await Auth.requireAuth();
    if (!user) return; // redirected to login
    // Migrate localStorage data once on first login
    if (!localStorage.getItem('advocate_migrated_to_supabase') &&
        localStorage.getItem('advocate_lab_profile')) {
      await DB.migrateFromLocalStorage();
    }
  })();
  // ────────────────────────────────────────────────────────────
`;

// localStorage key → DB method mapping
// Each entry: [regex to match, replacement string]
// These replace the common get/save function bodies
const REPLACEMENTS = [
  // ── advocate_symptoms (symptom config) ──
  {
    match: /function getSymptomState\(\)\s*\{[^}]+\}/g,
    replace: `async function getSymptomState() {
      const syms = await DB.getSymptomConfig();
      return { trackedSymptoms: syms.map(s => ({ id: s.symptom_id, label: s.label, icon: s.icon, custom: s.is_custom })) };
    }`
  },

  // ── advocate_entries (symptom daily logs) ──
  {
    match: /JSON\.parse\(localStorage\.getItem\('advocate_entries'\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getSymptomEntries())`
  },

  // ── advocate_lab_profile ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_lab_profile['"]\)\s*\|\|\s*['"]?\{\}['"]?\)/g,
    replace: `(await DB.getProfile())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_lab_profile['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `await DB.saveProfile($1)`
  },

  // ── advocate_medications ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_medications['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getMedications())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_medications['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveMedication() */`
  },

  // ── advocate_lab_entries ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_lab_entries['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getLabResults())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_lab_entries['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveLabResult() */`
  },

  // ── advocate_tests ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_tests['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getDiagnosticTests())`
  },

  // ── advocate_timeline ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_timeline['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getTimelineEvents())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_timeline['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveTimelineEvent() */`
  },

  // ── advocate_flares ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_flares['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getFlares())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_flares['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveFlare() */`
  },

  // ── advocate_contacts ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_contacts['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getCareTeam())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_contacts['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveContact() */`
  },

  // ── advocate_documents ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_documents['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getDocuments())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_documents['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveDocument() */`
  },

  // ── advocate_research_library ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_research_library['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getResearchLibrary())`
  },
  {
    match: /localStorage\.setItem\(['"]advocate_research_library['"],\s*JSON\.stringify\(([^)]+)\)\)/g,
    replace: `/* saved via DB.saveResearchItem() */`
  },

  // ── advocate_scripts ──
  {
    match: /JSON\.parse\(localStorage\.getItem\(['"]advocate_scripts['"]\)\s*\|\|\s*'\[\]'\)/g,
    replace: `(await DB.getSavedScripts())`
  }
];

// Pages to patch
const TOOL_PAGES = [
  'advocate-app.html',
  'advocate-careteam.html',
  'advocate-concierge.html',
  'advocate-documents.html',
  'advocate-er.html',
  'advocate-explain.html',
  'advocate-flare.html',
  'advocate-iep.html',
  'advocate-insurance.html',
  'advocate-labs.html',
  'advocate-medications.html',
  'advocate-myadvocate.html',
  'advocate-recorder.html',
  'advocate-research.html',
  'advocate-scripts.html',
  'advocate-summary.html',
  'advocate-symptoms.html',
  'advocate-testing.html',
  'advocate-timeline.html',
  'index.html'
];

let patched = 0;
let skipped = 0;

for (const page of TOOL_PAGES) {
  const filePath = path.join(__dirname, page);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️  Not found: ${page}`);
    skipped++;
    continue;
  }

  let html = fs.readFileSync(filePath, 'utf8');

  // Skip if already patched
  if (html.includes('supabase-client.js')) {
    console.log(`  ✓  Already patched: ${page}`);
    skipped++;
    continue;
  }

  // 1. Inject Supabase scripts before </head>
  html = html.replace('</head>', SUPABASE_SCRIPTS + '\n</head>');

  // 2. Apply localStorage → DB replacements
  for (const { match, replace } of REPLACEMENTS) {
    html = html.replace(match, replace);
  }

  // 3. Save
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✅  Patched: ${page}`);
  patched++;
}

console.log(`\nDone. ${patched} pages patched, ${skipped} skipped.`);
console.log('\nNext steps:');
console.log('  1. Run the SQL in db-schema.sql in your Supabase SQL editor');
console.log('  2. Replace YOUR_NEW_ANON_KEY in supabase-client.js with your rotated key');
console.log('  3. Add each tool page\'s save functions to use DB.save*() methods');
console.log('  4. Set SUPABASE_URL and SUPABASE_KEY in Netlify environment variables');
console.log('  5. Deploy and test login flow at /advocate-login.html');
