import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TaskRow } from "../lib/api";
import RagBadge from "../components/RagBadge";

export default function MyTasks() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.myTasks().then(setTasks).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!tasks) return <div>Loading…</div>;

  const open = tasks.filter((t) => t.rag !== "GREEN" && t.rag !== "N/A" && !t.status.startsWith("COMPLETED"));
  const rest = tasks.filter((t) => !open.includes(t));

  return (
    <div>
      <h1>My Tasks</h1>
      <p className="hint">
        Update the Actual Date on your own tasks from here or from the project page. If you're
        entering a date later than the plan date, you'll be asked for a reason and a proposed
        action before it saves.
      </p>

      <h2>Needs attention ({open.length})</h2>
      <TaskTable tasks={open} />

      <h2>Everything else</h2>
      <TaskTable tasks={rest} />
    </div>
  );
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  if (tasks.length === 0) return <p className="hint">Nothing here.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Project</th><th>Task</th><th>Plan</th><th>Actual</th><th>Status</th><th>RAG</th><th></th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.project_task_id}>
              <td><Link to={`/projects/${t.project_id}`}>{t.project_name}</Link></td>
              <td>{t.task_name}</td>
              <td>{t.plan_date ?? "—"}</td>
              <td>{t.actual_date ?? "—"}</td>
              <td style={{ fontSize: 12 }}>{t.status.replace(/_/g, " ")}</td>
              <td><RagBadge rag={t.rag} /></td>
              <td><Link to={`/projects/${t.project_id}`}>Open project →</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
