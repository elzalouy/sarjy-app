type LoadingIndicatorProps = {
  label?: string;
};

export function LoadingIndicator({
  label = "Loading",
}: LoadingIndicatorProps) {
  return (
    <span className="ui-spinner" role="status">
      <span className="ui-sr">{label}</span>
    </span>
  );
}
