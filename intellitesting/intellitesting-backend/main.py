from fastapi import FastAPI, HTTPException
from schemas import (
    TestGenerationRequest, 
    TestGenerationResponse, 
    TestExecutionRequest, 
    TestExecutionResponse
)
from services.test_generation import TestGenerationService
from services.test_execution import TestExecutionService
import uvicorn

app = FastAPI()

@app.post("/generate_tests", response_model=TestGenerationResponse)
async def generate_tests(request: TestGenerationRequest):
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
            chat_history=request.chat_history
        )
        
        if "error" in result:
             return TestGenerationResponse(
                status="error",
                error_message=result["error"]
            )

        return TestGenerationResponse(
            status="success",
            test_code=result["test_code"],
            suggested_file_path=result["suggested_file_path"]
        )

    except Exception as e:
        return TestGenerationResponse(
            status="error",
            error_message=str(e)
        )

@app.post("/run_tests", response_model=TestExecutionResponse)
async def run_tests(request: TestExecutionRequest):
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
    uvicorn.run(app, host="127.0.0.1", port=8000)