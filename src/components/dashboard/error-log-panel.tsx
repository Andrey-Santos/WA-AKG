"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";

interface ErrorLogRow {
    id: string;
    refLabel: string | null;
    target: string | null;
    message: string;
    createdAt: string;
}

/** Lists failures saved for the active session (auto-reply or broadcast) and lets the user delete them. */
export function ErrorLogPanel({ source }: { source: "AUTOREPLY" | "BROADCAST" }) {
    const t = useTranslations("errorLogs");
    const { sessionId } = useSession();
    const [rows, setRows] = useState<ErrorLogRow[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/error-logs/${sessionId}?source=${source}`);
            const json = await res.json();
            setRows(res.ok ? json.data || [] : []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [sessionId, source]);

    useEffect(() => { load(); }, [load]);

    const remove = async (query: string, okMessage: string) => {
        try {
            const res = await fetch(`/api/error-logs/${sessionId}?${query}`, { method: "DELETE" });
            if (!res.ok) throw new Error();
            toast.success(okMessage);
            load();
        } catch {
            toast.error(t("deleteFailed"));
        }
    };

    const jid = (v: string | null) => (v ? v.replace("@s.whatsapp.net", "").replace("@g.us", " (grupo)") : "-");

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                    <CardTitle>{t("title")}</CardTitle>
                    <CardDescription>{t(source === "AUTOREPLY" ? "descAutoreply" : "descBroadcast")}</CardDescription>
                </div>
                {rows.length > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => confirm(t("confirmDeleteAll")) && remove(`source=${source}`, t("deletedAll"))}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t("deleteAll")}
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 text-green-600" />
                        {t("empty")}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {rows.map((r) => (
                            <div key={r.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                                <div className="min-w-0 space-y-1 text-sm">
                                    <p className="break-words [overflow-wrap:anywhere] font-medium text-destructive">{r.message}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {new Date(r.createdAt).toLocaleString()}
                                        {r.refLabel ? ` · ${t(source === "AUTOREPLY" ? "rule" : "broadcast")}: ${r.refLabel}` : ""}
                                        {r.target ? ` · ${t("recipient")}: ${jid(r.target)}` : ""}
                                    </p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10" title={t("delete")} onClick={() => remove(`id=${r.id}`, t("deleted"))}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
