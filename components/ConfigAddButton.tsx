"use client";

export function ConfigAddButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        padding: "10px 8px 9px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          width: "100%",
          padding: "8px 10px",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          background: active ? "var(--accent)" : "var(--bg)",
          color: active ? "#fff" : "var(--accent)",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {label}
      </button>
    </div>
  );
}
