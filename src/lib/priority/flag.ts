/**
 * The RM copilot "Priority Clients" list (bible section 07). Off unless NEXT_PUBLIC_RM_PRIORITY_CLIENTS is exactly "1"
 * (build-time). With the flag off the copilot page renders exactly as it did before.
 */
export const RM_PRIORITY_CLIENTS_FLAG = "NEXT_PUBLIC_RM_PRIORITY_CLIENTS";
export const rmPriorityClientsEnabled = (env?: Record<string, string | undefined>): boolean => (env ? env[RM_PRIORITY_CLIENTS_FLAG] : process.env.NEXT_PUBLIC_RM_PRIORITY_CLIENTS) === "1";
