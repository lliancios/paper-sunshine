// App mark: a crystal ball inside a cream-white rounded bezel. Rendered both
// as the PWA icon (via next/og) and inline in the UI, so it only uses inline
// styles that Satori understands (gradients, radii, box-shadow, transforms).
export function SunMark({ size = 32, variant = "sun" }: { size?: number; variant?: "sun" | "indigo" }) {
  const s = size;
  const orb =
    variant === "sun"
      ? "radial-gradient(circle at 34% 28%, #fffdf2 0%, #fff1b8 12%, #fcd34d 32%, #f59e0b 58%, #e0680a 82%, #b8430a 100%)"
      : "radial-gradient(circle at 34% 28%, #eef2ff 0%, #a5b4fc 14%, #6366f1 38%, #3730a3 66%, #1e1b4b 100%)";
  const glow = variant === "sun" ? "rgba(217,119,6,0.35)" : "rgba(55,48,163,0.35)";
  const caustic = variant === "sun" ? "rgba(255,247,214,0.85)" : "rgba(199,210,254,0.75)";
  const d = s * 0.66; // orb diameter
  const o = (s - d) / 2;
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: s * 0.27,
        background: "linear-gradient(160deg, #ffffff 0%, #fbf8f1 55%, #efe8d8 100%)",
        border: `${Math.max(1, s * 0.012)}px solid rgba(200,186,155,0.55)`,
        boxShadow: `0 ${s * 0.03}px ${s * 0.08}px rgba(120,90,40,0.18)`,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* soft shadow of the orb on the bezel */}
      <div
        style={{
          position: "absolute",
          left: o + d * 0.1,
          top: o + d * 0.18,
          width: d * 0.8,
          height: d * 0.9,
          borderRadius: "50%",
          background: `radial-gradient(circle at 50% 60%, ${glow} 0%, rgba(0,0,0,0) 70%)`,
          display: "flex",
        }}
      />
      {/* the orb */}
      <div
        style={{
          position: "absolute",
          left: o,
          top: o,
          width: d,
          height: d,
          borderRadius: "50%",
          backgroundImage: orb,
          display: "flex",
        }}
      />
      {/* glassy rim */}
      <div
        style={{
          position: "absolute",
          left: o,
          top: o,
          width: d,
          height: d,
          borderRadius: "50%",
          border: `${Math.max(1, s * 0.014)}px solid rgba(255,255,255,0.45)`,
          display: "flex",
        }}
      />
      {/* light caught at the bottom of the ball */}
      <div
        style={{
          position: "absolute",
          left: o + d * 0.2,
          top: o + d * 0.62,
          width: d * 0.6,
          height: d * 0.3,
          borderRadius: "50%",
          background: `radial-gradient(ellipse at 50% 50%, ${caustic} 0%, rgba(255,255,255,0) 68%)`,
          display: "flex",
        }}
      />
      {/* specular highlight */}
      <div
        style={{
          position: "absolute",
          left: o + d * 0.14,
          top: o + d * 0.1,
          width: d * 0.42,
          height: d * 0.26,
          borderRadius: "50%",
          background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 72%)",
          transform: "rotate(-28deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: o + d * 0.66,
          top: o + d * 0.22,
          width: d * 0.1,
          height: d * 0.1,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)",
          display: "flex",
        }}
      />
    </div>
  );
}
