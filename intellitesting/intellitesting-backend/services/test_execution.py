from core.test_runner import TestRunner

class TestExecutionService:
    @staticmethod
    def execute_tests(language: str, test_code: str):
        """
        Executes the provided test code using the appropriate runner.
        """
        return TestRunner.run_test(language, test_code)
