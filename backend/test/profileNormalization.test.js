import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/utils/apiError.js";
import {
  getProfileNormalizationReport,
  normalizeGreenFlag,
  normalizeMappedValue,
  normalizeProfilePayload,
  serializeProfileForClient
} from "../src/utils/profileNormalization.js";
import { PROFILE_FIELD_RULES } from "../src/constants/profileValues.js";

for (const [field, rule] of Object.entries(PROFILE_FIELD_RULES)) {
  test(`${field}: accepts every canonical value`, () => {
    for (const canonical of rule.canonicalValues) {
      const actual =
        field === "green_flag"
          ? normalizeGreenFlag(canonical)
          : normalizeMappedValue(field, canonical);
      assert.equal(actual, canonical);
    }
  });

  test(`${field}: accepts every frontend alias`, () => {
    for (const [frontendValue, canonical] of Object.entries(rule.aliases ?? {})) {
      const actual =
        field === "green_flag"
          ? normalizeGreenFlag(frontendValue)
          : normalizeMappedValue(field, frontendValue);
      assert.equal(actual, canonical);
    }
  });

  test(`${field}: rejects unknown values with a clear 400`, () => {
    assert.throws(
      () => {
        if (field === "green_flag") {
          normalizeGreenFlag("Totally unknown");
          return;
        }
        normalizeMappedValue(field, "Totally unknown");
      },
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.details.field, field);
        assert.equal(error.details.received, "Totally unknown");
        assert.deepEqual(error.details.allowed_values, rule.canonicalValues);
        return true;
      }
    );
  });
}

test("normalizeProfilePayload: normalizes the profile fields before insert", () => {
  const normalized = normalizeProfilePayload({
    personal_style: "Minimalist",
    social_persona: "Extroverted",
    weekend_type: "Chill in",
    habits: "Gym Routine",
    conflict_style: "Need space then talk",
    green_flag: "Kindness to others, Ambition and drive"
  });

  assert.deepEqual(normalized, {
    personal_style: "Minimal",
    social_persona: "Outgoing",
    weekend_type: "Chill",
    habits: "Gym",
    conflict_style: "Need space",
    green_flag: "Kindness, Ambition"
  });
});

test("serializeProfileForClient: maps canonical database values back to frontend values", () => {
  const serialized = serializeProfileForClient({
    gender: "Female",
    age: 23,
    height: 170,
    build: "Athletic",
    skin_tone: "Brown",
    personal_style: "Minimal",
    social_persona: "Outgoing",
    weekend_type: "Chill",
    afternoon_activity: "Movies",
    habits: "Gym",
    conflict_style: "Talk it out",
    relationship_goal: "Long-term",
    green_flag: "Kindness, Ambition",
    instagram: "jane",
    tiktok: "jane"
  });

  assert.deepEqual(serialized, {
    gender: "Female",
    age: 23,
    height: 170,
    build: "Athletic",
    skin_tone: "Brown",
    personal_style: "Minimalist",
    social_persona: "Extroverted",
    weekend_type: "Chill in",
    afternoon_activity: "Movies",
    habits: "Gym Routine",
    conflict_style: "Talk it out immediately",
    relationship_goal: "Long-term",
    green_flag: ["Kindness to others", "Ambition and drive"],
    instagram: "jane",
    tiktok: "jane"
  });
});

test("getProfileNormalizationReport: lists frontend, normalized, and database values", () => {
  const report = getProfileNormalizationReport();
  assert.ok(report.length > 0);
  assert.ok(
    report.some(
      (row) =>
        row.field === "conflict_style" &&
        row.frontendValue === "Talk it out immediately" &&
        row.normalizedValue === "Talk it out" &&
        row.databaseValue === "Talk it out"
    )
  );
});

