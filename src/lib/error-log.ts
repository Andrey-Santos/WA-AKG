import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type ErrorSource = "AUTOREPLY" | "BROADCAST";

/** Persists a failure so it can be reviewed (and deleted) in the dashboard. Never throws. */
export async function logError(params: {
    sessionId: string;
    source: ErrorSource;
    message: string;
    refLabel?: string | null;
    target?: string | null;
}) {
    try {
        await prisma.errorLog.create({
            data: {
                sessionId: params.sessionId,
                source: params.source,
                message: params.message.slice(0, 2000),
                refLabel: params.refLabel ?? null,
                target: params.target ?? null,
            },
        });
    } catch (e: any) {
        logger.error("ErrorLog", `Failed to save error log: ${e?.message}`);
    }
}
