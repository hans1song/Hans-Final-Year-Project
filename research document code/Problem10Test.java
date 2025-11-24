package com.cm;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.lang.reflect.Field;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class Problem10Test {

    // Initial state constants, used for resetting
    private static final int INIT_A1 = 23;
    private static final int INIT_A19 = 9;
    private static final int INIT_A10 = 0;
    private static final int INIT_A12 = 0;
    private static final int INIT_A4 = 14;

    // Input range
    private static final int[] INPUTS = {2, 3, 4, 5, 6};

    /**
     * Forcibly reset the internal static state of Problem10 before each test run.
     * This is critical for testing stateful static classes.
     */
    @BeforeEach
    void resetState() throws Exception {
        setStaticField("a1", INIT_A1);
        setStaticField("a19", INIT_A19);
        setStaticField("a10", INIT_A10);
        setStaticField("a12", INIT_A12);
        setStaticField("a4", INIT_A4);
        
        // Reset auxiliary variables (although they act mostly as constants in logic, just to be safe)
        setStaticField("inputC", 3);
        setStaticField("inputD", 4);
        setStaticField("inputE", 5);
        setStaticField("inputF", 6);
        setStaticField("inputB", 2);
    }

    private void setStaticField(String fieldName, int value) throws Exception {
        Field field = Problem10.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        field.setInt(null, value);
    }

    /**
     * Basic Smoke Test: Verify if inputs in the initial state cause a crash or return expected values.
     */
    @Test
    @DisplayName("Basic Smoke Test - Verify logic runs without immediate crash")
    void testBasicExecution() {
        assertDoesNotThrow(() -> {
            int result = Problem10.calculate_output(4);
            // Based on logic analysis, input 4 in the initial state won't change a10/a19, only a1.
            // Should not throw exception.
            assertTrue(result != -2);
        });
    }

    /**
     * Stress Test: Automated State Space Exploration (BFS).
     * This test doesn't rely on manual calculation but uses algorithms to automatically find paths that trigger verifyError.
     * Goal: Trigger as many different verifyError messages as possible.
     */
    @Test
    @DisplayName("Bug Hunter - BFS Exploration to find Crash Paths")
    void testExploreStateSpaceForBugs() throws Exception {
        // Record found error messages
        Set<String> foundBugs = new HashSet<>();
        
        // BFS Queue: stores (current input sequence)
        Queue<List<Integer>> queue = new LinkedList<>();
        queue.add(new ArrayList<>());

        // Record visited state hashes (a10 + "_" + a19 + "_" + a1) to prevent infinite loops.
        // Note: a1 changes significantly; to avoid state explosion, we limit search depth or state count.
        Set<String> visitedStates = new HashSet<>();
        
        int maxDepth = 15; // Maximum length of search sequence
        int maxStates = 50000; // Maximum explored states to prevent OutOfMemory
        int bugCount = 0;

        System.out.println("Starting BFS State Exploration...");

        while (!queue.isEmpty() && visitedStates.size() < maxStates) {
            List<Integer> history = queue.poll();

            // If sequence is too long, abandon this branch
            if (history.size() > maxDepth) continue;

            // Reset state to initial point to replay history
            resetState();

            // Replay history and check if it still survives
            boolean crashedDuringReplay = false;
            try {
                for (int input : history) {
                    Problem10.calculate_output(input);
                }
            } catch (RuntimeException e) {
                // The history path itself is problematic (theoretically shouldn't happen as it was checked before adding to queue)
                crashedDuringReplay = true;
            }
            
            if (crashedDuringReplay) continue;

            // Get the state after replay as a fingerprint
            String stateFingerprint = getCurrentStateFingerprint();

            // Try all possible next inputs
            for (int nextInput : INPUTS) {
                // Reset again and replay to current point (to maintain a clean environment)
                resetState();
                try {
                    for (int input : history) {
                        Problem10.calculate_output(input);
                    }
                    
                    // --- Critical Step: Execute new input ---
                    Problem10.calculate_output(nextInput);
                    
                    // If no crash, record new state and add to queue
                    String newStateFingerprint = getCurrentStateFingerprint();
                    
                    // Only dig deeper if this new state (a1, a10, a19) hasn't been seen...
                    // or if the path is short, allow some repetition to cover different arithmetic paths
                    if (!visitedStates.contains(newStateFingerprint)) {
                        visitedStates.add(newStateFingerprint);
                        List<Integer> newHistory = new ArrayList<>(history);
                        newHistory.add(nextInput);
                        queue.add(newHistory);
                    }

                } catch (RuntimeException e) {
                    // !!! Bug Caught !!!
                    String msg = e.getMessage();
                    if (!foundBugs.contains(msg)) {
                        foundBugs.add(msg);
                        bugCount++;
                        
                        List<Integer> crashPath = new ArrayList<>(history);
                        crashPath.add(nextInput);
                        
                        System.out.println("--------------------------------------------------");
                        System.out.println(" [SUCCESS] Found Bug #" + bugCount + ": " + msg);
                        System.out.println(" Input Sequence: " + crashPath);
                        System.out.println(" Final State causing crash: " + getCurrentStateInfo());
                        System.out.println("--------------------------------------------------");
                    }
                }
            }
        }
        
        System.out.println("Exploration finished.");
        System.out.println("Total unique bugs found: " + foundBugs.size());
        System.out.println("Bug IDs: " + foundBugs);
        
        // Assert we should have found at least some bugs, proving code complexity and test validity.
        assertTrue(foundBugs.size() > 0, "Should have found at least one bug in the logic.");
    }

    /**
     * Targeted manual test for specific logic branches (based on code reverse engineering).
     * This is an example showing how an AI would attack if it "reads" the code.
     */
    @Test
    @DisplayName("Targeted Attack - Transition to a10=1")
    void testTransitionLogic() {
        // Analyze code:
        // Initial: a10=0, a19=9, a1=23
        // Condition: input=6 && ... -> Enters "else if... a1 = ... a10=1; return 25;"
        
        // Attempt to trigger
        assertDoesNotThrow(() -> {
            int res = Problem10.calculate_output(6);
            // Verify if output matches the return of that branch
            assertEquals(25, res, "Input 6 should trigger transition returning 25");
            
            // Verify if state has changed
            assertEquals(1, getStaticInt("a10"), "a10 should transition to 1");
        });
    }
    
    @Test
    @DisplayName("Fuzzing Test - Random Walk")
    void testRandomFuzzing() throws Exception {
        Random rand = new Random(42); // Fixed seed for reproducibility
        int maxSteps = 10000;
        
        for (int i = 0; i < 100; i++) { // Run 100 rounds of random tests
            resetState();
            try {
                for (int j = 0; j < 50; j++) { // Walk at most 50 steps per round
                    int input = INPUTS[rand.nextInt(INPUTS.length)];
                    Problem10.calculate_output(input);
                }
            } catch (RuntimeException e) {
                // Ignore errors; Fuzzing is mainly to ensure long-running execution doesn't cause
                // JVM crash or StackOverflow. Actual bug catching is handled by the BFS test above.
            }
        }
    }

    // --- Helper Methods ---

    private int getStaticInt(String fieldName) throws Exception {
        Field field = Problem10.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.getInt(null);
    }

    private String getCurrentStateFingerprint() throws Exception {
        // State fingerprint: a10 (main FSM), a19 (secondary FSM), a1 (arithmetic value)
        // a1 can be very large. To reduce state space, we could use ranges or modulo,
        // but for accuracy, we record it directly here. If BFS is too slow, consider recording only a10 and a19.
        return getStaticInt("a10") + "|" + getStaticInt("a19") + "|" + getStaticInt("a1");
    }
    
    private String getCurrentStateInfo() throws Exception {
         return String.format("a1=%d, a10=%d, a19=%d", 
             getStaticInt("a1"), getStaticInt("a10"), getStaticInt("a19"));
    }
}
