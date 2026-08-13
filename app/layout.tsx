import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "시장 대시보드",
  description: "주요 시장 지표와 투자 참고 신호를 한 화면에서 확인하는 대시보드",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
