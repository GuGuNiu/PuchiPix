import { useMemo } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import {
  Plus,
  X,
  Link as LinkIcon,
  Search as SearchIcon,
  ClipboardPaste,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import BatchSearchPanel from "@/components/tasks/batch-search-panel";

interface AddTaskModalProps {
  show: boolean;
  onClose: () => void;
  addTab: "link" | "search";
  setAddTab: (tab: "link" | "search") => void;
  linkInput: string;
  setLinkInput: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: (linkInput: string, setLinkInput: (v: string) => void, setShowAddModal: (v: boolean) => void) => void;
  onJobCompleted: () => void;
}

export function AddTaskModal({
  show,
  onClose,
  addTab,
  setAddTab,
  linkInput,
  setLinkInput,
  onSubmit,
  onJobCompleted,
}: AddTaskModalProps): React.JSX.Element {
  const { t } = useI18n();

  const parsedUrls = useMemo(() => {
    return linkInput
      .split(/[\n\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
  }, [linkInput]);

  const totalInputLines = useMemo(() => {
    if (!linkInput.trim()) return 0;
    return linkInput
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
  }, [linkInput]);

  return (
    <Dialog open={show} onClose={onClose} className="modal-overlay">
      <DialogPanel className="modal modal-lg">
        <div className="modal-header">
          <DialogTitle as="h2" style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <Plus size={18} style={{ flexShrink: 0 }} />
            {t("tasks.addTask")}
          </DialogTitle>
          <button className="btn-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-tab-bar">
            <button
              className={`modal-tab ${addTab === "link" ? "active" : ""}`}
              onClick={() => setAddTab("link")}
            >
              <LinkIcon size={14} className="tab-icon" />
              {t("tasks.linkImport")}
            </button>
            <button
              className={`modal-tab ${addTab === "search" ? "active" : ""}`}
              onClick={() => setAddTab("search")}
            >
              <SearchIcon size={14} className="tab-icon" />
              {t("tasks.batchSearch")}
            </button>
          </div>

          {addTab === "link" ? (
            <div>
              <div className="modal-section">
                <div className="modal-input-group">
                  <div className="modal-input-label">
                    <span>{t("tasks.pasteLinks")}</span>
                    <div className="input-stats-bar">
                      <div className="input-stat-item stat-input">
                        <FileText size={14} className="stat-icon" />
                        <span className="stat-label">{t("tasks.statInput")}</span>
                        <span className="stat-value">{totalInputLines}</span>
                        <span className="stat-label">{t("tasks.statLines")}</span>
                      </div>
                      <div className={`input-stat-item ${parsedUrls.length > 0 ? "stat-detected" : "stat-input"}`}>
                        <LinkIcon size={14} className="stat-icon" />
                        <span className="stat-label">{t("tasks.statDetected")}</span>
                        <span className="stat-value">{parsedUrls.length}</span>
                        <span className="stat-label">{t("tasks.statItems")}</span>
                      </div>
                    </div>
                  </div>
                  <textarea
                    className="form-control"
                    placeholder={t("tasks.linkInputPlaceholder")}
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSubmit(linkInput, setLinkInput, onClose);
                      }
                    }}
                    rows={8}
                    style={{
                      width: "100%",
                      resize: "vertical",
                      minHeight: 160,
                      fontSize: 13,
                      fontFamily: "var(--font-mono), ui-monospace, monospace",
                      lineHeight: 1.6,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 8,
                    }}
                  >
                    <p className="modal-input-hint" style={{ margin: 0 }}>
                      {t("tasks.autoDetectHint")}
                    </p>
                    <div className="quick-actions-bar" style={{ margin: 0 }}>
                      <button
                        className="quick-action-btn"
                        onClick={async () => {
                          try {
                            const text = await navigator.clipboard.readText();
                            setLinkInput((prev) => {
                              const urls = text
                                .split(/[\n\s,]+/)
                                .map((s) => s.trim())
                                .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
                              if (urls.length === 0) {
                                toast.error("tasks.clipboardNoLinks");
                                return prev;
                              }
                              const existing = prev
                                .split(/[\n\s,]+/)
                                .map((s) => s.trim())
                                .filter((s) => s.startsWith("http"));
                              const newUrls = urls.filter((u) => !existing.includes(u));
                              if (newUrls.length === 0) {
                                toast.info("tasks.clipboardAllExist");
                                return prev;
                              }
                                toast.success("tasks.pastedNewLinks", { count: newUrls.length });
                              return prev ? prev + "\n" + newUrls.join("\n") : newUrls.join("\n");
                            });
                          } catch {
                            toast.error("tasks.clipboardReadFail");
                          }
                        }}
                      >
                        <ClipboardPaste size={12} />
                        {t("tasks.paste")}
                      </button>
                      <button
                        className="quick-action-btn"
                        onClick={() => {
                          setLinkInput("");
                          toast.info("tasks.clipboardCleared");
                        }}
                        disabled={!linkInput}
                      >
                        <Trash2 size={12} />
                        {t("tasks.clear")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <button
                className="btn-block-primary"
                onClick={() => onSubmit(linkInput, setLinkInput, onClose)}
                disabled={parsedUrls.length === 0}
                style={{ marginTop: 4 }}
              >
                {parsedUrls.length > 1
                  ? t("tasks.batchImport", { count: parsedUrls.length })
                  : t("tasks.addTask")}
              </button>
            </div>
          ) : (
            <BatchSearchPanel onJobCompleted={onJobCompleted} embedded />
          )}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
