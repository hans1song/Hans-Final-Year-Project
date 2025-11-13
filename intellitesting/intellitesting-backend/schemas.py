
from pydantic import BaseModel
from typing import Optional, Dict, Any

class TestGenerationRequest(BaseModel):
    """
    Defines the structure for the incoming request to the /generate_tests endpoint.
    """
    selected_code: str
    language: str
    configuration: Dict[str, Any]
    framework: str

class TestGenerationResponse(BaseModel):
    """
    Defines the structure for the outgoing response from the /generate_tests endpoint.
    """
    status: str
    test_code: Optional[str] = None
    suggested_file_path: Optional[str] = None
    error_message: Optional[str] = None
