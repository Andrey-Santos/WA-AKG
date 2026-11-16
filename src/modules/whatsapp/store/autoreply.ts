import { prisma } from "@/lib/prisma";
import type { WASocket } from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";
import { logError } from "@/lib/error-log";

/**
 * Replaces every {{url:https://...}} in a response with the text returned by that URL
 * (fetched at reply time, so the content is always current). On failure the token becomes "".
 */
async function resolveDynamicResponse(text: string, onError?: (msg: string) => void): Promise<string> {
    const re = /\{\{\s*url:\s*(https?:\/\/[^\s}]+)\s*\}\}/gi;
    const matches = Array.from(text.matchAll(re));
    if (matches.length === 0) return text;

    const { safeFetchBuffer } = await import("@/lib/security");
    let result = text;
    for (const m of matches) {
        let replacement = "";
        try {
            const { buffer } = await safeFetchBuffer(m[1], { maxBytes: 100 * 1024, timeoutMs: 8000 });
            replacement = buffer.toString("utf8").trim();
        } catch (err: any) {
            logger.error("AutoReply", `Dynamic content fetch failed for ${m[1]}: ${err.message}`);
            onError?.(`Falha ao buscar o link dinâmico ${m[1]}: ${err.message}`);
        }
        result = result.replace(m[0], () => replacement);
    }
    return result;
}

type InteractiveButton = { type: string; displayText: string; value?: string };

function hasInteractive(rule: any): boolean {
    return Array.isArray(rule?.interactive?.buttons) && rule.interactive.buttons.length > 0;
}

/** Maps the stored { type, displayText, value } buttons to the interactive payload used by the sender. */
function buildInteractivePayload(rule: any, body: string) {
    const buttons = (rule.interactive.buttons as InteractiveButton[]).map((b, i) => {
        switch (b.type) {
            case "cta_url": return { type: "cta_url", displayText: b.displayText, url: b.value || "" };
            case "cta_call": return { type: "cta_call", displayText: b.displayText, phoneNumber: b.value || "" };
            case "cta_copy": return { type: "cta_copy", displayText: b.displayText, copyCode: b.value || "" };
            default: return { type: "quick_reply", displayText: b.displayText, id: `btn_${i + 1}` };
        }
    });
    return { title: rule.interactive.title || "", body, footer: rule.interactive.footer || "", buttons };
}

// Helper for permission check (Deduplicate from command-handler if possible, but keep simple here)
function canAutoReply(config: any, fromMe: boolean, senderJid: string): boolean {
    if (!config || !config.enabled) return false;

    // Auto Reply Specific Mode
    const mode = config.autoReplyMode || 'ALL';

    if (fromMe) {
        // If mode is OWNER, it triggers for ME? 
        // Auto Reply usually replies TO someone. 
        // If I send a message, and mode is OWNER, should it reply to me? 
        // User requested "Self Mode" -> Use case: Snippets.
        // So yes, if fromMe checks out.

        // However, standard auto-reply logic (replying to incoming) should be blocked if fromMe is true AND mode is ALL?
        // No, typically Auto Reply doesn't trigger on own messages to prevent unexpected loops.
        // But for "Self Mode" (Macros), it MUST trigger on own messages.

        if (mode === 'OWNER') return true;
        if (mode === 'ALL') return false; // Standard auto-reply ignores self

        // Specific? 
        return false;
    } else {
        // Incoming message from others
        if (mode === 'OWNER') return false; // Owner only acts on Owner messages
        if (mode === 'ALL') return true;

        if (mode === 'SPECIFIC') {
            const allowedJids = config.autoReplyAllowedJids || [];
            if (Array.isArray(allowedJids)) {
                return allowedJids.some((jid: string) => senderJid.includes(jid));
            }
        }

        if (mode === 'BLACKLIST') {
            const blockedJids = config.autoReplyBlockedJids || [];
            if (Array.isArray(blockedJids)) {
                const isBlocked = blockedJids.some((jid: string) => senderJid.includes(jid));
                return !isBlocked; // Return true if NOT blocked
            }
            return true; // If blacklist empty, allow all
        }
    }

    return false;
}

export async function bindAutoReply(sock: WASocket, sessionId: string) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        // Fetch session ID and Bot Config once per batch (optimization)
        const session = await prisma.session.findUnique({
            where: { sessionId },
            // @ts-ignore
            include: { botConfig: true }
        });

        if (!session) return;

        // @ts-ignore
        let config = (session as any).botConfig;

        if (!config) {
            logger.warn("AutoReply", "No config found, creating default...");
            config = await prisma.botConfig.create({
                data: {
                    sessionId: session.id,
                    enabled: true,
                    botMode: 'OWNER',
                    autoReplyMode: 'ALL'
                }
            });
        }

        logger.debug("AutoReply", `Processing for ${sessionId}. Config: ${config ? "Found" : "Missing"}, ${config?.enabled ? "Enabled" : "Disabled"}`);

        if (!config || !config.enabled) return;

        for (const msg of messages) {
            const fromMe = msg.key.fromMe || false;
            const remoteJid = msg.key.remoteJid;

            // Standardized Sender Logic
            const isGroup = remoteJid?.endsWith("@g.us") || false;
            const remoteJidAlt = msg.key.remoteJidAlt;
            let senderJid = (isGroup ? (msg.key.participant || msg.participant) : remoteJid);

            if (!isGroup && remoteJidAlt) {
                senderJid = remoteJidAlt;
            }

            if (!remoteJid || !senderJid) continue;

            // Check Permissions
            if (!canAutoReply(config, fromMe, senderJid)) continue;

            const content = normalizeMessageContent(msg.message);
            const text = content?.conversation || content?.extendedTextMessage?.text || ""; // Caption?

            if (!text) continue;

            try {
                // Fetch rules for this session
                const rules = await prisma.autoReply.findMany({
                    where: {
                        session: {
                            sessionId: sessionId
                        }
                    }
                });

                for (const rule of rules) {
                    let match = false;
                    // Optional per-rule accent-insensitive comparison (NFD + strip combining marks)
                    const fold = (s: string) => {
                        const lower = s.toLowerCase();
                        return (rule as any).ignoreAccents ? lower.normalize("NFD").replace(/[̀-ͯ]/g, "") : lower;
                    };
                    const keyword = fold(rule.keyword);
                    const incoming = fold(text);

                    switch (rule.matchType) {
                        case 'EXACT':
                            match = incoming === keyword;
                            break;
                        case 'CONTAINS':
                            match = incoming.includes(keyword);
                            break;
                        case 'REGEX':
                            try {
                                const regex = new RegExp(rule.keyword, 'i');
                                match = regex.test(text); // Use original case for regex
                            } catch (e) {
                                logger.error("AutoReply", "Invalid regex in auto-reply", rule.keyword);
                            }
                            break;
                    }

                    if (match) {
                        // Check trigger context (GROUP, PRIVATE, or ALL)
                        const isGroup = remoteJid.endsWith('@g.us');
                        const triggerType = (rule as any).triggerType || 'ALL'; // Default to ALL if undefined

                        if (triggerType === 'GROUP' && !isGroup) continue;
                        if (triggerType === 'PRIVATE' && isGroup) continue;

                        logger.info("AutoReply", `Match: ${rule.keyword} -> ${remoteJid}`);
                        const reportError = (message: string) =>
                            logError({ sessionId, source: "AUTOREPLY", refLabel: rule.keyword, target: remoteJid, message });
                        const responseText = rule.response ? await resolveDynamicResponse(rule.response, reportError) : rule.response;

                        if (rule.isMedia && rule.mediaUrl) {
                            const url = rule.mediaUrl;
                            const type = (rule as any).mediaType || "document";
                            
                            try {
                                const { safeFetchBuffer } = await import("@/lib/security");
                                const fetched = await safeFetchBuffer(url, {
                                    maxBytes: 25 * 1024 * 1024,
                                    timeoutMs: 15000
                                });
                                let { buffer, contentType } = fetched;
                                const { fileName } = fetched;

                                // WhatsApp doesn't render WebP sent as a regular image: convert to JPEG
                                if (type === "image" && /webp/i.test(contentType || "")) {
                                    const sharp = (await import("sharp")).default;
                                    buffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
                                    contentType = "image/jpeg";
                                }

                                let payload: any = {};
                                if (responseText) {
                                    payload.caption = responseText;
                                }

                                if (type === "image") {
                                    payload.image = buffer;
                                    payload.mimetype = contentType || "image/jpeg";
                                } else if (type === "video") {
                                    payload.video = buffer;
                                    payload.mimetype = contentType || "video/mp4";
                                } else if (type === "audio") {
                                    payload.audio = buffer;
                                    payload.mimetype = contentType || "audio/mp4";
                                } else {
                                    payload.document = buffer;
                                    payload.mimetype = contentType || "application/octet-stream";
                                    payload.fileName = fileName || "document";
                                }

                                await sock.sendMessage(remoteJid, payload, { quoted: msg });
                            } catch (err: any) {
                                logger.error("AutoReply", `Failed to send media auto-reply: ${err.message}. Falling back to text if response exists.`);
                                await reportError(`Falha ao enviar a mídia (${url}): ${err.message}${responseText ? " — enviado só o texto" : ""}`);
                                if (responseText) {
                                    await sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                                }
                            }
                        } else if (responseText && hasInteractive(rule)) {
                            try {
                                await sock.sendMessage(remoteJid, { interactiveMessage: buildInteractivePayload(rule, responseText) } as any, { quoted: msg });
                            } catch (err: any) {
                                logger.error("AutoReply", `Failed to send interactive auto-reply: ${err.message}. Falling back to text.`);
                                await reportError(`Falha ao enviar a mensagem interativa: ${err.message} — enviado só o texto`);
                                await sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                            }
                        } else if (responseText) {
                            await sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
                        }

                        break;
                    }
                }

            } catch (e: any) {
                logger.error("AutoReply", "Error executing auto-reply", e);
                await logError({ sessionId, source: "AUTOREPLY", refLabel: null, target: remoteJid, message: `Erro ao executar a resposta automática: ${e?.message || e}` });
            }
        }
    });
}
