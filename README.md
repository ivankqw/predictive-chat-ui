# Vibes Chat Interface

This project is a dynamic prompt UI chat interface that aims to create a more "vibey" and fluid user experience.

## Project Structure

- `vibes-chat-interface`: Next.js frontend 
- `vibes-server`: FastAPI backend

## Features

- Basic chat interface with message history
- Real-time intent detection as the user types
- Dynamic calendar event form that appears when scheduling intent is detected
- Integration with Groq LLM API for chat and intent detection

## Setup Instructions

### Backend Setup (vibes-server)

1. Navigate to the backend directory:
   ```
   cd vibes-server
   ```

2. Create a virtual environment (optional but recommended):
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Create a `.env` file:
   ```
   cp .env.example .env
   ```
   Update the `.env` file with your actual API keys if needed.

5. Start the backend server:
   ```
   python main.py
   ```
   The server will run on http://localhost:8000

### Frontend Setup (vibes-chat-interface)

1. Navigate to the frontend directory:
   ```
   cd vibes-chat-interface
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```
   The frontend will run on http://localhost:3000

## How It Works

1. As the user types in the chat input, the text is sent to the backend for intent detection
2. If the system detects that the user is trying to schedule a calendar event (with high confidence), a calendar form appears
3. The form is progressively filled with details as they are detected from the user's input
4. The user can continue typing to add more details or send the message to get a response from the assistant

## Future Features

- More intent types beyond calendar events
- More interactive UI elements based on detected intents
- "Vibey" flow state interactions with animations
