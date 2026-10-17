import "./helpers/env.js";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installFetchStub, pgError } from "./helpers/fetchStub.js";
import { getCurrentMatch } from "../src/services/matchService.js";
import { ApiError } from "../src/utils/apiError.js";

const ME = "user-me";
const PARTNER = "user-partner";

const matchRow = {
  id: "match-1",
  user1_id: ME,
  user2_id: PARTNER,
  match_score: 85,
  match_week: "2026-10-12",
  status: "pending",
};

const partnerUser = { id: PARTNER, name: "Ada", whatsapp_number: "+2348000000000" };

const partnerProfile = {
  user_id: PARTNER,
  age: 26,
  height: 70, // inches
  build: "athletic",
  gender: "female",
  skin_tone: "dark",
  social_persona: "ambivert",
  weekend_type: "outdoors",
  conflict_style: "talk",
  relationship_goal: "long_term",
  instagram: "@ada",
  // fields that must NOT leak into the response
  phone_internal: "secret",
  created_at: "2026-01-01",
};

// Stored as storage paths in the private bucket; returned as signed URLs.
const photos = [
  { image_url: `${PARTNER}/1.jpg`, photo_type: "main", upload_order: 0 },
  { image_url: `${PARTNER}/2.jpg`, photo_type: "extra", upload_order: 1 },
];
const signedUrl = (path) =>
  `${process.env.SUPABASE_URL}/storage/v1/object/sign/user-photos/${path}?token=t`;
const signedPhotos = photos.map((p) => ({ ...p, image_url: signedUrl(p.image_url) }));

let stub;
beforeEach(() => {
  stub = installFetchStub();
});
afterEach(() => {
  stub.restore();
});

function stubPartnerData({ match = matchRow, user = partnerUser, profile = partnerProfile } = {}) {
  stub.on({ table: "matches", method: "GET" }, match ? [match] : []);
  stub.on({ table: "users", method: "GET" }, user ? [user] : []);
  stub.on({ table: "user_profiles", method: "GET" }, profile ? [profile] : []);
  stub.on({ table: "user_photos", method: "GET" }, photos);
  stub.on({ table: "user_focuses", method: "GET" }, [{ focus_option: "career" }, { focus_option: "faith" }]);
  stub.on({ pathIncludes: "/storage/v1/object/sign/" }, (req) =>
    req.body.paths.map((path) => ({
      path,
      error: null,
      signedURL: `/object/sign/user-photos/${path}?token=t`,
    }))
  );
}

describe("getCurrentMatch", () => {
  test("returns the documented shape with height converted inches -> cm", async () => {
    stubPartnerData();

    const result = await getCurrentMatch(ME);

    assert.deepEqual(result, {
      match_id: "match-1",
      match_score: 85,
      match_week: "2026-10-12",
      status: "pending",
      partner: {
        id: PARTNER,
        name: "Ada",
        whatsapp_number: "+2348000000000",
        profile: {
          age: 26,
          height: 178, // round(70 * 2.54 = 177.8)
          build: "athletic",
          gender: "female",
          skin_tone: "dark",
          social_persona: "ambivert",
          weekend_type: "outdoors",
          conflict_style: "talk",
          relationship_goal: "long_term",
          instagram: "@ada",
        },
        photos: signedPhotos,
        focuses: ["career", "faith"],
      },
    });
    assert.deepEqual(stub.unexpected, []);
  });

  test("queries the latest non-expired/cancelled match involving the user", async () => {
    stubPartnerData();
    await getCurrentMatch(ME);

    const [q] = stub.callsTo({ table: "matches" });
    const p = q.url.searchParams;
    assert.equal(p.get("or"), `(user1_id.eq.${ME},user2_id.eq.${ME})`);
    assert.equal(p.get("status"), "not.in.(expired,cancelled)");
    assert.equal(p.get("order"), "match_week.desc");
    assert.equal(p.get("limit"), "1");

    // Partner lookups are keyed by the partner, never by the caller.
    assert.equal(stub.callsTo({ table: "users" })[0].url.searchParams.get("id"), `eq.${PARTNER}`);
    for (const table of ["user_profiles", "user_photos", "user_focuses"]) {
      assert.equal(stub.callsTo({ table })[0].url.searchParams.get("user_id"), `eq.${PARTNER}`, table);
    }
  });

  test("works when the caller is user2 (partner is user1)", async () => {
    stubPartnerData({ match: { ...matchRow, user1_id: PARTNER, user2_id: ME } });
    const result = await getCurrentMatch(ME);
    assert.equal(result.partner.id, PARTNER);
    assert.equal(stub.callsTo({ table: "users" })[0].url.searchParams.get("id"), `eq.${PARTNER}`);
  });

  test("height conversion edge cases", async () => {
    for (const [inches, cm] of [
      [60, 152], // 152.4
      [65, 165], // 165.1
      [72, 183], // 182.88
    ]) {
      stub.reset();
      stubPartnerData({ profile: { ...partnerProfile, height: inches } });
      const result = await getCurrentMatch(ME);
      assert.equal(result.partner.profile.height, cm, `${inches}in`);
    }
  });

  test("missing height stays undefined (not 0 / NaN)", async () => {
    stubPartnerData({ profile: { ...partnerProfile, height: null } });
    const result = await getCurrentMatch(ME);
    assert.equal(result.partner.profile.height, undefined);
  });

  test("returns null when the user has no current match (and makes no partner queries)", async () => {
    stubPartnerData({ match: null });
    assert.equal(await getCurrentMatch(ME), null);
    assert.equal(stub.calls.length, 1);
  });

  test("returns null when the partner account no longer exists", async () => {
    stubPartnerData({ user: null });
    assert.equal(await getCurrentMatch(ME), null);
  });

  test("partner without a profile row -> profile {} and empty arrays are fine", async () => {
    stubPartnerData({ profile: null });
    stub.on({ table: "user_photos", method: "GET" }, []);
    stub.on({ table: "user_focuses", method: "GET" }, []);
    const result = await getCurrentMatch(ME);
    assert.deepEqual(result.partner.profile, {});
    assert.deepEqual(result.partner.photos, []);
    assert.deepEqual(result.partner.focuses, []);
  });

  test("DB errors surface as ApiError", async () => {
    stub.on({ table: "matches", method: "GET" }, pgError("relation does not exist"));
    await assert.rejects(getCurrentMatch(ME), (err) => err instanceof ApiError && err.statusCode === 400);

    stub.reset();
    stubPartnerData();
    stub.on({ table: "user_photos", method: "GET" }, pgError("boom"));
    await assert.rejects(getCurrentMatch(ME), (err) => err instanceof ApiError);
  });
});
