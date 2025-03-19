'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Message } from '@/app/page';
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

interface CalendarEventFormProps {
  eventData: CalendarEventData | null;
  isVisible: boolean;
  setEventData: React.Dispatch<React.SetStateAction<CalendarEventData | null>>;
  setShowCalendarForm: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  resetChatInput: () => void;
}

export default function CalendarEventForm({ 
  eventData, 
  isVisible, 
  setEventData, 
  setShowCalendarForm, 
  setMessages,
  resetChatInput
}: CalendarEventFormProps) {
  const [prevData, setPrevData] = useState<CalendarEventData | null>(null);
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set());
  const [animateIn, setAnimateIn] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Animation effect when form becomes visible
  useEffect(() => {
    if (isVisible && !isClosing) {
      const timer = setTimeout(() => setAnimateIn(true), 50);
      return () => clearTimeout(timer);
    } 
    // If no longer visible, ensure animations are off
    if (!isVisible) {
      setAnimateIn(false);
      setIsClosing(false);
    }
  }, [isVisible, isClosing]);

  // Track field changes to highlight them
  useEffect(() => {
    if (!eventData || !prevData) {
      setPrevData(eventData);
      return;
    }

    // Identify changed fields
    const changedFields = new Set<string>();
    const fields: (keyof CalendarEventData)[] = [
      'title', 'date', 'startTime', 'endTime', 'location', 'description'
    ];
    
    fields.forEach(field => {
      if (eventData[field] !== prevData[field]) changedFields.add(field as string);
    });
    
    // Check attendees separately
    const prevAttendees = prevData.attendees || [];
    const currentAttendees = eventData.attendees || [];
    if (JSON.stringify(prevAttendees) !== JSON.stringify(currentAttendees)) {
      changedFields.add('attendees');
    }
    
    // Set highlights and clear after animation
    if (changedFields.size > 0) {
      setHighlightedFields(changedFields);
      const timer = setTimeout(() => setHighlightedFields(new Set()), 1500);
      return () => clearTimeout(timer);
    }
    
    setPrevData(eventData);
  }, [eventData, prevData]);

  // Calculate completion percentage
  const getCompletionPercentage = () => {
    if (!eventData) return 0;
    
    const fields = ['title', 'date', 'startTime', 'endTime', 'location', 'description', 'attendees'];
    const filledFields = fields.filter(field => {
      if (field === 'attendees') {
        return eventData[field as keyof CalendarEventData] && 
               Array.isArray(eventData[field as keyof CalendarEventData]) && 
               (eventData[field as keyof CalendarEventData] as string[]).length > 0;
      }
      return !!eventData[field as keyof CalendarEventData];
    });
    
    return Math.round((filledFields.length / fields.length) * 100);
  };

  // Clean form closure with animation
  const closeForm = (addMessage = false) => {
    setIsClosing(true);
    setAnimateIn(false);
    
    setTimeout(() => {
      if (addMessage && eventData?.title) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `Event "${eventData.title}" created successfully for ${eventData.date || 'today'}.` 
        }]);
      }
      
      resetChatInput();
      
      // Wait for message to be added before hiding form to prevent UI jank
      setTimeout(() => {
        setShowCalendarForm(false);
        setEventData(null);
      }, 100);
    }, 300);
  };

  const handleCreateEvent = () => {
    if (!eventData || !eventData.title) return;
    
    // Show success toast
    toast.success(`Event "${eventData.title}" has been created!`, {
      description: "Your calendar has been updated.",
      duration: 3000,
    });
    
    // Close form with message
    closeForm(true);
  };

  if (!isVisible || !eventData) return null;

  // Helper to determine if a field should be highlighted
  const isHighlighted = (field: string) => highlightedFields.has(field);

  return (
    <div 
      className={cn(
        "w-full bg-black/40 backdrop-blur-xl rounded-xl shadow-2xl p-4 sm:p-6 border border-white/10 relative",
        "transition-all duration-300 ease-out transform",
        animateIn ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4 pointer-events-none",
      )}
    >
      {/* Decorative elements */}
      <div className="absolute -top-3 left-10 w-20 h-1.5 bg-gradient-to-r from-blue-400 via-purple-400 to-yellow-300 rounded-full"></div>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-yellow-300">
          {eventData.title ? eventData.title : 'New Event'}
        </h3>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-100 text-opacity-70">
            {Math.round(eventData.confidence * 100)}%
          </div>
          <div className="h-1.5 w-20 bg-black/50 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500 ease-out"
              style={{ width: `${getCompletionPercentage()}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* More compact layout - 3 columns on desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {/* Title */}
        <div className={cn(
          "space-y-1 transition-all duration-200 ease-out", 
          animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          "delay-[0ms]"
        )}>
          <label className="block text-xs font-medium text-gray-100 text-opacity-80">
            Event Title
          </label>
          <div className={cn(
            "relative overflow-hidden rounded-lg shadow-sm",
            isHighlighted('title') && "after:absolute after:inset-0 after:bg-gradient-to-r after:from-blue-500/20 after:to-purple-500/20 after:animate-pulse"
          )}>
            <input
              type="text"
              value={eventData.title || ''}
              onChange={(e) => setEventData({ ...eventData, title: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
              placeholder="Meeting with team"
            />
          </div>
        </div>

        {/* Date */}
        <div className={cn(
          "space-y-1 transition-all duration-200 ease-out", 
          animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          "delay-[50ms]"
        )}>
          <label className="block text-xs font-medium text-gray-100 text-opacity-80">
            Date
          </label>
          <div className={cn(
            "relative overflow-hidden rounded-lg shadow-sm",
            isHighlighted('date') && "after:absolute after:inset-0 after:bg-gradient-to-r after:from-blue-500/20 after:to-purple-500/20 after:animate-pulse"
          )}>
            <input
              type="text"
              value={eventData.date || ''}
              onChange={(e) => setEventData({ ...eventData, date: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
              placeholder="MM/DD/YYYY"
            />
          </div>
        </div>

        {/* Time */}
        <div className={cn(
          "space-y-1 sm:col-span-2 lg:col-span-1 transition-all duration-200 ease-out", 
          animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          "delay-[100ms]"
        )}>
          <label className="block text-xs font-medium text-gray-100 text-opacity-80">
            Time
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={eventData.startTime || ''}
              readOnly
              className="w-1/2 px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100"
              placeholder="Start"
            />
            <input
              type="text"
              value={eventData.endTime || ''}
              readOnly
              className="w-1/2 px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100"
              placeholder="End"
            />
          </div>
        </div>

        {/* Location */}
        <div className={cn(
          "space-y-1 sm:col-span-2 transition-all duration-200 ease-out", 
          animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          "delay-[150ms]"
        )}>
          <label className="block text-xs font-medium text-gray-100 text-opacity-80">
            Location
          </label>
          <input
            type="text"
            value={eventData.location || ''}
            readOnly
            className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100"
            placeholder="Location"
          />
        </div>

        {/* Attendees */}
        {eventData.attendees && eventData.attendees.length > 0 && (
          <div className={cn(
            "space-y-1 sm:col-span-2 lg:col-span-1 transition-all duration-200 ease-out", 
            animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
            "delay-[200ms]"
          )}>
            <label className="block text-xs font-medium text-gray-100 text-opacity-80">
              Attendees
            </label>
            <div className="flex flex-wrap gap-1 p-2 rounded-lg bg-black/20 h-[40px] overflow-y-auto">
              {eventData.attendees.map((attendee, index) => (
                <span key={index} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-500/30 text-gray-100 border border-white/10">
                  {attendee}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Description - Only show if there is content */}
      {eventData.description && (
        <div className={cn(
          "space-y-1 mb-4 transition-all duration-200 ease-out",
          animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
          "delay-[250ms]"
        )}>
          <label className="block text-xs font-medium text-gray-100 text-opacity-80">
            Description
          </label>
          <div className={cn(
            "relative overflow-hidden rounded-lg shadow-sm",
            isHighlighted('description') && "after:absolute after:inset-0 after:bg-gradient-to-r after:from-blue-500/20 after:to-purple-500/20 after:animate-pulse"
          )}>
            <textarea
              value={eventData.description || ''}
              readOnly
              rows={2}
              className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-gray-100 resize-none"
              placeholder="Description"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className={cn(
        "flex justify-end space-x-2 transition-all duration-200 ease-out", 
        animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        "delay-[300ms]"
      )}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => closeForm(false)}
          className="text-xs bg-white/10 hover:bg-white/20 text-gray-100 border border-white/20"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleCreateEvent}
          className="text-xs bg-gradient-to-r from-blue-600 to-purple-600"
        >
          Create Event
        </Button>
      </div>
    </div>
  );
} 