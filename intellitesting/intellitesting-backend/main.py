
import time
import os
from fastapi import FastAPI, Request, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from schemas import TestGenerationRequest, TestGenerationResponse
from ai_service import generate_tests_for_code

# --- Security Placeholder ---
# In a production environment, use a more robust method for API key management.
API_KEY = os.getenv("API_KEY", "default-secret-key")

def verify_api_key(x_api_key: str = Header(None)):
    """
    Dependency to verify the API key provided in the request header.
    """
    if not x_api_key or x_api_key != API_KEY:
        # This is a placeholder for a secure API Gateway & Security check.
        raise HTTPException(status_code=401, detail="Invalid or missing API Key")
    return x_api_key

# --- FastAPI App Initialization ---
app = FastAPI(
    title="IntelliTesting AI Backend",
    description="An AI service to generate unit tests for code snippets.",
    version="1.0.0"
)

# --- Middleware for Performance Monitoring ---
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """
    Middleware to add a custom X-Process-Time header to all responses,
    indicating the total time taken to process the request.
    """
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = f"{process_time:.4f} sec"
    return response

# --- API Endpoint ---
@app.post("/generate_tests", 
          response_model=TestGenerationResponse,
          summary="Intelligent Test Generation",
          tags=["AI Test Generation"])
async def generate_tests_endpoint(request: TestGenerationRequest):
    """
    Receives code context, invokes the AI module, and returns generated test code.
    
    - **F-01**: Receives `selected_code`, `language`, `configuration`.
    - **F-02**: Utilizes an LLM to intelligently generate a `test_code`.
    - **Reliability**: Handles exceptions and returns appropriate error responses.
    """
    try:
        # Performance: Start timing the core AI logic.
        ai_start_time = time.time()

        result = generate_tests_for_code(
            selected_code=request.selected_code,
            configuration=request.configuration,
            framework=request.framework,
            language=request.language
        )
        
        ai_duration = time.time() - ai_start_time
        print(f"AI generation took: {ai_duration:.2f}s") # Logging for performance monitoring

        # Check if generation time exceeds the performance target.
        if ai_duration > 120: # 2-minute threshold
            # This could be logged to a monitoring service.
            print(f"Warning: Test generation time ({ai_duration:.2f}s) exceeded the 2-minute target.")

        return TestGenerationResponse(
            status="success",
            test_code=result["test_code"],
            suggested_file_path=result["suggested_file_path"]
        )

    except Exception as e:
        # Non-Crashing Integration: Catch all exceptions and return a 500 error.
        print(f"Error during test generation: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "error_message": f"An internal error occurred: {str(e)}"
            }
        )

# --- Root Endpoint for Health Check ---
@app.get("/", tags=["Health Check"])
def read_root():
    """
    A simple health check endpoint.
    """
    return {"status": "IntelliTesting AI Backend is running"}

