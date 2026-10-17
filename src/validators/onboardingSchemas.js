import { z } from "zod";

const buildSchema = z.enum([
  "Slim",
  "Petite",
  "Athletic",
  "Average",
  "Muscular",
  "Curvy",
  "Plus-size",
]);

const conflictStyleSchema = z.enum([
  "Talk it out immediately",
  "Need space then talk",
  "Let it blow over",
]);

const relationshipGoalSchema = z.enum([
  "Marriage bound",
  "Long-term",
  "Short-term",
  "Just looking for fun",
]);

export const profileSchema = z
  .object({
    gender: z.string().min(1).max(40).optional(),
    age: z.number().int().min(18).optional(),
    height: z.number().int().min(90).max(250).optional(),
    build: buildSchema.optional(),
    skin_tone: z.string().min(1).max(60).optional(),
    personal_style: z.string().min(1).max(80).optional(),
    social_persona: z.string().min(1).max(80).optional(),
    weekend_type: z.string().min(1).max(80).optional(),
    afternoon_activity: z.string().min(1).max(80).optional(),
    habits: z.string().min(1).max(120).optional(),
    conflict_style: conflictStyleSchema.optional(),
    relationship_goal: relationshipGoalSchema.optional(),
    green_flag: z.string().min(1).max(200).optional(),
    instagram: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(120).optional(),
  })
  .strict()
  .refine((v) => (v.age == null ? true : v.age >= 18), {
    message: "age must be >= 18",
    path: ["age"],
  });

export const preferencesSchema = z
  .object({
    preferred_min_age: z.number().int().min(18).optional(),
    preferred_max_age: z.number().int().min(18).optional(),
    preferred_min_height: z.number().int().min(36).max(96).optional(),
    preferred_max_height: z.number().int().min(36).max(96).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.preferred_min_age != null &&
      v.preferred_max_age != null &&
      v.preferred_min_age > v.preferred_max_age
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preferred_min_age cannot exceed preferred_max_age",
        path: ["preferred_min_age"],
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
        path: ["preferred_min_height"],
      });
    }
  });

export const focusesSchema = z
  .object({
    focuses: z
      .array(
        z.enum([
          "Getting my degree and doing well",
          "Building a business/project on the side",
          "Balancing school and enjoying life",
          "Still figuring things out",
        ]),
      )
      .max(2),
  })
  .strict();

export const preferredBuildsSchema = z
  .object({
    builds: z.array(buildSchema).min(1).max(7),
  })
  .strict();

export const photosSchema = z
  .object({
    photos: z
      .array(
        z
          .object({
            // Storage path, signed URL or legacy public URL; ownership is
            // checked in profileService.replacePhotos.
            image_url: z.string().trim().min(1),
            photo_type: z.enum(["Profile", "Gallery"]),
            upload_order: z.number().int().min(1).max(2),
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();
