/**
 * Helpers de tipagem estreita para as acoes de manage_task (sem `any`, sem `!`).
 */

/** Texto de um valor desconhecido (entrada JSON), sem cair em "[object Object]". */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  if (typeof v === 'function') return '';
  return String(v);
}

/** Invariante explicita no lugar de `!`: falha com mensagem legivel em vez de TypeError obscuro. */
export function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`invariante violada: ${what}`);
  return v;
}
