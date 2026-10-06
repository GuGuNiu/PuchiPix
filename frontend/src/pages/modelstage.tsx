import { Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function ModelStagePage(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="empty-state" style={{ minHeight: "60vh" }}>
          <div className="empty-state-icon">
            <Users size={48} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">{t("modelstage.title")}</div>
          <div className="empty-state-subtext">{t("modelstage.comingSoon")}</div>
        </div>
      </div>
    </div>
  );
}
