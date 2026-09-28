import { callAI, type AITextBlock } from './anthropicProxy';

// Traduz erros da API em mensagens que fazem sentido pro usuário
function friendlyError(err: unknown): Error {
  const candidate = err as { status?: number; response?: { status?: number }; message?: string; name?: string };
  const status = candidate?.status ?? candidate?.response?.status;
  if (status === 529 || status === 503) {
    return new Error('A IA está sobrecarregada no momento. Tente de novo em alguns segundos.');
  }
  if (status === 429) {
    return new Error('Muitas requisições seguidas. Aguarde alguns segundos e tente de novo.');
  }
  if (status === 401 || status === 403) {
    return new Error('Sua sessão expirou. Recarregue a página e entre novamente.');
  }
  if (status === 400) {
    return new Error('Não consegui processar essa imagem. Tente outra foto.');
  }
  if (status === 502) {
    return new Error('O servidor da IA não respondeu. Tente de novo.');
  }
  if (candidate?.message?.includes('fetch') || candidate?.name === 'APIConnectionError') {
    return new Error('Sem conexão. Verifique sua internet e tente de novo.');
  }
  return err instanceof Error ? err : new Error('Erro inesperado ao analisar a foto.');
}

export interface FoodAnalysis {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'alta' | 'média' | 'baixa';
  notes?: string;
}

// Comprime a imagem para reduzir tokens/custo (máx 1024px, JPEG 80%)
export function compressImage(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas não suportado')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem')); };
    img.src = url;
  });
}

const OUTPUT_FORMAT = `Responda APENAS com JSON válido, sem markdown, neste formato exato:
{"name": "nome curto do alimento/prato em português", "calories": número inteiro (kcal), "protein": número inteiro (gramas), "carbs": número inteiro (gramas), "fat": número inteiro (gramas), "confidence": "alta" | "média" | "baixa", "notes": "observação curta opcional sobre a estimativa"}`;

// Envia o conteúdo para a IA e converte a resposta em FoodAnalysis
type FoodContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } };

async function askAI(content: FoodContentBlock[], fallbackMsg: string): Promise<FoodAnalysis> {
  let response;
  try {
    response = await callAI('food-analysis', {
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    console.error('Erro na chamada da IA:', err);
    throw friendlyError(err);
  }

  const text = response.content
    .filter((b): b is AITextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  // Extrai o JSON mesmo se vier com texto ao redor
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(fallbackMsg);

  const parsed = JSON.parse(match[0]);
  if (parsed.error) throw new Error(parsed.error);

  return {
    name: String(parsed.name ?? 'Refeição'),
    calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
    protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
    carbs: Math.max(0, Math.round(Number(parsed.carbs) || 0)),
    fat: Math.max(0, Math.round(Number(parsed.fat) || 0)),
    confidence: parsed.confidence === 'alta' || parsed.confidence === 'baixa' ? parsed.confidence : 'média',
    notes: parsed.notes ? String(parsed.notes) : undefined,
  };
}

export async function analyzeFoodPhoto(base64: string, mediaType: 'image/jpeg'): Promise<FoodAnalysis> {
  return askAI(
    [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      {
        type: 'text',
        text: `Analise esta foto de comida e estime os valores nutricionais da porção visível.

${OUTPUT_FORMAT}

Se não houver comida na foto, responda: {"error": "descrição do problema"}`,
      },
    ],
    'A IA não retornou um resultado válido. Tente outra foto.'
  );
}

export async function analyzeFoodText(description: string): Promise<FoodAnalysis> {
  return askAI(
    [
      {
        type: 'text',
        text: `O usuário descreveu o que comeu. Estime os valores nutricionais totais.

Descrição: "${description}"

Regras:
- Some tudo se houver mais de um item (ex: "2 ovos e uma banana").
- Respeite as quantidades informadas (ex: "100g de amendoim", "2 ovos", "meio prato").
- Se não houver quantidade, assuma uma porção comum brasileira.
- Reconheça itens de fast food e marcas populares no Brasil (ex: McChicken, Big Mac, Whopper).
- Use a tabela TACO/valores nutricionais usuais como referência.

${OUTPUT_FORMAT}

Se a descrição não for comida ou for impossível estimar, responda: {"error": "descrição do problema"}`,
      },
    ],
    'A IA não conseguiu entender a descrição. Tente ser mais específico.'
  );
}
