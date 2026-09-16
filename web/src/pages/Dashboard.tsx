import { useEffect, useState } from "react";
import { api, type PortfolioSummary } from "../lib/api";
import RagBadge from "../components/RagBadge";

function inrCr(v: number) {
  return `₹${(v / 1e7).toFixed(2)} Cr`;
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [stageFunnel, setStageFunnel] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.dashboardPortfolio(),
      api.dashboardDepartments(),
      api.dashboardStageFunnel(),
    ])
      .then(([p, d, s]) => {
        setPortfolio(p);
        setDepartments(d.sort((a, b) => b.red - a.red));
        setStageFunnel(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!portfolio) return <div>Loading…</div>;

  return (
    <div>
      <h1>Portfolio Dashboard</h1>
      <div className="cards">
        <div className="card">
          <div className="label">Activities delivered</div>
          <div className="value">{portfolio.percent_delivered}%</div>
        </div>
        <div className="card">
          <div className="label">Overdue, no actual date</div>
          <div className="value">{portfolio.overdue_no_actual}</div>
        </div>
        <div className="card">
          <div className="label">Projects</div>
          <div className="value">
            {portfolio.projects_total}
            <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
              <RagBadge rag="RED" /> {portfolio.projects_red}{" "}
              <RagBadge rag="AMBER" /> {portfolio.projects_amber}{" "}
              <RagBadge rag="GREEN" /> {portfolio.projects_green}
            </span>
          </div>
        </div>
        <div className="card">
          <div className="label">Value at risk (RED projects)</div>
          <div className="value">{inrCr(portfolio.value_at_risk)}</div>
        </div>
      </div>

      <h2>Activity RAG mix ({portfolio.rag.total} total)</h2>
      <div className="cards">
        <div className="card"><div className="label">Green</div><div className="value">{portfolio.rag.green}</div></div>
        <div className="card"><div className="label">Amber</div><div className="value">{portfolio.rag.amber}</div></div>
        <div className="card"><div className="label">Red</div><div className="value">{portfolio.rag.red}</div></div>
        <div className="card"><div className="label">N/A</div><div className="value">{portfolio.rag.na}</div></div>
      </div>

      <h2>By department (most Red first)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Department</th><th>Green</th><th>Amber</th><th>Red</th><th>N/A</th><th>Total</th></tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.department}>
                <td>{d.department}</td>
                <td>{d.green}</td>
                <td>{d.amber}</td>
                <td style={{ fontWeight: d.red > 0 ? 700 : 400, color: d.red > 0 ? "#a3242c" : undefined }}>{d.red}</td>
                <td>{d.na}</td>
                <td>{d.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Stage funnel — where projects are stuck right now</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Stage</th><th>Projects</th></tr></thead>
          <tbody>
            {stageFunnel.sort((a, b) => b.projects - a.projects).map((s) => (
              <tr key={s.stage}><td>{s.stage}</td><td>{s.projects}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
