import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, getDevEmail, setDevEmail, type Me } from "./lib/api";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import MyTasks from "./pages/MyTasks";
import Admin from "./pages/Admin";

function DevLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState(getDevEmail() ?? "murali@valueenablers.com");
  return (
    <div style={{ maxWidth: 420, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>Local dev sign-in</h2>
      <p className="hint">
        In production this screen never appears — Cloudflare Access handles login with your
        Google Workspace account before requests ever reach this app. This box only exists so
        `npm run dev` works without deploying Access first.
      </p>
      <div className="field">
        <label>Email (must exist in the `user` table)</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button
        onClick={() => {
          setDevEmail(email);
          onLoggedIn();
        }}
      >
        Continue
      </button>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);

  async function loadMe() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.me();
      setMe(res);
    } catch (e: any) {
      if (e.status === 401) {
        setDevMode(true);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  if (loading) return <div style={{ padding: 40 }}>Loading…</div>;
  if (devMode && !me) return <DevLogin onLoggedIn={loadMe} />;
  if (error) return <div className="error-banner" style={{ margin: 40 }}>{error}</div>;
  if (!me) return null;

  const isAdmin = me.role === "superadmin";
  const canAssign = me.role === "superadmin" || me.role === "dept_head";

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">StrucRite Tracker</div>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/my-tasks">My Tasks</NavLink>
        {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        <div className="me">
          {me.name}
          <br />
          {me.email}
          <br />
          <strong>{me.role}</strong>
        </div>
      </div>
      <div className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail me={me} canAssign={canAssign} />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          {isAdmin && <Route path="/admin" element={<Admin />} />}
        </Routes>
      </div>
    </div>
  );
}
