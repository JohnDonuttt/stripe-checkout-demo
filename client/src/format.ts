const formatters = new Map<string, Intl.NumberFormat>();

export function money(amount: number, currency = 'gbp'): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() });
    formatters.set(currency, f);
  }
  return f.format(amount / 100);
}
