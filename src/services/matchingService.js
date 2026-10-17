import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";

// Helper to chunk arrays for Supabase 'in' queries to avoid URL length limits
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export async function fetchEligibleUsers() {
  const { data: users, error: userErr } = await supabase
    .from("users")
    .select("id")
    .eq("onboarding_completed", true)
    .eq("ready_to_be_matched", true);

  if (userErr) throw new ApiError(500, "Error fetching users for matching", { details: userErr });
  if (!users || users.length === 0) return { males: [], females: [] };

  const userIds = users.map((u) => u.id);
  const chunks = chunkArray(userIds, 200);

  let profiles = [];
  let preferences = [];
  let focuses = [];
  let builds = [];

  for (const chunk of chunks) {
    const [
      { data: pData },
      { data: prefData },
      { data: fData },
      { data: bData }
    ] = await Promise.all([
      supabase.from("user_profiles").select("*").in("user_id", chunk),
      supabase.from("preferences").select("*").in("user_id", chunk),
      supabase.from("user_focuses").select("*").in("user_id", chunk),
      supabase.from("preferred_builds").select("*").in("user_id", chunk)
    ]);

    if (pData) profiles.push(...pData);
    if (prefData) preferences.push(...prefData);
    if (fData) focuses.push(...fData);
    if (bData) builds.push(...bData);
  }

  // Group everything by user_id
  const usersMap = {};
  for (const uid of userIds) {
    usersMap[uid] = { id: uid, focuses: [], preferred_builds: [] };
  }

  for (const p of profiles) {
    if (usersMap[p.user_id]) usersMap[p.user_id].profile = p;
  }
  for (const pref of preferences) {
    if (usersMap[pref.user_id]) usersMap[pref.user_id].preferences = pref;
  }
  for (const f of focuses) {
    if (usersMap[f.user_id]) usersMap[f.user_id].focuses.push(f.focus_option);
  }
  for (const b of builds) {
    if (usersMap[b.user_id]) usersMap[b.user_id].preferred_builds.push(b.preferred_build);
  }

  const males = [];
  const females = [];

  // Sort into gender buckets
  for (const uid of userIds) {
    const userObj = usersMap[uid];
    if (!userObj.profile || !userObj.preferences) continue; // Ensure they have the required data

    const gender = userObj.profile.gender?.toLowerCase();
    if (gender === "male") males.push(userObj);
    else if (gender === "female") females.push(userObj);
  }

  return { males, females };
}

export async function getPastMatches() {
  const { data, error } = await supabase
    .from("matches")
    .select("user1_id, user2_id");

  if (error) throw new ApiError(500, "Error fetching past matches", { details: error });
  
  const pastPairs = new Set();
  if (data) {
    for (const match of data) {
      // Store a unique key for the pair regardless of order
      const key = [match.user1_id, match.user2_id].sort().join("|");
      pastPairs.add(key);
    }
  }
  return pastPairs;
}

function calculateScore(male, female) {
  const mProf = male.profile;
  const fProf = female.profile;
  const mPref = male.preferences;
  const fPref = female.preferences;

  // --- HARD FILTERS (Dealbreakers) ---
  // Age Check
  if (mPref.preferred_min_age && fProf.age != null && fProf.age < mPref.preferred_min_age) return 0;
  if (mPref.preferred_max_age && fProf.age != null && fProf.age > mPref.preferred_max_age) return 0;
  if (fPref.preferred_min_age && mProf.age != null && mProf.age < fPref.preferred_min_age) return 0;
  if (fPref.preferred_max_age && mProf.age != null && mProf.age > fPref.preferred_max_age) return 0;

  // Height Check
  if (mPref.preferred_min_height && fProf.height != null && fProf.height < mPref.preferred_min_height) return 0;
  if (mPref.preferred_max_height && fProf.height != null && fProf.height > mPref.preferred_max_height) return 0;
  if (fPref.preferred_min_height && mProf.height != null && mProf.height < fPref.preferred_min_height) return 0;
  if (fPref.preferred_max_height && mProf.height != null && mProf.height > fPref.preferred_max_height) return 0;

  // Build Check
  if (male.preferred_builds.length > 0 && fProf.build != null && !male.preferred_builds.includes(fProf.build)) return 0;
  if (female.preferred_builds.length > 0 && mProf.build != null && !female.preferred_builds.includes(mProf.build)) return 0;

  // --- SOFT FILTERS (Affinity Scoring) ---
  let score = 50; // Base score for passing hard filters

  // 1. Focuses overlap
  const sharedFocuses = male.focuses.filter(f => female.focuses.includes(f));
  score += sharedFocuses.length * 10;

  // 2. Personality/Vibe overlaps
  if (mProf.weekend_type === fProf.weekend_type) score += 5;
  if (mProf.social_persona === fProf.social_persona) score += 5;
  if (mProf.conflict_style === fProf.conflict_style) score += 5;
  if (mProf.relationship_goal === fProf.relationship_goal) score += 10;

  return Math.min(score, 100); // Cap at 100
}

export function galeShapley(males, females, pastPairs) {
  // 1. Build Preference Lists
  const malePrefs = {};
  const femalePrefs = {};

  for (const m of males) {
    malePrefs[m.id] = [];
    for (const f of females) {
      const pairKey = [m.id, f.id].sort().join("|");
      if (pastPairs.has(pairKey)) continue; // Skip past matches

      const score = calculateScore(m, f);
      if (score > 0) {
        malePrefs[m.id].push({ id: f.id, score });
      }
    }
    // Sort females by score descending
    malePrefs[m.id].sort((a, b) => b.score - a.score);
  }

  for (const f of females) {
    femalePrefs[f.id] = {};
    for (const m of males) {
      const pairKey = [m.id, f.id].sort().join("|");
      if (pastPairs.has(pairKey)) continue;

      const score = calculateScore(m, f);
      if (score > 0) {
        femalePrefs[f.id][m.id] = score; // Fast lookup for female preference
      }
    }
  }

  // 2. Gale-Shapley Execution
  const freeMales = males.filter(m => malePrefs[m.id].length > 0).map(m => m.id);
  const engagements = {}; // femaleId -> { maleId, score }
  const nextProposals = {}; // maleId -> index of next female to propose to
  
  for (const m of males) nextProposals[m.id] = 0;

  while (freeMales.length > 0) {
    const mId = freeMales[0];
    const preferences = malePrefs[mId];
    const proposalIndex = nextProposals[mId];

    if (proposalIndex >= preferences.length) {
      freeMales.shift(); // Man has no more women to propose to
      continue;
    }

    const targetFemale = preferences[proposalIndex];
    nextProposals[mId]++;

    const fId = targetFemale.id;
    const mScore = femalePrefs[fId][mId];

    if (!engagements[fId]) {
      // Female is free
      engagements[fId] = { maleId: mId, score: mScore };
      freeMales.shift(); // Man is engaged
    } else {
      // Female is currently engaged, compare scores
      const currentFiance = engagements[fId];
      if (mScore > currentFiance.score) {
        // Female dumps current fiance for the new guy
        freeMales.shift(); // New guy is engaged
        freeMales.push(currentFiance.maleId); // Old guy is free again
        engagements[fId] = { maleId: mId, score: mScore };
      }
      // Else, female rejects new guy, he remains free and loops again
    }
  }

  // 3. Format final matches
  const finalMatches = [];
  for (const [fId, engagement] of Object.entries(engagements)) {
    // Both malePrefs and engagements stored the one-sided score, let's just use it or recalculate
    finalMatches.push({
      user1_id: engagement.maleId,
      user2_id: fId,
      match_score: engagement.score,
    });
  }

  return finalMatches;
}

export function getMatchWeekDate(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// Expires last week's pending matches and inserts this week's in one
// transaction (see migrations/002_weekly_matches.sql). No-op if this week
// already has matches, so repeated triggers are safe.
export async function saveWeeklyMatches(matches, week = getMatchWeekDate(new Date())) {
  const { data, error } = await supabase.rpc("replace_weekly_matches", {
    p_week: week,
    p_matches: matches.map(m => ({
      user1_id: m.user1_id,
      user2_id: m.user2_id,
      match_score: m.match_score,
    })),
  });

  if (error) {
    throw new ApiError(500, "Unable to save matches", { details: error });
  }
  return { week, ...data };
}

// Throws on failure so callers (admin endpoint, scheduler) can report it.
export async function runMatchingCycle() {
  console.log("[Matching Cycle] Starting...");
  const { males, females } = await fetchEligibleUsers();
  console.log(`[Matching Cycle] Found ${males.length} males and ${females.length} females.`);

  const pastPairs = await getPastMatches();

  const newMatches = galeShapley(males, females, pastPairs);
  console.log(`[Matching Cycle] Generated ${newMatches.length} matches.`);

  const result = await saveWeeklyMatches(newMatches);
  console.log(`[Matching Cycle] ${result.status} for week ${result.week}: ${result.inserted} matches saved.`);
  return { eligible: { males: males.length, females: females.length }, generated: newMatches.length, ...result };
}
