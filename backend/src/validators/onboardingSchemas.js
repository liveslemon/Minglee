import { z } from "zod";
import { BUILD_VALUES, FOCUS_VALUES, PHOTO_TYPE_VALUES, PROFILE_FIELD_RULES } from "../constants/profileValues.js";

export const profileSchema = z
  .object({
    gender: z.string().min(1).max(40).optional(),
    age: z.number().int().min(18).optional(),
    height: z.number().int().min(50).max(260).optional(),
    build: z.enum(BUILD_VALUES).optional(),
    skin_tone: z.string().min(1).max(60).optional(),
    personal_style: z.string().min(1).max(80).optional(),
    social_persona: z.string().min(1).max(80).optional(),
    weekend_type: z.string().min(1).max(80).optional(),
    afternoon_activity: z.string().min(1).max(80).optional(),
    habits: z.string().min(1).max(120).optional(),
    conflict_style: z.string().min(1).max(120).optional(),
    relationship_goal: z.string().min(1).max(120).optional(),
    green_flag: z.string().min(1).max(200).optional(),
    instagram: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(120).optional()
  })
  .strict()
  .refine((v) => (v.age == null ? true : v.age >= 18), { message: "age must be >= 18", path: ["age"] });

export const canonicalProfileSchema = z
  .object({
    gender: z.string().min(1).max(40).optional(),
    age: z.number().int().min(18).optional(),
    height: z.number().int().min(50).max(260).optional(),
    build: z.enum(BUILD_VALUES).optional(),
    skin_tone: z.string().min(1).max(60).optional(),
    personal_style: z.enum(PROFILE_FIELD_RULES.personal_style.canonicalValues).optional(),
    social_persona: z.enum(PROFILE_FIELD_RULES.social_persona.canonicalValues).optional(),
    weekend_type: z.enum(PROFILE_FIELD_RULES.weekend_type.canonicalValues).optional(),
    afternoon_activity: z.string().min(1).max(80).optional(),
    habits: z.enum(PROFILE_FIELD_RULES.habits.canonicalValues).optional(),
    conflict_style: z.enum(PROFILE_FIELD_RULES.conflict_style.canonicalValues).optional(),
    relationship_goal: z.string().min(1).max(120).optional(),
    green_flag: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => {
        const values = value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);

        return values.every((entry) => PROFILE_FIELD_RULES.green_flag.canonicalValues.includes(entry));
      }, { message: "green_flag must contain canonical values", path: ["green_flag"] })
      .optional(),
    instagram: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(120).optional()
  })
  .strict();

export const preferencesSchema = z
  .object({
    preferred_min_age: z.number().int().min(18).optional(),
    preferred_max_age: z.number().int().min(18).optional(),
    preferred_min_height: z.number().int().min(50).max(260).optional(),
    preferred_max_height: z.number().int().min(50).max(260).optional()
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.preferred_min_age != null && v.preferred_max_age != null && v.preferred_min_age > v.preferred_max_age) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preferred_min_age cannot exceed preferred_max_age",
        path: ["preferred_min_age"]
      });
    }
    if (
      v.preferred_min_height != null &&
      v.preferred_max_height != null &&
      v.preferred_min_height > v.preferred_max_height
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preferred_min_height cannot exceed preferred_max_height",
        path: ["preferred_min_height"]
      });
    }
  });

export const focusesSchema = z
  .object({
    focuses: z
      .array(z.enum(FOCUS_VALUES))
      .max(2)
  })
  .strict();

export const preferredBuildsSchema = z
  .object({
    builds: z.array(z.enum(BUILD_VALUES)).min(1).max(4)
  })
  .strict();

export const photosSchema = z
  .object({
    photos: z
      .array(
        z
          .object({
            image_url: z.string().url(),
            photo_type: z.enum(PHOTO_TYPE_VALUES),
            upload_order: z.number().int().min(1).max(3)
          })
          .strict()
      )
      .min(2)
      .max(3)
  })
  .strict();

