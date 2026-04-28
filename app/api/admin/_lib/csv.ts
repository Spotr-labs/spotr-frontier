export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const out: string[] = [];
  out.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    out.push(row.map(csvEscape).join(","));
  }
  return out.join("\n");
}

export function csvResponse(
  body: string,
  filename: string
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
