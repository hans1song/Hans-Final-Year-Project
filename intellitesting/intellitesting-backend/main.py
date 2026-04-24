from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from schemas import (
    TestGenerationRequest,
    TestGenerationResponse,
    TestExecutionRequest,
    TestExecutionResponse
)
from services.test_generation import TestGenerationService
from services.test_execution import TestExecutionService
import uvicorn
import os
from datetime import date

app = FastAPI()

# CORS — allow VS Code extension to call from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

# In-memory rate limiter: { ip: (count, date_str) }
rate_limit_store: dict[str, tuple[int, str]] = {}
DAILY_LIMIT = 10

def check_rate_limit(ip: str) -> bool:
    """Returns True if request is allowed, False if rate limited."""
    today = date.today().isoformat()
    if ip not in rate_limit_store or rate_limit_store[ip][1] != today:
        rate_limit_store[ip] = (1, today)
        return True
    count, _ = rate_limit_store[ip]
    if count >= DAILY_LIMIT:
        return False
    rate_limit_store[ip] = (count + 1, today)
    return True

@app.post("/generate_tests", response_model=TestGenerationResponse)
async def generate_tests(request: TestGenerationRequest, raw_request: Request):
    # Extract optional user API key from header
    user_api_key = raw_request.headers.get("X-Gemini-Api-Key")

    # Rate limit only if user is not using their own key
    if not user_api_key:
        client_ip = raw_request.client.host if raw_request.client else "unknown"
        if not check_rate_limit(client_ip):
            raise HTTPException(
                status_code=429,
                detail=f"Daily limit of {DAILY_LIMIT} requests reached. Provide your own Gemini API key in extension settings to remove this limit."
            )

    try:
        result = TestGenerationService.generate_tests(
            file_content=request.file_content,
            selected_code=request.selected_code,
            selection_range=request.selection_range,
            language=request.language,
            framework=request.framework,
            configuration=request.configuration,
            file_path=request.file_path,
            instruction=request.instruction,
            specification=request.specification,
            chat_history=request.chat_history,
            api_key=user_api_key
        )

        if "error" in result:
             return TestGenerationResponse(
                status="error",
                error_message=result["error"]
            )

        return TestGenerationResponse(
            status="success",
            imports_and_setup=result.get("imports_and_setup"),
            test_cases=result.get("test_cases"),
            suggested_file_path=result.get("suggested_file_path"),
            interactive_questions=result.get("interactive_questions"),
            proposed_plan=result.get("proposed_plan")
        )

    except Exception as e:
        return TestGenerationResponse(
            status="error",
            error_message=str(e)
        )

@app.post("/run_tests", response_model=TestExecutionResponse)
async def run_tests(request: TestExecutionRequest):
    # Disable remote test execution in production (security)
    if os.getenv("DISABLE_TEST_EXECUTION", "false") == "true":
        raise HTTPException(status_code=403, detail="Remote test execution is disabled. Tests run locally via the extension.")

    try:
        result = TestExecutionService.execute_tests(
            language=request.language,
            test_code=request.test_code
        )

        if "error" in result:
             return TestExecutionResponse(
                passed=False,
                error_message=result["error"],
                stdout=result.get("stdout", ""),
                stderr=result.get("stderr", "")
            )

        return TestExecutionResponse(
            passed=result["passed"],
            stdout=result["stdout"],
            stderr=result["stderr"],
            exit_code=result["exit_code"]
        )

    except Exception as e:
        return TestExecutionResponse(
            passed=False,
            error_message=str(e)
        )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
