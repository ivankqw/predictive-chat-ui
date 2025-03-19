from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any, Union
import os
import openai
from dotenv import load_dotenv
import logging
import json
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Set up clients
# Original OpenAI compatibility client
openai_client = openai.OpenAI(
    base_url="https://api.groq.com/openai/v1", api_key=os.environ.get("GROQ_API_KEY")
)

# Native Groq client (only initialize if we have the SDK installed)
groq_client = None
try:
    from groq import Groq

    groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    logger.info("Groq SDK client initialized successfully")
except ImportError:
    logger.warning("Groq SDK not installed, using only OpenAI compatibility client")
    # If the groq package is not installed, we'll just use the OpenAI compatibility client
    pass

# Initialize JigsawStack for geo search
jigsawstack_api_key = os.environ.get("JIGSAWSTACK_API_KEY")
use_jigsawstack = False
if jigsawstack_api_key:
    try:
        from jigsawstack import JigsawStack

        jigsawstack_client = JigsawStack(api_key=jigsawstack_api_key)
        use_jigsawstack = True
        logger.info("JigsawStack client initialized successfully")
    except ImportError:
        logger.warning("JigsawStack SDK not installed")
        use_jigsawstack = False
else:
    logger.warning("JIGSAWSTACK_API_KEY not set in environment")

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = "qwen-2.5-32b"
# MODEL_NAME = "llama-3.3-70b-versatile"


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: Optional[List[Message]] = None
    message: Optional[str] = None


class ChatResponse(BaseModel):
    message: str


class IntentDetectionRequest(BaseModel):
    text: Optional[str] = None
    message: Optional[str] = None


class CalendarEventData(BaseModel):
    title: Optional[str] = None
    date: Optional[str] = None
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    attendees: Optional[List[str]] = None
    confidence: float


class IntentResponse(BaseModel):
    intent: str
    data: Optional[CalendarEventData] = None
    confidence: float = 0


class PlaceData(BaseModel):
    name: Optional[str] = None
    full_address: Optional[str] = None
    place_formatted: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    poi_category: Optional[List[str]] = None
    coordinates: Optional[List[float]] = None
    confidence: float = 0.0


class PlaceSearchResponse(BaseModel):
    intent: str
    places: Optional[List[PlaceData]] = None
    search_query: Optional[str] = None
    confidence: float = 0.0


# Calendar detection prompt
CALENDAR_DETECTION_PROMPT = """
You are a calendar assistant that helps identify if a message is related to scheduling a calendar event.
Be careful to only identify messages that are CLEARLY requesting to schedule, create, or set up a calendar event.
Only respond with high confidence if the user is clearly asking to schedule an event.

The current date and time is: {current_datetime}

Examples of calendar event requests and expected confidence:
- "Schedule a meeting with John tomorrow at 3pm" (confidence: 0.95)
- "Set up a call with the team on Friday at 2pm" (confidence: 0.95)
- "schedule a meeting" (confidence: 0.95)
- "Create a calendar event for my doctor's appointment next Tuesday" (confidence: 0.95)
- "meeting tomorrow" (confidence: 0.95)
- "remind me about lunch next week" (confidence: 0.75)
- "I need to meet with Sarah" (confidence: 0.95)

Examples of NOT calendar event requests:
- "What time is it?" (confidence: 0)
- "Tell me about AI" (confidence: 0)
- "How's the weather today?" (confidence: 0)
- "create a new document" (confidence: 0)
- "meeting notes" (confidence: 0)
- "I met with John yesterday" (past tense, confidence: 0)

Criteria for detection:
1. The message should contain clear scheduling intent keywords (schedule, create event, set up, plan, etc.)
2. It should contain at least one time reference (tomorrow, next week, at 3pm, etc.)
3. Simple mentions of "meeting" or similar words without scheduling context should have lower confidence

For any calendar event detected, extract the following fields if present:
1. title (string): The title or name of the event
2. date (string): The date of the event (in format MM/DD/YYYY if possible)
3. startTime (string): The start time of the event (in format HH:MM AM/PM if possible)
4. endTime (string): The end time of the event (in format HH:MM AM/PM if possible)
5. location (string): The location of the event
6. description (string): A description of the event
7. attendees (array of strings): Names of people attending the event

Confidence Scoring:
- 0.9-1.0: Very clear calendar event request with most details provided
- 0.7-0.9: Clear calendar intent but with fewer details
- 0.4-0.7: Possible calendar intent but ambiguous or lacking details
- 0.0-0.4: Not a calendar event request

If it's not a calendar event, return "NOT_CALENDAR_EVENT" with confidence 0.

VERY IMPORTANT: You must respond ONLY with valid, properly formatted JSON with NO additional text before or after. 
Do not include any explanations, markdown formatting, or text outside the JSON object itself.
Do not include "json:", "```json", or any other wrapper text. Just output the raw JSON object.

Format your response EXACTLY like this example (with proper JSON syntax):
{{
  "is_calendar_event": true/false,
  "confidence": float between 0 and 1,
  "event_data": {{
    "title": string or null,
    "date": string or null,
    "startTime": string or null,
    "endTime": string or null,
    "location": string or null,
    "description": string or null,
    "attendees": array of strings or null
  }}
}}
"""

# Place search detection prompt
PLACE_SEARCH_PROMPT = """
You are a food and place search assistant that helps identify if a message is related to searching for places to eat in Singapore.
Be careful to only identify messages that are CLEARLY asking about places to eat, restaurants, food establishments, etc. in Singapore.
Only respond with high confidence if the user is clearly asking for food recommendations or places to eat.

Examples of place search requests and expected confidence:
- "Where can I find good satay in Singapore?" (confidence: 0.95)
- "Recommend some restaurants in Singapore" (confidence: 0.95)
- "Where should I eat dinner tonight?" (confidence: 0.95)
- "Best hawker centers in Singapore" (confidence: 0.95)
- "I'm looking for Singaporean cuisine" (confidence: 0.95)
- "Where can I get good chicken rice?" (confidence: 0.95)
- "Food places near Orchard Road" (confidence: 0.95)

Examples of NOT place search requests:
- "What time is it?" (confidence: 0)
- "Tell me about Singapore's history" (confidence: 0)
- "How's the weather in Singapore today?" (confidence: 0)
- "Singapore tourist attractions" (confidence: 0.3)
- "Shopping malls in Singapore" (confidence: 0.3)
- "I ate at a great restaurant yesterday" (past tense, confidence: 0)

Criteria for detection:
1. The message should contain clear food/restaurant search intent
2. It should be about Singapore or assumed to be about Singapore
3. It should be about finding, locating, or recommending places to eat

For any place search detected, extract:
1. search_query (string): A search term that can be used for looking up places (e.g., "satay", "chicken rice", "restaurants in orchard road")
2. location (string, optional): Any specific location mentioned within Singapore (e.g., "Orchard Road", "Chinatown")
3. cuisine (string, optional): Any specific type of cuisine mentioned (e.g., "Chinese", "Indian", "local")

Confidence Scoring:
- 0.9-1.0: Very clear request for places to eat in Singapore
- 0.7-0.9: Clear food search intent but with fewer details
- 0.4-0.7: Possible food search intent but ambiguous
- 0.0-0.4: Not a place search request

If it's not a place search, return is_place_search: false with confidence 0.

VERY IMPORTANT: You must respond ONLY with valid, properly formatted JSON with NO additional text before or after. 
Do not include any explanations, markdown formatting, or text outside the JSON object itself.
Do not include "json:", "```json", or any other wrapper text. Just output the raw JSON object.

Format your response EXACTLY like this example (with proper JSON syntax):
{{
  "is_place_search": true/false,
  "confidence": float between 0 and 1,
  "search_data": {{
    "search_query": string or null,
    "location": string or null,
    "cuisine": string or null
  }}
}}
"""


def extract_json_from_llm_response(response_content: str) -> dict:
    """
    Extract clean JSON from LLM response with multiple fallback mechanisms.

    Args:
        response_content: Raw response content from the LLM

    Returns:
        Parsed JSON as a dictionary or a default empty response
    """
    logger.info(
        f"Attempting to extract JSON from LLM response of length {len(response_content)}"
    )

    # Default response if all parsing fails
    default_response = {"is_calendar_event": False, "confidence": 0, "event_data": {}}

    try:
        # First try: Clean and parse the direct content
        cleaned_response = response_content.strip()

        # Some models might return the JSON with "```json" or similar markers
        # Remove common code block markers
        code_block_patterns = [
            "```json",
            "```",
            "json:",
            "JSON:",
            "Json output:",
            "Response:",
            "Here is the JSON:",
        ]
        for pattern in code_block_patterns:
            if cleaned_response.startswith(pattern):
                cleaned_response = cleaned_response[len(pattern) :].strip()
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3].strip()

        # If it still doesn't look like JSON, try to extract JSON portion
        if not cleaned_response.startswith("{"):
            # Find the first '{' and the last '}'
            start_idx = cleaned_response.find("{")
            end_idx = cleaned_response.rfind("}")

            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                cleaned_response = cleaned_response[start_idx : end_idx + 1]
                logger.info(f"Extracted JSON portion: {cleaned_response}")

        # Parse the cleaned response
        result = json.loads(cleaned_response)
        logger.info(f"Successfully parsed JSON with standard cleaning: {result}")
        return result

    except json.JSONDecodeError as json_err:
        logger.warning(f"Standard JSON parsing failed: {str(json_err)}")

        # Second try: Use regex to find JSON patterns
        try:
            import re

            # This pattern matches a JSON object including nested objects
            json_pattern = r"\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}"
            matches = re.findall(json_pattern, response_content)

            if matches:
                # Try each match, starting with the largest (most likely complete)
                sorted_matches = sorted(matches, key=len, reverse=True)

                for match in sorted_matches:
                    try:
                        result = json.loads(match)
                        logger.info(
                            f"Successfully parsed JSON with regex extraction: {result}"
                        )
                        return result
                    except json.JSONDecodeError:
                        continue

                # If we got here, none of the matches could be parsed
                logger.warning(
                    "Found potential JSON matches with regex, but none could be parsed"
                )
            else:
                logger.warning("No JSON-like structures found with regex")

        except Exception as regex_err:
            logger.warning(f"Regex extraction attempt failed: {str(regex_err)}")

        # Third try: Attempt to clean quotes and special characters
        try:
            # Sometimes models use incorrect quotes or escape characters
            problematic_chars = [
                ("\\n", " "),
                ("\\t", " "),
                ("\\", ""),
                ('"', '"'),
                ('"', '"'),
                ("'", "'"),
            ]
            fixed_response = response_content
            for old, new in problematic_chars:
                fixed_response = fixed_response.replace(old, new)

            # Try to find and extract JSON again
            start_idx = fixed_response.find("{")
            end_idx = fixed_response.rfind("}")

            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                fixed_json = fixed_response[start_idx : end_idx + 1]
                result = json.loads(fixed_json)
                logger.info(
                    f"Successfully parsed JSON after character cleanup: {result}"
                )
                return result

        except Exception as cleanup_err:
            logger.warning(f"Character cleanup attempt failed: {str(cleanup_err)}")

        # If all parsing attempts failed, log the raw content for debugging
        logger.error(
            f"All JSON parsing attempts failed. Raw content: {response_content}"
        )
        return default_response


@app.post("/api/intent-detection")
async def detect_intent(
    request: Request, intent_request: IntentDetectionRequest = None
):
    """
    Enhanced intent detection endpoint with raw request logging
    """
    if not os.environ.get("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Log the raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"
        logger.info(f"Raw request body: {body_str}")

        # Initialize user_text
        user_text = ""

        # Here we have a logical error:
        # "if intent_request is not None or not intent_request" will always be true
        # Let's fix this to check if intent_request is None or empty

        # Enhanced debugging for parsed request data
        logger.info(f"Parsed request data: {intent_request}")

        # Use either text or message field
        user_text = intent_request.text or intent_request.message or ""

        if not user_text:
            logger.error("Neither 'text' nor 'message' field provided in request")
            raise HTTPException(
                status_code=422,
                detail="Request must include either 'text' or 'message' field",
            )

        # Log the user input
        logger.info(f"Intent detection request: '{user_text}'")

        # Count words in the input
        word_count = len(user_text.split())
        logger.info(f"Word count: {word_count}")

        # Skip full detection for very short inputs
        if word_count < 3:
            logger.info(f"Input too short (< 3 words), skipping intent detection")
            return IntentResponse(intent="none", data=None, confidence=0)

        # Get current date and time
        current_datetime = datetime.now().strftime("%A, %B %d, %Y %I:%M %p")

        # Format the prompt with current datetime
        formatted_prompt = CALENDAR_DETECTION_PROMPT.format(
            current_datetime=current_datetime
        )

        # Construct the messages for the API call
        messages = [
            {"role": "system", "content": formatted_prompt},
            {"role": "user", "content": user_text},
        ]

        # Use groq_client if available (native SDK), otherwise fallback to OpenAI compatibility
        if groq_client is not None and MODEL_NAME == "qwen-2.5-32b":
            logger.info("Using native Groq SDK for intent detection with Qwen model")
            try:
                # Call using native Groq SDK
                completion = groq_client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,  # Lower temperature for more predictable outputs
                    max_tokens=1024,  # Ensure we have enough tokens for the full JSON response
                    top_p=0.9,  # Control for diversity - slightly more focused
                )

                # Parse the response
                response_content = completion.choices[0].message.content
                logger.info(f"LLM response (Groq SDK): {response_content}")

            except Exception as groq_err:
                logger.error(f"Error using Groq SDK: {str(groq_err)}")
                # If Groq SDK fails, fall back to OpenAI compatibility
                logger.info("Falling back to OpenAI compatibility client")
                completion = openai_client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
                response_content = completion.choices[0].message.content
                logger.info(f"LLM response (OpenAI fallback): {response_content}")

        else:
            # Use the OpenAI compatibility client
            logger.info("Using OpenAI compatibility client for intent detection")
            completion = openai_client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                response_format={"type": "json_object"},
            )

            # Parse the response
            response_content = completion.choices[0].message.content
            logger.info(f"LLM response: {response_content}")

        # Use our helper function to extract the JSON
        result = extract_json_from_llm_response(response_content)
        logger.info(f"Extracted JSON result: {result}")

        # Check response structure with detailed logging
        is_calendar_event = result.get("is_calendar_event", False)
        logger.info(f"is_calendar_event: {is_calendar_event}")

        if is_calendar_event:
            event_data = result.get("event_data", {})
            # Get confidence from either top-level or inside event_data
            confidence = result.get("confidence", 0)
            if confidence == 0 and isinstance(event_data, dict):
                # Some LLM responses might include confidence in event_data
                confidence = event_data.get("confidence", 0)

            logger.info(f"Confidence value extracted: {confidence}")

            if not event_data:
                logger.warning("Missing event_data in LLM response")

            logger.info(f"Calendar event detected with confidence: {confidence}")
            logger.info(f"Event data: {event_data}")

            # Only show form for medium-to-high confidence (0.5+)
            if confidence >= 0.5:
                logger.info("Confidence threshold met, returning calendar event")

                # Create response with detailed logging of each field
                try:
                    # Apply confidence from outer scope if not present in event_data
                    if isinstance(event_data, dict) and "confidence" not in event_data:
                        event_data["confidence"] = confidence

                    calendar_event_data = CalendarEventData(
                        title=event_data.get("title"),
                        date=event_data.get("date"),
                        startTime=event_data.get("startTime"),
                        endTime=event_data.get("endTime"),
                        location=event_data.get("location"),
                        description=event_data.get("description"),
                        attendees=event_data.get("attendees"),
                        confidence=confidence,
                    )
                    logger.info(f"Created CalendarEventData: {calendar_event_data}")

                    # Return response that matches the frontend expectation
                    return IntentResponse(
                        intent="calendar_event",
                        data=calendar_event_data,
                        confidence=confidence,
                    )
                except Exception as validation_err:
                    logger.error(
                        f"Error creating CalendarEventData: {str(validation_err)}"
                    )
                    raise HTTPException(
                        status_code=500,
                        detail=f"Error creating calendar event data: {str(validation_err)}",
                    )
            else:
                logger.info(
                    f"Confidence too low ({confidence}), not treating as calendar event"
                )
        else:
            logger.info("Not a calendar event according to detection")

        # Default response if not a calendar event or confidence is too low
        logger.info("Returning default 'not a calendar event' response")
        return IntentResponse(intent="none", data=None, confidence=0)

    except Exception as e:
        logger.error(f"Error detecting intent: {str(e)}", exc_info=True)
        print(f"Error detecting intent: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error detecting intent: {str(e)}")


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: Request, chat_request: ChatRequest = None):
    """
    Enhanced chat endpoint with raw request logging and better message handling
    """
    if not os.environ.get("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Log the raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"
        logger.info(f"Raw chat request body: {body_str}")

        # Enhanced debugging
        logger.info(f"Parsed chat request data: {chat_request}")

        formatted_messages = []

        # Handle two possible request formats:
        # 1. A list of messages (original format)
        # 2. A single message (new format from frontend)
        if chat_request.messages:
            # Log the received messages for debugging
            logger.info(f"Messages received: {chat_request.messages}")
            logger.info(f"Message count: {len(chat_request.messages)}")
            logger.info(f"Message types: {[msg.role for msg in chat_request.messages]}")

            # Format messages for the LLM API from message list
            formatted_messages = [
                {"role": msg.role, "content": msg.content}
                for msg in chat_request.messages
            ]
            logger.info(f"Formatted message count: {len(formatted_messages)}")
        elif chat_request.message:
            # Create a single user message
            formatted_messages = [{"role": "user", "content": chat_request.message}]
            logger.info(f"Created single message: {formatted_messages}")
        else:
            logger.error("No messages or message field provided in parsed request")
            raise HTTPException(
                status_code=422,
                detail="Request must include either 'messages' or 'message' field",
            )

        # Add a system message if not present
        if not any(msg["role"] == "system" for msg in formatted_messages):
            formatted_messages.insert(
                0,
                {
                    "role": "system",
                    "content": "You are a helpful assistant that provides concise and accurate information. If the user asks about events, refer to the chat history and retrieve responses from there.",
                },
            )

        # Log detailed information about formatted messages
        logger.info(f"Final message count: {len(formatted_messages)}")
        logger.info(
            f"Final message structure: {[(msg['role'], len(msg['content'])) for msg in formatted_messages]}"
        )

        # Log full messages for debugging
        for i, msg in enumerate(formatted_messages):
            logger.info(
                f"Message {i} - Role: {msg['role']}, Content: {msg['content'][:100]}..."
            )

        # Decide which client to use
        chat_model = MODEL_NAME  # Use the globally defined model

        if groq_client is not None:
            logger.info(f"Using native Groq SDK for chat with model: {chat_model}")
            try:
                # Call using native Groq SDK
                completion = groq_client.chat.completions.create(
                    model=chat_model,
                    messages=formatted_messages,
                    temperature=0.5,
                    max_tokens=1024,  # Ensure we have enough tokens for comprehensive responses
                    top_p=1.0,  # Allow full diversity for conversational responses
                )

                # Extract the response
                assistant_message = completion.choices[0].message.content
                logger.info(
                    f"LLM response received (Groq SDK), length: {len(assistant_message)}"
                )

            except Exception as groq_err:
                logger.error(f"Error using Groq SDK for chat: {str(groq_err)}")
                # If Groq SDK fails, fall back to OpenAI compatibility
                logger.info("Falling back to OpenAI compatibility client for chat")
                completion = openai_client.chat.completions.create(
                    model=chat_model, messages=formatted_messages
                )
                assistant_message = completion.choices[0].message.content
                logger.info(
                    f"LLM response received (OpenAI fallback), length: {len(assistant_message)}"
                )
        else:
            # Use OpenAI compatibility client
            logger.info(
                f"Using OpenAI compatibility client for chat with model: {chat_model}"
            )
            completion = openai_client.chat.completions.create(
                model=chat_model, messages=formatted_messages
            )
            assistant_message = completion.choices[0].message.content
            logger.info(
                f"LLM response received (OpenAI compatibility), length: {len(assistant_message)}"
            )

        return ChatResponse(message=assistant_message)

    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error processing chat request: {str(e)}"
        )


@app.get("/")
async def health_check():
    return {"status": "ok"}


@app.post("/api/debug/echo")
async def debug_echo(request: Request):
    """
    Debug endpoint that echoes back the raw request body
    """
    try:
        # Get raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"

        # Try to parse as JSON for prettier output
        try:
            body_json = json.loads(body_str)
            return {
                "received_raw": body_str,
                "parsed_json": body_json,
                "content_type": request.headers.get("content-type"),
                "headers": dict(request.headers),
            }
        except:
            # Return raw if not valid JSON
            return {
                "received_raw": body_str,
                "content_type": request.headers.get("content-type"),
                "headers": dict(request.headers),
            }
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/debug/intent-simulation")
async def debug_intent_simulation(request: Request):
    """
    Debug endpoint that simulates intent detection with a predefined response
    """
    try:
        # Get raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"

        # Log incoming request for debugging
        logger.info(f"Intent simulation request: {body_str}")

        # Sample calendar event data
        sample_event = {
            "title": "Test Meeting",
            "date": "05/20/2024",
            "startTime": "10:00 AM",
            "endTime": "11:00 AM",
            "location": "Conference Room",
            "description": "Discussing test results",
            "attendees": ["John", "Jane"],
            "confidence": 0.85,
        }

        # Return a simulated positive intent detection
        return IntentResponse(
            intent="calendar_event",
            data=CalendarEventData(**sample_event),
            confidence=0.85,
        )
    except Exception as e:
        logger.error(f"Error in intent simulation: {str(e)}")
        return {"error": str(e)}


@app.post("/api/debug/chat-echo")
async def debug_chat_echo(request: Request):
    """
    Debug endpoint to echo back exactly what was received from the frontend
    for the chat endpoint, with detailed message structure analysis.
    """
    try:
        # Log the raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"
        logger.info(f"Debug echo raw body: {body_str}")

        # Parse the JSON body directly
        try:
            json_body = json.loads(body_str)
            # Analyze message structure
            analysis = {
                "received": json_body,
                "message_count": (
                    len(json_body.get("messages", [])) if "messages" in json_body else 0
                ),
                "message_roles": (
                    [msg.get("role") for msg in json_body.get("messages", [])]
                    if "messages" in json_body
                    else []
                ),
                "single_message": json_body.get("message", None),
                "raw_structure": str(type(json_body)),
            }

            logger.info(f"Debug echo analysis: {analysis}")

            # Return both the raw data and the analysis
            return {
                "raw_data": json_body,
                "analysis": analysis,
                "timestamp": datetime.now().isoformat(),
            }
        except json.JSONDecodeError as e:
            return {
                "error": f"Invalid JSON: {str(e)}",
                "raw_body": body_str,
                "timestamp": datetime.now().isoformat(),
            }

    except Exception as e:
        logger.error(f"Error in debug echo endpoint: {str(e)}", exc_info=True)
        return {
            "error": f"Error processing request: {str(e)}",
            "timestamp": datetime.now().isoformat(),
        }


@app.post("/api/place-search-intent")
async def detect_place_search_intent(
    request: Request, intent_request: IntentDetectionRequest = None
):
    """
    Endpoint to detect place search intent from user messages
    """
    if not os.environ.get("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="API key not configured")

    try:
        # Log the raw request body
        raw_body = await request.body()
        body_str = raw_body.decode("utf-8") if raw_body else "Empty body"
        logger.info(f"Raw request body: {body_str}")

        # Initialize user_text
        user_text = ""

        # Enhanced debugging for parsed request data
        logger.info(f"Parsed request data: {intent_request}")

        # Use either text or message field
        user_text = intent_request.text or intent_request.message or ""

        if not user_text:
            logger.error("Neither 'text' nor 'message' field provided in request")
            raise HTTPException(
                status_code=422,
                detail="Request must include either 'text' or 'message' field",
            )

        # Log the user input
        logger.info(f"Place search intent detection request: '{user_text}'")

        # Count words in the input
        word_count = len(user_text.split())
        logger.info(f"Word count: {word_count}")

        # Skip full detection for very short inputs
        if word_count < 3:
            logger.info(f"Input too short (< 3 words), skipping intent detection")
            return PlaceSearchResponse(intent="none", places=None, confidence=0)

        # Construct the messages for the API call
        messages = [
            {"role": "system", "content": PLACE_SEARCH_PROMPT},
            {"role": "user", "content": user_text},
        ]

        # Use groq_client if available (native SDK), otherwise fallback to OpenAI compatibility
        if groq_client is not None and MODEL_NAME == "qwen-2.5-32b":
            logger.info(
                "Using native Groq SDK for place search intent detection with Qwen model"
            )
            try:
                # Call using native Groq SDK
                completion = groq_client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.1,
                    max_tokens=1024,
                    top_p=0.9,
                )

                # Parse the response
                response_content = completion.choices[0].message.content
                logger.info(f"LLM response (Groq SDK): {response_content}")

            except Exception as groq_err:
                logger.error(f"Error using Groq SDK: {str(groq_err)}")
                # If Groq SDK fails, fall back to OpenAI compatibility
                logger.info("Falling back to OpenAI compatibility client")
                completion = openai_client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    response_format={"type": "json_object"},
                )
                response_content = completion.choices[0].message.content
                logger.info(f"LLM response (OpenAI fallback): {response_content}")

        else:
            # Use the OpenAI compatibility client
            logger.info(
                "Using OpenAI compatibility client for place search intent detection"
            )
            completion = openai_client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages,
                response_format={"type": "json_object"},
            )

            # Parse the response
            response_content = completion.choices[0].message.content
            logger.info(f"LLM response: {response_content}")

        # Use our helper function to extract the JSON
        result = extract_json_from_llm_response(response_content)
        logger.info(f"Extracted JSON result: {result}")

        # Check response structure with detailed logging
        is_place_search = result.get("is_place_search", False)
        logger.info(f"is_place_search: {is_place_search}")

        if is_place_search:
            search_data = result.get("search_data", {})
            confidence = result.get("confidence", 0)

            logger.info(f"Confidence value extracted: {confidence}")
            logger.info(f"Search data: {search_data}")

            # Only process for medium-to-high confidence (0.6+)
            if confidence >= 0.6 and search_data and search_data.get("search_query"):
                search_query = search_data.get("search_query", "")

                # Call JigsawStack API to get place results if available
                places_results = []

                if use_jigsawstack:
                    try:
                        logger.info(
                            f"Calling JigsawStack with search query: {search_query}"
                        )
                        result = jigsawstack_client.geo.search(
                            {
                                "search_value": search_query,
                                "country_code": "SGP",  # Singapore country code
                            }
                        )

                        logger.info(f"JigsawStack response: {result}")

                        if result.get("success") and result.get("data"):
                            # Transform JigsawStack data into our PlaceData format
                            for place in result["data"]:
                                try:
                                    coordinates = None
                                    if place.get("geoloc") and place["geoloc"].get(
                                        "coordinates"
                                    ):
                                        coordinates = place["geoloc"]["coordinates"]

                                    website = None
                                    phone = None
                                    if place.get(
                                        "addtional_properties"
                                    ):  # Note: API has a typo in "additional"
                                        website = place["addtional_properties"].get(
                                            "website"
                                        )
                                        phone = place["addtional_properties"].get(
                                            "phone"
                                        )

                                    places_results.append(
                                        PlaceData(
                                            name=place.get("name", "Unknown"),
                                            full_address=place.get("full_address", ""),
                                            place_formatted=place.get(
                                                "place_formatted", ""
                                            ),
                                            phone=phone,
                                            website=website,
                                            poi_category=place.get("poi_category"),
                                            coordinates=coordinates,
                                            confidence=confidence,
                                        )
                                    )
                                except Exception as e:
                                    logger.error(
                                        f"Error processing place data: {str(e)}"
                                    )
                    except Exception as e:
                        logger.error(f"Error calling JigsawStack API: {str(e)}")
                else:
                    # Mock data for testing when JigsawStack is not available
                    logger.info("Using mock place data (JigsawStack not available)")
                    places_results = [
                        PlaceData(
                            name="Maxwell Food Centre",
                            full_address="1 Kadayanallur St, Singapore 069184",
                            place_formatted="Singapore 069184",
                            phone="+65 6225 5632",
                            website="https://www.facebook.com/MaxwellFoodCentre/",
                            poi_category=[
                                "hawker center",
                                "food court",
                                "local cuisine",
                            ],
                            coordinates=[103.8455, 1.2800],
                            confidence=confidence,
                        ),
                        PlaceData(
                            name="Lau Pa Sat",
                            full_address="18 Raffles Quay, Singapore 048582",
                            place_formatted="Singapore 048582",
                            phone="+65 6220 2138",
                            website="https://laupasat.sg/",
                            poi_category=[
                                "hawker center",
                                "food court",
                                "historical site",
                            ],
                            coordinates=[103.8503, 1.2809],
                            confidence=confidence,
                        ),
                        PlaceData(
                            name="Newton Food Centre",
                            full_address="500 Clemenceau Ave North, Singapore 229495",
                            place_formatted="Singapore 229495",
                            phone=None,
                            website=None,
                            poi_category=[
                                "hawker center",
                                "food court",
                                "local cuisine",
                            ],
                            coordinates=[103.8387, 1.3138],
                            confidence=confidence,
                        ),
                    ]

                # Return places found
                return PlaceSearchResponse(
                    intent="place_search",
                    places=places_results,
                    search_query=search_query,
                    confidence=confidence,
                )
            else:
                logger.info(
                    f"Confidence too low ({confidence}) or missing search query"
                )

        # Return no intent if not a place search or low confidence
        return PlaceSearchResponse(intent="none", confidence=0)

    except Exception as e:
        logger.error(f"Error in place search intent detection: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error processing place search intent: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn

    # Fix: Use an import string instead of passing the app directly
    uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=4, reload=True)
