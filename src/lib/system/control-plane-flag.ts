/**
 * The control plane screens and nav item. Off unless NEXT_PUBLIC_CONTROL_PLANE is exactly "1" (build-time, like every other screen flag).
 * The default reads the variable by its literal name so Next inlines it at build time, as it does for the other NEXT_PUBLIC_ flags.
 */
export const CONTROL_PLANE_FLAG = "NEXT_PUBLIC_CONTROL_PLANE";
export const controlPlaneEnabled = (env?: Record<string, string | undefined>): boolean => (env ? env[CONTROL_PLANE_FLAG] : process.env.NEXT_PUBLIC_CONTROL_PLANE) === "1";
