// App mark: a rising sun over a page. Rendered both as the PWA icon (via
// next/og) and inline in the UI, so it only uses inline styles.
export function SunMark({ size = 32 }: { size?: number }) {
  const s = size;
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: s * 0.24,
        background: "linear-gradient(145deg, #fde68a 0%, #f59e0b 55%, #ea580c 100%)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: s * 0.5,
          height: s * 0.5,
          borderRadius: s,
          background: "#fffbeb",
          top: s * 0.2,
          left: s * 0.25,
          boxShadow: `0 0 ${s * 0.12}px rgba(255,251,235,0.9)`,
          display: "flex",
        }}
      />
      <div
        style={{
          width: s * 0.66,
          height: s * 0.36,
          background: "#ffffff",
          borderTopLeftRadius: s * 0.06,
          borderTopRightRadius: s * 0.06,
          marginBottom: 0,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          padding: s * 0.07,
          gap: s * 0.045,
        }}
      >
        <div style={{ height: s * 0.035, width: "85%", background: "#fcd34d", borderRadius: s }} />
        <div style={{ height: s * 0.035, width: "65%", background: "#e5e7eb", borderRadius: s }} />
        <div style={{ height: s * 0.035, width: "75%", background: "#e5e7eb", borderRadius: s }} />
      </div>
    </div>
  );
}
