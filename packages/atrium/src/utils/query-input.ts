/**
 * Entrada da query do `retrieve`: argumentos (inclusive apos `--`) ou stdin.
 * Um prompt que comeca com '-' nao pode ser tratado como flag.
 */

export async function readAllStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

export interface QueryInput {
  words: string[];
  stdin: boolean;
  stdinIsTTY: boolean;
}

/** Resolve a query final. Lanca se nao houver texto. */
export async function resolveQuery(input: QueryInput, read: () => Promise<string> = readAllStdin): Promise<string> {
  let q = input.words.join(' ').trim();
  if (!q && (input.stdin || !input.stdinIsTTY)) q = (await read()).trim();
  if (!q) throw new Error('query vazia: passe o texto como argumento (use `--` se comecar com "-") ou por stdin (--stdin)');
  return q;
}
