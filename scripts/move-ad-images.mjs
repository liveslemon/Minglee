// One-off: move ad images out of the (soon private) user photos bucket into
// the public ads bucket, and repoint public.ads.image_url at the new URLs.
// Required before running migrations/004_private_photos.sql.
//
//   node scripts/move-ad-images.mjs           # dry run: report only
//   node scripts/move-ad-images.mjs --apply   # create bucket, move files, update rows
//
// Uses SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env. Safe to re-run:
// already-moved files are no longer listed under the source bucket.
import { supabase } from "../src/supabase.js";
import { config } from "../src/config.js";

const APPLY = process.argv.includes("--apply");
const SOURCE = config.userPhotosBucket;
const TARGET = config.adsBucket;

if (SOURCE === TARGET) {
  throw new Error(`SUPABASE_ADS_BUCKET (${TARGET}) must differ from SUPABASE_USER_PHOTOS_BUCKET`);
}

async function listFilesRecursive(bucket, prefix) {
  const files = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listing ${bucket}/${prefix} failed: ${error.message}`);
    for (const entry of data) {
      const full = `${prefix}/${entry.name}`;
      // Folders have no id in Storage list results.
      if (entry.id === null) files.push(...(await listFilesRecursive(bucket, full)));
      else files.push(full);
    }
    if (data.length < pageSize) break;
  }
  return files;
}

function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function ensurePublicBucket(bucket) {
  const { data: existing, error } = await supabase.storage.getBucket(bucket);
  if (existing) {
    if (!existing.public) {
      const { error: updErr } = await supabase.storage.updateBucket(bucket, { public: true });
      if (updErr) throw new Error(`Could not make ${bucket} public: ${updErr.message}`);
      console.log(`Made bucket ${bucket} public.`);
    }
    return;
  }
  if (error && !/not found/i.test(error.message)) throw new Error(`getBucket(${bucket}): ${error.message}`);
  const { error: createErr } = await supabase.storage.createBucket(bucket, { public: true });
  if (createErr) throw new Error(`Could not create bucket ${bucket}: ${createErr.message}`);
  console.log(`Created public bucket ${bucket}.`);
}

const files = await listFilesRecursive(SOURCE, "ads");
console.log(`${files.length} ad image(s) in ${SOURCE}/ads.`);

const { data: ads, error: adsErr } = await supabase.from("ads").select("id,image_url");
if (adsErr) throw new Error(`Reading ads failed: ${adsErr.message}`);

const plan = files.map((path) => {
  const oldUrl = publicUrl(SOURCE, path);
  return { path, oldUrl, newUrl: publicUrl(TARGET, path), adIds: ads.filter((a) => a.image_url === oldUrl).map((a) => a.id) };
});
const orphans = plan.filter((p) => p.adIds.length === 0).length;
console.log(`${plan.length - orphans} referenced by ads rows, ${orphans} not referenced (moved anyway).`);

// Ads still pointing at the source bucket but whose file is missing.
const sourcePrefix = publicUrl(SOURCE, "ads/");
const dangling = ads.filter((a) => a.image_url?.startsWith(sourcePrefix) && !plan.some((p) => p.oldUrl === a.image_url));
if (dangling.length) {
  console.warn(`${dangling.length} ads row(s) point at ${SOURCE}/ads but the file doesn't exist:`, dangling.map((a) => a.id));
}

if (!APPLY) {
  for (const p of plan) console.log(`  would move ${p.path}  (ads: ${p.adIds.join(", ") || "none"})`);
  console.log("\nDry run only. Re-run with --apply to make these changes.");
  process.exit(0);
}

await ensurePublicBucket(TARGET);

let moved = 0;
let updated = 0;
for (const p of plan) {
  const { error } = await supabase.storage.from(SOURCE).move(p.path, p.path, { destinationBucket: TARGET });
  if (error) throw new Error(`Moving ${p.path} failed (${moved} moved so far; safe to re-run): ${error.message}`);
  moved += 1;

  if (p.adIds.length) {
    const { error: updErr } = await supabase.from("ads").update({ image_url: p.newUrl }).in("id", p.adIds);
    if (updErr) throw new Error(`File ${p.path} moved but updating ads ${p.adIds} failed: ${updErr.message}. Set image_url to ${p.newUrl}.`);
    updated += p.adIds.length;
  }
}

const left = await listFilesRecursive(SOURCE, "ads");
console.log(`Moved ${moved} file(s), updated ${updated} ads row(s). Remaining in ${SOURCE}/ads: ${left.length}.`);
if (left.length === 0) console.log("You can now run migrations/004_private_photos.sql.");
