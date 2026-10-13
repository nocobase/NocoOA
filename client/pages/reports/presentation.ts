/** Match the budget ledger's exact integer-cent display; never round a large safe integer through division. */
export function reportMoney(cents: number, locale: string): string {
  if (!Number.isSafeInteger(cents)) return '—';
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const separator =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.';
  return `${value < 0n ? '-' : ''}${new Intl.NumberFormat(locale).format(absolute / 100n)}${separator}${String(absolute % 100n).padStart(2, '0')}`;
}
