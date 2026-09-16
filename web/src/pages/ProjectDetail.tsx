import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type Me, type TaskRow, type UserRow } from "../lib/api";
import RagBadge from "../components/RagBadge";

function TaskEditModal({
  task,
  me,
  canAssign,
  users,
  onClose,
  onSaved,
}: {
  task: TaskRow;
  me: Me;
  canAssign: boolean;
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isOwner = task.owner_user_id === me.id;
  const canReportProgress = isOwner || me.role === "superadmin" || me.role === "dept_head";

  const [ownerId, setOwnerId] = useState<number | "">(task.owner_user_id ?? "");
  const [planDate, setPlanDate] = useState(task.plan_date ?? "");
  const [notApplicable, setNotApplicable] = useState(!!task.not_applicable);
  const [actualDate, setActualDate] = useState(task.actual_date ?? "");
  const [reason, setReason] = useState(task.open_delay?.reason ?? "");
  const [action, setAction] = useState(task.open_delay?.proposed_action ?? "");
  const [targetDate, setTargetDate] = useState(task.open_delay?.target_date ?? "");
  const [needsDelayInfo, setNeedsDelayInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveAssignment() {
    await api.assignTask(task.project_task_id, {
      owner_user_id: ownerId === "" ? undefined : Number(ownerId),
      plan_date: planDate || undefined,
      not_applicable: notApplicable,
    });
  }

  async function saveProgress() {
    if (!actualDate) return;
    await api.updateTask(task.project_task_id, {
      actual_date: actualDate,
      reason: reason || undefined,
      proposed_action: action || undefined,
      target_date: targetDate || undefined,
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNeedsDelayInfo(false);
    try {
      if (canAssign) await saveAssignment();
      if (canReportProgress && actualDate) await saveProgress();
      onSaved();
      onClose();
    } catch (e: any) {
      if (e.status === 422 && e.body?.requires_delay_log) {
        setNeedsDelayInfo(true);
        setError(e.message);
      } else {
        setError(e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{task.task_code} — {task.task_name}</h3>
        <p className="hint">{task.stage_name} · {task.owner_department_name}</p>
        {error && <div className="error-banner">{error}</div>}

        {canAssign && (
          <>
            <div className="field">
              <label>Owner</label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.department_name})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Plan date</label>
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            </div>
            <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={notApplicable} onChange={(e) => setNotApplicable(e.target.checked)} />
              <label>Not applicable for this project</label>
            </div>
          </>
        )}

        {canReportProgress && (
          <>
            <div className="field">
              <label>Actual date {isOwner && "(you own this task)"}</label>
              <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
            </div>
            {(needsDelayInfo || task.open_delay) && (
              <>
                <div className="field">
                  <label>Reason for delay {needsDelayInfo && <b style={{ color: "#a3242c" }}>(required)</b>}</label>
                  <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="field">
                  <label>Proposed action {needsDelayInfo && <b style={{ color: "#a3242c" }}>(required)</b>}</label>
                  <textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
                </div>
                <div className="field">
                  <label>Target date to resolve</label>
                  <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                </div>
              </>
            )}
          </>
        )}

        {!canAssign && !canReportProgress && (
          <p className="hint">You don't have edit permission on this task — view only.</p>
        )}

        <div className="actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          {(canAssign || canReportProgress) && (
            <button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetail({ me, canAssign }: { me: Me; canAssign: boolean }) {
  const { id } = useParams();
  const projectId = Number(id);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.tasksForProject(projectId).then(setTasks).catch((e) => setError(e.message));
  }

  useEffect(() => {
    reload();
    api.users().then(setUsers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!tasks) return <div>Loading…</div>;

  return (
    <div>
      <h1>{tasks[0]?.project_name ?? `Project #${projectId}`}</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Stage</th><th>Task</th><th>Owner</th>
              <th>Plan</th><th>Actual</th><th>Status</th><th>Variance</th><th>RAG</th><th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.project_task_id}>
                <td>{t.task_code}</td>
                <td style={{ fontSize: 11, color: "#666" }}>{t.stage_name}</td>
                <td>{t.task_name}</td>
                <td>{t.owner_user_name ?? <span style={{ color: "#999" }}>unassigned</span>}</td>
                <td>{t.plan_date ?? "—"}</td>
                <td>{t.actual_date ?? "—"}</td>
                <td style={{ fontSize: 12 }}>{t.status.replace(/_/g, " ")}</td>
                <td>{t.variance_days ?? "—"}</td>
                <td><RagBadge rag={t.rag} /></td>
                <td><button className="secondary" onClick={() => setEditing(t)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <TaskEditModal
          task={editing}
          me={me}
          canAssign={canAssign}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
