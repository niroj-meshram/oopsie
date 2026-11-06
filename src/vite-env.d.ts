/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Gemini key baked into local builds from .env (see README). */
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
