import type { Squad } from '../types';

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export const INITIAL_SQUAD: Squad = {
  id: 'squad-1',
  name: 'Os Brutos do CT',
  icon: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=200&h=200&auto=format&fit=crop',
  members: [
    {
      id: 'u1',
      name: 'Piter',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Piter',
      role: 'admin',
      isOnline: true,
    },
    {
      id: 'u2',
      name: 'Lucas',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lucas',
      role: 'member',
      isOnline: true,
    },
    {
      id: 'u3',
      name: 'Ana',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana',
      role: 'member',
      isOnline: false,
    },
    {
      id: 'u4',
      name: 'Marcos',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Marcos',
      role: 'member',
      isOnline: false,
    },
  ],
  weeklyPlan: DAYS.map((day, index) => ({
    id: `day-${index}`,
    name: day,
    focus: index === 0 ? 'Peito e Tríceps' : index === 1 ? 'Costas e Bíceps' : 'Descanso',
    exercises: index === 0 ? [
      { id: 'e1', name: 'Supino Reto', sets: 4, reps: '12', rest: '60s', completed: false },
      { id: 'e2', name: 'Supino Inclinado c/ Halter', sets: 3, reps: '10', rest: '60s', completed: false },
      { id: 'e3', name: 'Crucifixo Máquina', sets: 3, reps: '15', rest: '45s', completed: false },
      { id: 'e4', name: 'Tríceps Corda', sets: 4, reps: '12', rest: '45s', completed: false },
    ] : index === 1 ? [
      { id: 'e5', name: 'Puxada Aberta', sets: 4, reps: '12', rest: '60s', completed: false },
      { id: 'e6', name: 'Remada Curvada', sets: 3, reps: '10', rest: '60s', completed: false },
      { id: 'e7', name: 'Rosca Direta', sets: 3, reps: '12', rest: '45s', completed: false },
    ] : [],
  })),
  templates: [],
};
