// ============================================================
// /api/doctor — 诊断（GET）与修复（POST）
// ============================================================
// GET  → 运行全部检查，返回 DoctorReport JSON
// POST → { repairId, confirm } 执行修复；destructive 项 confirm:false
//        返回 { status: 'needs-confirmation' }，客户端确认后再发 confirm:true
// 已知限制：getServerRuntime() 会 bootstrap 全 app；若 chat.db 坏到 bootstrap
// 抛错，API 无法诊断——此时用 CLI（scripts/doctor.mts）。

import { getServerRuntime } from '@/lib/runtime';
import { createDoctorContext, runDoctor, applyRepair } from '@the-thing/core';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function doctorCtx() {
  const rt = await getServerRuntime();
  return createDoctorContext({ layout: rt.layout, dataStore: rt.dataStore });
}

export async function GET() {
  try {
    const report = await runDoctor(await doctorCtx());
    return NextResponse.json(report);
  } catch (error) {
    console.error('[Doctor API] GET error:', error);
    return NextResponse.json({ error: 'Failed to run doctor' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { repairId?: string; confirm?: boolean };
    if (!body.repairId) {
      return NextResponse.json({ error: 'Missing repairId' }, { status: 400 });
    }
    const outcome = await applyRepair(await doctorCtx(), body.repairId, {
      confirmed: body.confirm === true,
    });
    return NextResponse.json(outcome);
  } catch (error) {
    console.error('[Doctor API] POST error:', error);
    return NextResponse.json({ error: 'Failed to apply repair' }, { status: 500 });
  }
}
