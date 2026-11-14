// Component gallery for the design system (owner: D). Reference for B and C; not linked from the nav.
import { AppShell, PROFESSOR_COURSE_NAV } from "@/components/ui/app-shell";
import { DesignGallery } from "./gallery";

export default function Page() {
  return (
    <AppShell
      course={{ name: "Intro Statistics", term: "Fall 2026", nav: PROFESSOR_COURSE_NAV }}
      breadcrumbs={[{ label: "Intro Statistics", href: "/course" }, { label: "Design system" }]}
      title="Design system"
    >
      <DesignGallery />
    </AppShell>
  );
}
