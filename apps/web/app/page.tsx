import SignalDashboard from "@/components/SignalDashboard";

export default function Home() {
  return (
    <>
      <SignalDashboard />
      <a
        href="/strategy"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 90,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          border: "1px solid var(--border-strong)",
          borderRadius: 999,
          background: "var(--surface-raised)",
          color: "var(--cyan-bright)",
          boxShadow: "0 12px 35px rgba(0,0,0,.28)",
          fontSize: ".78rem",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Strategy &amp; volume →
      </a>
    </>
  );
}
