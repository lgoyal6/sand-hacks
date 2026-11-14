"use client";
// Global nav rail, adapted from the 21st.dev "Sidebar (Dashboard)" component.
// Unprompted: Canvas-style slim rail (icon over a short label), expands on hover to show full labels,
// motion/react instead of framer-motion, themed with the rail tokens, active state from the URL.
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { createContext, useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RailLink {
  label: string;
  href: string;
  icon: React.ReactNode;
  /** Extra path prefixes that should mark this link active. */
  match?: string[];
}

interface RailContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const RailContext = createContext<RailContextProps | undefined>(undefined);

export function useRail() {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error("useRail must be used inside <SidebarRail>");
  return ctx;
}

export function SidebarRail({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = setOpenProp ?? setOpenState;
  return <RailContext.Provider value={{ open, setOpen, animate }}>{children}</RailContext.Provider>;
}

const COLLAPSED = 76;
const EXPANDED = 208;

export function SidebarRailBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <>
      <DesktopRail className={className}>{children}</DesktopRail>
      <MobileRail>{children}</MobileRail>
    </>
  );
}

function DesktopRail({ className, children }: { className?: string; children: React.ReactNode }) {
  const { open, setOpen, animate } = useRail();
  return (
    <div className="relative hidden shrink-0 md:block" style={{ width: COLLAPSED }}>
      <motion.nav
        aria-label="Global"
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex h-full flex-col gap-1 overflow-hidden bg-rail px-2 py-3 text-rail-foreground",
          open && "shadow-pop",
          className,
        )}
        initial={false}
        animate={{ width: animate ? (open ? EXPANDED : COLLAPSED) : COLLAPSED }}
        transition={{ type: "tween", duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      >
        {children}
      </motion.nav>
    </div>
  );
}

function MobileRail({ children }: { children: React.ReactNode }) {
  const { open, setOpen } = useRail();
  return (
    <div className="flex h-12 w-full items-center justify-between bg-rail px-4 text-rail-foreground md:hidden">
      <span className="text-sm font-semibold">Unprompted</span>
      <button type="button" aria-label="Open navigation" onClick={() => setOpen(!open)}>
        <Menu className="size-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Global"
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] flex flex-col gap-1 bg-rail p-6 text-rail-foreground"
          >
            <button type="button" aria-label="Close navigation" className="mb-4 self-end" onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
            {children}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}

function isActive(pathname: string, link: RailLink) {
  const prefixes = [link.href, ...(link.match ?? [])];
  return prefixes.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")));
}

/** Brand row at the top of the rail: the mark is always visible, the name only when expanded. */
export function SidebarRailBrand({ href = "/", mark, name }: { href?: string; mark: React.ReactNode; name: string }) {
  const { open, animate } = useRail();
  const expanded = !animate || open;
  return (
    <Link href={href} className="mb-3 flex h-12 items-center gap-3 px-2" aria-label={`${name} home`}>
      <span className="flex w-[44px] shrink-0 justify-center">{mark}</span>
      <motion.span
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.12 }}
        className={cn("whitespace-pre text-sm font-semibold", !expanded && "pointer-events-none absolute")}
        aria-hidden
      >
        {name}
      </motion.span>
    </Link>
  );
}

export function SidebarRailLink({ link, className }: { link: RailLink; className?: string }) {
  const { open, animate } = useRail();
  const pathname = usePathname() ?? "/";
  const active = isActive(pathname, link);
  const expanded = !animate || open;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/rail relative flex min-h-14 items-center gap-3 rounded-md px-2 text-rail-muted transition-colors hover:bg-white/10 hover:text-rail-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        active && "bg-white text-rail hover:bg-white hover:text-rail",
        className,
      )}
    >
      <span
        className={cn(
          "flex w-[44px] shrink-0 flex-col items-center gap-1 text-[11px] leading-none [&_svg]:size-5",
          expanded && "w-6 [&>span]:hidden",
        )}
      >
        {link.icon}
        <span className="max-w-[60px] truncate">{link.label}</span>
      </span>
      <motion.span
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.12 }}
        className={cn("whitespace-pre text-sm font-medium", !expanded && "pointer-events-none absolute")}
        aria-hidden={!expanded}
      >
        {link.label}
      </motion.span>
    </Link>
  );
}
