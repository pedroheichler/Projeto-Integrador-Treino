import { lazy, Suspense, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { api } from './services/api';
import {
  addExercise as addExerciseToDB,
  saveExercise as saveExerciseToDB,
  deleteExercise as deleteExerciseFromDB,
} from './services/exercises';
import {
  Calendar,
  TrendingUp,
  Settings as SettingsIcon,
  Plus,
  CheckCircle2,
  Trash2,
  Edit3,
  RotateCcw,
  Dumbbell,
  Sparkles,
  Apple,
  Sun,
  Moon,
  Play,
  WifiOff,
  SkipForward,
} from 'lucide-react';
import { AppSwitcher } from './components/AppSwitcher';
import { Login } from './components/Login';
import { motion, AnimatePresence } from 'motion/react';
import { Squad, ViewType, TreinoTab, DietaTab, Exercise } from './types';
import { muscleGroupOf, MUSCLE_COLORS, type MuscleGroup } from './services/muscleGroups';
import { collectWeekFacts, generateWeeklyReport } from './services/weeklyReport';
import {
  enfileirar,
  sincronizar,
  observarFila,
  iniciarSincronizacaoAutomatica,
  type EstadoFila,
} from './services/offlineQueue';
import type { WorkoutExercise } from './services/gemini';
import type { Session } from './services/api';

const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.Settings })));
const AIChat = lazy(() => import('./components/AIChat').then(module => ({ default: module.AIChat })));
const Dieta = lazy(() => import('./components/Dieta').then(module => ({ default: module.Dieta })));

function ViewLoading() {
  return (
    <div className="min-h-48 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 animate-pulse">
      <div className="h-4 w-32 rounded bg-[var(--surface-3)] mb-4" />
      <div className="h-3 w-full rounded bg-[var(--surface-3)] mb-2" />
      <div className="h-3 w-2/3 rounded bg-[var(--surface-3)]" />
    </div>
  );
}


// Retorna "YYYY-MM-DD" no fuso local (evita bug UTC-3 após 21h)
function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Calcula sequência de treinos consecutivos respeitando dias de descanso.
// trainingDays: índices dos dias com treino (Seg=0…Dom=6). Vazio = todos os dias contam.
// Se treinou num dia de descanso (ex: trocou o dia), conta normalmente.
function calcStreak(dates: string[], trainingDays: number[] = []): number {
  if (!dates.length) return 0;

  const doneSet  = new Set(dates);
  const allDays  = trainingDays.length === 0;
  const todayStr = localDateStr();

  let streak = 0;
  let d = new Date();

  for (let i = 0; i < 400; i++) {
    const dateStr     = localDateStr(d);
    const dow         = (d.getDay() + 6) % 7;
    const isPlanned   = allDays || trainingDays.includes(dow);
    const doneOnDay   = doneSet.has(dateStr);

    if (!isPlanned && !doneOnDay) {
      // Dia de descanso sem treino → pula sem quebrar
      d.setDate(d.getDate() - 1);
      continue;
    }

    if (doneOnDay) {
      streak++;
    } else if (dateStr !== todayStr) {
      break; // Dia de treino planejado sem registro → quebra
    }

    d.setDate(d.getDate() - 1);
  }

  return streak;
}

function getStreakStyle(days: number): { color: string; badge: string } {
  if (days >= 60) return { color: 'var(--load)', badge: '60 dias 🏆' };
  if (days >= 45) return { color: 'var(--accent)', badge: '45 dias ⚡' };
  if (days >= 30) return { color: 'var(--danger)', badge: '30 dias 💪' };
  if (days >= 15) return { color: 'var(--load)', badge: '15 dias 🔥' };
  if (days >= 7)  return { color: 'var(--load)', badge: '7 dias 🏅' };
  return { color: 'var(--text)', badge: '' };
}

function parseRestSeconds(rest: string): number {
  if (!rest) return 60;
  const m = rest.match(/^(\d+):(\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  const s = rest.match(/^(\d+)/);
  return s ? parseInt(s[1]) : 60;
}

// Descobre em qual espaço o usuário treina: uma equipe de verdade tem
// prioridade sobre o espaço pessoal. Retorna null se ele não tiver nenhum.
async function findWorkspace(userId: string): Promise<{ id: string; personal: boolean } | null> {
  const { data } = await api
    .from('squad_members')
    .select('squad_id, squads(is_personal)')
    .eq('user_id', userId);

  const rows = (data ?? []).map(r => {
    // O join vem como objeto (FK many-to-one), mas o tipo gerado diz array
    const rel = r.squads as unknown as { is_personal: boolean } | { is_personal: boolean }[] | null;
    const squad = Array.isArray(rel) ? rel[0] : rel;
    return { id: r.squad_id as string, personal: !!squad?.is_personal };
  });

  const team = rows.find(r => !r.personal);
  return team ?? rows.find(r => r.personal) ?? null;
}

// Cria um espaço de treino individual (sem equipe) com os 7 dias da semana.
// Devolve o id, ou null se algo falhar.
async function createPersonalWorkspace(): Promise<string | null> {
  const { data, error } = await api.rpc('create_squad', {
    p_name: 'Meu Treino',
    p_personal: true,
  });
  if (error) {
    console.error('Erro ao criar espaço pessoal:', error);
    return null;
  }
  return data as string;
}

export default function App() {

  // ── Todos os hooks primeiro ──
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [squad, setSquad] = useState<Squad>({
    id: '',
    name: '',
    icon: '',
    members: [],
    weeklyPlan: [],
    templates: [],
  });
  const [currentView, setCurrentView] = useState<ViewType>('treino');
  const [treinoTab, setTreinoTab] = useState<TreinoTab>('hoje');
  const [dietaTab, setDietaTab] = useState<DietaTab>('agua');

  // Tema: "noite" (azul de madrugada) ou "cal" (quase branco com limão)
  const [theme, setTheme] = useState<'noite' | 'cal'>(
    () => (localStorage.getItem('kronos-theme') as 'noite' | 'cal') ?? 'noite'
  );
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'noite' ? 'cal' : 'noite';
      localStorage.setItem('kronos-theme', next);
      return next;
    });
  }, []);

  // A classe no <html> faz o fundo da página acompanhar o tema
  useEffect(() => {
    document.documentElement.classList.toggle('theme-cal', theme === 'cal');
    document.documentElement.classList.toggle('theme-noite', theme === 'noite');
  }, [theme]);
  // Aviso global (erro ou sucesso) — substitui os alert() do navegador
  const [toast, setToast] = useState<{ text: string; kind: 'erro' | 'ok' } | null>(null);
  const notify = useCallback((text: string, kind: 'erro' | 'ok' = 'erro') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<{dayId: string, exercise: Exercise} | null>(null);
  const [squadId, setSquadId] = useState<string | null>(null);
  const [isPersonal, setIsPersonal] = useState(false);
  const [checkingSquad, setCheckingSquad] = useState(true);
  const [squadLoading, setSquadLoading] = useState(false);
  const [selectedWeekDay, setSelectedWeekDay] = useState<number>(() => (new Date().getDay() + 6) % 7);
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => (new Date().getDay() + 6) % 7);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [diasTreinados, setDiasTreinados] = useState(0);
  const [memberStreaks, setMemberStreaks] = useState<Record<string, number>>({});
  const [progressStats, setProgressStats] = useState<{
    thisWeekByDate: Record<string, number>;
    lastWeekByDate: Record<string, number>;
    loading: boolean;
  }>({ thisWeekByDate: {}, lastWeekByDate: {}, loading: false });

  // Exercícios rastreados pelo usuário (independente do plano)
  type TrackedExercise = { id: string; name: string };
  type LoadEntry       = { id: string; date: string; load_notes: string };
  const [trackedExercises, setTrackedExercises] = useState<TrackedExercise[]>([]);
  const [loadHistory, setLoadHistory]           = useState<Record<string, LoadEntry[]>>({});
  const [loadInputs, setLoadInputs]             = useState<Record<string, string>>({});
  const [savedLoadIds, setSavedLoadIds]         = useState<Set<string>>(new Set());
  const [loadsLoading, setLoadsLoading]         = useState(false);

  // ── Features: set tracking, rest timer, per-set loads, PR ───────────────────
  const [setProgress, setSetProgress] = useState<Record<string, boolean[]>>({});
  const [restTimer, setRestTimer] = useState<{ exerciseId: string; remaining: number; total: number } | null>(null);
  // Cargas por série do dia. Ficam no banco (tabela set_logs) para não sumirem
  // ao trocar de aparelho ou limpar o cache.
  const [setLoadData, setSetLoadData] = useState<Record<string, Array<{ weight: string; reps: string; rpe: string }>>>({});
  const [prIds, setPrIds] = useState<Set<string>>(new Set());
  // Maior peso já registrado por exercício, vindo do banco
  const [personalRecords, setPersonalRecords] = useState<Record<string, number>>({});
  // Resumo da última sessão de cada exercício (ex: "4×10 · 75 kg")
  const [previousLoads, setPreviousLoads] = useState<Record<string, string>>({});
  // Modo treino em andamento
  const [sessao, setSessao] = useState<{ id: string; startedAt: string } | null>(null);
  const [sessaoDuracao, setSessaoDuracao] = useState(0);
  const [pulados, setPulados] = useState<Set<string>>(new Set());
  // Estado da fila offline (mostra o aviso de pendências)
  const [fila, setFila] = useState<EstadoFila>({
    pendentes: 0, online: true, sincronizando: false, falhou: false,
  });
  // Evolução de carga: maior peso por data, agrupado por exercício
  const [evolution, setEvolution] = useState<Record<string, { name: string; points: { date: string; kg: number }[] }>>({});
  const [evolutionPick, setEvolutionPick] = useState<string | null>(null);
  // Dias com treino registrado, para o calendário do mês
  const [trainedDates, setTrainedDates] = useState<Set<string>>(new Set());
  // Resumo semanal gerado por IA
  const [weekReport, setWeekReport] = useState<string | null>(null);
  const [weekReportLoading, setWeekReportLoading] = useState(false);
  const loadSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Fila offline: observa o estado e sincroniza quando a conexão volta
  useEffect(() => {
    const parar = observarFila(setFila);
    const pararAuto = iniciarSincronizacaoAutomatica();
    return () => { parar(); pararAuto(); };
  }, []);

  // Retoma a sessão que ficou aberta (app fechado no meio do treino)
  useEffect(() => {
    if (!session?.user?.id) return;
    api
      .from('workout_sessions')
      .select('id, started_at')
      .eq('user_id', session.user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) setSessao({ id: data[0].id, startedAt: data[0].started_at });
      });
  }, [session?.user?.id]);

  // Cronômetro da sessão
  useEffect(() => {
    if (!sessao) return;
    const calcular = () =>
      setSessaoDuracao(Math.max(0, Math.floor((Date.now() - new Date(sessao.startedAt).getTime()) / 1000)));
    calcular();
    const id = setInterval(calcular, 1000);
    return () => clearInterval(id);
  }, [sessao]);

  // Exercícios pulados hoje
  useEffect(() => {
    if (!session?.user?.id) return;
    api
      .from('exercise_progress')
      .select('exercise_id')
      .eq('user_id', session.user.id)
      .eq('date', localDateStr())
      .eq('skipped', true)
      .then(({ data }) => {
        if (data) setPulados(new Set(data.map((r: any) => r.exercise_id)));
      });
  }, [session?.user?.id]);

  // ── Rotas por hash (#/dieta/corpo) ──
  // Hash em vez de caminho: funciona em hospedagem estática sem precisar
  // configurar reescrita no servidor. Resolve o F5 perdendo a aba e o botão
  // voltar do celular saindo do app.
  useEffect(() => {
    const applyHash = () => {
      const [view, sub] = window.location.hash.replace(/^#\/?/, '').split('/');
      const views: ViewType[] = ['treino', 'dieta', 'ia', 'settings'];
      if (!views.includes(view as ViewType)) return;

      setCurrentView(view as ViewType);
      if (view === 'treino' && ['hoje', 'semana', 'progresso'].includes(sub)) {
        setTreinoTab(sub as TreinoTab);
      }
      if (view === 'dieta' && ['agua', 'refeicoes', 'corpo'].includes(sub)) {
        setDietaTab(sub as DietaTab);
      }
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  // Reflete a navegação na URL, mantendo o histórico do navegador utilizável
  useEffect(() => {
    const sub = currentView === 'treino' ? treinoTab : currentView === 'dieta' ? dietaTab : '';
    const next = `#/${currentView}${sub ? '/' + sub : ''}`;
    if (window.location.hash !== next) {
      window.history.pushState(null, '', next);
    }
  }, [currentView, treinoTab, dietaTab]);

  useEffect(() => {
    api.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = api.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
  if (!session) {
    setCheckingSquad(false);
    return;
  }

  const resolveWorkspace = async () => {
    const ws = await findWorkspace(session.user.id);

    if (ws) {
      setSquadId(ws.id);
      setIsPersonal(ws.personal);
    } else {
      // Sem nenhum espaço: cria um pessoal para treinar sozinho
      setSquadId(await createPersonalWorkspace());
      setIsPersonal(true);
    }
    setCheckingSquad(false);
  };

  resolveWorkspace();
}, [session?.user?.id]);

useEffect(() => {
  if (!squadId || !session) return;
  const currentSession = session;

  const load = async () => {
    setSquadLoading(true);
    const today = localDateStr();
    const oneYearAgo = localDateStr(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

    // ── Batch 1: 3 requisições em paralelo ──────────────────────────────────
    const [
      { data: squadData },
      { data: membersData },
      { data: daysData },
    ] = await Promise.all([
      api.from('squads').select('id, name, icon, invite_code').eq('id', squadId).single(),
      api.from('squad_members').select('user_id, role').eq('squad_id', squadId),
      api.from('workout_days').select('id, name, focus, day_order').eq('squad_id', squadId).order('day_order'),
    ]);

    if (!squadData || !daysData) { setSquadLoading(false); return; }

    const dayIds = daysData.map((d: any) => d.id);
    const memberUserIds = (membersData || []).map((m: any) => m.user_id);
    const allUserIds = [...new Set([...memberUserIds, currentSession.user.id])];

    // ── Batch 2: 4 requisições em paralelo ──────────────────────────────────
    // Exercícios: 1 query com .in() em vez de N queries separadas
    const [
      { data: exercisesData },
      { data: progressData },
      { data: profilesData },
      { data: allProgressData },
      { data: membersProgressData },
    ] = await Promise.all([
      api.from('exercises').select('id, name, sets, reps, rest, notes, workout_day_id').in('workout_day_id', dayIds).order('created_at', { ascending: true }),
      api.from('exercise_progress').select('exercise_id, completed').eq('user_id', currentSession.user.id).eq('date', today),
      api.from('profiles').select('id, name, avatar_url').in('id', allUserIds),
      api.from('exercise_progress').select('date').eq('user_id', currentSession.user.id).eq('completed', true).gte('date', oneYearAgo),
      memberUserIds.length > 0
        ? api.from('exercise_progress').select('user_id, date').in('user_id', memberUserIds).eq('completed', true).gte('date', oneYearAgo)
        : Promise.resolve({ data: [] }),
    ]);

    // ── Montar estado completo de uma vez ────────────────────────────────────
    const progressMap = new Map((progressData || []).map((p: any) => [p.exercise_id, p.completed]));
    const profileMap  = new Map((profilesData  || []).map((p: any) => [p.id, p]));

    // Agrupar exercícios por dia
    const exercisesByDay = new Map<string, Exercise[]>();
    for (const ex of (exercisesData || [])) {
      const arr = exercisesByDay.get(ex.workout_day_id) ?? [];
      arr.push({
        id: ex.id,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        rest: ex.rest,
        notes: ex.notes ?? undefined,
        completed: progressMap.get(ex.id) ?? false,
      });
      exercisesByDay.set(ex.workout_day_id, arr);
    }

    setSquad({
      id: squadData.id,
      name: squadData.name,
      icon: squadData.icon || '',
      inviteCode: squadData.invite_code,
      templates: [],
      members: (membersData || []).map((m: any) => ({
        id: m.user_id,
        name: profileMap.get(m.user_id)?.name || (m.user_id === currentSession.user.id ? currentSession.user.email : 'Membro'),
        avatar: profileMap.get(m.user_id)?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.user_id}`,
        role: m.role,
        isOnline: m.user_id === currentSession.user.id,
      })),
      weeklyPlan: daysData.map((day: any) => ({
        id: day.id,
        name: day.name,
        focus: day.focus || '',
        exercises: exercisesByDay.get(day.id) ?? [],
      })),
    });

    // Índices dos dias com treino (Seg=0…Dom=6) — dias sem exercícios = descanso
    const trainingDayIndices = daysData
      .map((_: any, idx: number) =>
        (exercisesByDay.get(daysData[idx].id) ?? []).length > 0 ? idx : -1
      )
      .filter((i: number) => i !== -1);

    // Dias treinados (streak consecutivo) — dados já vêm no batch 2
    const myDates = (allProgressData || []).map((r: any) => r.date as string);
    setDiasTreinados(calcStreak(myDates, trainingDayIndices));

    // Streak consecutivo por membro do squad (mesmo plano = mesmos dias de treino)
    const streaksByMember: Record<string, number> = {};
    const mpData = (membersProgressData || []) as { user_id: string; date: string }[];
    const datesByMember: Record<string, string[]> = {};
    for (const row of mpData) {
      if (!datesByMember[row.user_id]) datesByMember[row.user_id] = [];
      datesByMember[row.user_id].push(row.date);
    }
    for (const uid of memberUserIds) {
      streaksByMember[uid] = calcStreak(datesByMember[uid] || [], trainingDayIndices);
    }
    setMemberStreaks(streaksByMember);
    setSquadLoading(false);
  };

  load().catch(console.error);
}, [squadId]);

  const fetchDiasTreinados = useCallback(async () => {
    if (!session?.user?.id) return;

    const trainingDayIndices = squad.weeklyPlan
      .map((day, idx) => day.exercises.length > 0 ? idx : -1)
      .filter(i => i !== -1);

    const oneYearAgo = localDateStr(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    const { data } = await api
      .from('exercise_progress')
      .select('date')
      .eq('user_id', session.user.id)
      .eq('completed', true)
      .gte('date', oneYearAgo);
    const myDates = (data || []).map((r: any) => r.date as string);
    setDiasTreinados(calcStreak(myDates, trainingDayIndices));
  }, [session?.user?.id, squad.weeklyPlan]);

  const fetchProgressStats = useCallback(async () => {
    if (!session?.user?.id) return;
    setProgressStats(p => ({ ...p, loading: true }));

    const getWeekRange = (offsetWeeks = 0) => {
      const now = new Date();
      const dayOfWeek = (now.getDay() + 6) % 7; // Seg=0
      const monday = new Date(now);
      monday.setDate(now.getDate() - dayOfWeek + offsetWeeks * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        start: localDateStr(monday),
        end: localDateStr(sunday),
      };
    };

    const thisWeek = getWeekRange(0);
    const lastWeek = getWeekRange(-1);

    const [{ data: thisData }, { data: lastData }] = await Promise.all([
      api.from('exercise_progress').select('date').eq('user_id', session.user.id).eq('completed', true).gte('date', thisWeek.start).lte('date', thisWeek.end),
      api.from('exercise_progress').select('date').eq('user_id', session.user.id).eq('completed', true).gte('date', lastWeek.start).lte('date', lastWeek.end),
    ]);

    const countByDate = (rows: { date: string }[]) => {
      const result: Record<string, number> = {};
      for (const row of (rows || [])) result[row.date] = (result[row.date] ?? 0) + 1;
      return result;
    };

    setProgressStats({
      thisWeekByDate: countByDate(thisData ?? []),
      lastWeekByDate: countByDate(lastData ?? []),
      loading: false,
    });
  }, [session?.user?.id]);

  useEffect(() => {
    if (currentView === 'treino' && treinoTab === 'progresso') fetchProgressStats();
  }, [currentView, treinoTab, fetchProgressStats]);

  // Evolução de carga por exercício (alimenta o gráfico da aba Progresso)
  useEffect(() => {
    if (currentView !== 'treino' || treinoTab !== 'progresso' || !session?.user?.id) return;

    const sixMonthsAgo = localDateStr(new Date(Date.now() - 182 * 24 * 60 * 60 * 1000));

    // Dias com pelo menos um exercício concluído (calendário)
    api
      .from('exercise_progress')
      .select('date')
      .eq('user_id', session.user.id)
      .eq('completed', true)
      .gte('date', localDateStr(new Date(Date.now() - 370 * 24 * 60 * 60 * 1000)))
      .then(({ data }) => {
        if (data) setTrainedDates(new Set(data.map((r: any) => r.date)));
      });

    api
      .from('set_logs')
      .select('exercise_id, date, weight, exercises(name)')
      .eq('user_id', session.user.id)
      .gte('date', sixMonthsAgo)
      .not('weight', 'is', null)
      .order('date', { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const acc: Record<string, { name: string; byDate: Record<string, number> }> = {};

        for (const row of data as any[]) {
          const rel = row.exercises;
          const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? 'Exercício';
          const entry = (acc[row.exercise_id] ??= { name, byDate: {} });
          const kg = Number(row.weight);
          // Guarda só a maior carga de cada dia
          entry.byDate[row.date] = Math.max(entry.byDate[row.date] ?? 0, kg);
        }

        const built: Record<string, { name: string; points: { date: string; kg: number }[] }> = {};
        for (const [id, e] of Object.entries(acc)) {
          const points = Object.entries(e.byDate)
            .map(([date, kg]) => ({ date, kg }))
            .sort((a, b) => a.date.localeCompare(b.date));
          if (points.length >= 2) built[id] = { name: e.name, points };
        }
        setEvolution(built);
        setEvolutionPick(prev => (prev && built[prev] ? prev : Object.keys(built)[0] ?? null));
      });
  }, [currentView, treinoTab, session?.user?.id]);

  useEffect(() => {
    if (currentView !== 'treino' || treinoTab !== 'progresso' || !session?.user?.id) return;
    setLoadsLoading(true);

    api
      .from('tracked_exercises')
      .select('id, name')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true })
      .then(async ({ data: exData }) => {
        const exList = (exData || []) as { id: string; name: string }[];
        setTrackedExercises(exList);

        if (exList.length === 0) { setLoadsLoading(false); return; }

        const { data: loadsData } = await api
          .from('exercise_loads')
          .select('id, tracked_exercise_id, date, load_notes')
          .eq('user_id', session.user.id)
          .in('tracked_exercise_id', exList.map(e => e.id))
          .order('date', { ascending: false });

        const grouped: Record<string, { id: string; date: string; load_notes: string }[]> = {};
        for (const row of (loadsData || [])) {
          if (!grouped[row.tracked_exercise_id]) grouped[row.tracked_exercise_id] = [];
          grouped[row.tracked_exercise_id].push({ id: row.id, date: row.date, load_notes: row.load_notes });
        }
        setLoadHistory(grouped);

        // Pré-preenche o campo com o último registro
        const inputs: Record<string, string> = {};
        for (const [exId, entries] of Object.entries(grouped)) {
          if (entries[0]) inputs[exId] = entries[0].load_notes;
        }
        setLoadInputs(inputs);
        setLoadsLoading(false);
      });
  }, [currentView, treinoTab, session?.user?.id]); // eslint-disable-line

  // Initialize setProgress when squad weeklyPlan loads
  useEffect(() => {
    setSetProgress(prev => {
      const next = { ...prev };
      for (const day of squad.weeklyPlan) {
        for (const ex of day.exercises) {
          if (!(ex.id in next)) {
            next[ex.id] = Array(ex.sets).fill(ex.completed);
          }
        }
      }
      return next;
    });
  }, [squad.weeklyPlan]);

  // Rest timer countdown + notificação ao zerar
  useEffect(() => {
    if (!restTimer) return;
    if (restTimer.remaining <= 0) {
      setRestTimer(null);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Descanse acabou! 💪', {
          body: 'Hora da próxima série',
          icon: '/kronos-icon.png',
          silent: false,
        });
      }
      return;
    }
    const id = setTimeout(() => {
      setRestTimer(prev => prev ? { ...prev, remaining: prev.remaining - 1 } : null);
    }, 1000);
    return () => clearTimeout(id);
  }, [restTimer]);

  // Carrega as cargas de hoje e os recordes assim que o plano da semana chega
  useEffect(() => {
    if (!session?.user?.id || squad.weeklyPlan.length === 0) return;

    const exerciseIds = squad.weeklyPlan.flatMap(d => d.exercises.map(e => e.id));
    if (exerciseIds.length === 0) return;

    const load = async () => {
      const [{ data: logs }, { data: prs }] = await Promise.all([
        api
          .from('set_logs')
          .select('exercise_id, set_index, weight, reps, rpe')
          .eq('user_id', session.user.id)
          .eq('date', localDateStr())
          .in('exercise_id', exerciseIds),
        api.rpc('exercise_personal_records'),
      ]);

      if (logs) {
        const byExercise: Record<string, Array<{ weight: string; reps: string; rpe: string }>> = {};
        for (const row of logs) {
          const arr = byExercise[row.exercise_id] ?? [];
          while (arr.length <= row.set_index) arr.push({ weight: '', reps: '', rpe: '' });
          arr[row.set_index] = {
            weight: row.weight != null ? String(row.weight) : '',
            reps: row.reps != null ? String(row.reps) : '',
            rpe: (row as any).rpe != null ? String((row as any).rpe) : '',
          };
          byExercise[row.exercise_id] = arr;
        }
        setSetLoadData(byExercise);
      }

      if (prs) {
        const map: Record<string, number> = {};
        for (const row of prs as { exercise_id: string; best_weight: number }[]) {
          map[row.exercise_id] = Number(row.best_weight);
        }
        setPersonalRecords(map);
      }

      // "Da última vez você fez...": pega a sessão anterior mais recente
      const { data: past } = await api
        .from('set_logs')
        .select('exercise_id, date, weight, reps')
        .eq('user_id', session.user.id)
        .lt('date', localDateStr())
        .in('exercise_id', exerciseIds)
        .order('date', { ascending: false });

      if (past) {
        const summary: Record<string, string> = {};
        const lastDate: Record<string, string> = {};
        const rows: Record<string, { weight: number | null; reps: number | null }[]> = {};

        for (const r of past) {
          // Só a data mais recente de cada exercício
          if (!lastDate[r.exercise_id]) lastDate[r.exercise_id] = r.date;
          if (r.date !== lastDate[r.exercise_id]) continue;
          (rows[r.exercise_id] ??= []).push({ weight: r.weight, reps: r.reps });
        }

        for (const [exId, sets] of Object.entries(rows)) {
          const weights = sets.map(s => s.weight).filter((w): w is number => w != null);
          const repsList = sets.map(s => s.reps).filter((r): r is number => r != null);
          if (weights.length === 0 && repsList.length === 0) continue;
          const topWeight = weights.length ? Math.max(...weights) : null;
          const reps = repsList.length ? Math.max(...repsList) : null;
          summary[exId] = [
            reps != null ? `${sets.length}×${reps}` : `${sets.length} séries`,
            topWeight != null ? `${topWeight} kg` : null,
          ].filter(Boolean).join(' · ');
        }
        setPreviousLoads(summary);
      }
    };

    load();
  }, [session?.user?.id, squad.weeklyPlan.length]); // eslint-disable-line

  // Request notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Returns condicionais (só depois de todos os hooks) ──
  if (authLoading || checkingSquad) return <div style={{ color: '#fff', padding: 40, background: 'var(--bg)', minHeight: '100vh' }}>Carregando...</div>;

  if (!session) return <Login />;

  const buildWeeklyReport = async () => {
    setWeekReportLoading(true);
    try {
      const facts = await collectWeekFacts(session.user.id);
      setWeekReport(await generateWeeklyReport(facts));
    } catch (err: any) {
      console.error('Erro ao gerar o resumo semanal:', err);
      notify(err?.message ?? 'Não foi possível gerar o resumo.');
    } finally {
      setWeekReportLoading(false);
    }
  };

  const refreshSquad = async () => {
    const ws = await findWorkspace(session.user.id);

    if (ws) {
      setSquadId(ws.id);
      setIsPersonal(ws.personal);
    } else {
      // Saiu da última equipe: volta para um espaço pessoal
      setSquadId(await createPersonalWorkspace());
      setIsPersonal(true);
    }
  };

  const openEditor = (dayId: string, exercise: Exercise) => {
    setEditingExercise({ dayId, exercise });
    setIsEditorOpen(true);
  };

  const saveExercise = (updatedEx: Exercise) => {
    if (!editingExercise) return;
    saveExerciseToDB(updatedEx).catch(err => {
      console.error(err);
      notify('Não foi possível salvar o exercício.');
    });
    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day =>
        day.id === editingExercise.dayId
          ? { ...day, exercises: day.exercises.map(ex => ex.id === updatedEx.id ? updatedEx : ex) }
          : day
      )
    }));
    setIsEditorOpen(false);
    setEditingExercise(null);
  };

  const createTrackedExercise = async (name: string): Promise<boolean> => {
    if (!name.trim()) return false;
    const { data, error } = await api
      .from('tracked_exercises')
      .insert({ user_id: session.user.id, name: name.trim() })
      .select('id, name')
      .single();
    if (error) {
      console.error('Erro ao criar exercício:', error);
      notify('Não foi possível criar o exercício.');
      return false;
    }
    if (data) setTrackedExercises(prev => [...prev, data as { id: string; name: string }]);
    return true;
  };

  const deleteTrackedExercise = async (id: string) => {
    const { error } = await api.from('tracked_exercises').delete().eq('id', id).eq('user_id', session.user.id);
    if (error) { console.error(error); notify('Não foi possível remover o exercício.'); return; }
    setTrackedExercises(prev => prev.filter(e => e.id !== id));
    setLoadHistory(prev => { const n = { ...prev }; delete n[id]; return n; });
    setLoadInputs(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const saveLoad = async (trackedExId: string, notes: string) => {
    if (!notes.trim()) return;
    const today = localDateStr();
    const { data, error } = await api
      .from('exercise_loads')
      .insert({ tracked_exercise_id: trackedExId, user_id: session.user.id, date: today, load_notes: notes.trim() })
      .select('id, date, load_notes')
      .single();
    if (error || !data) {
      console.error('Erro ao salvar carga:', error);
      notify('Não foi possível salvar a carga. Tente de novo.');
      return;
    }
    {
      setLoadHistory(prev => ({
        ...prev,
        [trackedExId]: [{ id: data.id, date: data.date, load_notes: data.load_notes }, ...(prev[trackedExId] ?? [])],
      }));
      setLoadInputs(prev => ({ ...prev, [trackedExId]: '' }));
      setSavedLoadIds(prev => new Set(prev).add(trackedExId));
      setTimeout(() => setSavedLoadIds(prev => { const s = new Set(prev); s.delete(trackedExId); return s; }), 2000);
    }
  };

  const deleteLoad = async (trackedExId: string, loadId: string) => {
    const { error } = await api.from('exercise_loads').delete().eq('id', loadId).eq('user_id', session.user.id);
    if (error) { console.error(error); notify('Não foi possível remover o registro.'); return; }
    setLoadHistory(prev => ({
      ...prev,
      [trackedExId]: (prev[trackedExId] ?? []).filter(e => e.id !== loadId),
    }));
  };

  const applyAIWorkout = async (dayName: string, focus: string, aiExercises: WorkoutExercise[]) => {
    const day = squad.weeklyPlan.find(
      d => d.name.toLowerCase() === dayName.toLowerCase()
    );
    if (!day) return;

    // Deleta exercícios existentes do dia
    await Promise.all(day.exercises.map(ex => deleteExerciseFromDB(ex.id)));

    // Cria os novos exercícios
    const newExercises: Exercise[] = aiExercises.map(ex => ({
      id: crypto.randomUUID(),
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      rest: ex.rest,
      notes: ex.notes,
      completed: false,
    }));

    await Promise.all(newExercises.map(ex => addExerciseToDB(day.id, ex)));

    // Atualiza o foco do dia
    await api.from('workout_days').update({ focus }).eq('id', day.id);

    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(d =>
        d.id === day.id ? { ...d, focus, exercises: newExercises } : d
      ),
    }));
  };

  const todayIndex = (new Date().getDay() + 6) % 7; // Adjust to Monday = 0
  const todayId = squad.weeklyPlan[todayIndex]?.id ?? squad.weeklyPlan[0]?.id ?? '';

  const toggleExercise = async (dayId: string, exerciseId: string) => {
    const day = squad.weeklyPlan.find(d => d.id === dayId);
    const ex = day?.exercises.find(e => e.id === exerciseId);
    if (!ex) return;

    const newCompleted = !ex.completed;

    // Passa pela fila: sem internet fica guardado e sobe depois
    await enfileirar({
      tipo: 'exercise_progress',
      chave: `${exerciseId}:${localDateStr()}`,
      dados: {
        exercise_id: exerciseId,
        user_id: session.user.id,
        completed: newCompleted,
        skipped: false,
        date: localDateStr(),
      },
    });

    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day =>
        day.id === dayId
          ? { ...day, exercises: day.exercises.map(ex =>
              ex.id === exerciseId ? { ...ex, completed: newCompleted } : ex
            )}
          : day
      )
    }));

    fetchDiasTreinados();
  };

  const resetDay = async (dayId: string) => {
    const day = squad.weeklyPlan.find(d => d.id === dayId);
    if (day && day.exercises.length > 0) {
      const { error } = await api
        .from('exercise_progress')
        .delete()
        .eq('user_id', session.user.id)
        .eq('date', localDateStr())
        .in('exercise_id', day.exercises.map(e => e.id));
      if (error) {
        console.error('Erro ao resetar o dia:', error);
        notify('Não foi possível resetar o dia.');
        return;
      }
    }
    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(d =>
        d.id === dayId
          ? { ...d, exercises: d.exercises.map(ex => ({ ...ex, completed: false })) }
          : d
      )
    }));
    fetchDiasTreinados();
  };

  const handleSetToggle = (dayId: string, exercise: Exercise, setIndex: number) => {
    const current = setProgress[exercise.id] ?? Array(exercise.sets).fill(false);
    const updated = [...current];
    updated[setIndex] = !updated[setIndex];

    const allDone = updated.every(Boolean);
    const wasAllDone = current.every(Boolean);

    setSetProgress(prev => ({ ...prev, [exercise.id]: updated }));

    // Registra a série (marcada/desmarcada) junto com peso e reps
    persistSetLog(
      exercise.id,
      setIndex,
      setLoadData[exercise.id]?.[setIndex] ?? { weight: '', reps: '', rpe: '' },
      updated[setIndex]
    );

    if (allDone && !wasAllDone && !exercise.completed) toggleExercise(dayId, exercise.id);
    if (!allDone && wasAllDone && exercise.completed) toggleExercise(dayId, exercise.id);

    if (updated[setIndex]) {
      const secs = parseRestSeconds(exercise.rest);
      if (secs > 0) setRestTimer({ exerciseId: exercise.id, remaining: secs, total: secs });

      // Recorde: compara com o maior peso já registrado no banco
      const weight = parseFloat((setLoadData[exercise.id]?.[setIndex]?.weight ?? '').replace(',', '.'));
      if (!isNaN(weight) && weight > 0 && weight > (personalRecords[exercise.id] ?? 0)) {
        setPersonalRecords(prev => ({ ...prev, [exercise.id]: weight }));
        setPrIds(prev => new Set(prev).add(exercise.id));
        setTimeout(() => setPrIds(prev => { const s = new Set(prev); s.delete(exercise.id); return s; }), 6000);
      }
    } else {
      setRestTimer(prev => prev?.exerciseId === exercise.id ? null : prev);
    }
  };

  const handleLoadChange = (exerciseId: string, setIndex: number, field: 'weight' | 'reps' | 'rpe', val: string) => {
    let updatedSet = { weight: '', reps: '', rpe: '' };

    setSetLoadData(prev => {
      const sets = prev[exerciseId] ? [...prev[exerciseId]] : [];
      while (sets.length <= setIndex) sets.push({ weight: '', reps: '', rpe: '' });
      sets[setIndex] = { ...sets[setIndex], [field]: val };
      updatedSet = sets[setIndex];
      return { ...prev, [exerciseId]: sets };
    });

    // Grava no banco com atraso: evita uma requisição por tecla digitada
    const key = `${exerciseId}:${setIndex}`;
    clearTimeout(loadSaveTimers.current[key]);
    loadSaveTimers.current[key] = setTimeout(() => {
      persistSetLog(exerciseId, setIndex, updatedSet);
    }, 700);
  };

  // Salva (ou atualiza) uma série no banco
  const persistSetLog = async (
    exerciseId: string,
    setIndex: number,
    values: { weight: string; reps: string; rpe?: string },
    done?: boolean
  ) => {
    const weight = values.weight.trim() === '' ? null : Number(values.weight.replace(',', '.'));
    const reps = values.reps.trim() === '' ? null : parseInt(values.reps, 10);

    const rpeBruto = values.rpe?.trim();
    const rpe = !rpeBruto ? null : Math.min(10, Math.max(1, parseInt(rpeBruto, 10)));

    const row: Record<string, unknown> = {
      user_id: session.user.id,
      exercise_id: exerciseId,
      date: localDateStr(),
      set_index: setIndex,
      weight: Number.isFinite(weight as number) ? weight : null,
      reps: Number.isFinite(reps as number) ? reps : null,
      rpe: Number.isFinite(rpe as number) ? rpe : null,
      updated_at: new Date().toISOString(),
    };
    if (done !== undefined) row.done = done;

    await enfileirar({
      tipo: 'set_log',
      chave: `${exerciseId}:${localDateStr()}:${setIndex}`,
      dados: row,
    });
  };

  // ── Pular exercício ──
  // Diferente de "não fiz": registra a intenção, some da lista ativa e não
  // conta como pendente no progresso do dia.
  const pularExercicio = async (exerciseId: string) => {
    const jaPulado = pulados.has(exerciseId);
    setPulados(prev => {
      const s = new Set(prev);
      if (jaPulado) s.delete(exerciseId); else s.add(exerciseId);
      return s;
    });

    await enfileirar({
      tipo: 'exercise_progress',
      chave: `${exerciseId}:${localDateStr()}`,
      dados: {
        exercise_id: exerciseId,
        user_id: session.user.id,
        completed: false,
        skipped: !jaPulado,
        date: localDateStr(),
      },
    });
  };

  // ── Sessão de treino ──
  const iniciarSessao = async () => {
    const { data, error } = await api
      .from('workout_sessions')
      .insert({
        user_id: session.user.id,
        workout_day_id: activeDayId || null,
        date: localDateStr(),
      })
      .select('id, started_at')
      .single();

    if (error) {
      console.error('Erro ao iniciar a sessão:', error);
      notify('Não foi possível iniciar o treino.');
      return;
    }
    setSessao({ id: data.id, startedAt: data.started_at });
  };

  const encerrarSessao = async () => {
    if (!sessao) return;
    // Garante que nada ficou pendente antes de fechar o treino
    await sincronizar();

    const { data, error } = await api.rpc('finish_workout_session', {
      p_session_id: sessao.id,
    });

    if (error) {
      console.error('Erro ao encerrar a sessão:', error);
      notify('Não foi possível encerrar o treino.');
      return;
    }
    const volume = Number((data as any)?.total_volume ?? 0);
    const minutos = Math.max(1, Math.round(sessaoDuracao / 60));
    setSessao(null);
    setSessaoDuracao(0);
    notify(
      volume > 0
        ? `Treino encerrado — ${minutos} min · ${volume.toLocaleString('pt-BR')} kg de volume`
        : `Treino encerrado — ${minutos} min`,
      'ok'
    );
    fetchDiasTreinados();
  };

  const addExercise = (dayId: string) => {
    const newEx: Exercise = {
      id: crypto.randomUUID(),
      name: 'Novo Exercício',
      sets: 3,
      reps: '12',
      rest: '60s',
      completed: false
    };
    addExerciseToDB(dayId, newEx).catch(err => {
      console.error(err);
      notify('Não foi possível criar o exercício.');
    });
    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day =>
        day.id === dayId ? { ...day, exercises: [...day.exercises, newEx] } : day
      )
    }));
    openEditor(dayId, newEx);
  };

  const deleteExercise = (dayId: string, exId: string) => {
    deleteExerciseFromDB(exId).catch(err => {
      console.error(err);
      notify('Não foi possível remover o exercício.');
    });
    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day =>
        day.id === dayId ? { ...day, exercises: day.exercises.filter(ex => ex.id !== exId) } : day
      )
    }));
  };

  const updateDayFocus = (dayId: string, focus: string) => {
    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day =>
        day.id === dayId ? { ...day, focus } : day
      )
    }));

    api
      .from('workout_days')
      .update({ focus })
      .eq('id', dayId)
      .then(({ error }) => {
        if (error) console.error('Erro ao salvar foco:', error);
      });
  };

  const loadTemplate = (dayId: string, templateId: string) => {
    const template = squad.templates.find(t => t.id === templateId);
    if (!template) return;

    setSquad(prev => ({
      ...prev,
      weeklyPlan: prev.weeklyPlan.map(day => 
        day.id === dayId 
          ? { ...day, focus: template.name, exercises: template.exercises.map(ex => ({ ...ex, id: Math.random().toString(36).substring(2, 11) })) }
          : day
      )
    }));
  };

  const currentDayPlan = squad.weeklyPlan[activeDayIndex] ?? squad.weeklyPlan.find(d => d.id === todayId) ?? squad.weeklyPlan[0] ?? { id: '', name: '', focus: '', exercises: [] };
  const activeDayId = currentDayPlan.id;
  const completedCount = currentDayPlan.exercises.filter(ex => ex.completed).length;
  const totalCount = currentDayPlan.exercises.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={`flex h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden theme-${theme}`}>
      {/* Sidebar — só aparece em telas md+ */}
      <aside className="hidden md:flex w-52 border-r border-[var(--border)] flex-col py-6 bg-[var(--bg)] z-20 shrink-0">
        <div className="px-5 mb-8">
          <p className="text-[10px] text-[var(--text-2)] font-medium uppercase tracking-widest mb-1.5">{isPersonal ? 'Treino' : 'Squad'}</p>
          <p className="text-sm font-semibold text-[var(--text)] truncate">{squad.name || 'Kronos'}</p>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 flex-1">
          <NavItem icon={<Dumbbell size={16} />} label="Treino" active={currentView === 'treino'} onClick={() => setCurrentView('treino')} />
          <NavItem icon={<Apple size={16} />} label="Dieta" active={currentView === 'dieta'} onClick={() => setCurrentView('dieta')} />
          <NavItem icon={<Sparkles size={16} />} label="IA" active={currentView === 'ia'} onClick={() => setCurrentView('ia')} />
        </nav>

        <div className="px-3">
          <NavItem icon={<SettingsIcon size={16} />} label="Configurações" active={currentView === 'settings'} onClick={() => setCurrentView('settings')} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="max-w-5xl mx-auto p-4 md:p-8 pb-28 md:pb-10">
          {/* Header */}
          <header className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-[26px] font-bold text-[var(--text)]">
                {currentView === 'treino' && 'Treino'}
                {currentView === 'dieta' && 'Dieta'}
                {currentView === 'settings' && 'Configurações'}
                {currentView === 'ia' && 'Kronos AI'}
              </h2>
              <p className="text-xs text-[var(--text-2)] mt-0.5 capitalize">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                title={theme === 'noite' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
                aria-label="Alternar tema"
                className="p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {theme === 'noite' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <AppSwitcher currentApp="treino" userEmail={session?.user?.email} />
            </div>
          </header>

          {/* Sub-abas do Treino */}
          {currentView === 'treino' && (
            <div className="flex gap-6 mb-6 border-b border-[var(--border)]">
              {([
                { id: 'hoje',      label: 'Hoje' },
                { id: 'semana',    label: 'Semana' },
                { id: 'progresso', label: 'Progresso' },
              ] as { id: TreinoTab; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setTreinoTab(tab.id)}
                  className={`relative pb-2.5 text-[13.5px] font-medium transition-colors ${
                    treinoTab === tab.id ? 'text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab.label}
                  {treinoTab === tab.id && (
                    <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              ))}
            </div>
          )}

          {currentView === 'treino' && treinoTab === 'hoje' && squadLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-48" />
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-14" />
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-14" />
              </div>
              <div className="space-y-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-24" />
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-40" />
              </div>
            </div>
          )}

          {currentView === 'treino' && treinoTab === 'hoje' && !squadLoading && (
            <>
            {/* Aviso de pendências offline */}
            {(!fila.online || fila.pendentes > 0) && (
              <div className="flex items-center gap-2.5 mb-4 px-3.5 py-2.5 rounded-xl border border-[var(--load)] bg-[var(--load-soft)]">
                <WifiOff size={15} className="text-[var(--load)] shrink-0" />
                <p className="flex-1 text-[12.5px] text-[var(--load)]">
                  {!fila.online
                    ? `Sem conexão — ${fila.pendentes} ${fila.pendentes === 1 ? 'alteração guardada' : 'alterações guardadas'}. Pode treinar normalmente.`
                    : fila.sincronizando
                      ? 'Sincronizando o que ficou pendente...'
                      : `${fila.pendentes} ${fila.pendentes === 1 ? 'alteração pendente' : 'alterações pendentes'}`}
                </p>
                {fila.online && !fila.sincronizando && (
                  <button
                    onClick={() => sincronizar()}
                    className="shrink-0 text-[11.5px] font-semibold text-[var(--load)] underline"
                  >
                    Enviar agora
                  </button>
                )}
              </div>
            )}

            {/* Modo treino em andamento */}
            <div className="mb-4">
              {sessao ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                      Treino em andamento
                    </p>
                    <p className="font-display text-xl font-bold tabular-nums text-[var(--text)] mt-0.5">
                      {String(Math.floor(sessaoDuracao / 3600)).padStart(2, '0')}:
                      {String(Math.floor((sessaoDuracao % 3600) / 60)).padStart(2, '0')}:
                      {String(sessaoDuracao % 60).padStart(2, '0')}
                    </p>
                  </div>
                  <button
                    onClick={encerrarSessao}
                    className="shrink-0 px-4 py-2.5 rounded-lg bg-[var(--btn-bg)] text-[var(--btn-fg)] text-[12.5px] font-semibold transition-colors hover:bg-[var(--btn-bg-hover)]"
                  >
                    Encerrar
                  </button>
                </div>
              ) : (
                <button
                  onClick={iniciarSessao}
                  disabled={currentDayPlan.exercises.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[var(--btn-bg)] text-[var(--btn-fg)] text-sm font-semibold transition-colors hover:bg-[var(--btn-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play size={16} /> Iniciar treino
                </button>
              )}
            </div>

            {/* Sequência + semana */}
            <div className="flex gap-3 mb-4 lg:hidden">
              {(() => {
                const { badge } = getStreakStyle(diasTreinados);
                return (
                  <div className="flex-1 relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                    {/* Brilho radial no canto */}
                    <span className="pointer-events-none absolute -top-10 -right-10 w-[120px] h-[120px] rounded-full"
                      style={{ background: 'radial-gradient(circle, rgba(139,92,246,.16), transparent 70%)' }} />
                    <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">Sequência</p>
                    <div className="flex items-baseline gap-1.5 mt-2.5">
                      <span className="font-display text-[30px] font-extrabold tabular-nums tracking-[-0.03em] text-[var(--text)]">{diasTreinados}</span>
                      <span className="text-[13px] font-medium text-[var(--text-2)]">
                        dias <span className="inline-block animate-pulse">🔥</span>
                      </span>
                    </div>
                    {badge && (
                      <div className="inline-block mt-3 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] px-2.5 py-[5px] text-[10.5px] font-semibold">
                        recorde {badge}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="w-[132px] bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">Esta semana</p>
                <div className="flex gap-1.5 mt-3.5">
                  {squad.weeklyPlan.map(day => {
                    const isDone = day.exercises.length > 0 && day.exercises.every(e => e.completed);
                    return (
                      <span key={day.id} className="w-[9px] h-[9px] rounded-full transition-colors"
                        style={{ background: isDone ? 'var(--accent)' : 'var(--border)' }} />
                    );
                  })}
                </div>
                <p className="text-[11px] font-medium text-[var(--text-3)] mt-3.5">
                  {squad.weeklyPlan.filter(d => d.exercises.length > 0 && d.exercises.every(e => e.completed)).length} de{' '}
                  {squad.weeklyPlan.filter(d => d.exercises.length > 0).length} treinos
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column */}
              <div className="lg:col-span-2 space-y-4">

                {/* Hero card: foco + progresso */}
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 md:p-6">
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex-1 group relative">
                      <p className="text-[10px] text-[var(--text-3)] mb-2 uppercase tracking-[0.2em] font-semibold">{currentDayPlan.name}</p>
                      <input
                        type="text"
                        value={currentDayPlan.focus || ''}
                        onChange={(e) => updateDayFocus(activeDayId, e.target.value)}
                        placeholder="FOCO DO TREINO"
                        className="bg-transparent border-none text-[var(--text)] p-0 focus:ring-0 outline-none placeholder:text-[var(--border)] w-full uppercase"
                        style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 'clamp(1.6rem, 5vw, 2.4rem)', letterSpacing: '0.06em' }}
                      />
                      {squad.templates.length > 0 && (
                        <div className="absolute top-full left-0 mt-2 w-56 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl z-30 hidden group-focus-within:block max-h-44 overflow-y-auto">
                          {squad.templates.map(t => (
                            <button key={t.id} onClick={() => loadTemplate(activeDayId, t.id)}
                              className="w-full text-left px-4 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--border)] transition-colors flex justify-between items-center">
                              <span>{t.name}</span>
                              <span className="text-xs text-[var(--text-2)]">{t.exercises.length} exs</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      {/* Trocar dia */}
                      <div className="relative">
                        <button
                          onClick={() => setShowDayPicker(v => !v)}
                          className="p-2 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)] transition-colors"
                          title="Trocar treino">
                          <Calendar size={15} />
                        </button>
                        <AnimatePresence>
                          {showDayPicker && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -4 }}
                              transition={{ duration: 0.12 }}
                              className="absolute right-0 top-full mt-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl z-40 overflow-hidden shadow-xl min-w-[160px]">
                              {squad.weeklyPlan.map((day, idx) => {
                                const isActive = idx === activeDayIndex;
                                const isToday = idx === todayIndex;
                                const isDone = day.exercises.length > 0 && day.exercises.every(e => e.completed);
                                return (
                                  <button key={day.id}
                                    onClick={() => { setActiveDayIndex(idx); setShowDayPicker(false); }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors
                                      ${isActive ? 'bg-[var(--border)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'}`}>
                                    <span>{day.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      {isDone && <span className="text-[10px] text-[var(--btn-bg)]">✓</span>}
                                      {isToday && <span className="text-[9px] text-[var(--accent)] font-bold">HOJE</span>}
                                    </div>
                                  </button>
                                );
                              })}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <button onClick={() => resetDay(activeDayId)}
                        className="p-2 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)] transition-colors"
                        title="Resetar">
                        <RotateCcw size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <span className="text-4xl font-bold text-[var(--text)] tabular-nums">{completedCount}</span>
                      <span className="text-xl text-[var(--text-2)] font-medium"> / {totalCount}</span>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums ${progress === 100 ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'}`}>
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="w-full bg-[var(--surface-3)] h-1 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      className={`h-full rounded-full transition-colors ${progress === 100 ? 'bg-[var(--accent)]' : 'bg-[var(--text)]'}`}
                    />
                  </div>
                </div>

                {/* Lista de exercícios */}
                <div className="space-y-2">
                  {currentDayPlan.exercises.length > 0 ? (
                    currentDayPlan.exercises.map((ex) => (
                      <ExerciseItem
                        key={ex.id}
                        exercise={ex}
                        setsDone={setProgress[ex.id] ?? Array(ex.sets).fill(ex.completed)}
                        loadData={setLoadData[ex.id] ?? []}
                        onSetToggle={(setIndex) => handleSetToggle(activeDayId, ex, setIndex)}
                        onLoadChange={(setIndex, field, val) => handleLoadChange(ex.id, setIndex, field, val)}
                        isPR={prIds.has(ex.id)}
                        previous={previousLoads[ex.id]}
                        skipped={pulados.has(ex.id)}
                        onSkip={() => pularExercicio(ex.id)}
                        showEdit={false}
                      />
                    ))
                  ) : (
                    <div className="py-16 text-center">
                      <Dumbbell className="w-8 h-8 text-[var(--border)] mx-auto mb-3" />
                      <p className="text-sm text-[var(--text-2)]">Nenhum exercício para hoje</p>
                      <p className="text-xs text-[var(--text-3)] mt-1">Descanso merecido</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column — desktop only for streak/week, squad always */}
              <div className="space-y-4">

                {/* Streak — hidden on mobile (shown in quick-stats above) */}
                {(() => {
                  const { color, badge } = getStreakStyle(diasTreinados);
                  return (
                    <div className="hidden lg:block bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5"
                      style={diasTreinados >= 7 ? { borderColor: color + '40' } : undefined}>
                      <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-medium mb-3">Sequência</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold tabular-nums" style={{ color }}>{diasTreinados}</span>
                        <span className="text-sm text-[var(--text-2)]">dias</span>
                      </div>
                      {badge && (
                        <p className="text-xs mt-2 font-medium" style={{ color }}>{badge}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Squad — só faz sentido quando treina com outras pessoas */}
                {!isPersonal && (
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                  <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-medium mb-4">Squad</p>
                  <div className="space-y-3">
                    {squad.members.map(member => {
                      const streak = memberStreaks[member.id] ?? 0;
                      return (
                        <div key={member.id} className="flex items-center gap-3">
                          <div className="relative shrink-0">
                            <img src={member.avatar} alt={member.name}
                              className="w-8 h-8 rounded-full bg-[var(--surface-3)]"
                              referrerPolicy="no-referrer" />
                            {member.isOnline && (
                              <div className="absolute bottom-0 right-0 w-2 h-2 bg-[var(--accent)] border border-[var(--surface)] rounded-full" />
                            )}
                          </div>
                          <p className="text-sm text-[var(--text)] font-medium truncate flex-1">{member.name}</p>
                          {streak > 0 && (
                            <span className="text-xs shrink-0 font-medium" style={{ color: getStreakStyle(streak).color }}>
                              🔥 {streak}
                            </span>
                          )}
                          {member.role === 'admin' && (
                            <span className="text-[10px] text-[var(--text-2)] shrink-0">admin</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}

                {/* Semana — hidden on mobile (shown in quick-stats above) */}
                <div className="hidden lg:block bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                  <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-medium mb-4">Esta Semana</p>
                  <div className="space-y-2">
                    {squad.weeklyPlan.map((day, idx) => {
                      const isToday = idx === todayIndex;
                      const isDone = day.exercises.length > 0 && day.exercises.every(e => e.completed);
                      return (
                        <div key={day.id} className={`flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors ${isToday ? 'bg-[var(--surface-3)]' : ''}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            isDone ? 'bg-[var(--accent)]' : isToday ? 'bg-[var(--border-strong)] ring-1 ring-[var(--accent-line)]' : 'bg-[var(--surface-3)]'
                          }`}>
                            {isDone && <CheckCircle2 size={12} className="text-[var(--btn-fg)]" />}
                          </div>
                          <p className={`text-sm flex-1 ${isToday ? 'text-[var(--text)] font-medium' : 'text-[var(--text-2)]'}`}>{day.name}</p>
                          <span className="text-[10px] text-[var(--text-3)]">{day.exercises.length}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            </>
          )}

          {currentView === 'treino' && treinoTab === 'semana' && (
            <>
              {/* Mobile: horizontal day tabs */}
              <div className="md:hidden">
                {/* Day selector */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {squad.weeklyPlan.map((day, idx) => {
                    const isDone = day.exercises.length > 0 && day.exercises.every(e => e.completed);
                    const isToday = idx === todayIndex;
                    const isSelected = idx === selectedWeekDay;
                    return (
                      <button key={day.id} onClick={() => setSelectedWeekDay(idx)}
                        className="flex flex-col items-center gap-1 shrink-0 transition-all"
                        style={{ minWidth: 44 }}>
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all text-xs font-semibold
                          ${isSelected
                            ? isDone ? 'bg-[var(--accent)] text-[var(--btn-fg)]' : 'bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]'
                            : isDone ? 'bg-[var(--accent-soft)] text-[var(--btn-bg)]'
                            : isToday ? 'bg-[var(--surface-3)] text-[var(--text)] ring-1 ring-[var(--border-strong)]'
                            : 'bg-transparent text-[var(--text-3)]'
                          }`}>
                          {isDone ? <CheckCircle2 size={16} /> : day.name.slice(0, 3)}
                        </div>
                        {isToday && (
                          <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Selected day content */}
                {(() => {
                  const day = squad.weeklyPlan[selectedWeekDay];
                  if (!day) return null;
                  const isToday = selectedWeekDay === todayIndex;
                  return (
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                      {/* Day header */}
                      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--surface-3)]">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="text-sm font-semibold text-[var(--text)]">{day.name}</h3>
                            {isToday && <span className="text-[9px] bg-[var(--accent-soft)] text-[var(--accent)] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Hoje</span>}
                          </div>
                          <input
                            type="text"
                            value={day.focus || ''}
                            onChange={(e) => updateDayFocus(day.id, e.target.value)}
                            placeholder="Foco do treino..."
                            className="bg-transparent border-none text-xs text-[var(--text-2)] p-0 focus:ring-0 outline-none placeholder:text-[var(--border-strong)] w-full"
                          />
                        </div>
                        <button onClick={() => addExercise(day.id)}
                          className="w-8 h-8 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)] shrink-0 ml-2">
                          <Plus size={14} />
                        </button>
                      </div>
                      {/* Exercises */}
                      <div className="divide-y divide-[var(--surface-3)]">
                        {day.exercises.length > 0 ? (
                          day.exercises.map(ex => (
                            <div key={ex.id} className="flex items-center gap-3 px-4 py-3.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--text)] truncate">{ex.name}</p>
                                <p className="text-xs text-[var(--text-3)] mt-0.5">{ex.sets}×{ex.reps} · {ex.rest}</p>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button onClick={() => openEditor(day.id, ex)}
                                  className="w-8 h-8 rounded-lg bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-2)]">
                                  <Edit3 size={13} />
                                </button>
                                <button onClick={() => deleteExercise(day.id, ex.id)}
                                  className="w-8 h-8 rounded-lg bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-3)]">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-12 flex flex-col items-center gap-2 text-[var(--text-3)]">
                            <Dumbbell size={24} />
                            <p className="text-xs">Dia de descanso</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Desktop: grid view */}
              <div className="hidden md:grid grid-cols-2 xl:grid-cols-4 gap-4">
                {squad.weeklyPlan.map((day, idx) => (
                  <div key={day.id} className={`flex flex-col gap-3 p-4 rounded-xl border transition-all ${idx === todayIndex ? 'bg-[var(--surface)] border-[var(--border-strong)]' : 'bg-[var(--surface-2)] border-[var(--border)]'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className={`text-sm font-semibold ${idx === todayIndex ? 'text-[var(--text)]' : 'text-[var(--text-2)]'}`}>{day.name}</h3>
                          {idx === todayIndex && <span className="text-[9px] bg-[var(--accent-soft)] text-[var(--accent)] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Hoje</span>}
                        </div>
                        <div className="relative group/focus mt-0.5">
                          <input
                            type="text"
                            value={day.focus || ''}
                            onChange={(e) => updateDayFocus(day.id, e.target.value)}
                            placeholder="Foco..."
                            className="bg-transparent border-none text-[10px] text-[var(--text-2)] p-0 focus:ring-0 outline-none placeholder:text-[var(--border-strong)] w-full"
                          />
                          {squad.templates.length > 0 && (
                            <div className="absolute top-full left-0 mt-1 w-44 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg z-30 hidden group-focus-within/focus:block max-h-36 overflow-y-auto">
                              {squad.templates.map(t => (
                                <button key={t.id} onClick={() => loadTemplate(day.id, t.id)}
                                  className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--border)] transition-colors flex justify-between">
                                  <span>{t.name}</span>
                                  <span className="text-[var(--text-2)]">{t.exercises.length}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <button onClick={() => addExercise(day.id)}
                        className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-3)] transition-colors shrink-0">
                        <Plus size={14} />
                      </button>
                    </div>
                    <div className="space-y-1.5 flex-1">
                      {day.exercises.length > 0 ? (
                        day.exercises.map(ex => (
                          <div key={ex.id} onClick={() => openEditor(day.id, ex)}
                            className="group relative flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--surface-3)] hover:border-[var(--border-strong)] bg-[var(--bg)] transition-all cursor-pointer">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-[var(--text)] truncate">{ex.name}</p>
                              <p className="text-[10px] text-[var(--text-3)] mt-0.5">{ex.sets}×{ex.reps} · {ex.rest}</p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); openEditor(day.id, ex); }}
                                className="p-1 text-[var(--text-2)] hover:text-[var(--text)]"><Edit3 size={11} /></button>
                              <button onClick={(e) => { e.stopPropagation(); deleteExercise(day.id, ex.id); }}
                                className="p-1 text-[var(--text-2)] hover:text-[var(--danger)]"><Trash2 size={11} /></button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-8 flex flex-col items-center gap-2 opacity-20">
                          <Plus size={20} />
                          <p className="text-[10px]">Vazio</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {currentView === 'treino' && treinoTab === 'progresso' && (() => {
            // Datas seg–dom da semana atual (Seg=0 … Dom=6)
            const todayD = new Date();
            const dowOffset = (todayD.getDay() + 6) % 7;
            const weekDates = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(todayD);
              d.setDate(todayD.getDate() - dowOffset + i);
              return localDateStr(d);
            });

            const { thisWeekByDate, lastWeekByDate, loading } = progressStats;

            const totalDone       = Object.values(thisWeekByDate).reduce((a, b) => a + b, 0);
            const daysCompleted   = Object.keys(thisWeekByDate).length;
            const daysPlanned     = squad.weeklyPlan.filter(d => d.exercises.length > 0).length;
            const consistency     = daysPlanned > 0 ? Math.round((daysCompleted / daysPlanned) * 100) : 0;

            const lastDaysComp    = Object.keys(lastWeekByDate).length;
            const lastConsistency = daysPlanned > 0 ? Math.round((lastDaysComp / daysPlanned) * 100) : 0;
            const consistencyDiff = consistency - lastConsistency;

            // Máximo de exercícios num único dia (para escala das barras)
            const maxCompleted = Math.max(1, ...weekDates.map(d => thisWeekByDate[d] ?? 0));

            const dayLabels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

            const picked = evolutionPick ? evolution[evolutionPick] : null;

            // Volume semanal por grupo muscular: séries planejadas de cada dia
            // que tem treino, agrupadas pelo nome do exercício.
            const volume: Record<string, number> = {};
            for (const day of squad.weeklyPlan) {
              for (const ex of day.exercises) {
                const g = muscleGroupOf(ex.name);
                volume[g] = (volume[g] ?? 0) + (ex.sets || 0);
              }
            }
            const volumeRows = Object.entries(volume)
              .filter(([, v]) => v > 0)
              .sort((a, b) => b[1] - a[1]) as [MuscleGroup, number][];
            const maxVolume = Math.max(1, ...volumeRows.map(([, v]) => v));

            return (
              <div className="space-y-8">
                {/* Resumo da semana por IA */}
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
                        Resumo da semana
                      </p>
                      <p className="text-[11px] text-[var(--text-3)] mt-1">
                        Treino, dieta, água e peso analisados juntos
                      </p>
                    </div>
                    <button
                      onClick={buildWeeklyReport}
                      disabled={weekReportLoading}
                      className="shrink-0 flex items-center gap-1.5 bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] border border-[var(--accent-line)] text-[var(--accent)] rounded-lg px-3 py-2 text-[11.5px] font-semibold transition-all disabled:opacity-50"
                    >
                      {weekReportLoading
                        ? <>Gerando<span className="animate-pulse">...</span></>
                        : <><Sparkles size={13} /> {weekReport ? 'Atualizar' : 'Gerar'}</>}
                    </button>
                  </div>

                  {weekReport && (
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[13.5px] leading-relaxed text-[var(--text)] mt-4 pt-4 border-t border-[var(--border)]"
                    >
                      {weekReport}
                    </motion.p>
                  )}
                </div>

                {/* Calendário do mês */}
                {(() => {
                  const now = new Date();
                  const year = now.getFullYear();
                  const month = now.getMonth();
                  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Seg = 0
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const todayNum = now.getDate();
                  const cells: (number | null)[] = [
                    ...Array(firstDow).fill(null),
                    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                  ];
                  const trainedCount = Array.from({ length: daysInMonth }, (_, i) =>
                    trainedDates.has(localDateStr(new Date(year, month, i + 1)))
                  ).filter(Boolean).length;

                  return (
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold capitalize">
                          {now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                        </p>
                        <span className="text-[11px] font-semibold text-[var(--accent)]">
                          {trainedCount} {trainedCount === 1 ? 'treino' : 'treinos'}
                        </span>
                      </div>

                      <div className="grid grid-cols-7 gap-1.5">
                        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
                          <span key={i} className="text-center text-[9px] font-semibold text-[var(--text-3)]">{d}</span>
                        ))}
                        {cells.map((day, i) => {
                          if (day === null) return <span key={`e${i}`} />;
                          const ds = localDateStr(new Date(year, month, day));
                          const done = trainedDates.has(ds);
                          const isToday = day === todayNum;
                          const future = day > todayNum;
                          return (
                            <div
                              key={ds}
                              title={`${day} — ${done ? 'treinou' : future ? '' : 'sem treino'}`}
                              className="aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold transition-colors"
                              style={{
                                background: done ? 'var(--accent)' : future ? 'transparent' : 'var(--surface-3)',
                                color: done ? 'var(--bg)' : future ? 'var(--border-strong)' : 'var(--text-2)',
                                border: isToday ? '1.5px solid var(--accent)' : '1px solid transparent',
                              }}
                            >
                              {day}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Volume por grupo muscular */}
                {volumeRows.length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                    <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
                      Volume semanal por grupo
                    </p>
                    <p className="text-[11px] text-[var(--text-3)] mt-1 mb-4">
                      Séries planejadas na semana — ajuda a ver desequilíbrio
                    </p>
                    <div className="space-y-2.5">
                      {volumeRows.map(([group, sets]) => (
                        <div key={group} className="flex items-center gap-3">
                          <span className="w-20 shrink-0 text-[12px] font-medium text-[var(--text)]">{group}</span>
                          <div className="flex-1 h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(sets / maxVolume) * 100}%` }}
                              transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                              className="h-full rounded-full"
                              style={{ background: MUSCLE_COLORS[group] }}
                            />
                          </div>
                          <span className="w-14 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-[var(--text-2)]">
                            {sets} {sets === 1 ? 'série' : 'séries'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evolução de carga */}
                {picked && (() => {
                  const pts = picked.points;
                  const kgs = pts.map(p => p.kg);
                  const min = Math.min(...kgs);
                  const max = Math.max(...kgs);
                  const span = max - min || 1;
                  const first = pts[0];
                  const last = pts[pts.length - 1];
                  const growth = first.kg > 0 ? Math.round(((last.kg - first.kg) / first.kg) * 100) : 0;

                  // Normaliza para o viewBox 300×90 (y invertido: peso maior = mais alto)
                  const coords = pts.map((p, i) => {
                    const x = pts.length === 1 ? 150 : 6 + (i / (pts.length - 1)) * 288;
                    const y = 78 - ((p.kg - min) / span) * 68;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  });
                  const [lastX, lastY] = coords[coords.length - 1].split(',').map(Number);
                  const fmtMonth = (d: string) =>
                    new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long' });

                  return (
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
                          Evolução de carga
                        </p>
                        <select
                          value={evolutionPick ?? ''}
                          onChange={e => setEvolutionPick(e.target.value)}
                          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-[7px] text-[11.5px] font-semibold text-[var(--text)] outline-none focus:border-[var(--border-strong)] max-w-[55%] truncate"
                        >
                          {Object.entries(evolution).map(([id, e]) => (
                            <option key={id} value={id}>{e.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-baseline gap-2 mt-4">
                        <span className="font-display text-[28px] font-extrabold tracking-[-0.02em] text-[var(--text)]">
                          {last.kg}<span className="text-base text-[var(--text-2)]"> kg</span>
                        </span>
                        {growth !== 0 && (
                          <span className={`text-[11.5px] font-semibold ${growth > 0 ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>
                            {growth > 0 ? '+' : ''}{growth}% no período
                          </span>
                        )}
                      </div>

                      <svg viewBox="0 0 300 90" className="w-full h-24 mt-3.5 overflow-visible">
                        <polyline points={coords.join(' ')} fill="none" stroke="var(--accent)"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx={lastX} cy={lastY} r="3.5" fill="var(--accent)" />
                        <circle cx={coords[0].split(',')[0]} cy={coords[0].split(',')[1]} r="3"
                          fill="var(--border)" stroke="var(--text-2)" />
                      </svg>

                      <div className="flex justify-between text-[10.5px] font-medium text-[var(--text-3)] mt-1.5">
                        <span>{fmtMonth(first.date)} · {first.kg} kg</span>
                        <span>{fmtMonth(last.date)} · {last.kg} kg</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Recordes pessoais */}
                {Object.keys(personalRecords).length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
                    <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold">
                      Recordes pessoais
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3.5">
                      {Object.entries(personalRecords).map(([exId, kg]) => {
                        const name = evolution[exId]?.name
                          ?? squad.weeklyPlan.flatMap(d => d.exercises).find(e => e.id === exId)?.name;
                        if (!name) return null;
                        return (
                          <span key={exId}
                            className="rounded-full bg-[var(--accent-soft)] text-[var(--accent)] px-3 py-2 text-[11.5px] font-semibold">
                            {name} · {kg} kg
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
                  <StatCard
                    title="Total de Exercícios"
                    value={loading ? '—' : String(totalDone)}
                    subtitle="Esta semana"
                    icon={<Dumbbell className="text-[var(--accent)]" />}
                  />
                  <StatCard
                    title="Dias Concluídos"
                    value={loading ? '—' : `${daysCompleted}/7`}
                    subtitle="Meta semanal"
                    icon={<CheckCircle2 className="text-[var(--accent)]" />}
                  />
                  <StatCard
                    title="Consistência"
                    value={loading ? '—' : `${consistency}%`}
                    subtitle={
                      loading ? '' :
                      consistencyDiff === 0 ? 'Igual à semana passada' :
                      `${consistencyDiff > 0 ? '+' : ''}${consistencyDiff}% que semana passada`
                    }
                    icon={<TrendingUp className="text-purple-500" />}
                  />
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 md:p-8">
                  <h3 className="text-base md:text-xl font-bold mb-4 md:mb-6">Histórico de Atividade</h3>
                  {loading ? (
                    <div className="h-44 md:h-64 flex items-center justify-center text-sm text-[var(--text-2)]">Carregando...</div>
                  ) : (
                    <div className="h-44 md:h-64 flex items-end justify-between gap-1.5 md:gap-2">
                      {weekDates.map((dateKey, i) => {
                        const completed = thisWeekByDate[dateKey] ?? 0;
                        const pct = Math.round((completed / maxCompleted) * 100);
                        const isToday = dateKey === localDateStr(todayD);
                        return (
                          <div key={dateKey} className="flex-1 flex flex-col items-center gap-3">
                            <div className="w-full bg-[var(--surface-3)] rounded-t-lg relative group" style={{ height: '100%' }}>
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: pct > 0 ? `${pct}%` : completed === 0 ? '2px' : `${pct}%` }}
                                className={`w-full rounded-t-lg transition-all group-hover:opacity-80 ${isToday ? 'bg-[var(--accent-line)] border-t-2 border-[var(--accent)]' : 'bg-[var(--accent-soft)] border-t-2 border-[var(--btn-bg)]'}`}
                              />
                              {completed > 0 && (
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--surface-3)] text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                  {completed} ex
                                </div>
                              )}
                            </div>
                            <span className={`text-xs font-medium ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'}`}>
                              {dayLabels[i]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Breakdown por dia */}
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-[var(--border)]">
                    <p className="text-xs text-[var(--text-2)] uppercase tracking-widest font-medium">Dias desta semana</p>
                  </div>
                  <div className="divide-y divide-[var(--surface-3)]">
                    {weekDates.map((dateKey, i) => {
                      const day = squad.weeklyPlan[i];
                      const completed = thisWeekByDate[dateKey] ?? 0;
                      const planned   = day?.exercises.length ?? 0;
                      const isToday   = i === todayIndex;
                      const isDone    = planned > 0 && completed >= planned;
                      const dayName   = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'][i];
                      return (
                        <div key={dateKey} className={`px-5 py-3.5 flex items-center gap-4 ${isToday ? 'bg-[var(--surface-2)]' : ''}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            isDone ? 'bg-[var(--accent)]' : completed > 0 ? 'bg-[var(--accent-line)]' : 'bg-[var(--surface-3)]'
                          }`}>
                            {isDone && <CheckCircle2 size={12} className="text-[var(--btn-fg)]" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isToday ? 'text-[var(--text)]' : 'text-[var(--text-2)]'}`}>
                              {dayName} {isToday && <span className="text-[10px] bg-[var(--accent-soft)] text-[var(--accent)] px-1.5 py-0.5 rounded ml-1">Hoje</span>}
                            </p>
                            {day?.focus && <p className="text-xs text-[var(--text-3)] mt-0.5">{day.focus}</p>}
                          </div>
                          <span className="text-xs text-[var(--text-2)] tabular-nums shrink-0">
                            {planned > 0 ? `${completed}/${planned}` : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Evolução de Cargas ── */}
                <LoadTracker
                  trackedExercises={trackedExercises}
                  loadHistory={loadHistory}
                  loadInputs={loadInputs}
                  savedLoadIds={savedLoadIds}
                  loading={loadsLoading}
                  onSetInput={(id, val) => setLoadInputs(prev => ({ ...prev, [id]: val }))}
                  onSave={saveLoad}
                  onDelete={deleteTrackedExercise}
                  onDeleteEntry={deleteLoad}
                  onCreate={createTrackedExercise}
                />
              </div>
            );
          })()}

          {currentView === 'settings' && (
            <Suspense fallback={<ViewLoading />}>
              <Settings
                session={session}
                squad={squad}
                isPersonal={isPersonal}
                theme={theme}
                onToggleTheme={toggleTheme}
                onSquadUpdate={(name, icon) => setSquad(prev => ({ ...prev, name, icon }))}
                onLeaveSquad={refreshSquad}
                onSquadJoined={refreshSquad}
                onProfileUpdate={(name, avatarUrl) => setSquad(prev => ({
                  ...prev,
                  members: prev.members.map(m =>
                    m.id === session.user.id
                      ? { ...m, name: name || m.name, avatar: avatarUrl || m.avatar }
                      : m
                  ),
                }))}
              />
            </Suspense>
          )}

          {currentView === 'dieta' && (
            <Suspense fallback={<ViewLoading />}>
              <Dieta session={session} tab={dietaTab} onTabChange={setDietaTab} />
            </Suspense>
          )}

          {currentView === 'ia' && (
            <Suspense fallback={<ViewLoading />}>
              <AIChat
                squad={squad}
                streak={diasTreinados}
                progressStats={progressStats}
                onCreateWorkout={applyAIWorkout}
              />
            </Suspense>
          )}
        </div>
      </main>

      {/* Aviso flutuante (erro/sucesso) */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold border ${
              toast.kind === 'ok'
                ? 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent)]'
                : 'bg-[var(--danger-soft)] border-[var(--danger)] text-red-300'
            }`}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Nav — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[var(--bg)]/95 backdrop-blur-md border-t border-[var(--border)] flex items-center justify-around px-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)', paddingTop: 8 }}>
        <MobileNavItem icon={<Dumbbell size={21} />}     label="Treino" active={currentView === 'treino'}   onClick={() => setCurrentView('treino')} />
        <MobileNavItem icon={<Apple size={21} />}        label="Dieta"  active={currentView === 'dieta'}    onClick={() => setCurrentView('dieta')} />
        <MobileNavItem icon={<Sparkles size={21} />}     label="IA"     active={currentView === 'ia'}       onClick={() => setCurrentView('ia')} />
        <MobileNavItem icon={<SettingsIcon size={21} />} label="Config" active={currentView === 'settings'} onClick={() => setCurrentView('settings')} />
      </nav>

      {/* Editor Modal */}
      <AnimatePresence>
        {isEditorOpen && editingExercise && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-[var(--border)] flex justify-between items-center">
                <h3 className="text-xl font-bold">Editar Exercício</h3>
                <button onClick={() => setIsEditorOpen(false)} className="text-[var(--text-2)] hover:text-[var(--text)] transition-colors">
                  <Plus className="rotate-45" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-bold text-[var(--text-2)] uppercase mb-1 block">Nome do Exercício</label>
                  <input 
                    type="text" 
                    value={editingExercise.exercise.name}
                    onChange={(e) => setEditingExercise({ ...editingExercise, exercise: { ...editingExercise.exercise, name: e.target.value } })}
                    className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[var(--text-2)] uppercase mb-1 block">Séries</label>
                    <input 
                      type="number" 
                      value={editingExercise.exercise.sets}
                      onChange={(e) => setEditingExercise({ ...editingExercise, exercise: { ...editingExercise.exercise, sets: parseInt(e.target.value) } })}
                      className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[var(--text-2)] uppercase mb-1 block">Reps</label>
                    <input 
                      type="text" 
                      value={editingExercise.exercise.reps}
                      onChange={(e) => setEditingExercise({ ...editingExercise, exercise: { ...editingExercise.exercise, reps: e.target.value } })}
                      className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--text-2)] uppercase mb-1 block">Descanso</label>
                  <input 
                    type="text" 
                    value={editingExercise.exercise.rest}
                    onChange={(e) => setEditingExercise({ ...editingExercise, exercise: { ...editingExercise.exercise, rest: e.target.value } })}
                    className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--text-2)] uppercase mb-1 block">Observações</label>
                  <textarea 
                    value={editingExercise.exercise.notes || ''}
                    onChange={(e) => setEditingExercise({ ...editingExercise, exercise: { ...editingExercise.exercise, notes: e.target.value } })}
                    className="w-full bg-[var(--surface-3)] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--accent)] outline-none h-24 resize-none"
                    placeholder="Ex: Focar na cadência..."
                  />
                </div>
              </div>
              <div className="p-6 bg-[var(--surface-3)] flex gap-3">
                <button 
                  onClick={() => setIsEditorOpen(false)}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-[var(--text-2)] hover:text-[var(--text)] transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => saveExercise(editingExercise.exercise)}
                  className="flex-1 bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] text-[var(--btn-fg)] px-4 py-3 rounded-xl text-sm font-bold transition-all"
                >
                  Salvar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Rest Timer Overlay */}
      <AnimatePresence>
        {restTimer && (() => {
          // Anel de contagem regressiva (perímetro = 2·pi·23 ≈ 145)
          const C = 145;
          const offset = C * (1 - restTimer.remaining / restTimer.total);
          const low = restTimer.remaining <= 5;
          const color = low ? 'var(--danger)' : 'var(--accent)';
          return (
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[380px] z-50"
            >
              <div className="flex items-center gap-4 rounded-2xl border border-[var(--border-strong)] px-[18px] py-3.5 shadow-2xl backdrop-blur-xl"
                style={{ background: 'rgba(22,22,22,0.96)' }}>

                <div className="relative w-[52px] h-[52px] flex-none">
                  <svg viewBox="0 0 52 52" className="w-[52px] h-[52px] -rotate-90">
                    <circle cx="26" cy="26" r="23" fill="none" stroke="var(--border)" strokeWidth="3.5" />
                    <circle cx="26" cy="26" r="23" fill="none" stroke={color} strokeWidth="3.5"
                      strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset}
                      style={{ transition: 'stroke-dashoffset 900ms linear, stroke 200ms' }} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[12.5px] font-bold tabular-nums">
                    {String(Math.floor(restTimer.remaining / 60)).padStart(2, '0')}:{String(restTimer.remaining % 60).padStart(2, '0')}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[7px] text-[13.5px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
                    Descanso
                  </div>
                  <p className="text-[11.5px] text-[var(--text-2)] mt-1">Próxima série em seguida</p>
                </div>

                <button
                  onClick={() => setRestTimer(null)}
                  className="flex-none bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[var(--text)] hover:border-[var(--text-3)] transition-colors"
                >
                  Pular
                </button>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function MobileNavItem({ label, active, onClick }: { icon?: ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex-1 py-2 text-[12.5px] transition-colors"
      style={{
        color: active ? 'var(--text)' : 'var(--text-2)',
        fontWeight: active ? 600 : 500,
      }}>
      {label}
    </button>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all
        ${active ? 'bg-[var(--surface-3)] text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
      <span className={active ? 'text-[var(--accent)]' : ''}>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

function formatRestDisplay(rest: string): string {
  const secs = parseRestSeconds(rest);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function ExerciseItem({
  exercise, setsDone, loadData, onSetToggle, onLoadChange, isPR = false, previous,
  skipped = false, onSkip, onEdit, showEdit = true,
}: {
  exercise: Exercise;
  setsDone: boolean[];
  loadData: Array<{ weight: string; reps: string; rpe?: string }>;
  onSetToggle: (setIndex: number) => void;
  onLoadChange: (setIndex: number, field: 'weight' | 'reps' | 'rpe', val: string) => void;
  isPR?: boolean;
  /** Resumo da última vez que este exercício foi feito (ex: "4×10 · 75 kg") */
  previous?: string;
  /** Marcado como pulado hoje (equipamento ocupado, dor, falta de tempo) */
  skipped?: boolean;
  onSkip?: () => void;
  onEdit?: () => void;
  showEdit?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const doneCount = setsDone.filter(Boolean).length;
  const allDone = doneCount === exercise.sets;

  // Barra de acento à esquerda: acento quando concluído ou aberto
  const accent = skipped ? 'var(--text-3)' : allDone || expanded ? 'var(--accent)' : 'transparent';

  return (
    <motion.div layout
      className="relative overflow-hidden rounded-xl border transition-colors"
      style={{
        background: expanded ? 'var(--surface-2)' : 'var(--surface)',
        borderColor: expanded ? 'var(--border-strong)' : 'var(--border)',
        opacity: skipped ? 0.55 : 1,
      }}>
      <span className="absolute left-0 top-0 bottom-0 w-[2px] transition-colors"
        style={{ background: accent }} />

      {/* Linha principal */}
      <div className="flex items-center gap-3.5 px-[18px] py-4">
        {/* Marcar exercício inteiro */}
        <button
          onClick={() => {
            // Marca ou desmarca todas as séries de uma vez
            for (let i = 0; i < exercise.sets; i++) {
              if ((setsDone[i] ?? false) === allDone) onSetToggle(i);
            }
          }}
          aria-label={allDone ? 'desmarcar exercício' : 'concluir exercício'}
          className="flex-none w-[26px] h-[26px] rounded-full border-[1.5px] flex items-center justify-center transition-all active:scale-90"
          style={{
            borderColor: allDone ? 'var(--accent)' : 'var(--border-strong)',
            background: allDone ? 'var(--accent)' : 'transparent',
          }}>
          {allDone && <CheckCircle2 size={13} className="text-[var(--bg)]" />}
        </button>

        <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(v => !v)}>
          <p className={`text-[15.5px] font-semibold leading-tight ${allDone || skipped ? 'text-[var(--text-2)] line-through' : 'text-[var(--text)]'}`}>
            {exercise.name}
          </p>
          <p className="text-[12.5px] text-[var(--text-2)] mt-[5px]">
            {exercise.sets} séries · {exercise.reps} reps · {formatRestDisplay(exercise.rest)} descanso
          </p>
        </button>

        {skipped && (
          <span className="flex-none rounded-full px-[9px] py-[5px] text-[9.5px] font-bold tracking-[0.06em] bg-[var(--surface-3)] text-[var(--text-2)]">
            PULADO
          </span>
        )}

        {isPR && !skipped && (
          <span className="flex-none rounded-full px-[9px] py-[5px] text-[9.5px] font-bold tracking-[0.06em] bg-[var(--accent-soft)] text-[var(--accent)]">
            🏆 RECORDE
          </span>
        )}

        {onSkip && (
          <button
            onClick={e => { e.stopPropagation(); onSkip(); }}
            title={skipped ? 'Voltar para a lista' : 'Pular este exercício'}
            className={`flex-none p-1.5 rounded-lg transition-colors ${
              skipped ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            <SkipForward size={14} />
          </button>
        )}

        {showEdit && onEdit && (
          <button onClick={e => { e.stopPropagation(); onEdit(); }}
            className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors shrink-0">
            <Edit3 size={12} />
          </button>
        )}

        <span className="flex-none text-[11px] text-[var(--text-3)]">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Séries: peso, reps e marcação */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden">
            <div className="mx-[18px] mb-4 pt-3.5 border-t border-[var(--border)] flex flex-col gap-2">
              <div className="grid grid-cols-[18px_1fr_1fr_46px_34px] gap-2 text-[9.5px] font-semibold tracking-[0.12em] text-[var(--text-3)]">
                <span>#</span><span>PESO (KG)</span><span>REPS</span>
                <span title="Esforço percebido: 10 = falha, 8 = sobraram 2 reps">RPE</span>
                <span />
              </div>

              {Array.from({ length: exercise.sets }, (_, i) => {
                const done = setsDone[i] ?? false;
                const load = loadData[i] ?? { weight: '', reps: '' };
                return (
                  <div key={i} className="grid grid-cols-[18px_1fr_1fr_46px_34px] gap-2 items-center">
                    <span className="text-xs font-semibold text-[var(--text-2)]">{i + 1}</span>
                    <input
                      type="number" inputMode="decimal" placeholder="—"
                      value={load.weight}
                      onChange={e => onLoadChange(i, 'weight', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className={`w-full bg-[var(--bg)] border rounded-lg px-2.5 py-[9px] text-[13px] font-semibold tabular-nums outline-none transition-colors ${
                        done ? 'border-[var(--accent-line)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text)] focus:border-[var(--border-strong)]'
                      }`}
                    />
                    <input
                      type="number" inputMode="numeric" placeholder={exercise.reps}
                      value={load.reps}
                      onChange={e => onLoadChange(i, 'reps', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-[9px] text-[13px] font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--border-strong)] transition-colors"
                    />
                    <input
                      type="number" inputMode="numeric" min="1" max="10" placeholder="—"
                      value={load.rpe ?? ''}
                      onChange={e => onLoadChange(i, 'rpe', e.target.value)}
                      onClick={e => e.stopPropagation()}
                      title="Esforço percebido de 1 a 10"
                      className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-1.5 py-[9px] text-[13px] font-semibold tabular-nums text-center text-[var(--load)] outline-none focus:border-[var(--border-strong)] transition-colors"
                    />
                    <button
                      onClick={() => onSetToggle(i)}
                      aria-label="série feita"
                      className="w-[30px] h-[30px] rounded-lg border-[1.5px] flex items-center justify-center transition-all active:scale-90"
                      style={{
                        borderColor: done ? 'var(--accent)' : 'var(--border-strong)',
                        background: done ? 'var(--accent)' : 'transparent',
                      }}>
                      {done && <CheckCircle2 size={12} className="text-[var(--bg)]" />}
                    </button>
                  </div>
                );
              })}

              {previous && (
                <p className="text-[11.5px] text-[var(--text-3)] mt-0.5">Anterior: {previous}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── LoadTracker ────────────────────────────────────────────────────────────────
type TrackedExercise = { id: string; name: string };
type LoadEntry       = { id: string; date: string; load_notes: string };

function LoadTracker({
  trackedExercises, loadHistory, loadInputs, savedLoadIds, loading,
  onSetInput, onSave, onDelete, onDeleteEntry, onCreate,
}: {
  trackedExercises: TrackedExercise[];
  loadHistory: Record<string, LoadEntry[]>;
  loadInputs: Record<string, string>;
  savedLoadIds: Set<string>;
  loading: boolean;
  onSetInput: (id: string, val: string) => void;
  onSave: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
  onDeleteEntry: (exId: string, loadId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding]     = useState(false);
  const [creating, setCreating] = useState(false);

  const commit = async () => {
    const v = newName.trim();
    if (!v) return;
    setCreating(true);
    const ok = await onCreate(v);
    setCreating(false);
    if (ok) { setNewName(''); setAdding(false); }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  // Tendência: compara último e penúltimo registro
  const trend = (history: LoadEntry[]) => {
    if (history.length < 2) return null;
    const last = parseFloat(history[0].load_notes);
    const prev = parseFloat(history[1].load_notes);
    if (isNaN(last) || isNaN(prev)) return null;
    if (last > prev) return '↑';
    if (last < prev) return '↓';
    return '→';
  };

  return (
    <div>
      {/* Cabeçalho da seção */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">Evolução de Cargas</h3>
          <p className="text-xs text-[var(--text-2)] mt-0.5">Registre sua carga a cada sessão</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] rounded-lg text-xs text-[var(--btn-fg)] font-medium transition-all shrink-0"
        >
          <Plus size={13} /> Novo exercício
        </button>
      </div>

      {/* Form criar */}
      {adding && (
        <div className="bg-[var(--surface)] border border-[var(--accent-line)] rounded-xl p-4 mb-4 flex gap-2 items-center">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNewName(''); setAdding(false); } }}
            placeholder="Nome do exercício — ex: Supino"
            className="flex-1 bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent-line)] transition-colors"
          />
          <button onClick={commit} disabled={creating}
            className="px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-60 rounded-lg text-xs text-[var(--btn-fg)] font-semibold min-w-[64px] transition-all">
            {creating ? '...' : 'Criar'}
          </button>
          <button onClick={() => { setNewName(''); setAdding(false); }}
            className="px-3 py-2.5 bg-transparent border border-[var(--border)] rounded-lg text-xs text-[var(--text-2)] hover:text-[var(--text)] transition-colors">
            Cancelar
          </button>
        </div>
      )}

      {loading && (
        <div className="py-10 text-sm text-[var(--text-2)] text-center">Carregando...</div>
      )}

      {!loading && trackedExercises.length === 0 && !adding && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-12 flex flex-col items-center gap-3 text-[var(--text-3)]">
          <Dumbbell size={32} />
          <p className="text-sm text-[var(--text-2)]">Nenhum exercício cadastrado.</p>
          <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors">
            + Adicionar primeiro exercício
          </button>
        </div>
      )}

      {/* Grid de cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {trackedExercises.map(ex => {
          const history  = loadHistory[ex.id] ?? [];
          const inputVal = loadInputs[ex.id] ?? '';
          const isSaved  = savedLoadIds.has(ex.id);
          const t        = trend(history);
          const latest   = history[0];

          return (
            <div key={ex.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-4 hover:border-[var(--border-strong)] transition-colors">

              {/* Cabeçalho do card */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-display text-base font-bold text-[var(--text)] capitalize leading-tight">{ex.name}</p>
                  {latest && (
                    <p className="text-xs text-[var(--text-2)] mt-0.5">
                      Último: <span className="text-[var(--accent)] font-medium">{latest.load_notes}</span>
                      <span className="text-[var(--text-3)]"> · {formatDate(latest.date)}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t && (
                    <span className={`text-sm font-bold leading-none ${t === '↑' ? 'text-[var(--accent)]' : t === '↓' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
                      {t}
                    </span>
                  )}
                  <button
                    onClick={() => { if (confirm(`Excluir "${ex.name}" e todo o histórico?`)) onDelete(ex.id); }}
                    className="text-[var(--border-strong)] hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Input novo registro */}
              <div className="flex gap-2">
                <input
                  value={inputVal}
                  onChange={e => onSetInput(ex.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') onSave(ex.id, inputVal); }}
                  placeholder="Ex: 14kg · 3×10"
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] focus:border-[var(--accent-line)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--border-strong)] outline-none transition-colors"
                />
                <button
                  onClick={() => onSave(ex.id, inputVal)}
                  disabled={!inputVal.trim()}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold shrink-0 transition-all disabled:opacity-30 ${
                    isSaved
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]'
                      : 'bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--border-strong)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] hover:border-[var(--text-3)]'
                  }`}
                >
                  {isSaved ? '✓' : 'Salvar'}
                </button>
              </div>

              {/* Histórico em chips */}
              {history.length > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--text-3)] uppercase tracking-widest mb-2">Histórico</p>
                  <div className="flex flex-col gap-1.5">
                    {history.slice(0, 5).map((entry, idx) => {
                      const prevEntry  = history[idx + 1];
                      const curr = parseFloat(entry.load_notes);
                      const prev = prevEntry ? parseFloat(prevEntry.load_notes) : NaN;
                      const hasDiff = !isNaN(curr) && !isNaN(prev) && curr !== prev;

                      return (
                        <div key={entry.id} className="flex items-center gap-3 group">
                          <span className="text-[11px] text-[var(--text-3)] w-9 shrink-0 tabular-nums">{formatDate(entry.date)}</span>
                          <span className={`text-sm flex-1 ${idx === 0 ? 'text-[var(--text)] font-semibold' : 'text-[var(--text-2)]'}`}>
                            {entry.load_notes}
                          </span>
                          {hasDiff && (
                            <span className={`text-[11px] font-medium shrink-0 ${curr > prev ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>
                              {curr > prev ? '+' : ''}{(curr - prev).toFixed(1)}kg
                            </span>
                          )}
                          <button
                            onClick={() => onDeleteEntry(ex.id, entry.id)}
                            className="opacity-0 group-hover:opacity-100 text-[var(--border-strong)] hover:text-red-400 transition-all shrink-0"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon }: { title: string, value: string, subtitle: string, icon: ReactNode }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] p-4 md:p-5 rounded-xl">
      <div className="flex items-center gap-2 mb-3 md:mb-4 text-[var(--text-2)]">
        {icon}
        <p className="text-[10px] md:text-xs font-medium uppercase tracking-widest truncate">{title}</p>
      </div>
      <h4 className="text-2xl md:text-3xl font-bold text-[var(--text)] mb-1 tabular-nums">{value}</h4>
      <p className="text-[10px] md:text-xs text-[var(--text-2)] leading-tight">{subtitle}</p>
    </div>
  );
}
