import type { Squad } from '../types';
import { streamWorkoutChat } from './anthropicProxy';

const SYSTEM_PROMPT = `Você é o Kronos AI, assistente pessoal de treino e dieta integrado ao app Kronos.
Seja direto, motivador e técnico. Responda sempre em português brasileiro.

REGRAS IMPORTANTES:
- Quando o usuário pedir um TREINO ou exercícios para um dia específico: use a ferramenta create_workout_day para adicionar o treino diretamente ao app. NÃO sugira dieta ou alimentação junto.
- Quando o usuário pedir DIETA, alimentação ou macros: forneça o plano alimentar. NÃO adicione treinos não solicitados.
- Ao analisar progresso: foque nos dados fornecidos, seja específico e prático.
- Respostas concisas. Use markdown (negrito, listas) quando útil.`;

export function buildWorkoutContext(
  squad: Squad,
  streak: number,
  progressStats: { thisWeekByDate: Record<string, number>; lastWeekByDate: Record<string, number> }
): string {
  const thisWeekTotal = Object.values(progressStats.thisWeekByDate).reduce((a, b) => a + b, 0);
  const lastWeekTotal = Object.values(progressStats.lastWeekByDate).reduce((a, b) => a + b, 0);

  const plan = squad.weeklyPlan
    .map(day => {
      const exs = day.exercises.length > 0
        ? day.exercises.map(ex => `    - ${ex.name}: ${ex.sets}x${ex.reps}, descanso ${ex.rest}${ex.notes ? ` (${ex.notes})` : ''}`).join('\n')
        : '    - Descanso';
      return `  ${day.name}${day.focus ? ` (${day.focus})` : ''}:\n${exs}`;
    })
    .join('\n');

  return `Squad: ${squad.name}
Sequência atual: ${streak} dias consecutivos
Exercícios completados esta semana: ${thisWeekTotal}
Exercícios completados semana passada: ${lastWeekTotal}

Plano semanal:
${plan}`;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface WorkoutExercise {
  name: string;
  sets: number;
  reps: string;
  rest: string;
  notes?: string;
}

export interface WorkoutCreatedEvent {
  __workoutCreated__: true;
  dayName: string;
  focus: string;
  exercises: WorkoutExercise[];
}

export type MessageChunk = string | WorkoutCreatedEvent;

export async function* sendMessage(
  history: ChatMessage[],
  newMessage: string,
  workoutContext: string
): AsyncGenerator<MessageChunk> {
  const systemInstruction = `${SYSTEM_PROMPT}\n\nContexto atual do usuário:\n${workoutContext}`;

  const messages = [
    ...history.map(m => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.text,
    })),
    { role: 'user', content: newMessage },
  ];

  for await (const event of streamWorkoutChat({
    system: systemInstruction,
    messages,
  })) {
    if (event.type === 'text') {
      yield event.text;
    } else if (event.name === 'create_workout_day') {
      const input = event.input as { day_name: string; focus: string; exercises: WorkoutExercise[] };
      yield {
        __workoutCreated__: true,
        dayName: input.day_name,
        focus: input.focus,
        exercises: input.exercises,
      };
    }
  }
}
