/**
 * RN03: a meta diária de água é sugerida a partir do peso corporal
 * (35 ml por kg) e pode ser trocada por uma meta manual.
 *
 * Fica num lugar só para a tela de Dieta e o resumo semanal usarem a
 * mesma conta.
 */

export const ML_POR_KG = 35;
export const DEFAULT_WATER_GOAL = 2000;

/** Meta sugerida pelo peso, arredondada de 10 em 10 ml; null sem peso válido. */
export function suggestedWaterGoal(weightKg: number | null | undefined): number | null {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  return Math.round((weightKg * ML_POR_KG) / 10) * 10;
}

/** Meta que vale: a manual, se existir; senão a sugerida pelo peso; senão 2000 ml. */
export function effectiveWaterGoal(manualGoal: number | null | undefined, weightKg: number | null | undefined): number {
  return manualGoal ?? suggestedWaterGoal(weightKg) ?? DEFAULT_WATER_GOAL;
}
