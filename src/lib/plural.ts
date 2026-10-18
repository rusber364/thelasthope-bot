/** 1 танк, 2 танка, 5 танков: plural(n, ['танк', 'танка', 'танков']). */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const tens = n % 100;
  const units = n % 10;
  if (units === 1 && tens !== 11) return one;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}
