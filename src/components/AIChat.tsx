import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Send, Loader2, Sparkles, RotateCcw, CheckCircle2, Calendar } from 'lucide-react';
import type { Squad } from '../types';
import {
  sendMessage,
  buildWorkoutContext,
  type ChatMessage,
  type WorkoutExercise,
  type WorkoutCreatedEvent,
} from '../services/gemini';

interface WorkoutCard {
  dayName: string;
  focus: string;
  exercises: WorkoutExercise[];
}

interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  retryable?: boolean;
  workoutCard?: WorkoutCard;
}

interface AIChatProps {
  squad: Squad;
  streak: number;
  progressStats: {
    thisWeekByDate: Record<string, number>;
    lastWeekByDate: Record<string, number>;
    loading: boolean;
  };
  onCreateWorkout: (dayName: string, focus: string, exercises: WorkoutExercise[]) => void;
}

const QUICK_ACTIONS = [
  {
    label: 'Analisar progresso',
    prompt: 'Analise meu progresso atual considerando minha sequência de treinos e exercícios completados esta semana vs semana passada. Dê feedback específico e sugestões práticas de melhoria.',
  },
  {
    label: 'Sugerir dieta',
    prompt: 'Com base no meu plano de treino semanal, sugira um plano alimentar completo com macros recomendados (proteína, carboidrato, gordura) e exemplos de refeições para dias de treino e dias de descanso.',
  },
  {
    label: 'Ajustar treino',
    prompt: 'Analise meu plano de treino semanal e sugira ajustes para otimizar resultados: volume, frequência por músculo, exercícios complementares e progressão de carga.',
  },
  {
    label: 'Me motivar',
    prompt: 'Faça uma análise motivacional do meu desempenho recente e me dê dicas práticas para manter a consistência e superar platôs.',
  },
];

function renderInlineMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*.*?\*\*|\*.*?\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    return part;
  });
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose-sm">
      {text.split('\n').map((line, index) => {
        if (line.startsWith('### ')) {
          return <h3 key={index} className="text-sm font-bold text-[var(--text)] mt-3 mb-1">{renderInlineMarkdown(line.slice(4))}</h3>;
        }

        if (line.startsWith('## ')) {
          return <h2 key={index} className="text-sm font-bold text-[var(--text)] mt-3 mb-1">{renderInlineMarkdown(line.slice(3))}</h2>;
        }

        if (line.startsWith('- ')) {
          return <div key={index} className="ml-4 flex gap-2 text-[var(--text)]"><span aria-hidden="true">•</span><span>{renderInlineMarkdown(line.slice(2))}</span></div>;
        }

        return line
          ? <span key={index} className="block">{renderInlineMarkdown(line)}</span>
          : <br key={index} />;
      })}
    </div>
  );
}

export function AIChat({ squad, streak, progressStats, onCreateWorkout }: AIChatProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastFailedMsg, setLastFailedMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const trimmed = text.trim();
    const context = buildWorkoutContext(squad, streak, progressStats);

    const history: ChatMessage[] = messages
      .filter(m => !m.workoutCard)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        text: m.text,
      }));

    setLastFailedMsg(null);
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);

    const aiId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: aiId, role: 'assistant', text: '', streaming: true }]);

    try {
      let fullText = '';

      for await (const chunk of sendMessage(history, trimmed, context)) {
        if (typeof chunk === 'string') {
          fullText += chunk;
          setMessages(prev =>
            prev.map(m => (m.id === aiId ? { ...m, text: fullText } : m))
          );
        } else if ((chunk as WorkoutCreatedEvent).__workoutCreated__) {
          const ev = chunk as WorkoutCreatedEvent;
          onCreateWorkout(ev.dayName, ev.focus, ev.exercises);
          setMessages(prev =>
            prev.map(m =>
              m.id === aiId
                ? {
                    ...m,
                    text: '',
                    streaming: false,
                    workoutCard: {
                      dayName: ev.dayName,
                      focus: ev.focus,
                      exercises: ev.exercises,
                    },
                  }
                : m
            )
          );
          setLoading(false);
          return;
        }
      }

      setMessages(prev =>
        prev.map(m => (m.id === aiId ? { ...m, streaming: false } : m))
      );
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Erro desconhecido';
      const status = (err as { status?: number })?.status;
      let msg = raw;
      let isRetryable = false;

      try {
        const jsonStart = raw.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          const inner = parsed?.error?.message ?? parsed?.message;
          if (inner) msg = inner;
        }
      } catch { /* não era JSON */ }

      if (status === 529 || msg.toLowerCase().includes('overload')) {
        msg = 'Servidores sobrecarregados. Tente novamente em alguns segundos.';
        isRetryable = true;
        setLastFailedMsg(trimmed);
      } else if (status === 429 || msg.includes('rate') || msg.includes('quota')) {
        msg = 'Limite de requisições atingido. Aguarde alguns segundos.';
        isRetryable = true;
        setLastFailedMsg(trimmed);
      } else if (status === 401 || msg.includes('API_KEY') || msg.includes('api key') || msg.includes('auth')) {
        msg = 'Erro de autenticação com a IA. Faça login novamente ou verifique a Edge Function.';
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === aiId ? { ...m, text: `⚠️ ${msg}`, streaming: false, retryable: isRetryable } : m
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Empty state */}
      {isEmpty && (
        <div className="mb-2">
          <p className="text-[10px] text-[var(--text-2)] uppercase tracking-widest font-medium mb-1.5">
            Kronos AI
          </p>
          <h1
            className="text-4xl font-black uppercase tracking-wider text-[var(--text)] leading-tight mb-6"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            COMO POSSO<br />TE AJUDAR?
          </h1>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                onClick={() => send(action.prompt)}
                disabled={loading}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 text-left hover:border-[var(--accent-line)] hover:bg-[var(--surface-2)] transition-all group disabled:opacity-50"
              >
                <Sparkles size={13} className="text-[var(--accent)] mb-2.5" />
                <p className="text-xs font-semibold text-[var(--text)] group-hover:text-[var(--text)] transition-colors leading-tight">
                  {action.label}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      {!isEmpty && (
        <div className="space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Workout created card */}
              {msg.workoutCard ? (
                <div className="max-w-[88%] bg-[var(--surface)] border border-[var(--accent-line)] rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={15} className="text-[var(--accent)] shrink-0" />
                    <span className="text-sm font-semibold text-[var(--accent)]">
                      Treino adicionado na {msg.workoutCard.dayName}!
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar size={12} className="text-[var(--text-2)]" />
                    <span className="text-xs text-[var(--text-2)]">
                      {msg.workoutCard.focus} · {msg.workoutCard.exercises.length} exercícios
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {msg.workoutCard.exercises.map((ex, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-4">
                        <span className="text-xs text-[var(--text)] flex-1">{ex.name}</span>
                        <span className="text-xs text-[var(--text-2)] shrink-0 tabular-nums">
                          {ex.sets}×{ex.reps}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-3)] mt-3">
                    Veja em Semana → {msg.workoutCard.dayName}
                  </p>
                </div>
              ) : (
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[var(--accent-soft)] border border-[var(--accent-line)] text-[var(--text)]'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]'
                  }`}
                >
                  {msg.text ? (
                    <>
                      {msg.role === 'assistant' ? (
                        <MarkdownMessage text={msg.text} />
                      ) : (
                        <span>{msg.text}</span>
                      )}
                      {msg.streaming && (
                        <span className="inline-block w-0.5 h-3.5 bg-[var(--accent)] ml-0.5 animate-pulse align-middle" />
                      )}
                      {msg.retryable && lastFailedMsg && (
                        <button
                          onClick={() => {
                            setMessages(prev => prev.filter(m => m.id !== msg.id));
                            send(lastFailedMsg);
                          }}
                          className="flex items-center gap-1.5 mt-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                        >
                          <RotateCcw size={11} />
                          Tentar novamente
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="flex gap-1.5 py-0.5 items-center">
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Quick chips */}
      {!isEmpty && (
        <div className="flex gap-2 flex-wrap">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => send(action.prompt)}
              disabled={loading}
              className="text-xs text-[var(--text-2)] border border-[var(--border)] rounded-full px-3 py-1.5 hover:border-[var(--accent-line)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {action.label}
            </button>
          ))}
          <button
            onClick={() => setMessages([])}
            disabled={loading}
            className="text-xs text-[var(--text-3)] border border-[var(--border)] rounded-full px-3 py-1.5 hover:border-red-500/30 hover:text-red-400 transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            <RotateCcw size={10} />
            Limpar
          </button>
        </div>
      )}

      {/* Input */}
      <div className={`${isEmpty ? 'mt-2' : ''} border-t border-[var(--border)] pt-4`}>
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
            }}
            placeholder="Pergunte sobre treino, dieta, progresso..."
            rows={1}
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] focus:border-[var(--accent-line)] rounded-xl px-4 py-3 text-sm text-[var(--text)] placeholder-[var(--text-3)] outline-none transition-colors resize-none"
            style={{ minHeight: 44, maxHeight: 120 }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-11 h-11 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center shrink-0"
          >
            {loading
              ? <Loader2 size={16} className="animate-spin text-[var(--btn-fg)]" />
              : <Send size={16} className="text-[var(--btn-fg)]" />
            }
          </button>
        </div>
        <p className="text-[10px] text-[var(--text-3)] mt-2 text-center">
          Enter para enviar · Shift+Enter para nova linha
        </p>
      </div>
    </div>
  );
}
