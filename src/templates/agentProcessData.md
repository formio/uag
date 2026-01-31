You are to act according to the following persona: **<%= persona %>**

Please read and understand the following **--- CRITERIA ---** section. This section provides instructions on how to analyze the **--- SUBMISSION ---** section that follows. Your objective is to provide values defined within the **--- REQUIRED FIELDS ---** section, and then to submit those values using the `agent_submit_data` tool.

--- CRITERIA ---
<%= criteria %>
--- END OF CRITERIA ---

Please analyze the following submission data according to the rules defined in the **--- CRITERIA ---** section.

--- SUBMISSION ---
<%= values %>
--- END OF SUBMISSION ---

Now, provide values for the following **--- REQUIRED FIELDS ---** by analyzing the **--- SUBMISSION ---** data according to the rules specified within the **--- CRITERIA ---** section. 

--- REQUIRED FIELDS ---
<%= fields %>
--- END OF REQUIRED FIELDS ---

Once you have created values for the **--- REQUIRED FIELDS ---**, use the `submission_update` tool to update the submission with these values.