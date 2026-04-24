from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class TestCase(BaseModel):
    id: str = Field(description="A unique identifier for the test case, e.g., 'test_balance_exact_20000'.")
    intent: str = Field(description="A brief explanation of what this test case is verifying and why.")
    expected_behavior: str = Field(description="The expected behavior or outcome according to the specifications.")
    code: str = Field(description="The source code for this specific test case method/function.")

class AgentOutput(BaseModel):
    """
    Structured output from the Test Generation Agent.
    """
    explanation: str = Field(description="A brief Markdown explanation of the generated tests and strategy.")
    interactive_questions: Optional[List[str]] = Field(default=[], description="A list of questions for the developer to clarify ambiguities or edge cases.")
    imports_and_setup: str = Field(default="", description="The required import statements and any setup/teardown methods or class definitions needed for the tests.")
    test_cases: List[TestCase] = Field(default=[], description="A list of the generated independent test cases.")

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

class ProposedTestCase(BaseModel):
    scenario: str = Field(description="The description of the test scenario.")
    inputs: str = Field(description="A string representation of the inputs for the test case.")
    expected_output: str = Field(description="A string representation of the expected output.")

class TestGenerationResponse(BaseModel):
    """
    Defines the structure for the outgoing response from the /generate_tests endpoint.
    """
    status: str
    imports_and_setup: Optional[str] = None
    test_cases: Optional[List[Dict[str, Any]]] = None
    suggested_file_path: Optional[str] = None
    interactive_questions: Optional[str] = None
    proposed_plan: Optional[List[ProposedTestCase]] = None
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