# Vibes Chat Interface - Frontend

This is the frontend component of the Vibes Chat Interface project, built with Next.js.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Features

- Chat interface with message history
- Real-time typing indicators
- Dark mode support
- Responsive design

## Project Structure

- `src/app/page.tsx`: Main chat interface component
- `src/app/api/chat/route.ts`: API route that forwards requests to the backend

## Development

This project uses Next.js with the App Router. To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## Important Notes

- Make sure the backend server is running at http://localhost:8000 before using the chat functionality.
- The chat interface is currently a basic implementation. Future versions will add dynamic intent detection and more interactive elements.
