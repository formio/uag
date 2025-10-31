# Optional Fields Available

All required fields have been collected for your **<%= form.title %>** form.

**Would you like to fill out any optional fields?**

There are <%= totalOptionalFields %> optional fields available:
<%= optionalFields %>

If values for any of these fields are already provided, then skip to the `collect_field_data` tool to add those additional fields. Otherwise, use the following options.

**Options:**
- Say "yes" or "I'd like to fill optional fields" to add optional information
- Say "no" or "skip optional fields" to proceed with just the required information
- Say the name of a specific field you'd like to fill (e.g., "email")

Use the `collect_field_data` tool to collect any optional fields the user wants to fill.

If they wish to skip the collection of optional fields, then use the `submit_completed_form` to submit the required data to the form.
