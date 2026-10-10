"use client";

import { useEffect } from "react";

import { clearAllDrafts } from "./credential-drafts";

/** Mounted once for the whole Apps & Integrations page: unsaved credentials survive tab switches and are dropped when the person leaves the page. */
export function DraftsScope() {
  useEffect(() => clearAllDrafts, []);
  return null;
}
