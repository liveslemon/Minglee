// Phone number normalization.
//
// Canonical storage format is E.164: "+234XXXXXXXXXX" for Nigerian numbers,
// "+<digits>" for everything else. Users historically typed numbers in any
// format, so phoneLookupForms() lists the legacy spellings an existing row may
// still be stored under.

const SEPARATORS = /[\s\-.()]/g;

// Nigerian mobile numbers: 10 national digits starting 70/71/80/81/90/91.
const NG_NATIONAL = "[789][01]\\d{8}";
const NG_INTERNATIONAL_RE = new RegExp(`^2340?(${NG_NATIONAL})$`); // 234803..., 2340803...
const NG_LOCAL_RE = new RegExp(`^0?(${NG_NATIONAL})$`); // 0803..., 803...
const E164_DIGITS_RE = /^[1-9]\d{6,14}$/;

function compact(input) {
  let s = input.trim().replace(SEPARATORS, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return s;
}

function nigerianNational(digits, hasPlus) {
  const intl = digits.match(NG_INTERNATIONAL_RE);
  if (intl) return intl[1];
  if (hasPlus) return null;
  const local = digits.match(NG_LOCAL_RE);
  return local ? local[1] : null;
}

/**
 * Returns the E.164 form of `input`, or null if it is not a usable number.
 * Numbers without a leading "+" are only accepted when they are Nigerian.
 */
export function normalizePhone(input) {
  if (typeof input !== "string") return null;
  const s = compact(input);
  if (!/^\+?\d+$/.test(s)) return null;

  const hasPlus = s.startsWith("+");
  const digits = hasPlus ? s.slice(1) : s;

  const national = nigerianNational(digits, hasPlus);
  if (national) return `+234${national}`;

  // Starts with Nigeria's country code but isn't a valid Nigerian mobile.
  if (digits.startsWith("234")) return null;

  if (hasPlus && E164_DIGITS_RE.test(digits)) return `+${digits}`;
  return null;
}

/**
 * All spellings a stored row for this number might use: the normalized form,
 * the raw input as typed, and the common legacy digit-only variants.
 * `raw` must be a value that normalizePhone() accepts.
 */
export function phoneLookupForms(raw) {
  const normalized = normalizePhone(raw);
  if (!normalized) throw new Error("phoneLookupForms called with an invalid number");

  const forms = [normalized, raw.trim(), compact(raw)];
  const digits = normalized.slice(1);

  if (normalized.startsWith("+234")) {
    const national = digits.slice(3);
    forms.push(`234${national}`, `0${national}`, national, `+2340${national}`, `2340${national}`);
  } else {
    forms.push(digits, `00${digits}`);
  }

  return [...new Set(forms)];
}
