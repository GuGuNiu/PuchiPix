import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export function ConsoleLog(): React.JSX.Element {
  const { t } = useI18n();
  const [log, setLog] = useState<string>(t("common.loading"));

  useEffect(() => {
    const fetchLog = async (): Promise<void> => {
      try {
        const res = await fetch("/api/logs/latest");
        const data = await res.json();
        // Backend returns an array; older versions returned {log: "..."}. Support both.
        if (Array.isArray(data)) {          const last = data[data.length - 1];
          setLog(typeof last?.message === 'string' && last.message ? last.message : t("console.noTaskLogs"));
        } else {
          setLog(data.log ?? t("console.noTaskLogs"));
        }
      } catch {
        setLog(t("console.fetchFailed"));
      }
    };

    fetchLog();

    const interval = setInterval(fetchLog, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="console-log"
      title={log}
    >
      <span className="console-log-text">{log}</span>
    </div>
  );
}
