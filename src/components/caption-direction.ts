export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  language: string;
};

export function captionDirection(text: string): "rtl" | "ltr" | "auto" {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasArabic && hasLatin) {
    return "auto";
  }
  if (hasArabic) {
    return "rtl";
  }
  return "ltr";
}
