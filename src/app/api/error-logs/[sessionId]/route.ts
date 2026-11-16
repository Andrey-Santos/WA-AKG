import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

const SOURCES = ["AUTOREPLY", "BROADCAST"];

async function authorize(req: NextRequest, sessionId: string) {
    const user = await getAuthenticatedUser(req);
    if (!user) return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessSession(user.id, user.role, sessionId))) {
        return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
    }
    return null;
}

// GET /api/error-logs/[sessionId]?source=AUTOREPLY|BROADCAST
export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const denied = await authorize(req, sessionId);
    if (denied) return denied;

    const source = new URL(req.url).searchParams.get("source") || "";
    if (!SOURCES.includes(source)) {
        return NextResponse.json({ status: false, message: "Invalid source", error: "Invalid source" }, { status: 400 });
    }

    const data = await prisma.errorLog.findMany({
        where: { sessionId, source },
        orderBy: { createdAt: "desc" },
        take: 200,
    });
    return NextResponse.json({ status: true, message: "OK", data });
}

// DELETE /api/error-logs/[sessionId]?id=...  (one)  or  ?source=...  (all of that source)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
    const { sessionId } = await params;
    const denied = await authorize(req, sessionId);
    if (denied) return denied;

    const sp = new URL(req.url).searchParams;
    const id = sp.get("id");
    const source = sp.get("source");

    if (id) {
        const r = await prisma.errorLog.deleteMany({ where: { id, sessionId } });
        return NextResponse.json({ status: true, message: "Deleted", data: { count: r.count } });
    }
    if (source && SOURCES.includes(source)) {
        const r = await prisma.errorLog.deleteMany({ where: { sessionId, source } });
        return NextResponse.json({ status: true, message: "Deleted", data: { count: r.count } });
    }
    return NextResponse.json({ status: false, message: "Provide id or source", error: "Provide id or source" }, { status: 400 });
}
