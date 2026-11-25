export const BUDGET_FILE: string;
export const DEFAULT_ALLOWED: string[];
export function numericLeaves(obj: unknown, prefix?: string): Map<string, number>;
export function diffBudgets(
  base: unknown,
  head: unknown,
): {
  raised: { key: string; from: number; to: number }[];
  lowered: { key: string; from: number; to: number }[];
  added: { key: string; to: number }[];
  removed: { key: string; from: number }[];
};
export function checkBudgetRatchet(input: {
  base: unknown;
  head: unknown;
  changedPaths: string[];
  allowed?: string[];
}): { ok: boolean; failures: string[] };
export function main(env?: Record<string, string | undefined>): number;
