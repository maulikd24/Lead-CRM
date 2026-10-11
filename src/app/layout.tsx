import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { BRAND } from "@/lib/brand";
import { EARLY_PALETTE_SCRIPT } from "@/lib/palette/early-open";

const inter = localFont({
  src: "./fonts/Inter-VariableFont_opsz_wght.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const sora = localFont({
  src: "./fonts/Sora-VariableFont_wght.woff2",
  variable: "--font-sora",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: BRAND.full, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  // iPhones have no APK — this gives Safari's "Add to Home Screen" a proper title and standalone mode.
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};

// Colours the phone's status bar / browser chrome to match the UI (--background light, dark sidebar tone).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F9F8" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sora.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Counts Cmd+K presses made before hydration so the command palette can open for them (see lib/palette/early-open.ts). */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_PALETTE_SCRIPT }} />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
