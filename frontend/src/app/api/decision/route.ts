import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.DECISION_BACKEND_URL || 'http://127.0.0.1:8014/api/decision';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { text?: unknown; request_id?: unknown };
    if (typeof body.text !== 'string' || typeof body.request_id !== 'number' || !Number.isInteger(body.request_id)) {
      return NextResponse.json({ error: 'Expected text and integer request_id.' }, { status: 400 });
    }
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body.text, request_id: body.request_id }),
      cache: 'no-store',
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (error) {
    console.error('Decision proxy error:', error);
    return NextResponse.json({ error: 'Decision service unavailable.' }, { status: 503 });
  }
}
