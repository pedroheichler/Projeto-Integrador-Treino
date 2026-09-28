/**
 * Classifica um exercício em grupo muscular pelo nome.
 *
 * É heurística: o usuário não precisa marcar nada, e para uso pessoal acerta
 * a grande maioria. O objetivo é sinalizar desequilíbrio de volume (ex: 14
 * séries de peito contra 4 de costas na semana), não ser uma classificação
 * anatômica exata.
 */

export type MuscleGroup =
  | 'Peito' | 'Costas' | 'Pernas' | 'Ombro' | 'Bíceps' | 'Tríceps' | 'Abdômen' | 'Outros';

/**
 * Cada grupo precisa de uma cor distinta para o gráfico ser legível.
 * Em vez de cores fixas (que brigariam com os temas), usamos o acento do tema
 * com opacidades diferentes — funciona tanto no "Noite azul" quanto no
 * "Cal e limão", e mantém a leitura de qual barra é qual.
 */
export const MUSCLE_COLORS: Record<MuscleGroup, string> = {
  'Peito':   'color-mix(in srgb, var(--accent) 100%, transparent)',
  'Costas':  'color-mix(in srgb, var(--accent) 82%, transparent)',
  'Pernas':  'color-mix(in srgb, var(--accent) 64%, transparent)',
  'Ombro':   'var(--load)',
  'Bíceps':  'color-mix(in srgb, var(--load) 70%, transparent)',
  'Tríceps': 'color-mix(in srgb, var(--load) 48%, transparent)',
  'Abdômen': 'color-mix(in srgb, var(--accent) 46%, transparent)',
  'Outros':  'var(--text-3)',
};

// A ordem importa: o primeiro grupo cujo termo aparecer no nome vence.
const RULES: [MuscleGroup, string[]][] = [
  ['Tríceps', ['triceps', 'tríceps', 'frances', 'francês', 'testa', 'coice', 'mergulho', 'paralela']],
  ['Bíceps',  ['biceps', 'bíceps', 'rosca', 'martelo', 'scott', 'concentrad']],
  ['Costas',  ['costas', 'remada', 'puxada', 'barra fixa', 'pulldown', 'pull down', 'pull-up',
               'serrote', 'dorsal', 'crucifixo inverso', 'levantamento terra', 'terra', 'encolhimento']],
  ['Peito',   ['peito', 'supino', 'crucifixo', 'crossover', 'cross over', 'pec deck', 'peck deck',
               'voador', 'flexao', 'flexão']],
  ['Ombro',   ['ombro', 'desenvolvimento', 'elevacao lateral', 'elevação lateral', 'elevacao frontal',
               'elevação frontal', 'arnold', 'remada alta', 'deltoid']],
  ['Pernas',  ['perna', 'agachamento', 'leg press', 'legpress', 'cadeira extensora', 'extensora',
               'flexora', 'panturrilha', 'gluteo', 'glúteo', 'afundo', 'avanco', 'avanço',
               'stiff', 'hack', 'adutor', 'abdutor', 'coxa', 'passada']],
  ['Abdômen', ['abdomen', 'abdômen', 'abdominal', 'prancha', 'core', 'obliquo', 'oblíquo', 'elevacao de pernas']],
];

/** Remove acentos para a comparação não depender de como foi digitado */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function muscleGroupOf(exerciseName: string): MuscleGroup {
  const name = normalize(exerciseName);
  for (const [group, terms] of RULES) {
    if (terms.some(t => name.includes(normalize(t)))) return group;
  }
  return 'Outros';
}
