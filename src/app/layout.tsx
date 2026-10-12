import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = localFont({
  src: "./fonts/Inter-VariableFont_opsz_wght.ttf",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const sora = localFont({
  src: "./fonts/Sora-VariableFont_wght.ttf",
  variable: "--font-sora",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Supportify",
  description: "Client onboarding & journey management for Supportify",
  applicationName: "Supportify",
  // iPhones have no APK — this gives Safari's "Add to Home Screen" a proper title and standalone mode.
  appleWebApp: { capable: true, title: "Supportify", statusBarStyle: "default" },
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
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
