/** Uniform MCP tool results: JSON text content. */
export function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function err(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

export function numOrNull(v: string | number | null | undefined): number | null {
  return v == null ? null : Number(v);
}
