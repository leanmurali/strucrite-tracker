const COLORS: Record<string, string> = {
  GREEN: "#1e7e34",
  AMBER: "#946200",
  RED: "#a3242c",
  "N/A": "#5a5a5a",
};
const BG: Record<string, string> = {
  GREEN: "#e6f4ea",
  AMBER: "#fff3cd",
  RED: "#fbe4e6",
  "N/A": "#ececeb",
};

export default function RagBadge({ rag }: { rag: string }) {
  return (
    <span
      style={{
        color: COLORS[rag] ?? "#333",
        background: BG[rag] ?? "#eee",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.3,
        display: "inline-block",
      }}
    >
      {rag}
    </span>
  );
}
