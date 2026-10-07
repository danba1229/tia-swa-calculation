import "./globals.css";
import "./workspace.css";

export const metadata = {
  title: "TIA Support | 교통영향평가 조사 도구",
  description: "Address-centered TIA survey workspace for deployment.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
