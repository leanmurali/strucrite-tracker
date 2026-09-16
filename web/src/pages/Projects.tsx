import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ProjectRow } from "../lib/api";
import RagBadge from "../components/RagBadge";

function inrCr(v: number | null) {
  if (v == null) return "—";
  return `₹${(v / 1e7).toFixed(2)} Cr`;
}

export default function Projects() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projects().then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!rows) return <div>Loading…</div>;

  return (
    <div>
      <h1>Projects — Master Register</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th><th>Client</th><th>PO Date</th><th>Contract Value</th><th>Balance</th>
              <th>Overall RAG</th><th>Green</th><th>Amber</th><th>Red</th><th>N/A</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td>{p.client}</td>
                <td>{p.po_date}</td>
                <td>{inrCr(p.contract_value)}</td>
                <td>{inrCr(p.balance_value)}</td>
                <td><RagBadge rag={p.overall_rag} /></td>
                <td>{p.rag_summary.green}</td>
                <td>{p.rag_summary.amber}</td>
                <td>{p.rag_summary.red}</td>
                <td>{p.rag_summary.na}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
