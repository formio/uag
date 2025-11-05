**All required fields have been collected for <%= parentLabel %>.**
<%= dataSummary %>
**Next Steps**:
<% if (parent && parent.isTable) { %>
1. Use the `get_form_fields` tool with `parent_path`="<%= parent.data_path %>" and `criteria`="optional" to check if there are optional fields. If so, ask the user if they wish to fill any of them out for this row.
2. If there are no optional fields, or the user declines, then ask the user if they wish to "Add Another" (add another row to this parent component). If they affirm, then use the `collect_field_data` tool to collect the next row's data. Make sure to increment the row index for the fields within this parent component (e.g. <%= parent.data_path %>[<%= rowIndex %>] => <%= parent.data_path %>[<%= (rowIndex + 1) %>]) when collecting data for the next row.
3. If they do not wish to "Add Another", then use the `get_form_fields` tool to determine if there are any more fields that need to be collected outside of the <%= parent.label %> component. If so, use the `collect_field_data` tool to collect that information (make sure to change the `parent_path` parameter to the level above the <%= parent.label %> field, or leave empty if we are at the root of the form).
<% } else if (parent && (parent.isForm || parent.isContainer)) { %>
1. Use the `get_form_fields` tool with `parent_path`="<%= parent.data_path %>" and `criteria`="optional" to check if there are any optional fields. If so, ask the user if they wish to fill any of them out.
2. If there are no optional fields, or the user declines, then use the `get_form_fields` tool to determine if there are any more fields that need to be collected outside of the <%= parent.label %> component. If so, use the `collect_field_data` tool to collect that information (make sure to change the parent parameter to the level above the <%= parent.label %> field, or leave empty if we are at the root of the form).
<% } else { %>
1. Use the `get_form_fields` tool with `criteria`="optional" to check if there are optional fields. If so, ask the user if they wish to fill any of them out.
2. If there are no optional fields, or the user declines, then use the `confirm_form_submission` tool to show summary and get confirmation to submit the form.<% } %>