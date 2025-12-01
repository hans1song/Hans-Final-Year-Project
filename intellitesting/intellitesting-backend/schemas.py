from pydantic import BaseModel
from typing import Optional, Dict, Any, List

class SelectionRange(BaseModel):
    """Defines the line range of the user's selection."""
    start: int
    end: int

class TestGenerationRequest(BaseModel):
    """
    Defines the structure for the incoming request to the /generate_tests endpoint.
    """
    file_content: str
    file_path: Optional[str] = None
    selected_code: str
    selection_range: SelectionRange
    language: str
    configuration: Dict[str, Any]
    framework: str
    instruction: Optional[str] = None
    chat_history: Optional[List[Dict[str, str]]] = []

class TestGenerationResponse(BaseModel):
    """
    Defines the structure for the outgoing response from the /generate_tests endpoint.
    """
    status: str
    test_code: Optional[str] = None
    suggested_file_path: Optional[str] = None
    error_message: Optional[str] = None

class TestExecutionRequest(BaseModel):
    """
    Defines the structure for the incoming request to the /run_tests endpoint.
    """
    test_code: str
    language: str

class TestExecutionResponse(BaseModel):
    """
    Defines the structure for the outgoing response from the /run_tests endpoint.
    """
    stdout: Optional[str] = ""
    stderr: Optional[str] = ""
    exit_code: Optional[int] = None
    passed: bool
    error_message: Optional[str] = None