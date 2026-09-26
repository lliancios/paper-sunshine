import { ImageResponse } from "next/og";
import { SunMark } from "@/components/SunMark";

// Full-bleed 512px icon for Android/Chrome "maskable" installs.
export function GET() {
  return new ImageResponse(<SunMark size={512} bleed />, { width: 512, height: 512 });
}
