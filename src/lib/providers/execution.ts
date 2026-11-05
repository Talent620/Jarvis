import { runTool } from "../tools";
import { throwIfAborted } from "../requestCancellation";
import type { AskCtx } from "./types";

/** Every provider enters the same request-scoped consent/execution boundary. */
export async function executeProviderTool(ctx: AskCtx, name: string, input: unknown): Promise<string> {
  throwIfAborted(ctx.signal);
  if (!ctx.tools.some((tool) => tool.name === name)) return `Narzędzie ${name} nie jest udostępnione w tym zapytaniu. Nie wykonano działania.`;
  const result = ctx.signal || ctx.memoryPolicy || ctx.onToolExecution
    ? await runTool(name, input, { signal: ctx.signal, memoryPolicy: ctx.memoryPolicy, onExecution: ctx.onToolExecution })
    : await runTool(name, input);
  throwIfAborted(ctx.signal);
  return result;
}
