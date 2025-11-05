# Confirm Form Submission

All the required information for <%= parentLabel %> has been collected.

Display the following information to the user for them to confirm if it looks accurate.

<%= dataSummary %>

**Please confirm:** Does this information look correct? 

- Say or type "yes" or "confirm" to submit this form
- Say or type "no" or "cancel" to make changes
- Tell me which field you'd like to modify if you need to make changes

Only use `submit_completed_form` if the user explicitly confirms (says "yes", "confirm", "submit", etc.).