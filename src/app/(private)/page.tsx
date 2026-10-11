import type { Metadata } from "next";
import { CallScreen } from "../../features/voice/call-screen.tsx";

export const metadata: Metadata = {
  title: "Call",
};

export default function HomePage() {
  return <CallScreen />;
}

