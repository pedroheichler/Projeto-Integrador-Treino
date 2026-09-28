import { api } from './api';

/**
 * Fila de escritas para funcionar sem internet.
 *
 * O caso real é a academia no subsolo: você marca a série, a gravação falha e
 * o treino inteiro se perde sem você perceber. Aqui toda escrita do modo treino
 * passa por esta fila — é aplicada na tela na hora, guardada no disco e enviada
 * quando a conexão voltar.
 *
 * Deduplicação por chave: editar o peso da mesma série cinco vezes offline
 * gera um envio só, com o último valor.
 */

const STORAGE_KEY = 'kronos_fila_offline';
const MAX_TENTATIVAS = 5;

export type OperacaoPendente =
  | { tipo: 'set_log'; chave: string; dados: Record<string, unknown> }
  | { tipo: 'exercise_progress'; chave: string; dados: Record<string, unknown> };

type ItemFila = OperacaoPendente & { criadoEm: number; tentativas: number };

type Ouvinte = (estado: EstadoFila) => void;

export interface EstadoFila {
  pendentes: number;
  online: boolean;
  sincronizando: boolean;
  falhou: boolean;
}

let fila: ItemFila[] = carregar();
let sincronizando = false;
let falhou = false;
const ouvintes = new Set<Ouvinte>();

function carregar(): ItemFila[] {
  try {
    const bruto = localStorage.getItem(STORAGE_KEY);
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function salvar() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fila));
  } catch (err) {
    // Cota cheia: melhor perder o registro mais antigo do que travar o app
    console.error('Não foi possível guardar a fila offline:', err);
    fila = fila.slice(-100);
  }
}

function estado(): EstadoFila {
  return {
    pendentes: fila.length,
    online: navigator.onLine,
    sincronizando,
    falhou,
  };
}

function avisar() {
  const atual = estado();
  for (const ouvinte of ouvintes) ouvinte(atual);
}

export function observarFila(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  ouvinte(estado());
  return () => ouvintes.delete(ouvinte);
}

/** Envia uma operação; se falhar ou estiver offline, guarda para depois. */
export async function enfileirar(op: OperacaoPendente): Promise<void> {
  if (navigator.onLine) {
    try {
      await executar(op);
      return;
    } catch (err) {
      console.warn('Envio falhou, guardando para sincronizar depois:', err);
    }
  }

  // Substitui a operação anterior da mesma chave — só o último valor importa
  fila = fila.filter(item => !(item.tipo === op.tipo && item.chave === op.chave));
  fila.push({ ...op, criadoEm: Date.now(), tentativas: 0 });
  salvar();
  avisar();
}

async function executar(op: OperacaoPendente): Promise<void> {
  if (op.tipo === 'set_log') {
    const { error } = await api
      .from('set_logs')
      .upsert(op.dados, { onConflict: 'user_id,exercise_id,date,set_index' });
    if (error) throw error;
    return;
  }

  const { error } = await api
    .from('exercise_progress')
    .upsert(op.dados, { onConflict: 'exercise_id,user_id,date' });
  if (error) throw error;
}

/** Tenta enviar tudo o que está pendente, em ordem. */
export async function sincronizar(): Promise<void> {
  if (sincronizando || fila.length === 0 || !navigator.onLine) return;

  sincronizando = true;
  falhou = false;
  avisar();

  const restantes: ItemFila[] = [];

  for (const item of fila) {
    try {
      await executar(item);
    } catch (err) {
      console.error('Falha ao sincronizar item da fila:', err);
      const tentativas = item.tentativas + 1;
      // Desiste depois de várias tentativas para não travar a fila inteira
      // num registro problemático (ex: exercício apagado no servidor).
      if (tentativas < MAX_TENTATIVAS) {
        restantes.push({ ...item, tentativas });
      }
      falhou = true;
    }
  }

  fila = restantes;
  salvar();
  sincronizando = false;
  avisar();
}

export function pendentes(): number {
  return fila.length;
}

/** Liga a sincronização automática: ao voltar a conexão e ao abrir o app. */
export function iniciarSincronizacaoAutomatica(): () => void {
  const aoVoltar = () => { avisar(); sincronizar(); };
  const aoCair = () => avisar();

  window.addEventListener('online', aoVoltar);
  window.addEventListener('offline', aoCair);

  // Também tenta quando a aba volta ao primeiro plano
  const aoFocar = () => { if (navigator.onLine) sincronizar(); };
  document.addEventListener('visibilitychange', aoFocar);

  sincronizar();

  return () => {
    window.removeEventListener('online', aoVoltar);
    window.removeEventListener('offline', aoCair);
    document.removeEventListener('visibilitychange', aoFocar);
  };
}
