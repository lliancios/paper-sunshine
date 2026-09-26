import { ImageResponse } from "next/og";
import { SunMark } from "@/components/SunMark";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<SunMark size={512} />, size);
}
