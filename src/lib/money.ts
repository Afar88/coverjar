export const fmt = (cents: number) =>
  (cents < 0 ? "-" : "") + "$" + (Math.abs(cents) / 100).toFixed(2);

export const toCents = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
