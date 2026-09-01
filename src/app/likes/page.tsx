import type { Metadata } from "next";
import { LikesView } from "@/components/LikesView";

export const metadata: Metadata = {
  title: "Liked — R34 Browser",
};

export default function LikesPage() {
  return <LikesView />;
}
