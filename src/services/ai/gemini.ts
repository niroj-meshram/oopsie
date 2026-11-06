/**
 * Minimal Gemini (Google Generative Language API) client.
 * Called only when the user clicks "Generate with Gemini"; nothing is sent otherwise.
 */

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Fast and plenty for a short bullet summary. */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';
/** Tried in order when the chosen model is overloaded, retired or too slow. */
export const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'];
export const SUGGESTED_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-pro-latest', 'gemini-3.8-flash'];
const ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * Key from `.env` (VITE_GEMINI_API_KEY), inlined by Vite at build time.
 * It is readable inside dist/, so builds made with it are for personal use only;
 * `npm run package` builds without it. A key saved in Settings takes priority.
 */
export const ENV_GEMINI_API_KEY = (import.meta.env?.VITE_GEMINI_API_KEY ?? '').trim();

export class GeminiError extends Error {
  constructor(
    message: string,
    /** Whether trying another model could help. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GenerateRequest {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface GenerateResult {
  text: string;
  model: string;
}

const MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,80}$/i;

export function isPlausibleApiKey(key: string): boolean {
  return /^[A-Za-z0-9._-]{20,200}$/.test(key.trim());
}

function errorFor(status: number, apiMessage: string): GeminiError {
  if (status === 400 && /api key/i.test(apiMessage)) return new GeminiError('Gemini rejected the API key. Check it in Settings → AI timesheet.', false);
  if (status === 401 || status === 403) return new GeminiError('Gemini rejected the API key (not authorised). Check it in Settings → AI timesheet.', false);
  if (status === 404) return new GeminiError(`That Gemini model isn't available for this key.`, true);
  if (status === 429) return new GeminiError('Gemini rate limit or quota reached. Wait a minute and try again.', true);
  if (status >= 500) return new GeminiError('Gemini is busy right now.', true);
  return new GeminiError(`Gemini returned an error (${status}).`, false);
}

async function generateOnce(req: GenerateRequest, model: string): Promise<GenerateResult> {
  if (!MODEL_RE.test(model)) throw new GeminiError(`"${model}" is not a valid model name.`, false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  req.signal?.addEventListener('abort', onAbort);
  const doFetch = req.fetchImpl ?? fetch;
  try {
    let res: Response;
    try {
      res = await doFetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // The key travels in a header, never in the URL, so it can't end up in logs or history.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
        signal: controller.signal,
      });
    } catch {
      if (req.signal?.aborted) throw new GeminiError('Cancelled.', false);
      if (controller.signal.aborted) throw new GeminiError('Gemini took too long to answer.', true);
      throw new GeminiError("Couldn't reach Gemini. Check your internet connection.", false);
    }
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    } | null;
    if (!res.ok) throw errorFor(res.status, body?.error?.message ?? '');
    if (body?.promptFeedback?.blockReason) throw new GeminiError('Gemini declined to answer this request.', false);
    const text = (body?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim();
    if (!text) throw new GeminiError('Gemini returned an empty answer.', true);
    return { text, model };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
}

/** Tries the chosen model, then the fallbacks, stopping at errors another model can't fix. */
export async function generateWithGemini(req: GenerateRequest): Promise<GenerateResult> {
  if (!req.apiKey.trim()) throw new GeminiError('Add your Gemini API key in Settings → AI timesheet first.', false);
  const models = [req.model, ...FALLBACK_MODELS.filter((m) => m !== req.model)];
  let last: GeminiError | null = null;
  for (const model of models) {
    try {
      return await generateOnce(req, model);
    } catch (err) {
      last = err instanceof GeminiError ? err : new GeminiError('Something went wrong talking to Gemini.', false);
      if (!last.retryable) throw last;
    }
  }
  throw last ?? new GeminiError('Gemini is unavailable right now. Use the quick summary instead.', false);
}
