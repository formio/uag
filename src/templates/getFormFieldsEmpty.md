No fields were found matching `criteria`="<%= criteria %>" for <%= parentLabel %>.

**Next Steps**:
<% if (parent && parent.isTable) { %>
 - Ask the user if they wish to "Add Another" (add another row to the **<%= parent.label %>** component). If they affirm, then use the `collect_field_data` tool to collect the next row's data. Make sure to increment the row index for the fields within **<%= parent.data_path %>** data_path when collecting data for the next row (e.g. <%= parent.data_path %>[<%= rowIndex %>] => <%= parent.data_path %>[<%= (rowIndex + 1) %>]).
<% } else if (parent) { %>
 - Considering the search was made using a `parent_path` context, try the search again at a higher `parent_path` context.
<% } else if (criteria === "optional") { %>
 - Since there are no more "optional" fields, use the `submit_completed_form` tool to submit all the information if the user confirms they wish to do so, if necessary use the `confirm_form_submission` tool to ensure all the collected information is correct.
<% } else if (criteria === "required") { %>
 - Use the `get_form_fields` tool, with `criteria`="optional" to determine if there are any optional fields they wish to provide information for.
<% } else { %>
 - Use the `submit_completed_form` tool to submit all the information if the user confirms they wish to do so, if necessary use the `confirm_form_submission` tool to ensure all the collected information is correct.
<% } %>