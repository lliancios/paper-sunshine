// App mark: a crystal ball inside a cream-white rounded bezel. Rendered both
// as the PWA icon (via next/og) and inline in the UI, so it only uses inline
// styles that Satori understands (gradients, radii, box-shadow, transforms).
/** `bleed`: square, borderless version for home-screen icons (iOS and Android apply their own mask). */
export function SunMark({ size = 32, variant = "sun", bleed = false }: { size?: number; variant?: "sun" | "indigo"; bleed?: boolean }) {
  const s = size;
  const orb =
    variant === "sun"
      ? "radial-gradient(circle at 34% 28%, #fffdf2 0%, #fff1b8 12%, #fcd34d 32%, #f59e0b 58%, #e0680a 82%, #b8430a 100%)"
      : "radial-gradient(circle at 34% 28%, #eef2ff 0%, #a5b4fc 14%, #6366f1 38%, #3730a3 66%, #1e1b4b 100%)";
    const caustic = variant === "sun" ? "rgba(255,247,214,0.85)" : "rgba(199,210,254,0.75)";
  const d = s * 0.6; // orb diameter
  const o = (s - d) / 2; // orb left
  const t = s * 0.13; // orb top
  const bronze = "linear-gradient(180deg, #d9a35a 0%, #b7782f 45%, #8a5520 100%)";
  return (
    <div
      style={{
        width: s,
        height: s,
        borderRadius: bleed ? 0 : s * 0.27,
        background: "linear-gradient(160deg, #ffffff 0%, #fbf8f1 55%, #efe8d8 100%)",
        border: bleed ? "none" : `${Math.max(1, s * 0.012)}px solid rgba(200,186,155,0.55)`,
        boxShadow: bleed ? "none" : `0 ${s * 0.03}px ${s * 0.08}px rgba(120,90,40,0.18)`,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* stand: neck and base, drawn first so the orb sits on top */}
      <div
        style={{
          position: "absolute",
          left: (s - d * 0.44) / 2,
          top: t + d * 0.9,
          width: d * 0.44,
          height: s * 0.09,
          borderRadius: s * 0.02,
          backgroundImage: bronze,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: (s - d * 0.86) / 2,
          top: t + d * 0.9 + s * 0.075,
          width: d * 0.86,
          height: s * 0.075,
          borderRadius: `${s * 0.035}px ${s * 0.035}px ${s * 0.02}px ${s * 0.02}px`,
          backgroundImage: bronze,
          boxShadow: `0 ${s * 0.01}px ${s * 0.02}px rgba(90,60,20,0.25)`,
          display: "flex",
        }}
      />
      {/* the orb */}
      <div
        style={{
          position: "absolute",
          left: o,
          top: t,
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
          top: t,
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
          top: t + d * 0.62,
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
          top: t + d * 0.1,
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
          top: t + d * 0.22,
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
