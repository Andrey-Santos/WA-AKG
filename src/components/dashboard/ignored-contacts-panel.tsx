"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/components/dashboard/session-provider";

/** Phone numbers the auto-reply must ignore (bot-config autoReplyMode=BLACKLIST + autoReplyBlockedJids). */
export function IgnoredContactsPanel() {
    const t = useTranslations("autoreply");
    const { sessionId } = useSession();
    const [config, setConfig] = useState<any>(null);
    const [number, setNumber] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`);
            const json = await res.json();
            setConfig(res.ok ? json.data : null);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    useEffect(() => { load(); }, [load]);

    // POST replaces the whole config, so send back everything we loaded with only the two auto-reply fields changed
    const save = async (blocked: string[]) => {
        if (!sessionId || !config) return;
        setSaving(true);
        try {
            const autoReplyMode = blocked.length ? "BLACKLIST" : config.autoReplyMode === "BLACKLIST" ? "ALL" : config.autoReplyMode;
            const res = await fetch(`/api/sessions/${sessionId}/bot-config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...config, autoReplyMode, autoReplyBlockedJids: blocked }),
            });
            if (!res.ok) throw new Error();
            setConfig({ ...config, autoReplyMode, autoReplyBlockedJids: blocked });
        } catch {
            toast.error(t("ignoredSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const blocked: string[] = config?.autoReplyBlockedJids ?? [];
    const otherMode = config && !["ALL", "BLACKLIST"].includes(config.autoReplyMode);

    const add = () => {
        const digits = number.replace(/\D/g, "");
        if (digits.length < 8) return toast.error(t("ignoredInvalid"));
        const jid = `${digits}@s.whatsapp.net`;
        if (!blocked.includes(jid)) save([...blocked, jid]);
        setNumber("");
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("ignoredTitle")}</CardTitle>
                <CardDescription>{t("ignoredDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : !config ? null : (
                    <>
                        {otherMode && <p className="text-sm text-amber-600">{t("ignoredOtherMode", { mode: config.autoReplyMode })}</p>}
                        <div className="flex gap-2">
                            <Input
                                value={number}
                                onChange={(e) => setNumber(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && add()}
                                placeholder={t("ignoredPlaceholder")}
                                inputMode="tel"
                            />
                            <Button onClick={add} disabled={saving || otherMode}>
                                <Plus className="h-4 w-4 mr-1" /> {t("ignoredAdd")}
                            </Button>
                        </div>
                        {blocked.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("ignoredEmpty")}</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {blocked.map((jid) => (
                                    <span key={jid} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
                                        +{jid.split("@")[0]}
                                        <button
                                            onClick={() => save(blocked.filter((j) => j !== jid))}
                                            disabled={saving}
                                            aria-label={t("ignoredRemove")}
                                            className="text-muted-foreground hover:text-destructive"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
