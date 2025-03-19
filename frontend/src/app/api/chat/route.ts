import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Forward the request to our backend
    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error('Backend service error');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
} 