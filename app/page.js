import TiaResearchBuilder from "../components/TiaResearchBuilder";

export default function Page() {
  const kakaoJsKey = process.env.KAKAO_JS_KEY || "";

  return <TiaResearchBuilder kakaoJsKey={kakaoJsKey} />;
}
