import type { Metadata } from "next";
import { ForYouFeed } from "@/components/ForYouFeed";

export const metadata: Metadata = {
  title: "For You — R34 Browser",
};

export default function ForYouPage() {
  return <ForYouFeed />;
}
