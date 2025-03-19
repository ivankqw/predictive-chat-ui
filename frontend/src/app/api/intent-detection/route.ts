import { NextResponse } from 'next/server';

const BACKEND_URL = 'http://localhost:8000';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('Frontend API route received:', body);
    
    // Forward the request to our backend
    // Make sure to pass through the message field exactly as received
    const response = await fetch(`${BACKEND_URL}/api/intent-detection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Pass through whichever field is present (message or text)
        message: body.message || body.text
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend error:', response.status, errorText);
      throw new Error(`Backend service error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Backend response:', data);
    return NextResponse.json(data);
  } catch (error) {
    console.error('API route error:', error);
    return NextResponse.json(
      { intent: "none", data: null, confidence: 0 },
      { status: 500 }
    );
  }
} 