from typing import Dict, Any
from core.languages.factory import LanguageFactory

class CodeAnalyzer:
    """
    Analyzes source code to extract structural metadata (AST-like)
    to improve the context for LLM prompt generation.
    """

    @staticmethod
    def analyze(code: str, language: str) -> Dict[str, Any]:
        try:
            strategy = LanguageFactory.get_strategy(language)
            result = strategy.analyze_code(code)
            result["language"] = language
            return result
        except ValueError as e:
             return {"error": f"Analysis not supported: {str(e)}"}
        except Exception as e:
            return {"error": f"Analysis Failed: {str(e)}"}
