import {
  captionDirection,
  type TranscriptLine,
} from "./caption-direction.ts";

export type { TranscriptLine };

type TranscriptListProps = {
  lines: readonly TranscriptLine[];
};

export function TranscriptList({ lines }: TranscriptListProps) {
  if (lines.length === 0) {
    return <p className="ui-hint">The transcript will appear here.</p>;
  }

  return (
    <ol className="ui-transcript-list" aria-live="polite">
      {lines.map((line) => (
        <TranscriptItem key={line.id} line={line} />
      ))}
    </ol>
  );
}

function TranscriptItem({ line }: { line: TranscriptLine }) {
  const direction = captionDirection(line.text);
  const who = line.role === "user" ? "You" : "Sarjy";
  return (
    <li
      className={
        line.role === "user"
          ? "ui-transcript-line ui-transcript-user"
          : "ui-transcript-line ui-transcript-assistant"
      }
      dir={direction}
      lang={line.language.length > 0 ? line.language : undefined}
    >
      <span className="ui-transcript-who">{who}</span>
      <p
        className={
          line.final ? "ui-transcript" : "ui-transcript ui-transcript-partial"
        }
        dir={direction}
      >
        {line.text}
      </p>
      {line.final ? null : <span className="ui-hint">Live</span>}
    </li>
  );
}
