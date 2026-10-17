import { setEnv } from "./helpers/env.js";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFetchStub, pgError } from "./helpers/fetchStub.js";
import {
  galeShapley,
  saveWeeklyMatches,
  runMatchingCycle,
  getMatchWeekDate,
} from "../src/services/matchingService.js";
import { ApiError } from "../src/utils/apiError.js";

// ---------------------------------------------------------------------------
// Fixtures for the pure algorithm
// ---------------------------------------------------------------------------

function person(id, gender, { profile = {}, preferences = {}, focuses = [], preferred_builds = [] } = {}) {
  return {
    id,
    profile: {
      user_id: id,
      gender,
      age: 25,
      height: 68,
      build: "average",
      weekend_type: "outdoors",
      social_persona: "ambivert",
      conflict_style: "talk",
      relationship_goal: "long_term",
      ...profile,
    },
    preferences: { user_id: id, ...preferences },
    focuses,
    preferred_builds,
  };
}

const man = (id, opts) => person(id, "male", opts);
const woman = (id, opts) => person(id, "female", opts);
const pairKey = (a, b) => [a, b].sort().join("|");

function assertEachUserOnce(matches) {
  const seen = new Set();
  for (const m of matches) {
    assert.ok(!seen.has(m.user1_id), `${m.user1_id} matched twice`);
    assert.ok(!seen.has(m.user2_id), `${m.user2_id} matched twice`);
    seen.add(m.user1_id);
    seen.add(m.user2_id);
  }
}

describe("galeShapley (regression baseline)", () => {
  test("pairs compatible men and women; user1 is always the man, user2 the woman", () => {
    const males = [man("m1"), man("m2")];
    const females = [woman("f1"), woman("f2")];
    const result = galeShapley(males, females, new Set());

    assert.equal(result.length, 2);
    assertEachUserOnce(result);
    for (const m of result) {
      assert.ok(["m1", "m2"].includes(m.user1_id));
      assert.ok(["f1", "f2"].includes(m.user2_id));
      assert.equal(typeof m.match_score, "number");
    }
  });

  test("score: 50 base + 10 per shared focus + vibe bonuses, capped at 100", () => {
    // Identical vibes: 50 + 5 + 5 + 5 + 10 = 75; plus one shared focus = 85.
    const [match] = galeShapley(
      [man("m1", { focuses: ["career", "fitness"] })],
      [woman("f1", { focuses: ["career", "travel"] })],
      new Set()
    );
    assert.equal(match.match_score, 85);

    // Different vibes, no focus overlap: base only.
    const [baseOnly] = galeShapley(
      [man("m1", { profile: { weekend_type: "a", social_persona: "a", conflict_style: "a", relationship_goal: "a" } })],
      [woman("f1", { profile: { weekend_type: "b", social_persona: "b", conflict_style: "b", relationship_goal: "b" } })],
      new Set()
    );
    assert.equal(baseOnly.match_score, 50);

    const many = ["a", "b", "c", "d", "e"];
    const [capped] = galeShapley([man("m1", { focuses: many })], [woman("f1", { focuses: many })], new Set());
    assert.equal(capped.match_score, 100);
  });

  test("prefers the higher-scoring partner", () => {
    const males = [man("m1", { focuses: ["x", "y"] })];
    const females = [woman("f_low"), woman("f_high", { focuses: ["x", "y"] })];
    const [match] = galeShapley(males, females, new Set());
    assert.equal(match.user2_id, "f_high");
  });

  test("a woman trades up when a better-scoring man proposes later", () => {
    // m1 proposes first and is engaged to f1, then m2 (higher score with f1) displaces him.
    const males = [man("m1"), man("m2", { focuses: ["x"] })];
    const females = [woman("f1", { focuses: ["x"] })];
    const result = galeShapley(males, females, new Set());
    assert.deepEqual(
      result.map((m) => [m.user1_id, m.user2_id]),
      [["m2", "f1"]]
    );
  });

  describe("hard filters (dealbreakers) produce no pairing", () => {
    const cases = [
      ["woman too young for him", { m: { preferences: { preferred_min_age: 30 } }, f: { profile: { age: 22 } } }],
      ["woman too old for him", { m: { preferences: { preferred_max_age: 24 } }, f: { profile: { age: 30 } } }],
      ["man too young for her", { f: { preferences: { preferred_min_age: 30 } }, m: { profile: { age: 22 } } }],
      ["man too old for her", { f: { preferences: { preferred_max_age: 24 } }, m: { profile: { age: 30 } } }],
      ["man too short for her", { f: { preferences: { preferred_min_height: 72 } }, m: { profile: { height: 66 } } }],
      ["man too tall for her", { f: { preferences: { preferred_max_height: 70 } }, m: { profile: { height: 75 } } }],
      ["woman too short for him", { m: { preferences: { preferred_min_height: 66 } }, f: { profile: { height: 60 } } }],
      ["woman too tall for him", { m: { preferences: { preferred_max_height: 66 } }, f: { profile: { height: 70 } } }],
      ["her build not in his list", { m: { preferred_builds: ["athletic"] }, f: { profile: { build: "curvy" } } }],
      ["his build not in her list", { f: { preferred_builds: ["athletic"] }, m: { profile: { build: "slim" } } }],
    ];

    for (const [name, { m = {}, f = {} }] of cases) {
      test(name, () => {
        assert.deepEqual(galeShapley([man("m1", m)], [woman("f1", f)], new Set()), []);
      });
    }

    test("filters pass when the other side's attribute is unknown (null)", () => {
      const result = galeShapley(
        [man("m1", { preferences: { preferred_min_age: 30 }, preferred_builds: ["athletic"] })],
        [woman("f1", { profile: { age: null, build: null } })],
        new Set()
      );
      assert.equal(result.length, 1);
    });

    test("a dealbreaker with one woman lets him match another", () => {
      const result = galeShapley(
        [man("m1", { preferences: { preferred_max_age: 26 } })],
        [woman("f_old", { profile: { age: 40 } }), woman("f_ok", { profile: { age: 25 } })],
        new Set()
      );
      assert.deepEqual(result.map((r) => r.user2_id), ["f_ok"]);
    });
  });

  test("past pairs are never re-matched", () => {
    const past = new Set([pairKey("m1", "f1")]);
    assert.deepEqual(galeShapley([man("m1")], [woman("f1")], past), []);

    // Key order must not matter.
    const pastReversed = new Set([["f1", "m1"].sort().join("|")]);
    assert.deepEqual(galeShapley([man("m1")], [woman("f1")], pastReversed), []);
  });

  test("a past pair is skipped in favour of a new partner, even if it scored higher", () => {
    const males = [man("m1", { focuses: ["x"] })];
    const females = [woman("f_past", { focuses: ["x"] }), woman("f_new")];
    const result = galeShapley(males, females, new Set([pairKey("m1", "f_past")]));
    assert.deepEqual(result.map((r) => r.user2_id), ["f_new"]);
  });

  test("men<->women only: no same-gender matches are produced", () => {
    assert.deepEqual(galeShapley([man("m1"), man("m2")], [], new Set()), []);
    assert.deepEqual(galeShapley([], [woman("f1"), woman("f2")], new Set()), []);
  });

  test("unequal groups: each user appears at most once", () => {
    const males = [man("m1"), man("m2"), man("m3", { focuses: ["x"] })];
    const females = [woman("f1", { focuses: ["x"] })];
    const result = galeShapley(males, females, new Set());
    assert.equal(result.length, 1);
    assertEachUserOnce(result);
  });

  test("larger random population: valid, one-to-one, no past pairs, no blocking pairs", () => {
    // Deterministic PRNG so failures are reproducible.
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const focusPool = ["career", "fitness", "travel", "faith", "music", "food"];
    const gen = (id, g) =>
      person(id, g, {
        profile: {
          age: 20 + Math.floor(rand() * 15),
          height: 60 + Math.floor(rand() * 16),
          build: pick(["slim", "average", "athletic", "curvy"]),
          weekend_type: pick(["in", "out"]),
          social_persona: pick(["intro", "extro"]),
          conflict_style: pick(["talk", "space"]),
          relationship_goal: pick(["casual", "long_term"]),
        },
        preferences: rand() < 0.3 ? { preferred_max_age: 28 } : {},
        focuses: focusPool.filter(() => rand() < 0.4),
      });
    const males = Array.from({ length: 25 }, (_, i) => gen(`m${i}`, "male"));
    const females = Array.from({ length: 20 }, (_, i) => gen(`f${i}`, "female"));
    const past = new Set([pairKey("m0", "f0"), pairKey("m1", "f1"), pairKey("m2", "f3")]);

    const result = galeShapley(males, females, past);
    assert.ok(result.length > 0);
    assertEachUserOnce(result);

    const maleIds = new Set(males.map((m) => m.id));
    const femaleIds = new Set(females.map((f) => f.id));
    for (const m of result) {
      assert.ok(maleIds.has(m.user1_id));
      assert.ok(femaleIds.has(m.user2_id));
      assert.ok(!past.has(pairKey(m.user1_id, m.user2_id)));
      assert.ok(m.match_score > 0 && m.match_score <= 100);
    }

    // Stability: no man and woman both strictly prefer each other to their match.
    // Scores are symmetric, so score(m, f) from a 1x1 run is the pair's score.
    const score = (m, f) => galeShapley([m], [f], past)[0]?.match_score ?? 0;
    const partnerScore = new Map();
    for (const r of result) {
      partnerScore.set(r.user1_id, r.match_score);
      partnerScore.set(r.user2_id, r.match_score);
    }
    for (const m of males) {
      for (const f of females) {
        const s = score(m, f);
        if (s === 0) continue;
        const blocking = s > (partnerScore.get(m.id) ?? 0) && s > (partnerScore.get(f.id) ?? 0);
        assert.ok(!blocking, `blocking pair ${m.id}-${f.id} (${s})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Save step (Supabase RPC) — fetch stubbed
// ---------------------------------------------------------------------------

let stub;
beforeEach(() => {
  stub = installFetchStub();
});
afterEach(() => {
  stub.restore();
});

describe("saveWeeklyMatches", () => {
  const matches = [
    { user1_id: "m1", user2_id: "f1", match_score: 80, extra: "dropped" },
    { user1_id: "m2", user2_id: "f2", match_score: 55 },
  ];

  test("calls the replace_weekly_matches RPC with p_week and the match payload", async () => {
    stub.on({ rpc: "replace_weekly_matches", method: "POST" }, { status: "ok", inserted: 2 });

    const result = await saveWeeklyMatches(matches, "2026-10-12");

    assert.equal(stub.calls.length, 1, "exactly one request: the RPC (no separate expire + insert)");
    const [call] = stub.calls;
    assert.equal(call.path, "/rest/v1/rpc/replace_weekly_matches");
    assert.equal(call.method, "POST");
    assert.deepEqual(call.body, {
      p_week: "2026-10-12",
      p_matches: [
        { user1_id: "m1", user2_id: "f1", match_score: 80 },
        { user1_id: "m2", user2_id: "f2", match_score: 55 },
      ],
    });
    assert.deepEqual(result, { week: "2026-10-12", status: "ok", inserted: 2 });
  });

  test("passes through already_ran", async () => {
    stub.on({ rpc: "replace_weekly_matches" }, { status: "already_ran", inserted: 0 });
    const result = await saveWeeklyMatches([], "2026-10-12");
    assert.deepEqual(stub.calls[0].body, { p_week: "2026-10-12", p_matches: [] });
    assert.deepEqual(result, { week: "2026-10-12", status: "already_ran", inserted: 0 });
  });

  test("defaults p_week to this week's Monday (YYYY-MM-DD)", async () => {
    stub.on({ rpc: "replace_weekly_matches" }, { status: "ok", inserted: 0 });
    const result = await saveWeeklyMatches([]);
    assert.match(stub.calls[0].body.p_week, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(result.week, stub.calls[0].body.p_week);
    assert.equal(result.week, getMatchWeekDate(new Date()));
  });

  test("throws ApiError(500) when the RPC errors", async () => {
    stub.on({ rpc: "replace_weekly_matches" }, pgError("duplicate key", { status: 409, code: "23505" }));
    await assert.rejects(saveWeeklyMatches(matches, "2026-10-12"), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.statusCode, 500);
      assert.equal(err.details.details.code, "23505");
      return true;
    });
  });
});

describe("getMatchWeekDate", () => {
  test("returns the Monday of the week for midday dates (UTC)", () => {
    const restore = setEnv({ TZ: "UTC" });
    try {
      assert.equal(getMatchWeekDate(new Date("2026-10-16T12:00:00Z")), "2026-10-12"); // Friday
      assert.equal(getMatchWeekDate(new Date("2026-10-12T12:00:00Z")), "2026-10-12"); // Monday
      assert.equal(getMatchWeekDate(new Date("2026-10-18T12:00:00Z")), "2026-10-12"); // Sunday
    } finally {
      restore();
    }
  });

  // BUG (not fixed here; tests only): getMatchWeekDate computes the Monday in
  // the server's local time zone but formats it with toISOString() (UTC). On a
  // server east of UTC (e.g. TZ=Africa/Lagos, UTC+1), any time between local
  // midnight and 01:00 yields the previous *Sunday*. The scheduler fires at
  // exactly 00:00 Africa/Lagos on Friday, so on such a server p_week would be a
  // Sunday, while an admin-triggered run later the same week would send Monday;
  // replace_weekly_matches compares match_week = p_week, so it would not detect
  // that the week already ran and would create a second set of matches.
  test(
    "Friday 00:00 Africa/Lagos (cron time) maps to Monday, not Sunday",
    { todo: "BUG: getMatchWeekDate mixes local-time arithmetic with UTC formatting" },
    () => {
      const restore = setEnv({ TZ: "Africa/Lagos" });
      try {
        assert.equal(getMatchWeekDate(new Date("2026-10-16T00:00:00+01:00")), "2026-10-12");
      } finally {
        restore();
      }
    }
  );
});

describe("runMatchingCycle", () => {
  function stubEligibleUsers() {
    stub.on({ table: "users", method: "GET" }, [{ id: "m1" }, { id: "f1" }, { id: "x1" }]);
    stub.on({ table: "user_profiles", method: "GET" }, [
      { user_id: "m1", gender: "Male", age: 25, height: 70 },
      { user_id: "f1", gender: "female", age: 24, height: 64 },
      { user_id: "x1", gender: "female", age: 24, height: 64 }, // no preferences row -> skipped
    ]);
    stub.on({ table: "preferences", method: "GET" }, [{ user_id: "m1" }, { user_id: "f1" }]);
    stub.on({ table: "user_focuses", method: "GET" }, [
      { user_id: "m1", focus_option: "career" },
      { user_id: "f1", focus_option: "career" },
    ]);
    stub.on({ table: "preferred_builds", method: "GET" }, []);
    stub.on({ table: "matches", method: "GET" }, []);
  }

  test("happy path: fetches eligible users, matches them and saves via the RPC", async () => {
    stubEligibleUsers();
    stub.on({ rpc: "replace_weekly_matches" }, { status: "ok", inserted: 1 });

    const result = await runMatchingCycle();

    const [usersQuery] = stub.callsTo({ table: "users" });
    assert.equal(usersQuery.url.searchParams.get("onboarding_completed"), "eq.true");
    assert.equal(usersQuery.url.searchParams.get("ready_to_be_matched"), "eq.true");

    const [rpc] = stub.callsTo({ rpc: "replace_weekly_matches" });
    // 50 base + 10 shared focus + 25 vibe bonuses. Note: the vibe fields are
    // absent on both profiles, and undefined === undefined counts as a match.
    assert.deepEqual(rpc.body.p_matches, [{ user1_id: "m1", user2_id: "f1", match_score: 85 }]);
    assert.equal(stub.callsTo({ table: "matches", method: "PATCH" }).length, 0, "no non-atomic expire step");
    assert.equal(stub.callsTo({ table: "matches", method: "POST" }).length, 0, "no non-atomic insert step");

    assert.deepEqual(result.eligible, { males: 1, females: 1 });
    assert.equal(result.generated, 1);
    assert.equal(result.status, "ok");
    assert.equal(result.inserted, 1);
    assert.equal(result.week, rpc.body.p_week);
    assert.deepEqual(stub.unexpected, []);
  });

  test("propagates RPC errors instead of swallowing them", async () => {
    stubEligibleUsers();
    stub.on({ rpc: "replace_weekly_matches" }, pgError("function does not exist", { status: 404, code: "42883" }));
    await assert.rejects(runMatchingCycle(), (err) => err instanceof ApiError && err.statusCode === 500);
  });

  test("propagates errors fetching users", async () => {
    stub.on({ table: "users", method: "GET" }, pgError("permission denied", { status: 401 }));
    await assert.rejects(runMatchingCycle(), (err) => {
      assert.ok(err instanceof ApiError);
      assert.match(err.message, /fetching users/);
      return true;
    });
    assert.equal(stub.callsTo({ rpc: "replace_weekly_matches" }).length, 0);
  });

  test("propagates errors fetching past matches (and does not save)", async () => {
    stubEligibleUsers();
    stub.on({ table: "matches", method: "GET" }, pgError("timeout", { status: 400 }));
    await assert.rejects(runMatchingCycle(), (err) => err instanceof ApiError && /past matches/.test(err.message));
    assert.equal(stub.callsTo({ rpc: "replace_weekly_matches" }).length, 0);
  });

  test("past matches from the DB are excluded", async () => {
    stubEligibleUsers();
    stub.on({ table: "matches", method: "GET" }, [{ user1_id: "f1", user2_id: "m1" }]);
    stub.on({ rpc: "replace_weekly_matches" }, { status: "ok", inserted: 0 });
    const result = await runMatchingCycle();
    assert.equal(result.generated, 0);
    assert.deepEqual(stub.callsTo({ rpc: "replace_weekly_matches" })[0].body.p_matches, []);
  });
});
