export function DataStream(): React.JSX.Element {
  return (
    <div className="ops-data-stream">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="stream-bar" />
      ))}
    </div>
  );
}

export function DiskActivity(): React.JSX.Element {
  return (
    <div className="ops-disk-activity">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="disk-dot" />
      ))}
    </div>
  );
}
