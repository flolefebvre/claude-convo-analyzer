// The app's typefaces, declared once for both root layouts: next/font hosts
// one instance per call, so a second `Geist()` would be a second definition.

import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The class names that define `--font-geist-sans` and `--font-geist-mono`, for a root layout's `<html>`.
 *
 * @example <html className={`${fontVariableClassNames} h-full antialiased`}>
 */
export const fontVariableClassNames = `${geistSans.variable} ${geistMono.variable}`;
