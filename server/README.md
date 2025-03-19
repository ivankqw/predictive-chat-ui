# Vibes Chat Interface - Backend

This is the backend component of the Vibes Chat Interface project, built with FastAPI and integrated with Groq's LLM API.

## Setup

1. Create a virtual environment (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file and ensure your Groq API key is properly set.

4. Test your Groq installation and API key:
   ```bash
   python test_groq.py
   ```
   This script tests your Groq SDK installation, API key validity, and JSON extraction capabilities.

5. Run the server:
   ```bash
   python main.py
   ```
   
   The server will start on http://localhost:8000

## API Endpoints

- `GET /`: Health check endpoint
- `POST /api/chat`: Main chat endpoint
  - Request body:
    ```json
    {
      "messages": [
        {
          "role": "user",
          "content": "Hello, how are you?"
        }
      ]
    }
    ```
  - Response:
    ```json
    {
      "message": "I'm doing well, thank you for asking! How can I help you today?"
    }
    ```
- `POST /api/intent-detection`: Detects calendar event intent from user messages
  - Request body:
    ```json
    {
      "message": "Schedule a meeting tomorrow at 3pm"
    }
    ```
  - Response (for detected calendar event):
    ```json
    {
      "intent": "calendar_event",
      "data": {
        "title": "Meeting",
        "date": "05/28/2024",
        "startTime": "3:00 PM",
        "endTime": null,
        "location": null,
        "description": null,
        "attendees": null,
        "confidence": 0.85
      },
      "confidence": 0.85
    }
    ```

## Key Components

- FastAPI for the web server framework
- Groq's LLama 3.3 70B model for chat capabilities
- Groq's Qwen 2.5 32B model for intent detection
- Dual client implementation:
  - Native Groq SDK (preferred)
  - OpenAI-compatible client (fallback)

## Implementation Details

- The application uses the native Groq SDK when available, falling back to the OpenAI compatibility client if needed
- Enhanced JSON parsing with multiple fallback mechanisms for robust handling of model responses
- Detailed logging for debugging and tracing request/response flow
- Automatic error handling and recovery

## Debug Endpoints

- `POST /api/debug/echo`: Returns the raw request body, useful for debugging frontend-to-backend communication
- `POST /api/debug/intent-simulation`: Simulates a positive calendar event detection, useful for testing UI components

## Future Development

- Intent detection for more use cases beyond calendar events  
- More structured output formats
- Integration with additional APIs for task-specific functionalities 

# Vibes Server - Backend Performance Recommendations

This document outlines recommended improvements for the backend API, particularly for the intent detection endpoint.

## Current Implementation

The `/api/intent-detection` endpoint processes user input to detect intents, primarily calendar events, using the Groq API with a fallback to OpenAI's compatibility client.

## Recommended Backend Performance Improvements

### 1. Optimize API Key Validation

**Current Behavior**: The endpoint checks for the `GROQ_API_KEY` environment variable on every request.

**Improvement**: Move this check to server startup. Validate the API key once when the application initializes and throw an error if it's missing.

```python
@app.on_event("startup")
async def startup_event():
    if not os.environ.get("GROQ_API_KEY"):
        raise RuntimeError("API key not configured")
```

### 2. Reduce Logging Overhead

**Current Behavior**: The endpoint logs the raw request body and other details on every request.

**Improvement**: Enable verbose logging only in debug mode:

```python
if os.environ.get("DEBUG", "False").lower() == "true":
    logger.info(f"Raw request body: {body_str}")
```

### 3. Enhance Input Validation

**Current Behavior**: The code checks if user_text is empty and skips detection for inputs with fewer than 3 words.

**Improvement**: Strengthen validation with better heuristics:

```python
user_text = user_text.strip()
if not user_text or len(user_text) < 10:
    raise HTTPException(status_code=422, detail="Input too short or empty")
```

### 4. Cache Common Responses

**Current Behavior**: Every request triggers a new API call to Groq or OpenAI.

**Improvement**: Implement caching for frequently occurring inputs:

```python
import redis
cache = redis.Redis(host='localhost', port=6379, db=0)

cache_key = f"intent:{user_text}"
cached_result = cache.get(cache_key)
if cached_result:
    return IntentResponse(**json.loads(cached_result))
# After computing result
cache.setex(cache_key, 3600, json.dumps(result.dict()))  # Cache for 1 hour
```

### 5. Optimize Model Parameters

**Current Behavior**: The API call uses fixed parameters (temperature=0.1, max_tokens=1024, top_p=0.9).

**Improvement**: Adjust parameters for better performance:

```python
completion = groq_client.chat.completions.create(
    model=MODEL_NAME,
    messages=messages,
    response_format={"type": "json_object"},
    temperature=0.05,  # Lower for more deterministic outputs
    max_tokens=256,    # Reduced for faster responses
    top_p=0.95,
)
```

### 6. Asynchronous Processing for Long Tasks

**Current Behavior**: The endpoint processes requests synchronously.

**Improvement**: Use background tasks for intent detection:

```python
from fastapi import BackgroundTasks

async def process_intent(user_text: str, task_id: str):
    # Intent detection logic here
    result = await detect_intent_logic(user_text)
    # Store result somewhere (e.g., Redis)
    cache.set(task_id, json.dumps(result.dict()))

@app.post("/api/intent-detection")
async def detect_intent(request: Request, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    background_tasks.add_task(process_intent, user_text, task_id)
    return {"task_id": task_id, "status": "processing"}
```

### 7. Robust Error Handling

**Current Behavior**: Errors are logged and raised as HTTP exceptions.

**Improvement**: Add retry logic for transient API failures:

```python
from tenacity import retry, stop_after_attempt, wait_fixed

@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
async def call_groq_api(messages):
    return groq_client.chat.completions.create(messages=messages, ...)
```

## Implementation Priority

1. Start with the quick wins: API key validation at startup and increased debounce time
2. Implement input validation improvements
3. Add caching for common responses
4. Optimize model parameters
5. Add asynchronous processing and retries for more complex scenarios

## Required Dependencies

For implementing these recommendations, you'll need to add:

```bash
pip install redis tenacity
```

Add these to your requirements.txt file. 