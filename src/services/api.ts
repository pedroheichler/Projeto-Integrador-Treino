/**
 * Cliente do backend Kronos (Java).
 *
 * Interface encadeada usada pelo app inteiro
 * (from/select/eq/insert/upsert/rpc/auth...): cada chamada vira um POST
 * para a API do backend.
 *
 * No app Android o backend roda dentro do próprio aplicativo e serve o
 * frontend na mesma origem, por isso a URL padrão é relativa (/api).
 */

export interface User {
  id: string;
  email: string;
}

export interface Session {
  access_token: string;
  expires_at?: number;
  user: User;
}

export class ApiError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface Result<T = any> {
  data: T | null;
  error: ApiError | null;
}

export const API_URL: string = import.meta.env.VITE_API_URL || '/api';
const SESSION_KEY = 'kronos-session';

// ── Sessão ────────────────────────────────────────────────────────────────

type AuthListener = (event: string, session: Session | null) => void;
const listeners = new Set<AuthListener>();

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let currentSession: Session | null = readSession();

function setSession(session: Session | null, event: string) {
  currentSession = session;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Sem armazenamento: a sessão vale só enquanto o app estiver aberto
  }
  for (const listener of listeners) listener(event, session);
}

async function request<T = any>(path: string, body?: unknown, method = 'POST'): Promise<Result<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  if (currentSession) headers.Authorization = `Bearer ${currentSession.access_token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { data: null, error: new ApiError('Sem conexão com o servidor.', 'network') };
  }

  let json: { data?: T; error?: { message?: string; code?: string } } = {};
  try {
    json = await response.json();
  } catch {
    // Resposta sem corpo JSON
  }

  if (!response.ok || json.error) {
    // Token inválido (ex: banco apagado): volta para a tela de login
    if (response.status === 401 && currentSession) setSession(null, 'SIGNED_OUT');
    const message = json.error?.message ?? `Erro ${response.status}`;
    return { data: null, error: new ApiError(message, json.error?.code, response.status) };
  }

  return { data: (json.data ?? null) as T | null, error: null };
}

// ── Consultas encadeadas ──────────────────────────────────────────────────

type Action = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

class QueryBuilder<T = any[]> implements PromiseLike<Result<T>> {
  private action: Action = 'select';
  private columns = '*';
  private returning = false;
  private values: unknown;
  private onConflict?: string;
  private filters: { column: string; op: string; value: unknown }[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitCount?: number;
  private mode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(private table: string) {}

  select(columns = '*') {
    this.columns = columns;
    // Depois de insert/update/upsert, select() pede as linhas de volta
    if (this.action !== 'select') this.returning = true;
    return this;
  }

  insert(values: unknown) {
    this.action = 'insert';
    this.values = values;
    return this;
  }

  update(values: unknown) {
    this.action = 'update';
    this.values = values;
    return this;
  }

  upsert(values: unknown, options?: { onConflict?: string }) {
    this.action = 'upsert';
    this.values = values;
    this.onConflict = options?.onConflict;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  private filter(column: string, op: string, value: unknown) {
    this.filters.push({ column, op, value });
    return this;
  }

  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.filter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.filter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.filter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.filter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.filter(column, 'lte', value); }
  in(column: string, values: unknown[]) { return this.filter(column, 'in', values); }
  is(column: string, value: unknown) { return this.filter(column, 'is', value); }
  not(column: string, op: string, value: unknown) { return this.filter(column, `not.${op}`, value); }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  // Uma linha só: o resultado deixa de ser lista
  single(): QueryBuilder<any> {
    this.mode = 'single';
    return this as QueryBuilder<any>;
  }

  maybeSingle(): QueryBuilder<any> {
    this.mode = 'maybeSingle';
    return this as QueryBuilder<any>;
  }

  private async execute(): Promise<Result<T>> {
    const result = await request<any[]>('/query', {
      table: this.table,
      action: this.action,
      columns: this.columns,
      returning: this.action === 'select' || this.returning,
      values: this.values,
      onConflict: this.onConflict,
      filters: this.filters,
      order: this.orders,
      limit: this.limitCount,
    });
    if (result.error) return { data: null, error: result.error };

    const rows = result.data ?? [];
    if (this.action !== 'select' && !this.returning) return { data: null, error: null };
    if (this.mode === 'many') return { data: rows as T, error: null };

    if (rows.length > 1) {
      return { data: null, error: new ApiError('A consulta retornou mais de uma linha.', 'multiple_rows') };
    }
    if (rows.length === 0) {
      return this.mode === 'maybeSingle'
        ? { data: null, error: null }
        : { data: null, error: new ApiError('Nenhuma linha encontrada.', 'not_found') };
    }
    return { data: rows[0], error: null };
  }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function authenticate(path: string, body: unknown) {
  const result = await request<Session>(path, body);
  if (result.error || !result.data) {
    return { data: { session: null, user: null }, error: result.error };
  }
  setSession(result.data, 'SIGNED_IN');
  return { data: { session: result.data, user: result.data.user }, error: null };
}

const auth = {
  async getSession() {
    return { data: { session: currentSession }, error: null };
  },

  async refreshSession() {
    return { data: { session: currentSession }, error: null };
  },

  onAuthStateChange(callback: AuthListener) {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => { listeners.delete(callback); } } } };
  },

  signInWithPassword(credentials: { email: string; password: string }) {
    return authenticate('/auth/login', credentials);
  },

  signUp(credentials: { email: string; password: string; options?: { data?: { name?: string } } }) {
    return authenticate('/auth/signup', {
      email: credentials.email,
      password: credentials.password,
      name: credentials.options?.data?.name,
    });
  },

  async signOut() {
    await request('/auth/logout', {});
    setSession(null, 'SIGNED_OUT');
    return { error: null };
  },
};

// ── Arquivos (ainda não suportado no beta) ────────────────────────────────

const storage = {
  from(_bucket: string) {
    return {
      async upload(..._args: unknown[]): Promise<Result> {
        return { data: null, error: new ApiError('Envio de imagens ainda não está disponível na versão beta.') };
      },
    };
  },
};

export const api = {
  from: (table: string) => new QueryBuilder(table),
  rpc: <T = any>(fn: string, args: Record<string, unknown> = {}) => request<T>(`/rpc/${fn}`, args),
  auth,
  storage,
};
