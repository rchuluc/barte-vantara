export const locales = ["pt-BR", "en", "es"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "pt-BR";
export const localeCookie = "vantara-locale";

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value);
}
