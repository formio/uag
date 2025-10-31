# Confirm Form Submission

All the required information for your **<%= form.title %>** form has been collected.

Please review the following data before submission:

<%= dataSummary %>

**Please confirm:** Does this information look correct? 

- Say or type "yes" or "confirm" to submit this form
- Say or type "no" or "cancel" to make changes
- Tell me which field you'd like to modify if you need to make changes

Only use `submit_completed_form` if the user explicitly confirms (says "yes", "confirm", "submit", etc.).

**Current Data**:
<%= JSON.stringify(currentData, null, 2) %>