'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import CalendarEventForm from '@/components/CalendarEventForm';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Export the Message interface
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface CalendarEventData {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  confidence: number;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hello! How can I help you today?' },
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDetectingIntent, setIsDetectingIntent] = useState(false);
  const [calendarEventData, setCalendarEventData] = useState<CalendarEventData | null>(null);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [isCalendarFormVisible, setIsCalendarFormVisible] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [intentDetectionActive, setIntentDetectionActive] = useState(true);
  const [lastProcessedInput, setLastProcessedInput] = useState<string>("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);

  // Handle showing and hiding the calendar form with proper transition
  useEffect(() => {
    if (showCalendarForm) {
      // First make the container visible
      setIsCalendarFormVisible(true);
    } else {
      // Wait for animation to complete before removing the form from DOM
      const timer = setTimeout(() => {
        setIsCalendarFormVisible(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [showCalendarForm]);

  // Always scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      const scrollToBottom = () => {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        });
      };
      scrollToBottom();
    }
  }, [messages]);

  // Auto focus the input field
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    
    const adjustHeight = () => {
      textarea.style.height = '60px'; // Reset height first
      const newHeight = Math.min(textarea.scrollHeight, 120); // Cap at 120px
      textarea.style.height = `${newHeight}px`;
    };
    
    adjustHeight();
  }, [inputMessage]);

  // Reset chat input and focus
  const resetChatInput = useCallback(() => {
    setInputMessage('');
    // Delay focus to ensure the UI has updated
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.style.height = '60px';
        inputRef.current.focus();
      }
    }, 100);
  }, []);

  // Function to detect intent from user input - with performance improvements
  const detectIntent = useCallback(async (input: string) => {
    // Skip detection if input is too short or hasn't changed enough
    if (!intentDetectionActive ||
      input.trim().split(/\s+/).length < 3 ||
      input.length < 10 ||
      input === lastProcessedInput) {
      return;
    }

    setIsDetectingIntent(true);
    setLastProcessedInput(input);

    try {
      const response = await fetch('/api/intent-detection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: input }),
      });

      if (!response.ok) {
        throw new Error('Intent detection request failed');
      }

      const data = await response.json();

      // If a calendar event is detected with sufficient confidence
      if (data.intent === 'calendar_event' && data.data) {
        // Set default values for calendar event data
        const defaultEventData = {
          title: 'New Event',
          date: new Date().toLocaleDateString(),
          startTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          endTime: new Date(new Date().getTime() + 60 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          location: '',
          description: '',
          attendees: [],
          confidence: 0.5,
        };

        // Use default values when setting calendar event data
        setCalendarEventData({ ...defaultEventData, ...data.data });
        setShowCalendarForm(true);
      }
    } catch (error) {
      console.error('Error detecting intent:', error);
    } finally {
      setIsDetectingIntent(false);
    }
  }, [intentDetectionActive, lastProcessedInput]);

  // Handle input changes with improved debouncing
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputMessage(value);

    // Clear any existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    // Increased debounce time to 500ms for better performance
    if (value.trim() && intentDetectionActive) {
      const newTimeout = setTimeout(() => {
        detectIntent(value);
      }, 500); // Increased from 200ms to 500ms
      setTypingTimeout(newTimeout);
    }
  }, [typingTimeout, intentDetectionActive, detectIntent]);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputMessage.trim() || isLoading) return;

    // Save a copy of the message before clearing input
    const messageToSend = inputMessage.trim();

    // Clear input first to prevent double submissions
    setInputMessage('');

    // Add user message to the chat
    const userMessage = { role: 'user' as const, content: messageToSend };

    // Update messages state with the new user message
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Set loading state
    setIsLoading(true);

    // If form is visible, close it gracefully
    if (showCalendarForm) {
      setShowCalendarForm(false);
      setCalendarEventData(null);
    }

    // Reset intent detection for the next interaction
    setIntentDetectionActive(true);

    try {
      console.log('Sending messages to backend:', updatedMessages);

      // Send the entire message history to the backend
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages
        }),
        // Add a timeout to prevent indefinite waiting
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Failed to get response: ${response.status}`);
      }

      const data = await response.json();
      console.log('Response from backend:', data);

      const assistantMessage = data.message || data.response || data.content || 'I received your message.';
      
      // Use a single state update for both loading state and messages
      setIsLoading(false);
      setMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Use a single state update for both loading state and messages
      setIsLoading(false);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      // Reset chat input after a short delay
      setTimeout(() => {
        resetChatInput();
      }, 100);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-custom-brown p-4 sm:p-8 lg:p-24">
      <div className="z-10 w-full max-w-3xl flex flex-col h-[90vh] relative light-beam-container backdrop-blur-sm rounded-xl border border-white/5 shadow-2xl p-6 transform-gpu">
        <div className="light-beam"></div>
        <div className="absolute inset-0 bg-black/10 backdrop-blur-sm rounded-xl -z-10"></div>

        {/* Logo */}
        <div className="flex flex-col items-center justify-center mb-6">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-orange-600 to-yellow-400 drop-shadow-md">
            Vibes Chat
          </h1>
          <p className="text-sm text-gray-300 text-opacity-80 mt-2 max-w-md text-center">
            Experience flow state with AI that anticipates your needs before you even ask.
          </p>
        </div>

        {/* Main content area - fixed structure with proper spacing */}
        <div className="flex-1 flex flex-col">
          {/* Chat container with fixed position */}
          <div className="flex-1 relative rounded-lg bg-black/10 backdrop-blur-md border border-white/5 shadow-lg mb-4">
            <div className="absolute inset-0 overflow-y-auto px-4 py-4">
              <div className="flex flex-col space-y-4 min-h-[50px] pb-2">
                {messages.map((message, index) => (
                  <div
                    key={`msg-${index}`}
                    className={cn(
                      "p-3 rounded-lg shadow-md max-w-[85%] transform-gpu",
                      message.role === 'user'
                        ? "bg-blue-600/20 ml-auto border border-blue-500/30"
                        : "bg-purple-600/20 border border-purple-500/30"
                    )}
                  >
                    <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">{message.content}</p>
                  </div>
                ))}
                {isLoading && (
                  <div className="p-3 rounded-lg bg-purple-600/20 border border-purple-500/30 shadow-md max-w-[85%]">
                    <div className="flex space-x-2 items-center">
                      <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse delay-200"></div>
                      <div className="w-2 h-2 bg-purple-300 rounded-full animate-pulse delay-400"></div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} className="h-4 w-full flex-shrink-0" />
              </div>
            </div>
          </div>

          {/* Calendar form container */}
          <div
            ref={formContainerRef}
            className={cn(
              "transition-all duration-300 ease-out mb-4 overflow-hidden",
              showCalendarForm
                ? "opacity-100 max-h-[500px]"
                : "opacity-0 max-h-0"
            )}
            aria-hidden={!showCalendarForm}
          >
            {isCalendarFormVisible && calendarEventData && (
              <CalendarEventForm
                eventData={calendarEventData}
                isVisible={showCalendarForm}
                setEventData={setCalendarEventData}
                setShowCalendarForm={setShowCalendarForm}
                setMessages={setMessages}
                resetChatInput={resetChatInput}
              />
            )}
          </div>

          {/* Message input form */}
          <form onSubmit={handleSubmit} className="relative">
            <textarea
              ref={inputRef}
              value={inputMessage}
              onChange={handleInputChange}
              placeholder="Type a message..."
              className="w-full bg-black/20 backdrop-blur-md text-gray-100 rounded-lg p-4 pr-12 resize-none border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-600/30 shadow-md min-h-[60px] max-h-32 transition-all duration-200"
              style={{ height: '60px' }}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <Button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="absolute right-2 bottom-2 w-10 h-10 rounded-full p-0 bg-gradient-to-r from-blue-600 to-purple-600 text-gray-100 flex items-center justify-center hover:shadow-lg transition-all duration-200"
              aria-label="Send message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </Button>
          </form>
        </div>

        {/* Intent detection indicator - keep outside the flex container */}
        {isDetectingIntent && (
          <div className="absolute bottom-16 right-4 text-xs text-gray-400 flex items-center gap-1 transition-opacity duration-300 opacity-80">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            Thinking...
          </div>
        )}
      </div>
    </main>
  );
}
