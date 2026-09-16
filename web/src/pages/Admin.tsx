import { useEffect, useState } from "react";
import { api, type Department, type UserRow } from "../lib/api";

export default function Admin() {
  const [tab, setTab] = useState<"users" | "departments">("users");
  return (
    <div>
      <h1>Admin</h1>
      <div className="tab-row">
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Users</button>
        <button className={tab === "departments" ? "active" : ""} onClick={() => setTab("departments")}>Departments</button>
      </div>
      {tab === "users" ? <UsersTab /> : <DepartmentsTab />}
    </div>
  );
}

function DepartmentsTab() {
  const [rows, setRows] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.departments().then(setRows).catch((e) => setError(e.message));
  }
  useEffect(reload, []);

  async function add() {
    if (!name.trim()) return;
    try {
      await api.createDepartment(name.trim());
      setName("");
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={add}>Add department</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th></tr></thead>
          <tbody>{rows.map((d) => <tr key={d.id}><td>{d.name}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function UsersTab() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", department_id: "", role: "member" });

  function reload() {
    api.users().then(setRows).catch((e) => setError(e.message));
    api.departments().then(setDepartments).catch(() => {});
  }
  useEffect(reload, []);

  async function add() {
    if (!form.email || !form.name || !form.department_id) return;
    try {
      await api.createUser({
        email: form.email,
        name: form.name,
        department_id: Number(form.department_id),
        role: form.role,
      });
      setForm({ email: "", name: "", department_id: "", role: "member" });
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleActive(u: UserRow) {
    await api.updateUser(u.id, { active: u.active ? false : true } as any);
    reload();
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <h2>Add a user</h2>
      <p className="hint">
        Adding someone here provisions their account — they'll be recognized the first time they
        sign in through Google (Cloudflare Access). No password to set.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
          <option value="">Department…</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="member">Member</option>
          <option value="dept_head">Department Head</option>
          <option value="project_owner">Project Owner</option>
          <option value="superadmin">Superadmin</option>
        </select>
        <button onClick={add}>Add user</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.department_name}</td>
                <td>{u.role}</td>
                <td>{u.active ? "Active" : "Deactivated"}</td>
                <td><button className="secondary" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Reactivate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
