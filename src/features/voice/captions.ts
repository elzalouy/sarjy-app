import {
  captionDirection,
  type TranscriptLine,
} from "../../components/caption-direction.ts";

export { captionDirection, type TranscriptLine };

export function applyCaptions(
  lines: readonly TranscriptLine[],
  incoming: readonly TranscriptLine[],
): TranscriptLine[] {
  const next = lines.map((line) => ({ ...line }));
  for (const caption of incoming) {
    const index = next.findIndex((line) => line.id === caption.id);
    if (index === -1) {
      next.push({ ...caption });
      continue;
    }
    next[index] = { ...caption };
  }
  return next;
}
