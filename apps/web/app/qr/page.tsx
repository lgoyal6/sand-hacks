// Printable QR code for the table (owner: D): points at PUBLIC_BASE_URL/check, the public leak checker.
import { Suspense } from "react";
import QRCode from "qrcode";
import { connection } from "next/server";
import { Logo } from "@/components/ui/logo";

export const metadata = { title: "Scan to check your question · Unprompted" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <QrBody />
    </Suspense>
  );
}

async function QrBody() {
  await connection();
  const base = (process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:3100").replace(/\/+$/, "");
  const url = `${base}/check`;
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#111418", light: "#ffffff" } });
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-white px-6 py-10 text-center print:py-0">
      <Logo size={36} />
      <h1 className="max-w-[640px] text-[40px] font-semibold leading-tight tracking-[-0.02em]">Is your homework question already online?</h1>
      <div className="w-[min(80vw,480px)] [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-[20px] text-muted-foreground">
        Scan, paste a question, and see which homework sites have it.
        <span className="num mt-2 block text-[16px] text-foreground">{url.replace(/^https?:\/\//, "")}</span>
      </p>
      <p className="text-sm text-muted-foreground print:hidden">Print this page (Cmd+P) for the table.</p>
    </main>
  );
}
