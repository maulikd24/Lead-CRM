import type { Metadata, Viewport } from "next";
import { Manrope, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-heading-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
    { media: "(prefers-color-scheme: light)", color: "#f1f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#141816" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
