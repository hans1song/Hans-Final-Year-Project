from core.languages.strategy import LanguageStrategy
from core.languages.python_strategy import PythonStrategy
from core.languages.java_strategy import JavaStrategy

class LanguageFactory:
    _strategies = {
        "python": PythonStrategy(),
        "java": JavaStrategy()
    }

    @classmethod
    def get_strategy(cls, language: str) -> LanguageStrategy:
        strategy = cls._strategies.get(language.lower())
        if not strategy:
            # Fallback or Error? 
            # For now, let's default to Python or raise error. 
            # Raising error is safer for this strict architecture.
            raise ValueError(f"Unsupported language: {language}")
        return strategy
