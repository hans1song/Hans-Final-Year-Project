from abc import ABC, abstractmethod
from typing import Dict, Any

class LanguageStrategy(ABC):
    """
    Abstract Base Class for language-specific strategies.
    Defines the interface for analysis, prompt generation, and test execution configuration.
    """

    @property
    @abstractmethod
    def language_id(self) -> str:
        pass

    @abstractmethod
    def analyze_code(self, code: str) -> Dict[str, Any]:
        """
        Analyzes the source code structure (classes, functions, imports).
        """
        pass

    @abstractmethod
    def get_test_prompt_template(self) -> str:
        """
        Returns the prompt template specifically tuned for this language.
        """
        pass
    
    @abstractmethod
    def get_suggested_test_path(self, source_file_path: str) -> str:
        """
        Determines the conventional test file path based on the source path.
        """
        pass
