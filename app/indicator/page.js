import IndicatorCalculator from "../../components/IndicatorCalculator";

export const metadata = {
  title: "지표·O/D 접근강도 계산기 | TIA Support",
  description: "주소와 목표연도로 교통영향평가 지표와 방향별 접근강도를 계산하고 저장합니다.",
};

export default function IndicatorPage() {
  return <IndicatorCalculator />;
}
