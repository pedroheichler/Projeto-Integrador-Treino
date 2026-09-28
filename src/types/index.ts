export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  rest: string;
  notes?: string;
  completed: boolean;
}

export interface DayPlan {
  id: string;
  name: string;
  focus?: string;
  exercises: Exercise[];
}

export type Role = 'admin' | 'member';

export interface Member {
  id: string;
  name: string;
  avatar: string;
  role: Role;
  isOnline?: boolean;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface Squad {
  id: string;
  name: string;
  icon: string;
  inviteCode?: string;
  members: Member[];
  weeklyPlan: DayPlan[];
  templates: WorkoutTemplate[];
}

export type ViewType = 'treino' | 'dieta' | 'ia' | 'settings';

/** Sub-abas dentro da área de Treino */
export type TreinoTab = 'hoje' | 'semana' | 'progresso';

/** Sub-abas dentro da área de Dieta */
export type DietaTab = 'agua' | 'refeicoes' | 'corpo';
