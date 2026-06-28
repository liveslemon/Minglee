import { PROFILE_FIELD_RULES } from "../constants/profileValues.js";
import { ApiError } from "./apiError.js";

function normalizeLookupKey(value) {
  return value.trim().toLowerCase();
}

function buildLookupMap(rule) {
  const lookup = new Map();

  for (const canonical of rule.canonicalValues) {
    lookup.set(normalizeLookupKey(canonical), canonical);
  }

  for (const [alias, canonical] of Object.entries(rule.aliases ?? {})) {
    lookup.set(normalizeLookupKey(alias), canonical);
  }

  return lookup;
}

function getSuggestedReplacement(value, rule) {
  const normalized = normalizeLookupKey(value);

  for (const canonical of rule.canonicalValues) {
    if (normalizeLookupKey(canonical) === normalized) {
      return canonical;
    }
  }

  for (const alias of Object.keys(rule.aliases ?? {})) {
    if (normalizeLookupKey(alias) === normalized) {
      return rule.aliases[alias];
    }
  }

  return null;
}

export function normalizeMappedValue(field, value) {
  const rule = PROFILE_FIELD_RULES[field];
  if (!rule || value == null) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  const lookup = buildLookupMap(rule);
  const canonical = lookup.get(normalizeLookupKey(trimmed));
  if (canonical) return canonical;

  throw new ApiError(400, `Unsupported ${field} value`, {
    field,
    received: value,
    allowed_values: rule.canonicalValues,
    suggested_replacement: getSuggestedReplacement(value, rule)
  });
}

export function normalizeGreenFlag(value) {
  if (value == null || typeof value !== "string") return value;

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  return parts.map((part) => normalizeMappedValue("green_flag", part)).join(", ");
}

export function normalizeProfilePayload(payload) {
  return {
    ...payload,
    personal_style: normalizeMappedValue("personal_style", payload.personal_style),
    social_persona: normalizeMappedValue("social_persona", payload.social_persona),
    weekend_type: normalizeMappedValue("weekend_type", payload.weekend_type),
    habits: normalizeMappedValue("habits", payload.habits),
    conflict_style: normalizeMappedValue("conflict_style", payload.conflict_style),
    green_flag: normalizeGreenFlag(payload.green_flag)
  };
}

export function toFrontendMappedValue(field, value) {
  const rule = PROFILE_FIELD_RULES[field];
  if (!rule || value == null || typeof value !== "string") return value;
  return rule.frontendValues[value] ?? value;
}

export function toFrontendGreenFlagList(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => toFrontendMappedValue("green_flag", item));
  }
  if (typeof value !== "string") return value;

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => toFrontendMappedValue("green_flag", part));
}

export function serializeProfileForClient(profile) {
  if (!profile) return null;

  return {
    gender: profile.gender ?? null,
    age: profile.age ?? null,
    height: profile.height ?? null,
    build: profile.build ?? null,
    skin_tone: profile.skin_tone ?? null,
    personal_style: toFrontendMappedValue("personal_style", profile.personal_style) ?? null,
    social_persona: toFrontendMappedValue("social_persona", profile.social_persona) ?? null,
    weekend_type: toFrontendMappedValue("weekend_type", profile.weekend_type) ?? null,
    afternoon_activity: profile.afternoon_activity ?? null,
    habits: toFrontendMappedValue("habits", profile.habits) ?? null,
    conflict_style: toFrontendMappedValue("conflict_style", profile.conflict_style) ?? null,
    relationship_goal: profile.relationship_goal ?? null,
    green_flag: toFrontendGreenFlagList(profile.green_flag) ?? null,
    instagram: profile.instagram ?? null,
    tiktok: profile.tiktok ?? null
  };
}

export function getProfileNormalizationReport() {
  return Object.entries(PROFILE_FIELD_RULES).flatMap(([field, rule]) => {
    const aliasEntries = Object.entries(rule.aliases ?? {}).map(([frontendValue, normalizedValue]) => ({
      field,
      frontendValue,
      normalizedValue,
      databaseValue: normalizedValue
    }));

    const canonicalEntries = rule.canonicalValues.map((canonicalValue) => ({
      field,
      frontendValue: rule.frontendValues?.[canonicalValue] ?? canonicalValue,
      normalizedValue: canonicalValue,
      databaseValue: canonicalValue
    }));

    const deduped = new Map();
    for (const row of [...aliasEntries, ...canonicalEntries]) {
      deduped.set(`${row.field}:${row.frontendValue}:${row.databaseValue}`, row);
    }

    return [...deduped.values()];
  });
}

