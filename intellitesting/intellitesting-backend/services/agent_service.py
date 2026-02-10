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
    test_code: str
):
    """
    Submits the final test generation result.
    Call this tool ONLY when you have successfully generated a comprehensive test suite.
    
    Args:
        explanation: A brief Markdown explanation of the strategy.
        interactive_questions: Questions for the user about edge cases (if any).
        test_code: The final source code of the test file.
    """
    return "Result submitted successfully."

# 1. Define Agent State
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    file_content: str
    selected_code: str
    language: str
    framework: str
    final_test_code: str
    interactive_questions: Optional[List[str]]
    iterations: int

# 2. Setup LLM and Tools
# Using gemini-1.5-flash for balanced speed and capability
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=os.getenv("GEMINI_API_KEY"),
    temperature=0
)

tools = [analyze_source_code, run_unit_tests, read_file, submit_final_result]
llm_with_tools = llm.bind_tools(tools)

# 3. Define Nodes

def agent_node(state: AgentState):
    """
    The brain of the agent. Decides to call a tool or return the final code.
    """
    messages = state["messages"]

    # Invoke LLM
    try:
        print("--- Invoking LLM ---")
        response = llm_with_tools.invoke(messages)
        print(f"DEBUG: LLM Response Type: {type(response)}")
        print(f"DEBUG: LLM Tool Calls: {response.tool_calls}")
        if response.content:
            print(f"DEBUG: LLM Content (Truncated): {str(response.content)[:100]}...")
    except Exception as e:
        print(f"ERROR: LLM Invocation Failed: {e}")
        # Fallback if LLM fails
        response = AIMessage(content=f"Error invoking LLM: {str(e)}")
    
    # Update iteration count
    iterations = state.get("iterations", 0) + 1
    
    return {
        "messages": [response],
        "iterations": iterations
    }

def tool_node_wrapper(state: AgentState):
    """
    Wraps the standard ToolNode to inspect outputs for our logic.
    """
    messages = state["messages"]
    last_message = messages[-1]
    
    # Ensure the last message actually has tool calls
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        print("DEBUG: No tool calls in last message.")
        return {"messages": []}

    tool_calls = last_message.tool_calls
    print(f"DEBUG: Processing {len(tool_calls)} tool calls...")
    outputs = []
    
    final_code_update = None
    questions_update = None
    
    for tool_call in tool_calls:
        tool_name = tool_call["name"]
        print(f"DEBUG: Executing Tool: {tool_name}")
        tool_args = tool_call["args"]
        
        result_content = ""
        
        if tool_name == "submit_final_result":
            final_code_update = tool_args.get("test_code")
            questions_update = tool_args.get("interactive_questions", [])
            result_content = "Submission accepted."
            
        elif tool_name == "run_unit_tests":
            # ... (rest of run_unit_tests logic) ...
            # Capture the code being tested as a potential final candidate
            final_code_update = tool_args.get("test_code")
            
            # Execute tool
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

        outputs.append(ToolMessage(
            content=result_content,
            name=tool_name, 
            tool_call_id=tool_call["id"]
        ))

    update_dict = {"messages": outputs}
    if final_code_update:
        update_dict["final_test_code"] = final_code_update
    if questions_update is not None:
        update_dict["interactive_questions"] = questions_update
        
    return update_dict

def should_continue(state: AgentState):
    """
    Decides whether to continue the loop or stop.
    """
    messages = state["messages"]
    last_message = messages[-1]
    
    # If LLM didn't call tools, it's done (Fallback)
    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return END

    # If Submit tool was called, we are done
    for tool_call in last_message.tool_calls:
        if tool_call["name"] == "submit_final_result":
            return END

    # Check for max iterations (Safety break)
    if state["iterations"] > 8:
        return END
        
    return "tools"

def check_test_results(state: AgentState):
    """
    After tools run, check if tests passed.
    """
    messages = state["messages"]
    # The last messages are ToolMessages added by tool_node_wrapper
    
    all_passed = False
    ran_tests = False
    
    # Iterate backwards to find the latest run_unit_tests result
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage) and msg.name == "run_unit_tests":
            ran_tests = True
            content = msg.content
            try:
                data = json.loads(content)
                if data.get("passed") is True:
                    all_passed = True
                else:
                    all_passed = False # Explicit failure
            except json.JSONDecodeError:
                all_passed = False
            break # Only check the most recent test run
            
    if ran_tests and all_passed:
        return END
    
    # If tests failed, or if we only ran analysis, continue back to agent
    return "agent"

# 4. Compile Graph
workflow = StateGraph(AgentState)

workflow.add_node("agent", agent_node)
workflow.add_node("tools", tool_node_wrapper)

workflow.set_entry_point("agent")

workflow.add_conditional_edges(
    "agent",
    should_continue,
    {
        "tools": "tools",
        END: END
    }
)

workflow.add_conditional_edges(
    "tools",
    check_test_results,
    {
        "agent": "agent",
        END: END
    }
)

app = workflow.compile()
