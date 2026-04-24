import os
import operator
import json
from typing import TypedDict, Annotated, List, Union, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage, ToolMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from core.tools import run_unit_tests, analyze_source_code, read_file
from dotenv import load_dotenv

load_dotenv()

from langchain_core.tools import tool
from schemas import AgentOutput

@tool
def submit_final_result(
    explanation: str, 
    interactive_questions: List[str], 
    imports_and_setup: str,
    test_cases: List[dict]
):
    """
    Submits the final test generation result.
    Call this tool ONLY when you have successfully generated a comprehensive test suite.
    
    Args:
        explanation: A brief Markdown explanation of the strategy.
        interactive_questions: Questions for the user about edge cases (if any).
        imports_and_setup: The required import statements and any setup/teardown methods.
        test_cases: A list of dicts representing the generated independent test cases. Each dict must have 'id', 'intent', 'expected_behavior', and 'code' keys.
    """
    return "Result submitted successfully."

@tool
def submit_test_plan(
    explanation: str,
    plan_cases: List[dict]
):
    """
    Submits a proposed test plan for user review when no specification is provided.
    Call this tool ONLY when you are in Interactive Mode and have a test plan ready.
    Do NOT generate code yet.
    
    Args:
        explanation: A brief summary of the test plan.
        plan_cases: A list of dicts, where each dict has 'scenario', 'inputs', and 'expected_output' keys.
    """
    return "Test plan submitted for user review."

# 1. Define Agent State
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    file_content: str
    selected_code: str
    language: str
    framework: str
    final_test_code: str
    imports_and_setup: str
    test_cases: List[dict]
    proposed_plan: List[dict]
    interactive_questions: Optional[List[str]]
    iterations: int

# 2. Setup LLM and Tools
tools = [analyze_source_code, run_unit_tests, read_file, submit_final_result, submit_test_plan]

# Cache for the default (server-key) app to avoid rebuilding every request
_default_app = None

def build_agent_app(api_key: str = None):
    """Build a compiled LangGraph app, optionally with a user-provided API key."""
    global _default_app
    resolved_key = api_key or os.getenv("GEMINI_API_KEY")

    # Return cached app if using the server's default key
    if not api_key and _default_app is not None:
        return _default_app

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=resolved_key,
        temperature=0
    )
    llm_with_tools = llm.bind_tools(tools)

    compiled = _compile_graph(llm_with_tools)

    if not api_key:
        _default_app = compiled

    return compiled

def _compile_graph(llm_with_tools):
    """Compile a LangGraph agent with the given LLM."""

    def agent_node(state: AgentState):
        messages = state["messages"]
        try:
            print("--- Invoking LLM ---")
            response = llm_with_tools.invoke(messages)
            print(f"DEBUG: LLM Response Type: {type(response)}")
            print(f"DEBUG: LLM Tool Calls: {response.tool_calls}")
            if response.content:
                print(f"DEBUG: LLM Content (Truncated): {str(response.content)[:100]}...")
        except Exception as e:
            print(f"ERROR: LLM Invocation Failed: {e}")
            response = AIMessage(content=f"Error invoking LLM: {str(e)}")
        iterations = state.get("iterations", 0) + 1
        return {"messages": [response], "iterations": iterations}

    def tool_node_wrapper(state: AgentState):
        messages = state["messages"]
        last_message = messages[-1]
        if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
            return {"messages": []}

        tool_calls = last_message.tool_calls
        print(f"DEBUG: Processing {len(tool_calls)} tool calls...")
        outputs = []
        final_code_update = None
        imports_update = None
        cases_update = None
        plan_update = None
        questions_update = None

        for tool_call in tool_calls:
            tool_name = tool_call["name"]
            print(f"DEBUG: Executing Tool: {tool_name}")
            tool_args = tool_call["args"]
            result_content = ""

            if tool_name == "submit_final_result":
                imports_update = tool_args.get("imports_and_setup", "")
                cases_update = tool_args.get("test_cases", [])
                questions_update = tool_args.get("interactive_questions", [])
                result_content = "Submission accepted."
            elif tool_name == "submit_test_plan":
                plan_update = tool_args.get("plan_cases", [])
                questions_update = [tool_args.get("explanation", "Please review the proposed test plan.")]
                result_content = "Test plan submission accepted."
            elif tool_name == "run_unit_tests":
                final_code_update = tool_args.get("test_code")
                try:
                    result = run_unit_tests.invoke(tool_args)
                    result_content = result
                except Exception as e:
                    result_content = json.dumps({"passed": False, "error_message": f"Tool execution failed: {str(e)}"})
            elif tool_name == "analyze_source_code":
                try:
                    result = analyze_source_code.invoke(tool_args)
                    result_content = result
                except Exception as e:
                    result_content = f"Analysis failed: {str(e)}"
            elif tool_name == "read_file":
                try:
                    result = read_file.invoke(tool_args)
                    result_content = result
                except Exception as e:
                    result_content = f"Read file failed: {str(e)}"
            else:
                result_content = f"Unknown tool: {tool_name}"

            outputs.append(ToolMessage(content=result_content, name=tool_name, tool_call_id=tool_call["id"]))

        update_dict = {"messages": outputs}
        if final_code_update:
            update_dict["final_test_code"] = final_code_update
        if imports_update is not None:
            update_dict["imports_and_setup"] = imports_update
        if cases_update is not None:
            update_dict["test_cases"] = cases_update
        if plan_update is not None:
            update_dict["proposed_plan"] = plan_update
        if questions_update is not None:
            update_dict["interactive_questions"] = questions_update
        return update_dict

    def should_continue(state: AgentState):
        messages = state["messages"]
        last_message = messages[-1]
        if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
            return END
        if state["iterations"] > 8:
            return END
        return "tools"

    def check_test_results(state: AgentState):
        messages = state["messages"]
        for msg in reversed(messages):
            if not isinstance(msg, ToolMessage):
                break
            if msg.name in ["submit_final_result", "submit_test_plan"]:
                return END
        for msg in reversed(messages):
            if not isinstance(msg, ToolMessage):
                break
            if msg.name == "run_unit_tests":
                try:
                    data = json.loads(msg.content)
                    if data.get("passed") is True:
                        return END
                except json.JSONDecodeError:
                    pass
                break
        return "agent"

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node_wrapper)
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_conditional_edges("tools", check_test_results, {"agent": "agent", END: END})
    return workflow.compile()
