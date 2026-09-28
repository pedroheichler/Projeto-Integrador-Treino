import { api } from './api';
import { callAI, type AITextBlock } from './anthropicProxy';

/**
 * Resumo semanal: junta treino, dieta, água e peso da última semana e pede
 * para a IA escrever um parágrafo curto e útil.
 *
 * A coleta dos números é feita aqui (não pela IA) — assim os dados são exatos
 * e a IA só interpreta.
 */

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface WeekFacts {
  treinos: number;
  exercicios: number;
  exerciciosSemanaPassada: number;
  diasComMetaAgua: number;
  mediaKcal: number | null;
  mediaProteina: number | null;
  diasComRegistroDieta: number;
  pesoAtual: number | null;
  pesoVariacao: number | null;
  cargasSubiram: string[];
}

export async function collectWeekFacts(userId: string): Promise<WeekFacts> {
  const today = new Date();
  const from = localDateStr(new Date(today.getTime() - 6 * 86400000));
  const prevFrom = localDateStr(new Date(today.getTime() - 13 * 86400000));
  const prevTo = localDateStr(new Date(today.getTime() - 7 * 86400000));
  const to = localDateStr(today);

  const [prog, prevProg, water, settings, diet, weight, logs] = await Promise.all([
    api.from('exercise_progress').select('date')
      .eq('user_id', userId).eq('completed', true).gte('date', from).lte('date', to),
    api.from('exercise_progress').select('date')
      .eq('user_id', userId).eq('completed', true).gte('date', prevFrom).lte('date', prevTo),
    api.from('water_intake').select('date, ml')
      .eq('user_id', userId).gte('date', from).lte('date', to),
    api.from('diet_settings').select('water_goal_ml').eq('user_id', userId).maybeSingle(),
    api.rpc('diet_daily_totals', { p_from: from, p_to: to }),
    api.from('body_weight').select('date, weight')
      .eq('user_id', userId).gte('date', prevFrom).order('date', { ascending: true }),
    api.from('set_logs').select('exercise_id, date, weight, exercises(name)')
      .eq('user_id', userId).not('weight', 'is', null).gte('date', prevFrom).lte('date', to),
  ]);

  const dias = new Set((prog.data ?? []).map((r: any) => r.date));

  const waterGoal = settings.data?.water_goal_ml ?? 2000;
  const perDay: Record<string, number> = {};
  for (const r of (water.data ?? []) as any[]) perDay[r.date] = (perDay[r.date] ?? 0) + r.ml;
  const diasComMetaAgua = Object.values(perDay).filter(ml => ml >= waterGoal).length;

  const dietRows = (diet.data ?? []) as any[];
  const mediaKcal = dietRows.length
    ? Math.round(dietRows.reduce((a, r) => a + Number(r.kcal), 0) / dietRows.length) : null;
  const mediaProteina = dietRows.length
    ? Math.round(dietRows.reduce((a, r) => a + Number(r.protein), 0) / dietRows.length) : null;

  const weights = (weight.data ?? []).map((r: any) => ({ date: r.date, w: Number(r.weight) }));
  const pesoAtual = weights.length ? weights[weights.length - 1].w : null;
  const pesoVariacao = weights.length >= 2 ? weights[weights.length - 1].w - weights[0].w : null;

  // Exercícios cuja carga máxima subiu em relação à semana anterior
  const best: Record<string, { name: string; prev: number; now: number }> = {};
  for (const r of (logs.data ?? []) as any[]) {
    const rel = r.exercises;
    const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? 'Exercício';
    const entry = (best[r.exercise_id] ??= { name, prev: 0, now: 0 });
    const kg = Number(r.weight);
    if (r.date >= from) entry.now = Math.max(entry.now, kg);
    else entry.prev = Math.max(entry.prev, kg);
  }
  const cargasSubiram = Object.values(best)
    .filter(e => e.prev > 0 && e.now > e.prev)
    .map(e => `${e.name} ${e.prev}→${e.now} kg`);

  return {
    treinos: dias.size,
    exercicios: (prog.data ?? []).length,
    exerciciosSemanaPassada: (prevProg.data ?? []).length,
    diasComMetaAgua,
    mediaKcal,
    mediaProteina,
    diasComRegistroDieta: dietRows.length,
    pesoAtual,
    pesoVariacao,
    cargasSubiram,
  };
}

export async function generateWeeklyReport(facts: WeekFacts): Promise<string> {
  const linhas = [
    `Treinos na semana: ${facts.treinos} (${facts.exercicios} exercícios concluídos)`,
    `Exercícios na semana anterior: ${facts.exerciciosSemanaPassada}`,
    `Dias que bateu a meta de água: ${facts.diasComMetaAgua} de 7`,
    facts.diasComRegistroDieta > 0
      ? `Alimentação registrada em ${facts.diasComRegistroDieta} dias — média de ${facts.mediaKcal} kcal e ${facts.mediaProteina} g de proteína por dia`
      : 'Alimentação: nenhum registro nesta semana',
    facts.pesoAtual != null ? `Peso atual: ${facts.pesoAtual} kg` : 'Peso: sem registro',
    facts.pesoVariacao != null
      ? `Variação de peso no período: ${facts.pesoVariacao > 0 ? '+' : ''}${facts.pesoVariacao.toFixed(1)} kg`
      : null,
    facts.cargasSubiram.length
      ? `Cargas que subiram: ${facts.cargasSubiram.join('; ')}`
      : 'Nenhuma carga aumentou em relação à semana anterior',
  ].filter(Boolean).join('\n');

  const response = await callAI('weekly-report', {
    messages: [{
      role: 'user',
      content: `Você é o Kronos AI, assistente de treino e dieta. Escreva um resumo curto da semana do usuário com base nos dados abaixo.

${linhas}

Regras:
- Português brasileiro, tom direto e motivador, sem bajulação.
- No máximo 4 frases curtas, em texto corrido (sem listas, sem markdown).
- Comece pelo que foi bem, depois aponte UM ponto de atenção concreto.
- Cite números reais dos dados. Não invente nada que não esteja acima.
- Se faltar dado (ex: sem registro de peso ou dieta), sugira registrar, sem cobrar.`,
    }],
  });

  return response.content
    .filter((b): b is AITextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}
