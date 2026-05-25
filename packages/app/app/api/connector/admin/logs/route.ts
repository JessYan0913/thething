import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface CallLog {
  id: string;
  timestamp: string;
  connectorId: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

const callLogs: CallLog[] = [];
const MAX_LOGS = 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const connectorId = searchParams.get('connectorId');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  let filteredLogs = callLogs;

  if (connectorId) {
    filteredLogs = callLogs.filter(log => log.connectorId === connectorId);
  }

  const total = filteredLogs.length;
  const paginatedLogs = filteredLogs
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit);

  const stats = {
    totalCalls: callLogs.length,
    successRate: callLogs.length > 0
      ? (callLogs.filter(l => l.success).length / callLogs.length * 100).toFixed(2) + '%'
      : '0%',
    avgDurationMs: callLogs.length > 0
      ? Math.round(callLogs.reduce((sum, l) => sum + l.durationMs, 0) / callLogs.length)
      : 0,
    byConnector: {} as Record<string, { total: number; success: number; avgMs: number }>,
  };

  for (const log of callLogs) {
    if (!stats.byConnector[log.connectorId]) {
      stats.byConnector[log.connectorId] = { total: 0, success: 0, avgMs: 0 };
    }
    const s = stats.byConnector[log.connectorId];
    s.total++;
    if (log.success) s.success++;
    s.avgMs += log.durationMs;
  }

  for (const [id, s] of Object.entries(stats.byConnector)) {
    s.avgMs = Math.round(s.avgMs / (stats.byConnector[id]?.total || 1));
  }

  return NextResponse.json({
    success: true,
    data: {
      logs: paginatedLogs,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
      stats,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      connectorId: string;
      toolName: string;
      success: boolean;
      durationMs: number;
      input: Record<string, unknown>;
      result?: unknown;
      error?: string;
    };

    const log: CallLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...body,
    };

    callLogs.unshift(log);

    if (callLogs.length > MAX_LOGS) {
      callLogs.splice(MAX_LOGS);
    }

    return NextResponse.json({ success: true, logId: log.id });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
