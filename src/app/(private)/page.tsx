import type { Metadata } from "next";
import { DirectionalText } from "../../components/directional-text.tsx";
import { PageContainer } from "../../components/page-container.tsx";

export const metadata: Metadata = {
  title: "Home",
};

export default function HomePage() {
  return (
    <PageContainer title="Home" width="wide">
      <DirectionalText>You are signed in.</DirectionalText>
    </PageContainer>
  );
}
