import { api, API_URL } from './api';

export type AIOperation = 'workout-chat' | 'food-analysis' | 'weekly-report';

export interface AITextBlock {
  type: 'text';
  text: string;
}

export interface AIToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type AIContentBlock = AITextBlock | AIToolUseBlock;

export interface AIMessageResponse {
  content: AIContentBlock[];
}

export interface AIRequest {
  system?: string;
  messages: unknown[];
}

export type AIStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown };

async function getAccessToken(): Promise<string> {
  let { data: { session } } = await api.auth.getSession();
  const expiresAt = session?.expires_at ?? 0;

  if (session && expiresAt - Math.floor(Date.now() / 1000) < 120) {
    const { data } = await api.auth.refreshSession();
    if (data.session) session = data.session;
  }

  if (!session) throw new Error('Você precisa estar logado para usar a IA.');
  return session.access_token;
}

function proxyUrl(): string {
  return `${API_URL}/ai`;
}

async function parseError(response: Response): Promise<Error> {
  let message = 'Não foi possível falar com a IA. Tente novamente.';

  try {
    const body = await response.json() as { error?: { message?: string } | string; message?: string };
    if (typeof body.error === 'string') message = body.error;
    else if (body.error?.message) message = body.error.message;
    else if (body.message) message = body.message;
  } catch {
    // Mantém a mensagem segura e amigável quando o upstream não devolve JSON.
  }

  const error = new Error(message) as Error & { status?: number };
  error.status = response.status;
  return error;
}

async function requestProxy(operation: AIOperation, request: AIRequest): Promise<Response> {
  const accessToken = await getAccessToken();
  const response = await fetch(proxyUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation, request }),
  });

  if (!response.ok) throw await parseError(response);
  return response;
}

export async function callAI(
  operation: Exclude<AIOperation, 'workout-chat'>,
  request: AIRequest,
): Promise<AIMessageResponse> {
  const response = await requestProxy(operation, request);
  return response.json() as Promise<AIMessageResponse>;
}

interface PendingTool {
  name: string;
  json: string;
  initialInput?: unknown;
}

export async function* streamWorkoutChat(request: AIRequest): AsyncGenerator<AIStreamEvent> {
  const response = await requestProxy('workout-chat', request);
  if (!response.body) throw new Error('A IA não iniciou a resposta.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const tools = new Map<number, PendingTool>();
  let buffer = '';

  const processEvent = (rawEvent: string): AIStreamEvent[] => {
    const events: AIStreamEvent[] = [];

    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const rawData = line.slice(5).trim();
      if (!rawData || rawData === '[DONE]') continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        continue;
      }

      const type = event.type;
      const index = typeof event.index === 'number' ? event.index : -1;
      const delta = event.delta as Record<string, unknown> | undefined;

      if (type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
        events.push({ type: 'text', text: delta.text });
      }

      if (type === 'content_block_start') {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === 'tool_use' && typeof block.name === 'string' && index >= 0) {
          tools.set(index, { name: block.name, json: '', initialInput: block.input });
        }
      }

      if (type === 'content_block_delta' && delta?.type === 'input_json_delta' && index >= 0) {
        const pending = tools.get(index);
        if (pending && typeof delta.partial_json === 'string') pending.json += delta.partial_json;
      }
    }

    return events;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      for (const event of processEvent(chunk)) yield event;
    }

    if (done) break;
  }

  if (buffer) {
    for (const event of processEvent(buffer)) yield event;
  }

  for (const tool of tools.values()) {
    let input: unknown = tool.initialInput ?? {};
    if (tool.json) {
      try {
        input = JSON.parse(tool.json) as unknown;
      } catch {
        throw new Error('A IA retornou um treino inválido. Tente novamente.');
      }
    }
    yield { type: 'tool_use', name: tool.name, input };
  }
}
