## Detailed field field information for <%= parentLabel %>
<% if (parent) { %>
All values for these fields should be stored within the parent path of "<%= parent.data_path %>" (e.g. "<%= parentDataPath %>.childField")
<% } %>
### Field Information
<%= fields %>
<%= rules %>

Use the `collect_field_data` tool<% if (parent) { %> with the `parent_path`="<%= parent.data_path %>"<% } %> to collect field information that the user has provided, or use the `submission_update` tool to update existing records with new or modified values.