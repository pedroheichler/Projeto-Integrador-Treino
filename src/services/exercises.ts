import { api } from './api';
import { Exercise } from '../types';

export async function addExercise(dayId: string, exercise: Exercise): Promise<void> {
  const { error } = await api.from('exercises').insert({
    id: exercise.id,
    workout_day_id: dayId,
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    rest: exercise.rest,
    notes: exercise.notes ?? null,
    completed: exercise.completed,
  });

  if (error) throw error;
}

export async function saveExercise(exercise: Exercise): Promise<void> {
  const { error } = await api
    .from('exercises')
    .update({
      name: exercise.name,
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      notes: exercise.notes ?? null,
      completed: exercise.completed,
    })
    .eq('id', exercise.id);

  if (error) throw error;
}

export async function deleteExercise(exerciseId: string): Promise<void> {
  const { error } = await api.from('exercises').delete().eq('id', exerciseId);
  if (error) throw error;
}

export async function fetchExercisesByDay(dayId: string): Promise<Exercise[]> {
  const { data, error } = await api
    .from('exercises')
    .select('id, name, sets, reps, rest, notes, completed')
    .eq('workout_day_id', dayId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    sets: row.sets,
    reps: row.reps,
    rest: row.rest,
    notes: row.notes ?? undefined,
    completed: row.completed,
  }));
}
