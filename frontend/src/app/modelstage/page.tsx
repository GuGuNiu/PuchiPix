import { Users } from "lucide-react";

export default function ModelStagePage() {
  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="empty-state" style={{ minHeight: "60vh" }}>
          <div className="empty-state-icon">
            <Users size={48} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">模特台</div>
          <div className="empty-state-subtext">即将上线，敬请期待</div>
        </div>
      </div>
    </div>
  );
}
