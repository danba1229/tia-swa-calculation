import TiaResearchBuilder from "../../components/TiaResearchBuilder";

export const metadata = {
  title: "TIA Research Builder Embed",
  description: "Embedded TIA survey workspace for blog integration.",
};

export default function EmbedPage() {
  const kakaoJsKey = process.env.KAKAO_JS_KEY || "";

  return <TiaResearchBuilder kakaoJsKey={kakaoJsKey} embedded />;
}
