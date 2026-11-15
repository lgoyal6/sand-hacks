// Loading states using Dat's Loader (components/ui/loader.tsx, kept verbatim). Owner: D.
//   LoadingShell: a whole page while it loads. The sidebar stays, the loader sits dead center of the content
//                 area (right of the sidebar on desktop, the full screen on mobile).
//   PageLoader:   inside a page that is already showing its title (client-side fetches): centered in the rest.
//   PanelLoader:  inside a card, centered in the card.
import Loader from "@/components/ui/loader";
import { AppShell } from "@/components/ui/app-shell";

type Props = { title: string; subtitle: string };

export function LoadingShell({ title, subtitle }: Props) {
  return (
    <AppShell wide className="flex items-center justify-center">
      <div role="status" aria-live="polite">
        <Loader title={title} subtitle={subtitle} size="md" />
      </div>
    </AppShell>
  );
}

export function PageLoader({ title, subtitle }: Props) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[calc(100svh-12rem)] w-full items-center justify-center">
      <Loader title={title} subtitle={subtitle} size="md" />
    </div>
  );
}

export function PanelLoader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-40 w-full items-center justify-center rounded-lg border border-border">
      <Loader title={title} subtitle={subtitle ?? ""} size="sm" className="p-4" />
    </div>
  );
}
