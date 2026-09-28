import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { Scale, Ruler, Check, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Session } from '../services/api';

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type WeighIn = { id: string; date: string; weight: number };
type Measure = {
  id: string; date: string;
  chest: number | null; waist: number | null; hip: number | null;
  arm: number | null; thigh: number | null;
};

const MEASURE_FIELDS = [
  { key: 'chest', label: 'Peito' },
  { key: 'waist', label: 'Cintura' },
  { key: 'hip',   label: 'Quadril' },
  { key: 'arm',   label: 'Braço' },
  { key: 'thigh', label: 'Coxa' },
] as const;

/**
 * O peso oscila muito de um dia para o outro (água, sal, horário).
 * A média dos últimos 7 registros mostra a tendência real e evita
 * que a pessoa desanime com uma variação que não significa nada.
 */
function movingAverage(points: WeighIn[], window = 7): { date: string; avg: number }[] {
  return points.map((_, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((a, p) => a + p.weight, 0) / slice.length;
    return { date: points[i].date, avg };
  });
}

export function Corpo({ session }: { session: Session }) {
  const [weights, setWeights] = useState<WeighIn[]>([]);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [weightInput, setWeightInput] = useState('');
  const [saving, setSaving] = useState(false);

  const [showMeasureForm, setShowMeasureForm] = useState(false);
  const [measureDraft, setMeasureDraft] = useState<Record<string, string>>({});

  const today = localDateStr();

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      setLoading(true);
      const [w, m] = await Promise.all([
        api.from('body_weight')
          .select('id, date, weight')
          .eq('user_id', session.user.id)
          .order('date', { ascending: true }),
        api.from('body_measurements')
          .select('id, date, chest, waist, hip, arm, thigh')
          .eq('user_id', session.user.id)
          .order('date', { ascending: false }),
      ]);

      if (w.error || m.error) {
        console.error('Erro ao carregar dados corporais:', w.error ?? m.error);
        setError('Não foi possível carregar seus registros.');
      }
      if (w.data) setWeights(w.data.map(r => ({ ...r, weight: Number(r.weight) })));
      if (m.data) setMeasures(m.data as Measure[]);
      setLoading(false);
    };
    load();
  }, [session?.user?.id]);

  const stats = useMemo(() => {
    if (weights.length === 0) return null;
    const avg = movingAverage(weights);
    const current = weights[weights.length - 1];
    const currentAvg = avg[avg.length - 1].avg;

    // Compara com a média de 7 dias atrás para medir a tendência
    const weekAgoIdx = Math.max(0, avg.length - 8);
    const weekAgoAvg = avg[weekAgoIdx].avg;
    const delta = currentAvg - weekAgoAvg;

    const min = Math.min(...weights.map(p => p.weight));
    const max = Math.max(...weights.map(p => p.weight));

    return { avg, current, currentAvg, delta, min, max };
  }, [weights]);

  const saveWeight = async () => {
    const value = Number(weightInput.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Digite um peso válido.');
      return;
    }
    setSaving(true);
    const { data, error: upErr } = await api
      .from('body_weight')
      .upsert(
        { user_id: session.user.id, date: today, weight: value },
        { onConflict: 'user_id,date' }
      )
      .select('id, date, weight')
      .single();
    setSaving(false);

    if (upErr) {
      console.error('Erro ao salvar peso:', upErr);
      setError(`Não foi possível salvar: ${upErr.message}`);
      return;
    }
    const row = { ...(data as any), weight: Number((data as any).weight) };
    setWeights(prev => {
      const rest = prev.filter(p => p.date !== today);
      return [...rest, row].sort((a, b) => a.date.localeCompare(b.date));
    });
    setWeightInput('');
  };

  const saveMeasures = async () => {
    const payload: Record<string, unknown> = { user_id: session.user.id, date: today };
    let hasAny = false;
    for (const f of MEASURE_FIELDS) {
      const raw = (measureDraft[f.key] ?? '').replace(',', '.').trim();
      const val = raw === '' ? null : Number(raw);
      payload[f.key] = Number.isFinite(val as number) ? val : null;
      if (payload[f.key] != null) hasAny = true;
    }
    if (!hasAny) { setError('Preencha ao menos uma medida.'); return; }

    const { data, error: upErr } = await api
      .from('body_measurements')
      .upsert(payload, { onConflict: 'user_id,date' })
      .select('id, date, chest, waist, hip, arm, thigh')
      .single();

    if (upErr) {
      console.error('Erro ao salvar medidas:', upErr);
      setError(`Não foi possível salvar: ${upErr.message}`);
      return;
    }
    setMeasures(prev => [data as Measure, ...prev.filter(x => x.date !== today)]);
    setMeasureDraft({});
    setShowMeasureForm(false);
  };

  const deleteWeight = async (id: string) => {
    const removed = weights.find(w => w.id === id);
    setWeights(prev => prev.filter(w => w.id !== id));
    const { error: delErr } = await api
      .from('body_weight').delete().eq('id', id).eq('user_id', session.user.id);
    if (delErr && removed) {
      setWeights(prev => [...prev, removed].sort((a, b) => a.date.localeCompare(b.date)));
      setError('Não foi possível remover o registro.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-64" />
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl h-40" />
      </div>
    );
  }

  const latestMeasure = measures[0];
  const prevMeasure = measures[1];

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)]">
          <p className="flex-1 text-sm text-[var(--danger)]">{error}</p>
          <button onClick={() => setError(null)} className="text-[var(--danger)]/60 hover:text-[var(--danger)]">✕</button>
        </div>
      )}

      {/* ── Peso ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
              <Scale size={16} className="text-[var(--accent)]" /> Peso
            </h3>
            <p className="text-xs text-[var(--text-2)] mt-0.5">Tendência pela média de 7 dias</p>
          </div>
        </div>

        {stats ? (
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-[32px] font-extrabold tracking-[-0.03em] text-[var(--text)] tabular-nums">
                {stats.current.weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                <span className="text-base font-semibold text-[var(--text-2)]"> kg</span>
              </span>
              {(() => {
                const d = stats.delta;
                const flat = Math.abs(d) < 0.05;
                const Icon = flat ? Minus : d < 0 ? TrendingDown : TrendingUp;
                const color = flat ? 'text-[var(--text-2)]' : d < 0 ? 'text-[var(--accent)]' : 'text-[var(--load)]';
                return (
                  <span className={`flex items-center gap-1 text-[12.5px] font-semibold ${color}`}>
                    <Icon size={14} />
                    {flat ? 'estável' : `${d > 0 ? '+' : ''}${d.toFixed(1)} kg na semana`}
                  </span>
                );
              })()}
            </div>
            <p className="text-[11px] text-[var(--text-3)] mt-1.5">
              Média atual: {stats.currentAvg.toFixed(1)} kg · {weights.length} registros
            </p>

            {/* Gráfico: pontos reais + linha da média móvel */}
            {weights.length >= 2 && (() => {
              const pad = (stats.max - stats.min) * 0.15 || 1;
              const lo = stats.min - pad;
              const hi = stats.max + pad;
              const span = hi - lo;
              const x = (i: number) => weights.length === 1 ? 150 : 6 + (i / (weights.length - 1)) * 288;
              const y = (v: number) => 82 - ((v - lo) / span) * 74;

              return (
                <>
                  <svg viewBox="0 0 300 90" className="w-full h-28 mt-4 overflow-visible">
                    <polyline
                      points={weights.map((p, i) => `${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ')}
                      fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round"
                    />
                    <polyline
                      points={stats.avg.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ')}
                      fill="none" stroke="var(--accent)" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                    <circle cx={x(weights.length - 1)} cy={y(stats.currentAvg)} r="3.5" fill="var(--accent)" />
                  </svg>
                  <div className="flex justify-between text-[10.5px] text-[var(--text-3)] mt-1">
                    <span>{new Date(weights[0].date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</span>
                    <span className="text-[var(--accent)]">— média de 7 dias</span>
                    <span>{new Date(weights[weights.length - 1].date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</span>
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-[var(--text-2)]">
            Registre seu peso para acompanhar a evolução
          </p>
        )}

        {/* Registrar peso de hoje */}
        <div className="flex gap-2 mt-5">
          <input
            type="number" step="0.1" inputMode="decimal"
            value={weightInput}
            onChange={e => setWeightInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveWeight(); }}
            placeholder={weights.some(w => w.date === today) ? 'Atualizar peso de hoje (kg)' : 'Peso de hoje (kg)'}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={saveWeight}
            disabled={saving || !weightInput.trim()}
            className="px-5 rounded-xl bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--btn-fg)] text-sm font-semibold transition-all"
          >
            {saving ? '...' : 'Salvar'}
          </button>
        </div>

        {/* Últimos registros */}
        {weights.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-1">
            {[...weights].reverse().slice(0, 5).map(w => (
              <div key={w.id} className="group flex items-center justify-between py-1.5">
                <span className="text-[12px] text-[var(--text-2)] capitalize">
                  {new Date(w.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[var(--text)] tabular-nums">
                    {w.weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg
                  </span>
                  <button
                    onClick={() => deleteWeight(w.id)}
                    className="p-1 rounded text-transparent group-hover:text-[var(--text-3)] hover:!text-[var(--danger)] transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Medidas ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
              <Ruler size={16} className="text-[var(--accent)]" /> Medidas
            </h3>
            <p className="text-xs text-[var(--text-2)] mt-0.5">
              Em centímetros — mostram evolução quando a balança não mexe
            </p>
          </div>
          <button
            onClick={() => {
              setMeasureDraft(latestMeasure
                ? Object.fromEntries(MEASURE_FIELDS.map(f => [f.key, latestMeasure[f.key] != null ? String(latestMeasure[f.key]) : '']))
                : {});
              setShowMeasureForm(v => !v);
            }}
            className="w-8 h-8 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] flex items-center justify-center transition-all"
          >
            <span className={showMeasureForm ? 'rotate-45 transition-transform text-lg' : 'transition-transform text-lg'}>+</span>
          </button>
        </div>

        {showMeasureForm && (
          <div className="mb-4 p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {MEASURE_FIELDS.map(f => (
                <label key={f.key} className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-2)]">{f.label}</span>
                  <input
                    type="number" step="0.5" inputMode="decimal"
                    value={measureDraft[f.key] ?? ''}
                    onChange={e => setMeasureDraft(d => ({ ...d, [f.key]: e.target.value }))}
                    placeholder="—"
                    className="w-full mt-1 bg-[var(--surface-3)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-semibold tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent-line)] transition-colors placeholder:text-[var(--text-3)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
              ))}
            </div>
            <button
              onClick={saveMeasures}
              className="w-full mt-4 py-2.5 rounded-lg bg-[var(--btn-bg)] hover:bg-[var(--btn-bg-hover)] text-[var(--btn-fg)] text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            >
              <Check size={14} /> Salvar medidas de hoje
            </button>
          </div>
        )}

        {latestMeasure ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {MEASURE_FIELDS.map(f => {
              const now = latestMeasure[f.key];
              const before = prevMeasure?.[f.key];
              if (now == null) return null;
              const diff = before != null ? Number(now) - Number(before) : null;
              return (
                <div key={f.key} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-2)]">{f.label}</p>
                  <p className="font-display text-lg font-bold text-[var(--text)] tabular-nums mt-1">
                    {Number(now).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                    <span className="text-[11px] font-medium text-[var(--text-2)]"> cm</span>
                  </p>
                  {diff != null && Math.abs(diff) >= 0.1 && (
                    <p className={`text-[10.5px] font-semibold mt-0.5 ${diff > 0 ? 'text-[var(--accent)]' : 'text-[var(--load)]'}`}>
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)} cm
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-[var(--text-2)]">Nenhuma medida registrada ainda</p>
        )}

        {latestMeasure && (
          <p className="text-[10.5px] text-[var(--text-3)] mt-3">
            Última medição:{' '}
            {new Date(latestMeasure.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}
            {prevMeasure && ' · comparado com a anterior'}
          </p>
        )}
      </div>
    </div>
  );
}
