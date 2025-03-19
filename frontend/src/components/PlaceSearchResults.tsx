'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Message } from '@/app/page';
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ExternalLink } from 'lucide-react';

interface PlaceData {
  name: string;
  full_address: string;
  place_formatted: string;
  phone?: string;
  website?: string;
  poi_category?: string[];
  coordinates?: [number, number];
  confidence: number;
}

interface PlaceSearchResultsProps {
  places: PlaceData[] | null;
  isVisible: boolean;
  setShowPlaceResults: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  searchQuery: string;
  resetChatInput: () => void;
}

export default function PlaceSearchResults({
  places,
  isVisible,
  setShowPlaceResults,
  setMessages,
  searchQuery,
  resetChatInput
}: PlaceSearchResultsProps) {
  const [animateIn, setAnimateIn] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Animation effect when results become visible
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

  // Clean form closure with animation
  const closeResults = (addMessage = false) => {
    setIsClosing(true);
    setAnimateIn(false);

    setTimeout(() => {
      if (addMessage && places && places.length > 0) {
        // Add a message showing what places were found
        const placeNames = places.slice(0, 3).map(place => place.name).join(', ');
        const moreText = places.length > 3 ? ` and ${places.length - 3} more` : '';

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Here are some places I found for "${searchQuery}": ${placeNames}${moreText}.`
        }]);
      }

      resetChatInput();

      // Wait for message to be added before hiding results to prevent UI jank
      setTimeout(() => {
        setShowPlaceResults(false);
      }, 100);
    }, 300);
  };

  // Format a specific place for display
  const openInMaps = (place: PlaceData) => {
    if (place.coordinates) {
      const [lng, lat] = place.coordinates;
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');

      // Show success toast
      toast.success(`Opening ${place.name} in Google Maps`, {
        description: "Map opened in a new tab",
        duration: 3000,
      });

      // Close results with message
      closeResults(true);
    }
  };

  if (!isVisible || !places || places.length === 0) return null;

  return (
    <div
      className={cn(
        "w-full bg-black/40 backdrop-blur-xl rounded-xl shadow-2xl p-4 sm:p-6 border border-white/10 relative",
        "transition-all duration-300 ease-out transform",
        animateIn ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4 pointer-events-none",
      )}
    >
      {/* Decorative elements */}
      <div className="absolute -top-3 left-10 w-20 h-1.5 bg-gradient-to-r from-orange-400 via-red-400 to-purple-400 rounded-full"></div>

      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-purple-400">
          Places in Singapore
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-400 hover:text-gray-300"
          onClick={() => closeResults(false)}
        >
          Close
        </Button>
      </div>

      {/* Search query */}
      <div className="mb-4 text-sm text-gray-400">
        Search results for: <span className="text-gray-200">{searchQuery}</span>
      </div>

      {/* Place results */}
      <div className="space-y-4">
        {places.map((place, index) => (
          <div
            key={index}
            className={cn(
              "p-4 rounded-lg border border-white/10 bg-black/30 transition-all duration-200 ease-out",
              animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
              `delay-[${index * 50}ms]`
            )}
          >
            <div className="flex justify-between">
              <div>
                <h4 className="font-medium text-gray-100">{place.name}</h4>
                <p className="text-sm text-gray-400 mt-1">{place.full_address}</p>

                {place.poi_category && place.poi_category.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {place.poi_category.map((category, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300"
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-2 space-x-2">
                  {place.phone && (
                    <a
                      href={`tel:${place.phone}`}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      {place.phone}
                    </a>
                  )}

                  {place.website && (
                    <a
                      href={place.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline inline-flex items-center"
                    >
                      Website <ExternalLink size={12} className="ml-1" />
                    </a>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="border-orange-500/30 text-orange-400 hover:bg-orange-500/20"
                onClick={() => openInMaps(place)}
              >
                Open Maps
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 flex justify-end">
        <Button
          variant="default"
          size="sm"
          className="bg-gradient-to-r from-orange-600 to-purple-600"
          onClick={() => closeResults(true)}
        >
          Show in Chat
        </Button>
      </div>
    </div>
  );
} 