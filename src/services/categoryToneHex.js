// Backend (hex-color) port of frontend/src/components/ui/categoryTone.js —
// kept logically identical (same keyword rules, same fallback hash) so an
// officer's category renders in the same color on the downloaded PDF chart
// as it does on the on-screen Organizational Chart.

const KEYWORD_TONES = [
  { test: /adviser|advisor/i, tone: "sky" },
  { test: /executive/i, tone: "teal" },
  { test: /committee/i, tone: "rose" },
  { test: /judiciary|legislative/i, tone: "violet" },
  { test: /board/i, tone: "amber" },
  { test: /secretariat|secretary/i, tone: "cyan" },
  { test: /member/i, tone: "amber" },
];

const FALLBACK_PALETTE = ["indigo", "fuchsia", "lime", "orange", "emerald", "cyan", "rose", "sky"];

const TONE_HEX = {
  sky: { bg: "#e0f2fe", text: "#0369a1" },
  teal: { bg: "#ccfbf1", text: "#0f766e" },
  rose: { bg: "#ffe4e6", text: "#be123c" },
  violet: { bg: "#ede9fe", text: "#6d28d9" },
  amber: { bg: "#fef3c7", text: "#92400e" },
  cyan: { bg: "#cffafe", text: "#0e7490" },
  indigo: { bg: "#e0e7ff", text: "#4338ca" },
  fuchsia: { bg: "#fae8ff", text: "#a21caf" },
  lime: { bg: "#ecfccb", text: "#4d7c0f" },
  orange: { bg: "#ffedd5", text: "#c2410c" },
  emerald: { bg: "#d1fae5", text: "#047857" },
  slate: { bg: "#f1f5f9", text: "#475569" },
};

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function categoryToneHex(category) {
  if (!category || !category.trim()) return TONE_HEX.slate;
  const trimmed = category.trim();
  const keyword = KEYWORD_TONES.find((k) => k.test.test(trimmed));
  if (keyword) return TONE_HEX[keyword.tone];
  const tone = FALLBACK_PALETTE[hashString(trimmed.toLowerCase()) % FALLBACK_PALETTE.length];
  return TONE_HEX[tone];
}
