import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NotchNav } from "@/components/ui/notch-nav";
import "./globals.css";

const navItems: Array<{
  value: string;
  label: string;
  href: string;
  icon: "home" | "tasfya" | "review";
}> = [
  { value: "home", label: "Home", href: "/", icon: "home" },
  { value: "tasfya", label: "التسوية", href: "/tasfya", icon: "tasfya" },
  { value: "review", label: "المراجعة", href: "/review", icon: "review" },
];

export const metadata: Metadata = {
  title: "El Tasfyat",
  description: "El Tasfyat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border bg-card/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <NotchNav
              items={navItems}
              defaultValue="home"
              ariaLabel="Primary navigation"
            />
          </div>
        </header>
        <main className="flex-1 overflow-x-auto">{children}</main>
      </body>
    </html>
  );
}
