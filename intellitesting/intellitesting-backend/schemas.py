from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class AgentOutput(BaseModel):
    """
    Structured output from the Test Generation Agent.
    """
    explanation: str = Field(description="A brief Markdown explanation of the generated tests and strategy.")
    interactive_questions: Optional[List[str]] = Field(default=[], description="A list of questions for the developer to clarify ambiguities or edge cases.")
    test_code: str = Field(description="The complete, compilable unit test source code.")
    # file_path_suggestion is handled by strategy logic, but we can let LLM suggest too if needed.
    # For now, let's keep path logic deterministic in Python code.

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
    specification: Optional[str] = None
    chat_history: Optional[List[Dict[str, str]]] = []

class TestGenerationResponse(BaseModel):
    """
    Defines the structure for the outgoing response from the /generate_tests endpoint.
    """
    status: str
    test_code: Optional[str] = None
    suggested_file_path: Optional[str] = None
    interactive_questions: Optional[str] = None
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