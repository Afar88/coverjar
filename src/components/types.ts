export type Balances = { spend: number; jar: number };
export type Member = {
  id: string;
  name: string;
  role: "parent" | "teen";
  age: number | null;
  allowance_cents: number;
  payout_email: string | null;
  emoji: string;
  balances: Balances | null;
};
export type Rules = {
  jar_percent: number;
  deductible_cents: number;
  max_payout_cents: number;
  streak_bonus_percent: number;
  covered: string[];
  excluded: string[];
  repair_shop_email: string;
};
export type Assessment = {
  covered: boolean;
  category: string;
  coverage_reason: string;
  damage_observed: string;
  photo_matches_description: boolean;
  estimated_repair_cents: number;
  recommended_payout_cents: number;
  final_payout_cents: number;
  caps_applied: string[];
  confidence: number;
  risk_flags: string[];
  parent_summary: string;
  teen_message: string;
  payee: "repair_shop" | "parent";
  model: string;
};
export type Claim = {
  id: number;
  member_id: string;
  title: string;
  description: string;
  amount_cents: number;
  photo_file: string | null;
  status: "pending_parent" | "payout_pending" | "payout_failed" | "paid" | "denied";
  ai: Assessment | null;
  payout_cents: number | null;
  payee_email: string | null;
  paypal_ref: string | null;
  parent_note: string | null;
  created_at: string;
};
export type LedgerEntry = {
  id: number;
  member_id: string;
  bucket: "spend" | "jar";
  amount_cents: number;
  kind: string;
  memo: string;
  paypal_ref: string | null;
  created_at: string;
};
export type AppState = {
  members: Member[];
  rules: Rules;
  ledger: LedgerEntry[];
  claims: Claim[];
  config: { paypal: "sandbox" | "simulated"; paypalClientId: string | null; cryptoEnabled: boolean; ai: string };
};
