export function effectiveCharacterCount(value: string) {
  return Array.from(value.replace(/\s/gu, "")).length;
}
