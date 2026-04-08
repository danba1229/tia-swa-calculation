import "./globals.css";

export const metadata = {
  title: "TIA Research Builder",
  description: "Address-centered TIA survey workspace for deployment.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
