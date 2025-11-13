import os
import time
from dotenv import load_dotenv
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_google_genai import ChatGoogleGenerativeAI

# Load environment variables from .env file
load_dotenv()

# Initialize the Gemini LLM
# This replaces the FakeLLM with a real implementation using Google's Gemini Pro.
# It requires the GEMINI_API_KEY to be set in the .env file.
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=os.getenv("GEMINI_API_KEY"))

def generate_tests_for_code(selected_code: str, configuration: dict, framework: str, language: str):
    """
    Generates test code using the Gemini LLM based on the provided code and configuration.

    Args:
        selected_code: The code snippet to generate tests for.
        configuration: Project configuration details.
        framework: The target testing framework.
        language: The programming language of the code.

    Returns:
        A dictionary containing the generated test code and a suggested file path.
    """
    
    # 1. Define the prompt template for the LLM
    prompt_template = PromptTemplate.from_template(
        """You are an expert test code generation assistant.

        **Context:**
        - Programming Language: {language}
        - Testing Framework: {framework}
        - Project Configuration: {configuration}

        **Task:**
        Based on the **Code to Test** provided below, generate a complete, runnable unit test file.

        **Crucial Instructions:**
        1.  The output must **only** contain the test code (imports and the test class, e.g., `MyMathUtilsTest`).
        2.  Do **NOT** include the original **Code to Test** (e.g., `MyMathUtils`) in your response. The test file should assume the original code is in a separate file and accessible on the classpath.
        3.  The test must strictly adhere to the syntax and conventions of the '{framework}' framework.
        4.  The output must be a clean code block, starting *immediately* with the `import` statements, and contain *only* the test file contents. Do not add any extra explanations, introductory text, or markdown formatting like ```java.

        **Code to Test:**
        ```
        {code}
        ```
        """
    )

    # 2. Create a LangChain chain
    chain = prompt_template | llm | StrOutputParser()

    # 3. Invoke the chain with the provided context
    generated_code = chain.invoke({
        "language": language,
        "framework": framework,
        "configuration": str(configuration), # Convert dict to string for the prompt
        "code": selected_code
    })

    # 4. Determine a suggested file path (basic example)
    if language== "java":  suggested_path = f"src/test/{language}/generated/TestGeneratedtest.java"
    if language== "python": suggested_path =f"src/test/{language}/generated/TestGeneratedtest.py"



    return {
        "test_code": generated_code,
        "suggested_file_path": suggested_path
    }