function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSensitiveText(message: string, secrets: readonly (string | undefined)[] = []) {
  let redacted = message
    .replace(/socks5:\/\/[^\s"'<>]+/gi, "socks5://[redigido]")
    .replace(/\b(password|passwd|senha|username|user|usuario|usuário)\s*([=:])\s*[^\s,;]+/gi, "$1$2[redigido]");

  const candidates = new Set(
    secrets
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .flatMap(value => [value, encodeURIComponent(value)])
  );
  for (const secret of candidates) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), "gi"), "[redigido]");
  }
  return redacted;
}
