import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { motion, AnimatePresence } from 'motion/react';
import {
  Droplets,
  GlassWater,
  Plus,
  Trash2,
  Flame,
  Beef,
  Pencil,
  Check,
  RotateCcw,
  UtensilsCrossed,
  Trophy,
  Camera,
  Loader2,
  Wheat,
  Sparkles,
  Star,
  Copy,
} from 'lucide-react';
import { compressImage, analyzeFoodPhoto, analyzeFoodText, type FoodAnalysis } from '../services/foodAI';
import { Corpo } from './Corpo';
import type { Session } from '../services/api';
import type { DietaTab } from '../types';

// "YYYY-MM-DD" no fuso local
function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMl(ml: number): string {
  return ml >= 1000 ? `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` : `${ml} ml`;
}

/** "410 kcal · 42g carbo · 44g prot" — omite o que não foi informado */
function macroLine(m: { calories: number | null; protein: number | null; carbs: number | null; fat?: number | null }): string {
  const parts = [
    m.calories != null ? `${m.calories} kcal` : null,
    m.carbs != null ? `${m.carbs}g carbo` : null,
    m.protein != null ? `${m.protein}g prot` : null,
    m.fat != null ? `${m.fat}g gord` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Sem macros';
}

type WaterEntry = { id: string; ml: number; date: string };
type Meal = { id: string; name: string; calories: number | null; protein: number | null; carbs: number | null; fat: number | null; slotId: string | null };

/** Uma refeição da rotina do usuário (café, almoço, ...) com metas próprias */
type MealSlot = {
  id: string;
  name: string;
  position: number;
  timeHint: string | null;
  kcalGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
};

/** Refeição salva para reuso rápido */
type Favorite = {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  slotId: string | null;
};

interface DietaProps {
  session: Session;
  /** Sub-aba ativa, controlada pelo App para virar rota (#/dieta/corpo) */
  tab: DietaTab;
  onTabChange: (tab: DietaTab) => void;
}

export function Dieta({ session, tab: dietTab, onTabChange: setDietTab }: DietaProps) {
  // ── Hidratação ──
  const [waterEntries, setWaterEntries] = useState<WaterEntry[]>([]);
  const [waterGoal, setWaterGoal] = useState(2000);
  const [editingWaterGoal, setEditingWaterGoal] = useState(false);
  const [waterGoalInput, setWaterGoalInput] = useState('2000');
  const [customMl, setCustomMl] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  // ── Refeições ──
  const [meals, setMeals] = useState<Meal[]>([]);
  const [calorieGoal, setCalorieGoal] = useState<number>(2500);
  const [proteinGoal, setProteinGoal] = useState<number>(150);
  const [showMealForm, setShowMealForm] = useState(false);
  const [mealName, setMealName] = useState('');
  const [mealCal, setMealCal] = useState('');
  const [mealProt, setMealProt] = useState('');
  const [mealCarbs, setMealCarbs] = useState('');
  const [mealFat, setMealFat] = useState('');

  // ── IA: análise de foto ──
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [foodDescription, setFoodDescription] = useState('');
  // Guarda a última tentativa para o botão "Tentar de novo"
  type LastAction =
    | { kind: 'photo'; img: { base64: string; mediaType: 'image/jpeg' } }
    | { kind: 'text'; text: string };
  const [lastAction, setLastAction] = useState<LastAction | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Rotina alimentar do usuário
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [editingRoutine, setEditingRoutine] = useState(false);
  const [routineDraft, setRoutineDraft] = useState<MealSlot[]>([]);
  const [savingRoutine, setSavingRoutine] = useState(false);
  // Slot ao qual a refeição sendo criada pertence
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

  // Dia que está sendo visualizado (permite ver ontem, anteontem...)
  const [viewDate, setViewDate] = useState(() => localDateStr());
  const [copying, setCopying] = useState(false);

  // Favoritos: evita redigitar o que se come todo dia
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [pickingFavFor, setPickingFavFor] = useState<string | null>(null);

  const todayStr = localDateStr();
  const today = viewDate;
  const isToday = viewDate === todayStr;

  // ── Carregar dados ──
  useEffect(() => {
    if (!session) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      const base = new Date(viewDate + 'T12:00:00');
      const weekAgo = localDateStr(new Date(base.getTime() - 6 * 24 * 60 * 60 * 1000));

      const [waterRes, mealsRes, settingsRes] = await Promise.all([
        api
          .from('water_intake')
          .select('id, ml, date')
          .eq('user_id', session.user.id)
          .gte('date', weekAgo)
          .lte('date', viewDate)
          .order('created_at', { ascending: true }),
        api
          .from('meals')
          .select('id, name, calories, protein, carbs, fat, slot_id')
          .eq('user_id', session.user.id)
          .eq('date', today)
          .order('created_at', { ascending: true }),
        api
          .from('diet_settings')
          .select('water_goal_ml, calorie_goal, protein_goal')
          .eq('user_id', session.user.id)
          .maybeSingle(),
      ]);

      const loadErr = waterRes.error ?? mealsRes.error ?? settingsRes.error;
      if (loadErr) {
        console.error('Erro ao carregar dados da dieta:', loadErr);
        setError(`Não foi possível carregar seus dados: ${loadErr.message}`);
      }

      if (waterRes.data) setWaterEntries(waterRes.data as WaterEntry[]);
      if (mealsRes.data) {
        setMeals(mealsRes.data.map((m: any) => ({
          id: m.id, name: m.name, calories: m.calories,
          protein: m.protein, carbs: m.carbs, fat: m.fat ?? null,
          slotId: m.slot_id ?? null,
        })));
      }

      const { data: favData } = await api
        .from('favorite_meals')
        .select('id, name, calories, protein, carbs, fat, slot_id')
        .eq('user_id', session.user.id)
        .order('times_used', { ascending: false })
        .limit(30);
      if (favData) {
        setFavorites(favData.map((f: any) => ({
          id: f.id, name: f.name, calories: f.calories, protein: f.protein,
          carbs: f.carbs, fat: f.fat, slotId: f.slot_id ?? null,
        })));
      }

      // Rotina alimentar: cria as 6 refeições padrão na primeira vez
      const { data: slotData, error: slotErr } = await api.rpc('ensure_meal_routine');
      if (slotErr) {
        console.error('Erro ao carregar a rotina:', slotErr);
      } else if (slotData) {
        setSlots((slotData as any[]).map(r => ({
          id: r.id, name: r.name, position: r.position, timeHint: r.time_hint,
          kcalGoal: r.kcal_goal, proteinGoal: r.protein_goal, carbsGoal: r.carbs_goal,
          fatGoal: r.fat_goal ?? 0,
        })).sort((a, b) => a.position - b.position));
      }
      const settings = settingsRes.data;
      if (settings) {
        setWaterGoal(settings.water_goal_ml ?? 2000);
        setWaterGoalInput(String(settings.water_goal_ml ?? 2000));
        if (settings.calorie_goal) setCalorieGoal(settings.calorie_goal);
        if (settings.protein_goal) setProteinGoal(settings.protein_goal);
      }
      setLoading(false);
    };
    load();
  }, [session?.user?.id, viewDate]);

  // ── Derivados ──
  const waterToday = useMemo(
    () => waterEntries.filter(e => e.date === today).reduce((a, e) => a + e.ml, 0),
    [waterEntries, today]
  );
  const waterPct = Math.min(100, (waterToday / waterGoal) * 100);
  const goalHit = waterToday >= waterGoal;

  const weekData = useMemo(() => {
    const days: { label: string; date: string; ml: number; isToday: boolean }[] = [];
    const base = new Date(viewDate + 'T12:00:00').getTime();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base - i * 24 * 60 * 60 * 1000);
      const ds = localDateStr(d);
      days.push({
        label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3).replace('.', ''),
        date: ds,
        ml: waterEntries.filter(e => e.date === ds).reduce((a, e) => a + e.ml, 0),
        isToday: ds === today,
      });
    }
    return days;
  }, [waterEntries, today, viewDate]);

  const totalCal = meals.reduce((a, m) => a + (m.calories ?? 0), 0);
  const totalProt = meals.reduce((a, m) => a + (m.protein ?? 0), 0);
  const totalCarbs = meals.reduce((a, m) => a + (m.carbs ?? 0), 0);
  const totalFat = meals.reduce((a, m) => a + (m.fat ?? 0), 0);

  // A meta diária é a soma das metas da rotina — assim não há como divergir
  const routineGoals = useMemo(() => slots.reduce(
    (acc, s) => ({
      kcal: acc.kcal + s.kcalGoal,
      prot: acc.prot + s.proteinGoal,
      carb: acc.carb + s.carbsGoal,
      fat: acc.fat + s.fatGoal,
    }),
    { kcal: 0, prot: 0, carb: 0, fat: 0 }
  ), [slots]);

  const dayCalorieGoal = routineGoals.kcal || calorieGoal;
  const dayProteinGoal = routineGoals.prot || proteinGoal;

  // Refeições agrupadas por slot, com o consumido de cada um
  const bySlot = useMemo(() => {
    const map: Record<string, { meals: Meal[]; kcal: number; prot: number; carb: number; fat: number }> = {};
    for (const slot of slots) map[slot.id] = { meals: [], kcal: 0, prot: 0, carb: 0, fat: 0 };

    const loose: Meal[] = [];
    for (const m of meals) {
      const bucket = m.slotId ? map[m.slotId] : undefined;
      if (!bucket) { loose.push(m); continue; }
      bucket.meals.push(m);
      bucket.kcal += m.calories ?? 0;
      bucket.prot += m.protein ?? 0;
      bucket.carb += m.carbs ?? 0;
      bucket.fat += m.fat ?? 0;
    }
    return { map, loose };
  }, [meals, slots]);

  // ── Ações: água ──
  const addWater = async (ml: number) => {
    if (ml <= 0) return;
    const wasBelow = waterToday < waterGoal;
    const tempId = `temp-${Date.now()}`;
    setWaterEntries(prev => [...prev, { id: tempId, ml, date: today }]);

    if (wasBelow && waterToday + ml >= waterGoal) {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2500);
    }

    const { data, error: insertErr } = await api
      .from('water_intake')
      .insert({ user_id: session.user.id, ml, date: today })
      .select('id, ml, date')
      .single();
    if (data) {
      setWaterEntries(prev => prev.map(e => (e.id === tempId ? (data as WaterEntry) : e)));
    } else {
      // Reverte o registro otimista e avisa o usuário
      setWaterEntries(prev => prev.filter(e => e.id !== tempId));
      console.error('Erro ao registrar água:', insertErr);
      setError(`Não foi possível registrar a água: ${insertErr?.message ?? 'erro desconhecido'}`);
    }
  };

  const undoWater = async () => {
    const todayEntries = waterEntries.filter(e => e.date === today);
    const last = todayEntries[todayEntries.length - 1];
    if (!last) return;
    setWaterEntries(prev => prev.filter(e => e.id !== last.id));
    if (!last.id.startsWith('temp-')) {
      await api.from('water_intake').delete().eq('id', last.id).eq('user_id', session.user.id);
    }
  };

  const saveWaterGoal = async () => {
    const goal = Math.max(500, Number(waterGoalInput) || 2000);
    setWaterGoal(goal);
    setEditingWaterGoal(false);
    const { error: upErr } = await api
      .from('diet_settings')
      .upsert({ user_id: session.user.id, water_goal_ml: goal, calorie_goal: calorieGoal, protein_goal: proteinGoal });
    if (upErr) {
      console.error('Erro ao salvar meta de água:', upErr);
      setError(`Não foi possível salvar a meta: ${upErr.message}`);
    }
  };

  // ── Ações: refeições ──
  const addMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mealName.trim()) return;
    const cal = mealCal ? Number(mealCal) : null;
    const prot = mealProt ? Number(mealProt) : null;
    const carbs = mealCarbs ? Number(mealCarbs) : null;
    const fat = mealFat ? Number(mealFat) : null;
    const { data, error: insertErr } = await api
      .from('meals')
      .insert({
        user_id: session.user.id, date: today, name: mealName.trim(),
        calories: cal, protein: prot, carbs, fat, slot_id: activeSlot,
      })
      .select('id, name, calories, protein, carbs, fat, slot_id')
      .single();

    if (insertErr) {
      console.error('Erro ao salvar refeição:', insertErr);
      setAiError(`Não foi possível salvar: ${insertErr.message}`);
      return;
    }

    if (data) {
      const d = data as any;
      setMeals(prev => [...prev, {
        id: d.id, name: d.name, calories: d.calories,
        protein: d.protein, carbs: d.carbs, fat: d.fat ?? null,
        slotId: d.slot_id ?? null,
      }]);
    }
    setActiveSlot(null);
    setMealName('');
    setMealCal('');
    setMealProt('');
    setMealCarbs('');
    setMealFat('');
    setFoodDescription('');
    setAiNote(null);
    setAiError(null);
    setLastAction(null);
    setShowMealForm(false);
  };

  // ── IA: preencher macros (por foto ou por descrição) ──
  const runAnalysis = async (analyze: () => Promise<FoodAnalysis>) => {
    setAiLoading(true);
    setAiError(null);
    setAiNote(null);
    try {
      const result = await analyze();
      setMealName(result.name);
      setMealCal(String(result.calories));
      setMealProt(String(result.protein));
      setMealCarbs(String(result.carbs));
      setMealFat(result.fat != null ? String(result.fat) : '');
      setAiNote(
        `Confiança ${result.confidence}${result.notes ? ` — ${result.notes}` : ''}. Ajuste os valores se precisar.`
      );
    } catch (err: any) {
      setAiError(err?.message ?? 'Erro ao analisar. Tente novamente.');
    } finally {
      setAiLoading(false);
    }
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher a mesma foto de novo
    if (!file) return;

    try {
      const img = await compressImage(file);
      setLastAction({ kind: 'photo', img });
      await runAnalysis(() => analyzeFoodPhoto(img.base64, img.mediaType));
    } catch (err: any) {
      setAiError(err?.message ?? 'Não foi possível ler a imagem.');
    }
  };

  const handleDescribeFood = async () => {
    const desc = foodDescription.trim();
    if (!desc || aiLoading) return;
    setLastAction({ kind: 'text', text: desc });
    await runAnalysis(() => analyzeFoodText(desc));
  };

  const retryLastAnalysis = () => {
    if (!lastAction) return;
    if (lastAction.kind === 'photo') {
      runAnalysis(() => analyzeFoodPhoto(lastAction.img.base64, lastAction.img.mediaType));
    } else {
      runAnalysis(() => analyzeFoodText(lastAction.text));
    }
  };

  // Adiciona uma refeição ao rascunho da rotina (só vai pro banco ao salvar)
  const addRoutineSlot = () => {
    setRoutineDraft(d => [...d, {
      id: `nova-${crypto.randomUUID()}`,
      name: '',
      position: d.length,
      timeHint: '',
      kcalGoal: 0,
      proteinGoal: 0,
      carbsGoal: 0,
      fatGoal: 0,
    }]);
  };

  const removeRoutineSlot = (index: number) => {
    setRoutineDraft(d => d.filter((_, i) => i !== index).map((x, i) => ({ ...x, position: i })));
  };

  // Salva a rotina inteira: cria, atualiza e remove numa transação só
  const saveRoutine = async () => {
    setSavingRoutine(true);
    const { data, error: rpcErr } = await api.rpc('save_meal_routine', {
      p_slots: routineDraft.map((x, i) => ({
        // Slots novos ainda não existem no banco — vão sem id
        id: x.id.startsWith('nova-') ? null : x.id,
        name: x.name,
        position: i,
        time_hint: x.timeHint,
        kcal_goal: x.kcalGoal,
        protein_goal: x.proteinGoal,
        carbs_goal: x.carbsGoal,
        fat_goal: x.fatGoal,
      })),
    });
    setSavingRoutine(false);

    if (rpcErr) {
      console.error('Erro ao salvar a rotina:', rpcErr);
      setError(`Não foi possível salvar a rotina: ${rpcErr.message}`);
      return;
    }

    const saved = (data as any[]).map(r => ({
      id: r.id, name: r.name, position: r.position, timeHint: r.time_hint,
      kcalGoal: r.kcal_goal, proteinGoal: r.protein_goal, carbsGoal: r.carbs_goal,
      fatGoal: r.fat_goal ?? 0,
    })).sort((a, b) => a.position - b.position);

    setSlots(saved);
    // Refeições cujos slots sumiram voltam para "Fora da rotina"
    const alive = new Set(saved.map(x => x.id));
    setMeals(prev => prev.map(m => (m.slotId && !alive.has(m.slotId) ? { ...m, slotId: null } : m)));
    setEditingRoutine(false);
  };

  // Salva uma refeição já registrada como favorita
  const saveAsFavorite = async (m: Meal) => {
    if (favorites.some(f => f.name.toLowerCase() === m.name.toLowerCase())) {
      setError('Essa refeição já está nos favoritos.');
      return;
    }
    const { data, error: favErr } = await api
      .from('favorite_meals')
      .insert({
        user_id: session.user.id, name: m.name, calories: m.calories,
        protein: m.protein, carbs: m.carbs, fat: m.fat, slot_id: m.slotId,
      })
      .select('id, name, calories, protein, carbs, fat, slot_id')
      .single();

    if (favErr) {
      console.error('Erro ao favoritar:', favErr);
      setError(`Não foi possível favoritar: ${favErr.message}`);
      return;
    }
    const d = data as any;
    setFavorites(prev => [{
      id: d.id, name: d.name, calories: d.calories, protein: d.protein,
      carbs: d.carbs, fat: d.fat, slotId: d.slot_id ?? null,
    }, ...prev]);
  };

  const removeFavorite = async (id: string) => {
    setFavorites(prev => prev.filter(f => f.id !== id));
    await api.from('favorite_meals').delete().eq('id', id).eq('user_id', session.user.id);
  };

  // Registra um favorito no dia/slot atual com um toque
  const addFromFavorite = async (fav: Favorite, slotId: string) => {
    const { data, error: insErr } = await api
      .from('meals')
      .insert({
        user_id: session.user.id, date: viewDate, name: fav.name,
        calories: fav.calories, protein: fav.protein, carbs: fav.carbs,
        fat: fav.fat, slot_id: slotId,
      })
      .select('id, name, calories, protein, carbs, fat, slot_id')
      .single();

    if (insErr) {
      console.error('Erro ao adicionar favorito:', insErr);
      setError(`Não foi possível adicionar: ${insErr.message}`);
      return;
    }
    const d = data as any;
    setMeals(prev => [...prev, {
      id: d.id, name: d.name, calories: d.calories, protein: d.protein,
      carbs: d.carbs, fat: d.fat ?? null, slotId: d.slot_id ?? null,
    }]);

    // Mais usado sobe na lista
    api.rpc('increment_favorite_use', { p_id: fav.id }).then(() => {});
    setPickingFavFor(null);
  };

  // Navega entre os dias (não deixa passar de hoje)
  const shiftDay = (days: number) => {
    const d = new Date(viewDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const next = localDateStr(d);
    if (next > todayStr) return;
    setViewDate(next);
  };

  const dayLabel = (() => {
    const d = new Date(viewDate + 'T12:00:00');
    const yesterday = localDateStr(new Date(Date.now() - 86400000));
    if (viewDate === todayStr) return 'Hoje';
    if (viewDate === yesterday) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  })();

  // Repete a alimentação do dia anterior — útil quando a rotina é estável
  const copyPreviousDay = async () => {
    const prev = new Date(viewDate + 'T12:00:00');
    prev.setDate(prev.getDate() - 1);

    setCopying(true);
    const { data, error: cpErr } = await api.rpc('copy_meals_from', {
      p_from: localDateStr(prev),
      p_to: viewDate,
    });
    setCopying(false);

    if (cpErr) {
      console.error('Erro ao copiar o dia anterior:', cpErr);
      setError(`Não foi possível copiar: ${cpErr.message}`);
      return;
    }
    if (!data || (data as any[]).length === meals.length) {
      setError('O dia anterior não tem refeições registradas.');
      return;
    }
    setMeals((data as any[]).map(m => ({
      id: m.id, name: m.name, calories: m.calories,
      protein: m.protein, carbs: m.carbs, fat: m.fat ?? null,
      slotId: m.slot_id ?? null,
    })));
  };

  // Encaixa numa refeição da rotina uma entrada que ficou solta
  const moveMealToSlot = async (mealId: string, slotId: string) => {
    setMeals(prev => prev.map(m => (m.id === mealId ? { ...m, slotId } : m)));
    const { error: upErr } = await api
      .from('meals')
      .update({ slot_id: slotId })
      .eq('id', mealId)
      .eq('user_id', session.user.id);
    if (upErr) {
      console.error('Erro ao mover refeição:', upErr);
      setMeals(prev => prev.map(m => (m.id === mealId ? { ...m, slotId: null } : m)));
      setError(`Não foi possível mover: ${upErr.message}`);
    }
  };

  const deleteMeal = async (id: string) => {
    const removed = meals.find(m => m.id === id);
    setMeals(prev => prev.filter(m => m.id !== id));
    const { error: delErr } = await api
      .from('meals').delete().eq('id', id).eq('user_id', session.user.id);
    if (delErr && removed) {
      console.error('Erro ao remover refeição:', delErr);
      setMeals(prev => [...prev, removed]); // devolve à lista
      setError(`Não foi possível remover: ${delErr.message}`);
    }
  };

  // ── Anel SVG ──
  const R = 80;
  const C = 2 * Math.PI * R;

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
        <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl h-80" />
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Erro geral */}
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)]">
          <p className="flex-1 text-sm text-[var(--danger)]">{error}</p>
          <button onClick={() => setError(null)} className="text-[var(--danger)]/60 hover:text-[var(--danger)] transition-colors">
            ✕
          </button>
        </div>
      )}

      {/* Celebração */}
      <AnimatePresence>
        {celebrate && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-[var(--btn-bg)] text-[var(--btn-fg)] px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 font-bold text-sm"
          >
            <Trophy size={18} /> Meta de água batida! 💧
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navegação por dia — não se aplica à aba Corpo */}
      {dietTab !== 'corpo' && (
      <div className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-xl px-2 py-2">
        <button
          onClick={() => shiftDay(-1)}
          className="w-9 h-9 rounded-lg text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-all"
          aria-label="dia anterior"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-[var(--text)]">{dayLabel}</p>
          <p className="text-[10px] text-[var(--text-3)] capitalize">
            {new Date(viewDate + 'T12:00:00').toLocaleDateString('pt-BR', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
        </div>
        <button
          onClick={() => shiftDay(1)}
          disabled={isToday}
          className="w-9 h-9 rounded-lg text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-all disabled:opacity-25 disabled:cursor-not-allowed"
          aria-label="próximo dia"
        >
          ›
        </button>
      </div>
      )}

      {/* Sub-abas */}
      <div className="flex gap-6 border-b border-[var(--border)]">
        {([
          { id: 'agua',      label: 'Hidratação' },
          { id: 'refeicoes', label: 'Refeições' },
          { id: 'corpo',     label: 'Corpo' },
        ] as { id: DietaTab; label: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setDietTab(t.id)}
            className={`relative pb-2.5 text-[13.5px] font-medium transition-colors ${
              dietTab === t.id ? 'text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
            {dietTab === t.id && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />
            )}
          </button>
        ))}
      </div>

      {dietTab === 'agua' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Card Hidratação ── */}
        <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 md:p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
                <Droplets size={16} className="text-[var(--accent)]" /> Hidratação
              </h3>
              <p className="text-xs text-[var(--text-2)] mt-0.5">Meta diária de água</p>
            </div>
            {editingWaterGoal ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={waterGoalInput}
                  onChange={e => setWaterGoalInput(e.target.value)}
                  className="w-20 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-lg px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[10px] text-[var(--text-2)]">ml</span>
                <button onClick={saveWaterGoal} className="p-1.5 bg-[var(--btn-bg)] rounded-lg text-[var(--btn-fg)]">
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingWaterGoal(true)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] bg-[var(--surface-3)] px-3 py-1.5 rounded-lg transition-all"
              >
                Meta: {formatMl(waterGoal)} <Pencil size={11} />
              </button>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
            {/* Anel de progresso */}
            <div className="relative w-48 h-48 shrink-0">
              <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                <circle cx="100" cy="100" r={R} stroke="var(--border)" strokeWidth="14" fill="none" />
                <motion.circle
                  cx="100" cy="100" r={R}
                  stroke={'var(--accent)'}
                  strokeWidth="14"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  initial={{ strokeDashoffset: C }}
                  animate={{ strokeDashoffset: C * (1 - waterPct / 100) }}
                  transition={{ type: 'spring', stiffness: 60, damping: 15 }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span
                  key={waterToday}
                  initial={{ scale: 1.15, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`text-3xl font-black tabular-nums ${goalHit ? 'text-[var(--accent)]' : 'text-[var(--accent)]'}`}
                >
                  {formatMl(waterToday)}
                </motion.span>
                <span className="text-xs text-[var(--text-2)] mt-1">de {formatMl(waterGoal)}</span>
                <span className={`text-[10px] font-bold mt-1 ${goalHit ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'}`}>
                  {goalHit ? '✓ Meta batida!' : `${waterPct.toFixed(0)}%`}
                </span>
              </div>
            </div>

            {/* Botões rápidos */}
            <div className="flex-1 w-full space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { ml: 200, label: 'Copo', icon: '🥛' },
                  { ml: 500, label: 'Garrafa', icon: '🍶' },
                  { ml: 1000, label: '1 Litro', icon: '💧' },
                ].map(b => (
                  <motion.button
                    key={b.ml}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => addWater(b.ml)}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] transition-all"
                  >
                    <span className="text-2xl">{b.icon}</span>
                    <span className="text-xs font-semibold text-[var(--text)]">+{b.ml} ml</span>
                    <span className="text-[10px] text-[var(--text-2)]">{b.label}</span>
                  </motion.button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  value={customMl}
                  onChange={e => setCustomMl(e.target.value)}
                  placeholder="Quantidade personalizada (ml)"
                  className="flex-1 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => { addWater(Number(customMl)); setCustomMl(''); }}
                  disabled={!customMl || Number(customMl) <= 0}
                  className="px-4 bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--btn-fg)] rounded-xl transition-all"
                >
                  <Plus size={18} />
                </button>
              </div>

              <button
                onClick={undoWater}
                disabled={waterEntries.filter(e => e.date === today).length === 0}
                className="flex items-center gap-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <RotateCcw size={12} /> Desfazer último registro
              </button>
            </div>
          </div>

          {/* Copos do dia */}
          <div className="mt-6 pt-5 border-t border-[var(--border)]">
            <p className="text-[10px] text-[var(--text-2)] uppercase tracking-widest mb-3">Copos de 250 ml</p>
            <div className="flex gap-1.5 flex-wrap">
              {Array.from({ length: Math.ceil(waterGoal / 250) }).map((_, i) => {
                const filled = waterToday >= (i + 1) * 250;
                const partial = !filled && waterToday > i * 250;
                return (
                  <motion.div
                    key={i}
                    initial={false}
                    animate={{ scale: filled ? 1 : 0.95, opacity: filled || partial ? 1 : 0.35 }}
                    className={`w-8 h-10 rounded-b-lg rounded-t-sm border-2 flex items-end justify-center overflow-hidden ${
                      filled ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-strong)] bg-[var(--surface-2)]'
                    }`}
                  >
                    {filled && <GlassWater size={14} className="text-[var(--accent)] mb-1" />}
                    {partial && (
                      <div
                        className="w-full bg-[var(--accent-soft)]"
                        style={{ height: `${((waterToday - i * 250) / 250) * 100}%` }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Card Histórico semanal ── */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 md:p-6">
          <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Últimos 7 dias</h3>
          <p className="text-xs text-[var(--text-2)] mb-6">Consumo de água</p>
          <div className="flex items-end justify-between gap-2 h-40">
            {weekData.map(d => {
              const pct = Math.min(100, (d.ml / waterGoal) * 100);
              const hit = d.ml >= waterGoal;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <span className="text-[9px] text-[var(--text-2)] tabular-nums">
                    {d.ml > 0 ? formatMl(d.ml) : ''}
                  </span>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(4, pct * 0.8)}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 16 }}
                    className={`w-full max-w-[28px] rounded-lg ${
                      hit ? 'bg-[var(--accent)]' : d.isToday ? 'bg-[var(--accent)]' : 'bg-[var(--accent-soft)]'
                    }`}
                  />
                  <span className={`text-[10px] capitalize ${d.isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-2)]'}`}>
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-center justify-between text-xs">
            <span className="text-[var(--text-2)]">Dias com meta batida</span>
            <span className="font-bold text-[var(--accent)]">
              {weekData.filter(d => d.ml >= waterGoal).length}/7
            </span>
          </div>
        </div>
      </div>
      )}

      {dietTab === 'refeicoes' && (
      <>
      {/* ── Card Refeições ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 md:p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
              <UtensilsCrossed size={16} className="text-[var(--load)]" /> Refeições de Hoje
            </h3>
            <p className="text-xs text-[var(--text-2)] mt-0.5">{meals.length} registradas</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setRoutineDraft(slots.map(x => ({ ...x }))); setEditingRoutine(true); }}
              className="flex items-center gap-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text)] bg-[var(--surface-3)] px-3 py-1.5 rounded-lg transition-all"
            >
              Minha rotina <Pencil size={11} />
            </button>
            <button
              onClick={() => setShowMealForm(p => !p)}
              className="bg-[var(--surface-3)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] p-1.5 rounded-lg transition-all"
            >
              <Plus size={18} className={showMealForm ? 'rotate-45 transition-transform' : 'transition-transform'} />
            </button>
          </div>
        </div>

        {/* Barras de macros */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--text-2)] flex items-center gap-1">
                <Flame size={12} className="text-[var(--load)]" /> Calorias
              </span>
              <span className={`text-xs font-bold tabular-nums ${totalCal > dayCalorieGoal ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}>
                {totalCal} / {dayCalorieGoal} kcal
              </span>
            </div>
            <div className="w-full bg-[var(--surface-3)] h-2 rounded-full overflow-hidden">
              <motion.div
                animate={{ width: `${Math.min(100, (totalCal / dayCalorieGoal) * 100)}%` }}
                className={`h-full rounded-full ${totalCal > dayCalorieGoal ? 'bg-[var(--danger)]' : 'bg-[var(--load)]'}`}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--text-2)] flex items-center gap-1">
                <Beef size={12} className="text-[var(--danger)]" /> Proteína
              </span>
              <span className={`text-xs font-bold tabular-nums ${totalProt >= dayProteinGoal ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                {totalProt} / {dayProteinGoal} g
              </span>
            </div>
            <div className="w-full bg-[var(--surface-3)] h-2 rounded-full overflow-hidden">
              <motion.div
                animate={{ width: `${Math.min(100, (totalProt / dayProteinGoal) * 100)}%` }}
                className={`h-full rounded-full ${totalProt >= dayProteinGoal ? 'bg-[var(--accent)]' : 'bg-[var(--danger)]'}`}
              />
            </div>
          </div>
        </div>

        {/* Total de carboidratos */}
        <div className="flex items-center justify-between px-4 py-2.5 mb-5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl">
          <span className="text-xs text-[var(--text-2)] flex items-center gap-1.5">
            <Wheat size={13} className="text-[var(--load)]" /> Carboidratos
          </span>
          <span className="text-xs font-bold tabular-nums">
            <span className="text-[var(--load)]">{totalCarbs} g</span>
            <span className="text-[var(--text-3)]"> · gordura </span>
            <span className="text-[var(--load)]">{totalFat} g</span>
          </span>
        </div>

        {/* Form de nova refeição */}
        <AnimatePresence>
          {showMealForm && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={addMeal}
              className="overflow-hidden mb-4"
            >
              <div className="p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl space-y-3">
                {/* Botão de análise por foto */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelected}
                  className="hidden"
                />
                {/* Descrever com palavras */}
                <div className="flex gap-2">
                  <input
                    value={foodDescription}
                    onChange={e => setFoodDescription(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleDescribeFood(); }
                    }}
                    disabled={aiLoading}
                    placeholder="Ex: 2 ovos e um pão, 100g de amendoim, um McChicken..."
                    className="flex-1 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleDescribeFood}
                    disabled={aiLoading || !foodDescription.trim()}
                    title="Calcular macros com IA"
                    className="shrink-0 flex items-center gap-1.5 px-4 bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--btn-fg)] rounded-xl text-sm font-semibold transition-all"
                  >
                    {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    Calcular
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-[var(--border)]" />
                  <span className="text-[10px] text-[var(--text-3)] uppercase tracking-widest">ou</span>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                </div>

                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[var(--accent-line)] bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] text-[var(--accent)] text-sm font-semibold transition-all disabled:opacity-60"
                >
                  {aiLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Analisando...
                    </>
                  ) : (
                    <>
                      <Camera size={16} /> Tirar foto do prato
                    </>
                  )}
                </button>

                {aiError && (
                  <div className="flex items-center gap-2 text-xs text-[var(--danger)] bg-[var(--danger-soft)] rounded-lg px-3 py-2">
                    <span className="flex-1">{aiError}</span>
                    {lastAction && !aiLoading && (
                      <button
                        type="button"
                        onClick={retryLastAnalysis}
                        className="shrink-0 flex items-center gap-1 font-semibold text-[var(--danger)] hover:text-[var(--text)] bg-[var(--danger-soft)] hover:bg-[var(--danger-soft)] px-2.5 py-1 rounded-md transition-all"
                      >
                        <RotateCcw size={11} /> Tentar de novo
                      </button>
                    )}
                  </div>
                )}
                {aiNote && (
                  <p className="text-xs text-[var(--accent)] bg-[var(--accent-soft)] rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <Sparkles size={13} className="shrink-0 mt-0.5" /> {aiNote}
                  </p>
                )}

                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    required
                    value={mealName}
                    onChange={e => setMealName(e.target.value)}
                    placeholder="Ex: Frango com arroz"
                    className="flex-1 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)]"
                  />
                  <input
                    type="number"
                    value={mealCal}
                    onChange={e => setMealCal(e.target.value)}
                    placeholder="kcal"
                    className="w-full md:w-24 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input
                    type="number"
                    value={mealCarbs}
                    onChange={e => setMealCarbs(e.target.value)}
                    placeholder="carbo (g)"
                    className="w-full md:w-24 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input
                    type="number"
                    value={mealFat}
                    onChange={e => setMealFat(e.target.value)}
                    placeholder="gord (g)"
                    className="w-full md:w-24 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <input
                    type="number"
                    value={mealProt}
                    onChange={e => setMealProt(e.target.value)}
                    placeholder="prot (g)"
                    className="w-full md:w-24 bg-[var(--surface-3)] border border-[var(--border-strong)] rounded-xl px-4 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-all placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="submit"
                    className="bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] text-[var(--btn-fg)] font-semibold px-5 py-2.5 rounded-xl text-sm transition-all"
                  >
                    Adicionar
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Rotina do dia: uma seção por refeição, com meta própria */}
        <div className="space-y-3">
          {slots.map(slot => {
            const eaten = bySlot.map[slot.id] ?? { meals: [], kcal: 0, prot: 0, carb: 0, fat: 0 };
            const pct = slot.kcalGoal > 0 ? Math.min(100, (eaten.kcal / slot.kcalGoal) * 100) : 0;
            const over = slot.kcalGoal > 0 && eaten.kcal > slot.kcalGoal;
            const hitProtein = slot.proteinGoal > 0 && eaten.prot >= slot.proteinGoal;
            const empty = eaten.meals.length === 0;

            return (
              <div key={slot.id} className="rounded-xl border border-[var(--border)] transition-colors"
                style={{ background: empty ? 'var(--surface-2)' : 'var(--surface)' }}>

                {/* Cabeçalho da refeição */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[var(--text)]">{slot.name}</p>
                      {slot.timeHint && (
                        <span className="text-[10px] text-[var(--text-3)] font-medium">{slot.timeHint}</span>
                      )}
                      {hitProtein && !empty && (
                        <span className="text-[9px] font-bold text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded">
                          PROTEÍNA OK
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] mt-1 tabular-nums text-[var(--text-2)]">
                      <span className={over ? 'text-[var(--danger)]' : 'text-[var(--load)]'}>
                        {eaten.kcal} / {slot.kcalGoal} kcal
                      </span>
                      {' \u00b7 '}
                      <span className={hitProtein ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'}>
                        {eaten.prot} / {slot.proteinGoal} g prot
                      </span>
                      {slot.carbsGoal > 0 && (
                        <>
                          {' \u00b7 '}
                          <span className="text-[var(--load)]">{eaten.carb} / {slot.carbsGoal} g carbo</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {favorites.length > 0 && (
                      <button
                        onClick={() => setPickingFavFor(pickingFavFor === slot.id ? null : slot.id)}
                        title="Usar um favorito"
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                          pickingFavFor === slot.id
                            ? 'bg-[var(--load-soft)] text-[var(--load)]'
                            : 'bg-[var(--surface-3)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--load)]'
                        }`}
                      >
                        <Star size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => { setActiveSlot(slot.id); setShowMealForm(true); }}
                      title={'Adicionar em ' + slot.name}
                      className="w-8 h-8 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] flex items-center justify-center transition-all"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* Favoritos: um toque para registrar */}
                <AnimatePresence>
                  {pickingFavFor === slot.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 flex flex-wrap gap-2">
                        {favorites.map(f => (
                          <button
                            key={f.id}
                            onClick={() => addFromFavorite(f, slot.id)}
                            className="group/fav flex items-center gap-2 bg-[var(--surface-3)] hover:bg-[var(--load-soft)] border border-[var(--border)] hover:border-[var(--load)] rounded-lg pl-3 pr-2 py-2 transition-all"
                          >
                            <span className="text-[12px] text-[var(--text)]">{f.name}</span>
                            <span className="text-[10px] text-[var(--text-2)]">{f.calories ?? 0} kcal</span>
                            <span
                              onClick={e => { e.stopPropagation(); removeFavorite(f.id); }}
                              title="Remover dos favoritos"
                              className="text-[var(--text-3)] hover:text-[var(--danger)] transition-colors px-1"
                            >
                              ×
                            </span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Progresso de calorias da refeição */}
                <div className="mx-4 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <motion.div
                    animate={{ width: pct + '%' }}
                    className={`h-full rounded-full ${over ? 'bg-[var(--danger)]' : pct >= 100 ? 'bg-[var(--accent)]' : 'bg-[var(--load)]'}`}
                  />
                </div>

                {/* Itens registrados nesta refeição */}
                {eaten.meals.length > 0 && (
                  <div className="px-4 pt-3 pb-3 space-y-1.5">
                    <AnimatePresence>
                      {eaten.meals.map(m => (
                        <motion.div
                          key={m.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -16 }}
                          className="group flex items-center gap-3"
                        >
                          <span className="w-7 h-7 rounded-lg bg-[var(--load-soft)] flex items-center justify-center shrink-0">
                            <UtensilsCrossed size={13} className="text-[var(--load)]" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[var(--text)] truncate">{m.name}</p>
                            <p className="text-[10.5px] text-[var(--text-2)]">{macroLine(m)}</p>
                          </div>
                          <button
                            onClick={() => saveAsFavorite(m)}
                            title="Salvar nos favoritos"
                            className="p-1.5 rounded-lg text-transparent group-hover:text-[var(--text-3)] hover:!text-[var(--load)] hover:bg-[var(--load-soft)] transition-all"
                          >
                            <Star size={13} />
                          </button>
                          <button
                            onClick={() => deleteMeal(m.id)}
                            className="p-1.5 rounded-lg text-transparent group-hover:text-[var(--text-3)] hover:!text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all"
                          >
                            <Trash2 size={13} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {empty && (
                  <p className="px-4 pt-2.5 pb-3.5 text-[11.5px] text-[var(--text-3)]">Ainda não registrada</p>
                )}
              </div>
            );
          })}

          {meals.length === 0 && slots.length > 0 && (
            <button
              onClick={copyPreviousDay}
              disabled={copying}
              className="w-full py-3 rounded-xl border border-dashed border-[var(--border-strong)] text-[var(--text-2)] hover:text-[var(--accent)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] text-sm font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {copying
                ? <><Loader2 size={15} className="animate-spin" /> Copiando...</>
                : <><Copy size={15} /> Repetir a alimentação de ontem</>}
            </button>
          )}

          {/* Refeições registradas antes da rotina existir */}
          {bySlot.loose.length > 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4">
              <p className="text-[10px] text-[var(--text-2)] uppercase tracking-[0.14em] font-semibold mb-3">
                Fora da rotina
              </p>
              <div className="space-y-2">
                {bySlot.loose.map(m => (
                  <div key={m.id} className="group flex items-center gap-3">
                    <span className="w-7 h-7 rounded-lg bg-[var(--surface-3)] flex items-center justify-center shrink-0">
                      <UtensilsCrossed size={13} className="text-[var(--text-2)]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--text)] truncate">{m.name}</p>
                      <p className="text-[10.5px] text-[var(--text-2)]">{macroLine(m)}</p>
                    </div>
                    <select
                      value=""
                      onChange={e => { if (e.target.value) moveMealToSlot(m.id, e.target.value); }}
                      title="Mover para uma refeição da rotina"
                      className="bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-2 py-1 text-[11px] text-[var(--text-2)] outline-none"
                    >
                      <option value="">Mover para…</option>
                      {slots.map(sl => <option key={sl.id} value={sl.id}>{sl.name}</option>)}
                    </select>
                    <button
                      onClick={() => deleteMeal(m.id)}
                      className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Editor da rotina alimentar */}
      {editingRoutine && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
          onClick={() => !savingRoutine && setEditingRoutine(false)}>
          <div className="bg-[var(--surface)] border-t sm:border border-[var(--border-strong)] rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[88vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            <div className="p-5 border-b border-[var(--border)] flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text)]">Minha rotina</h3>
                <p className="text-xs text-[var(--text-2)] mt-0.5">
                  Defina as refeições do seu dia e a meta de cada uma
                </p>
              </div>
              <button onClick={() => setEditingRoutine(false)} disabled={savingRoutine}
                className="p-1.5 rounded-lg text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-all disabled:opacity-40">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {routineDraft.map((slot, i) => (
                <div key={slot.id} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={slot.name}
                      onChange={e => setRoutineDraft(d => d.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      placeholder="Nome da refeição"
                      className="flex-1 min-w-0 bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text)] outline-none focus:border-[var(--border-strong)] transition-colors"
                    />
                    <input
                      value={slot.timeHint ?? ''}
                      onChange={e => setRoutineDraft(d => d.map((x, j) => j === i ? { ...x, timeHint: e.target.value } : x))}
                      placeholder="07:00"
                      className="w-[68px] shrink-0 bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-2 py-2.5 text-sm text-center text-[var(--text-2)] outline-none focus:border-[var(--border-strong)] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => removeRoutineSlot(i)}
                      title="Remover refeição"
                      className="shrink-0 w-10 rounded-lg border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--danger)] hover:border-[var(--danger)] hover:bg-[var(--danger-soft)] flex items-center justify-center transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {([
                      { key: 'kcalGoal',    label: 'kcal',  color: 'text-[var(--load)]' },
                      { key: 'carbsGoal',   label: 'carbo', color: 'text-[var(--load)]' },
                      { key: 'proteinGoal', label: 'prot',  color: 'text-[var(--danger)]' },
                      { key: 'fatGoal',     label: 'gord',  color: 'text-[var(--load)]' },
                    ] as { key: 'kcalGoal' | 'carbsGoal' | 'proteinGoal' | 'fatGoal'; label: string; color: string }[]).map(f => (
                      <label key={f.key} className="block">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${f.color}`}>{f.label}</span>
                        <input
                          type="number" min="0" inputMode="numeric"
                          value={slot[f.key]}
                          onChange={e => setRoutineDraft(d => d.map((x, j) =>
                            j === i ? { ...x, [f.key]: Math.max(0, Number(e.target.value) || 0) } : x
                          ))}
                          className="w-full mt-1 bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--border-strong)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {routineDraft.length === 0 && (
                <div className="py-10 text-center border border-dashed border-[var(--border)] rounded-xl">
                  <p className="text-sm text-[var(--text-2)]">Nenhuma refeição na rotina</p>
                  <p className="text-xs text-[var(--text-3)] mt-1">Adicione a primeira abaixo</p>
                </div>
              )}

              <button
                type="button"
                onClick={addRoutineSlot}
                className="w-full py-3 rounded-xl border border-dashed border-[var(--border-strong)] text-[var(--text-2)] hover:text-[var(--accent)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] text-sm font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <Plus size={15} /> Adicionar refeição
              </button>
            </div>

            {/* Total do dia — soma das refeições */}
            <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between text-xs">
              <span className="text-[var(--text-2)]">Total do dia</span>
              <span className="font-bold tabular-nums text-[var(--text)]">
                {routineDraft.reduce((a, x) => a + x.kcalGoal, 0)} kcal
                <span className="text-[var(--text-3)]"> · </span>
                {routineDraft.reduce((a, x) => a + x.carbsGoal, 0)} g carbo
                <span className="text-[var(--text-3)]"> · </span>
                {routineDraft.reduce((a, x) => a + x.proteinGoal, 0)} g prot
                <span className="text-[var(--text-3)]"> · </span>
                {routineDraft.reduce((a, x) => a + x.fatGoal, 0)} g gord
              </span>
            </div>

            <div className="p-5 pt-3 flex gap-3">
              <button onClick={() => setEditingRoutine(false)} disabled={savingRoutine}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-[var(--text-2)] hover:text-[var(--text)] bg-[var(--surface-3)] transition-all disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={saveRoutine} disabled={savingRoutine}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-[var(--btn-fg)] bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] transition-all disabled:opacity-60">
                {savingRoutine ? 'Salvando...' : 'Salvar rotina'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {dietTab === 'corpo' && <Corpo session={session} />}
    </div>
  );
}
