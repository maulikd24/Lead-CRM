/**
 * The control plane screens and nav item. Off unless NEXT_PUBLIC_CONTROL_PLANE is exactly "1" (build-time, like every other screen flag).
 * Seam for the flag registry: the registry agent lists this name in its inventory; this file is the only reader.
 */
export const CONTROL_PLANE_FLAG = "NEXT_PUBLIC_CONTROL_PLANE";
export const controlPlaneEnabled = (env: Record<string, string | undefined> = process.env): boolean => env[CONTROL_PLANE_FLAG] === "1";
