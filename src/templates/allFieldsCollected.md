**All required fields have been collected for <%= parentLabel %>.**

<%= dataSummary %>
**Next Steps**:
<% if (parent && parent.isTable) { %>
1. Use the `get_form_fields` tool with `parent_path`="<%= parent.data_path %>" and `criteria`="optional" to check if there are optional fields for this row. If so, ask the user if they wish to fill any of them out for this row.
2. If no other optional fields need to be provided, and another row of information is required for the **<%= parent.label %>** component, then use the `collect_field_data` tool to collect any additional required rows.
3. If no additionial required rows are needed, then ask the user if they wish to "Add Another" (add another row to the **<%= parent.label %>** component). If they affirm, then use the `collect_field_data` tool to collect the next row's data. Make sure to increment the row index for the fields within **<%= parent.data_path %>** data_path when collecting data for the next row (e.g. <%= parent.data_path %>[<%= rowIndex %>] => <%= parent.data_path %>[<%= (rowIndex + 1) %>]).
4. If they do not wish to "Add Another", then use the `get_form_fields` tool to determine if there are any more fields that need to be collected outside of the **<%= parent.label %>** component. If so, use the `collect_field_data` tool to collect that information (make sure to change the `parent_path` parameter to the level above the **<%= parent.label %>** field, or leave empty if we are at the root of the form).
<% } else if (parent && (parent.isForm || parent.isContainer)) { %>
1. Use the `get_form_fields` tool with `parent_path`="<%= parent.data_path %>" and `criteria`="optional" to check if there are any optional fields. If so, ask the user if they wish to fill any of them out.
2. If there are no optional fields, or the user does not wish to add any more values to the <%= parent.label %> component, then use the `get_form_fields` tool to determine if there are any more fields that need to be collected outside of the <%= parent.label %> component. If so, use the `collect_field_data` tool to collect that information (make sure to change the parent parameter to the level above the <%= parent.label %> field, or leave empty if we are at the root of the form).
<% } else { %>
1. Use the `get_form_fields` tool with `criteria`="optional" to check if there are optional fields. If so, ask the user if they wish to fill any of them out.
2. If there are no optional fields then use the `submit_completed_form` tool to submit the data. If necessary, use the `confirm_form_submission` tool to provide them a summary of the collected values before submission.
3. If there are optional fields, but the user does not want to add anything else, use the `submit_completed_form` tool to submit the data. If necessary, use the `confirm_form_submission` tool to provide them a summary of the collected values.<% } %>